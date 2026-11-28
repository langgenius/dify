"""Add End User identity, Connections, and personal WebApp state.

Revision ID: 6ef794ace1e2
Revises: 6b1d2f4e8a90
Create Date: 2026-11-27 17:55:00.000000

PostgreSQL performs restartable work on live tables first. The final schema
changes and Alembic's revision stamp share a transaction. On downgrade, restore
and remove live indexes first, then drop feature schema atomically with the stamp.
Offline SQL assumes the exact declared starting schema. See migrations/README.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.engine import Connection

from migrations.builder_workspace_origin_v1 import ORIGIN_COLUMN, POSTGRES_BACKFILL
from migrations.postgresql_online_v1 import IndexSpec, create_indexes, drop_indexes, nullable_column_exists
from models.types import LongText, StringUUID

revision = "6ef794ace1e2"
down_revision = "6b1d2f4e8a90"
branch_labels = None
depends_on = None

_ACCOUNT_LINK = IndexSpec(
    "end_users", "end_user_app_account_key", ("tenant_id", "app_id", "type", "account_id"), unique=True
)
_UPLOAD_TENANT = IndexSpec("upload_files", "upload_file_tenant_idx", ("tenant_id",))
_LIVE_INDEXES = (
    IndexSpec("end_users", "end_user_account_apps_idx", ("account_id", "type", "tenant_id", "app_id", "id")),
    IndexSpec(
        "workflow_runs",
        "workflow_run_end_user_recent_idx",
        ("tenant_id", "app_id", "created_by_role", "created_by", "triggered_from", "created_at"),
    ),
    IndexSpec("messages", "message_app_workflow_run_idx", ("app_id", "workflow_run_id", "conversation_id")),
    IndexSpec("upload_files", "upload_file_owner_idx", ("tenant_id", "created_by_role", "created_by")),
    IndexSpec("tool_files", "tool_file_owner_idx", ("tenant_id", "user_id")),
)


def upgrade() -> None:
    """Expand the parent schema or resume a PostgreSQL upgrade without replacing existing records."""
    _add_account_link()
    _create_live_indexes(*_LIVE_INDEXES)
    _drop_live_indexes(_UPLOAD_TENANT)
    _add_and_backfill_builder_origin()

    # No autocommit below this point: a failure before stamping rolls back these changes together.
    _create_personal_connections()
    _create_connection_selections()
    _create_connection_revisions()
    _create_account_webapps()
    _create_installed_app_connections()
    backfill_recent_usage(op.get_bind())

    # Do not hold schema locks on live tables during the usage backfill.
    op.add_column("workflow_runs", sa.Column("connection_context", LongText(), nullable=True))
    op.add_column("accounts", sa.Column("be_end_user_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Restore the parent schema; remove only End User state and preserve existing parent rows."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and not op.get_context().as_sql:
        if not (
            nullable_column_exists(bind, _ACCOUNT_LINK.table, "account_id", StringUUID())
            and _account_link_constraint_exists()
        ):
            raise RuntimeError("Expected the upgraded account link before removing End User state")
        if not nullable_column_exists(bind, "accounts", ORIGIN_COLUMN, sa.DateTime()):
            raise RuntimeError("Expected the upgraded Builder origin before removing End User state")
    _create_live_indexes(_UPLOAD_TENANT)
    _drop_live_indexes(*reversed(_LIVE_INDEXES))

    op.drop_table("installed_app_connection_configurations")
    op.drop_table("account_webapps")
    op.drop_table("end_user_connection_revision_acceptances")
    op.drop_table("end_user_connection_revisions")
    op.drop_table("session_connections")
    op.drop_table("app_connections")
    op.drop_table("end_user_connections")
    op.drop_column("accounts", "be_end_user_at")
    op.drop_column("accounts", ORIGIN_COLUMN)
    op.drop_column("workflow_runs", "connection_context")
    with op.batch_alter_table(_ACCOUNT_LINK.table) as batch:
        batch.drop_constraint(_ACCOUNT_LINK.name, type_="unique")
        batch.drop_column("account_id")


def _account_link_constraint_exists() -> bool:
    """Check the named constraint on the existing table without accepting a mismatched key."""
    constraints = sa.inspect(op.get_bind()).get_unique_constraints(_ACCOUNT_LINK.table)
    named = next((constraint for constraint in constraints if constraint["name"] == _ACCOUNT_LINK.name), None)
    if named is None:
        return False
    if named["column_names"] != list(_ACCOUNT_LINK.columns):
        raise RuntimeError(f"Constraint {_ACCOUNT_LINK.name} does not match the required end-user account key")
    return True


def _add_account_link() -> None:
    """Add a nullable account link and enforce uniqueness without rewriting existing guests."""
    context = op.get_context()
    bind = op.get_bind()
    column = sa.Column("account_id", StringUUID(), nullable=True)
    if bind.dialect.name == "postgresql":
        with context.autocommit_block():
            if context.as_sql or not nullable_column_exists(bind, _ACCOUNT_LINK.table, column.name, column.type):
                op.add_column(_ACCOUNT_LINK.table, column)
        create_indexes(op, _ACCOUNT_LINK)
        with context.autocommit_block():
            if context.as_sql or not _account_link_constraint_exists():
                op.execute(
                    sa.text(
                        "ALTER TABLE end_users ADD CONSTRAINT end_user_app_account_key "
                        "UNIQUE USING INDEX end_user_app_account_key"
                    )
                )
    else:
        with op.batch_alter_table(_ACCOUNT_LINK.table) as batch:
            batch.add_column(column)
            batch.create_unique_constraint(_ACCOUNT_LINK.name, list(_ACCOUNT_LINK.columns))


def _pending_portable_indexes(specs: tuple[IndexSpec, ...], *, dropping: bool) -> tuple[IndexSpec, ...]:
    """Filter online MySQL/SQLite DDL without reusing or dropping mismatched indexes."""
    if op.get_context().as_sql:
        return specs
    inspector = sa.inspect(op.get_bind())
    pending = []
    for spec in specs:
        index = next((item for item in inspector.get_indexes(spec.table) if item["name"] == spec.name), None)
        if index is not None and (
            index["column_names"] != list(spec.columns)
            or index["unique"] != spec.unique
            or index.get("dialect_options")
            or index.get("column_sorting")
        ):
            raise RuntimeError(f"Index {spec.name} differs from the required index on {spec.table}{spec.columns}")
        if (index is not None) == dropping:
            pending.append(spec)
    return tuple(pending)


def _create_live_indexes(*specs: IndexSpec) -> None:
    """Build missing indexes on existing tables; commit PostgreSQL builds independently."""
    if op.get_bind().dialect.name == "postgresql":
        create_indexes(op, *specs)
    else:
        for spec in _pending_portable_indexes(specs, dropping=False):
            op.create_index(spec.name, spec.table, list(spec.columns), unique=spec.unique)


def _drop_live_indexes(*specs: IndexSpec) -> None:
    """Drop only matching indexes without changing rows or unrelated access paths."""
    if op.get_bind().dialect.name == "postgresql":
        drop_indexes(op, *specs)
    else:
        for spec in _pending_portable_indexes(specs, dropping=True):
            op.drop_index(spec.name, table_name=spec.table)


def _add_and_backfill_builder_origin() -> None:
    """Add the origin column and fill legacy origins without overwriting known ones on retry."""
    context = op.get_context()
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with context.autocommit_block():
            if context.as_sql or not nullable_column_exists(bind, "accounts", ORIGIN_COLUMN, sa.DateTime()):
                op.add_column("accounts", sa.Column(ORIGIN_COLUMN, sa.DateTime(), nullable=True))
            op.execute(POSTGRES_BACKFILL)
    else:
        op.add_column("accounts", sa.Column(ORIGIN_COLUMN, sa.DateTime(), nullable=True))
        _backfill_builder_origin_portable()


def _backfill_builder_origin_portable() -> None:
    """Apply the legacy fallback on dialects without PostgreSQL's transactional DO block."""
    accounts = sa.table(
        "accounts",
        sa.column("id", sa.String()),
        sa.column("status", sa.String()),
        sa.column("initialized_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column(ORIGIN_COLUMN, sa.DateTime()),
    )
    tenants = sa.table("tenants", sa.column("id", sa.String()), sa.column("created_at", sa.DateTime()))
    memberships = sa.table(
        "tenant_account_joins",
        sa.column("account_id", sa.String()),
        sa.column("tenant_id", sa.String()),
        sa.column("role", sa.String()),
    )
    first_owned_workspace = (
        sa.select(sa.func.min(tenants.c.created_at))
        .select_from(tenants.join(memberships, memberships.c.tenant_id == tenants.c.id))
        .where(memberships.c.account_id == accounts.c.id, memberships.c.role == "owner")
        .correlate(accounts)
        .scalar_subquery()
    )
    legacy_origin = sa.case(
        (accounts.c.status == "active", sa.func.coalesce(accounts.c.initialized_at, accounts.c.created_at)),
        else_=accounts.c.initialized_at,
    )
    origin = sa.func.coalesce(first_owned_workspace, legacy_origin)
    op.execute(
        accounts.update()
        .where(accounts.c.first_workspace_created_at.is_(None), origin.is_not(None))
        .values(first_workspace_created_at=origin)
    )


def _create_personal_connections() -> None:
    """Create the final connection table with scoped owners and OAuth grant provenance."""
    op.create_table(
        "end_user_connections",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=True),
        sa.Column("end_user_id", StringUUID(), nullable=True),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("credential_type", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("encrypted_credentials", LongText(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("oauth_client_source", sa.String(20), nullable=True),
        sa.Column("oauth_client_configuration_id", StringUUID(), nullable=True),
        sa.Column("oauth_client_id", LongText(), nullable=True),
        sa.Column("oauth_client_fingerprint", sa.String(64), nullable=True),
        sa.Column("oauth_plugin_unique_identifier", sa.String(512), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("account_label", LongText(), nullable=True),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_active_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connections_pkey"),
        sa.CheckConstraint(
            "(account_id IS NOT NULL AND end_user_id IS NULL) OR (account_id IS NULL AND end_user_id IS NOT NULL)",
            name=sa.schema.conv("end_user_connection_owner_check"),
        ),
        sa.CheckConstraint(
            "credential_type IN ('api-key', 'oauth2')", name=sa.schema.conv("end_user_connection_credential_type_check")
        ),
        sa.CheckConstraint(
            "status IN ('connected', 'reconnect_required', 'invalid')",
            name=sa.schema.conv("end_user_connection_status_check"),
        ),
        sa.CheckConstraint(
            "credential_type = 'oauth2' OR account_label IS NULL",
            name=sa.schema.conv("end_user_connection_account_label_check"),
        ),
        sa.CheckConstraint("revision > 0", name=sa.schema.conv("end_user_connection_revision_check")),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("name")).between(1, 100),
            name=sa.schema.conv("end_user_connection_name_check"),
        ),
        sa.CheckConstraint(
            "(credential_type = 'api-key' AND oauth_client_source IS NULL "
            "AND oauth_client_configuration_id IS NULL AND oauth_client_id IS NULL AND expires_at IS NULL) OR "
            "(credential_type = 'oauth2' AND oauth_client_source IS NOT NULL "
            "AND oauth_client_source IN ('workspace', 'platform'))",
            name=sa.schema.conv("end_user_connection_oauth_check"),
        ),
        sa.UniqueConstraint("id", "tenant_id", "provider", name="end_user_connection_scope_key"),
    )
    op.create_index("end_user_connection_account_idx", "end_user_connections", ["tenant_id", "account_id", "id"])
    op.create_index("end_user_connection_end_user_idx", "end_user_connections", ["tenant_id", "end_user_id", "id"])
    op.create_index("end_user_connection_activity_idx", "end_user_connections", ["last_active_at", "id"])
    op.create_index(
        "end_user_connection_consumer_idx", "end_user_connections", ["account_id", "provider", "credential_type", "id"]
    )


def _create_connection_selections() -> None:
    """Create App and Session selections that reference existing scoped personal connections."""
    op.create_table(
        "app_connections",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(255), nullable=False),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("connection_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="app_connections_pkey"),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("node_id")).between(1, 255),
            name=sa.schema.conv("app_connection_node_id_check"),
        ),
        sa.UniqueConstraint("app_id", "end_user_id", "node_id", name="app_connection_selection_key"),
        sa.ForeignKeyConstraint(
            ["connection_id", "tenant_id", "provider"],
            ["end_user_connections.id", "end_user_connections.tenant_id", "end_user_connections.provider"],
            name="app_connection_scope_fkey",
            ondelete="CASCADE",
        ),
    )
    op.create_index("app_connection_connection_idx", "app_connections", ["connection_id"])

    op.create_table(
        "session_connections",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(255), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("connection_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="session_connections_pkey"),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("node_id")).between(1, 255),
            name=sa.schema.conv("session_connection_node_id_check"),
        ),
        sa.UniqueConstraint("app_id", "session_id", "node_id", name="session_connection_selection_key"),
        sa.ForeignKeyConstraint(
            ["connection_id", "tenant_id", "provider"],
            ["end_user_connections.id", "end_user_connections.tenant_id", "end_user_connections.provider"],
            name="session_connection_scope_fkey",
            ondelete="CASCADE",
        ),
    )
    op.create_index("session_connection_connection_idx", "session_connections", ["connection_id"])


def _create_connection_revisions() -> None:
    """Create immutable authorization snapshots and scoped End User acceptances."""
    op.create_table(
        "end_user_connection_revisions",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_revisions_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", "fingerprint", name="end_user_connection_revision_content_key"),
        sa.UniqueConstraint("id", "tenant_id", "app_id", name="end_user_connection_revision_scope_key"),
    )
    op.create_table(
        "end_user_connection_revision_acceptances",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("revision_id", StringUUID(), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("source_revision_id", StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_revision_acceptances_pkey"),
        sa.CheckConstraint(
            "(reason = 'approved' AND source_revision_id IS NULL) OR "
            "(reason = 'inherited' AND source_revision_id IS NOT NULL AND source_revision_id <> revision_id)",
            name=sa.schema.conv("end_user_revision_acceptance_reason_check"),
        ),
        sa.UniqueConstraint(
            "tenant_id", "app_id", "end_user_id", "revision_id", name="end_user_revision_acceptance_end_user_key"
        ),
        sa.ForeignKeyConstraint(
            ["revision_id", "tenant_id", "app_id"],
            [
                "end_user_connection_revisions.id",
                "end_user_connection_revisions.tenant_id",
                "end_user_connection_revisions.app_id",
            ],
            name="end_user_revision_acceptance_scope_fkey",
        ),
        sa.ForeignKeyConstraint(
            ["source_revision_id", "tenant_id", "app_id"],
            [
                "end_user_connection_revisions.id",
                "end_user_connection_revisions.tenant_id",
                "end_user_connection_revisions.app_id",
            ],
            name="end_user_revision_acceptance_source_scope_fkey",
        ),
    )


def _create_account_webapps() -> None:
    """Create account-owned WebApp usage and preference storage before seeding usage."""
    op.create_table(
        "account_webapps",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("favorited_at", sa.DateTime(), nullable=True),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="account_webapps_pkey"),
        sa.UniqueConstraint("account_id", "tenant_id", "app_id", name="account_webapp_owner_key"),
        sa.CheckConstraint(
            "removed_at IS NULL OR favorited_at IS NULL", name=sa.schema.conv("account_webapp_removed_favorite_check")
        ),
    )
    op.create_index(
        "account_webapp_recent_idx", "account_webapps", ["account_id", "removed_at", "last_used_at", "app_id"]
    )
    op.create_index(
        "account_webapp_favorite_idx", "account_webapps", ["account_id", "removed_at", "favorited_at", "app_id"]
    )
    op.create_index("account_webapp_app_idx", "account_webapps", ["tenant_id", "app_id"])


def _create_installed_app_connections() -> None:
    """Create member-scoped Workspace credential selections for Installed Apps."""
    op.create_table(
        "installed_app_connection_configurations",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("installed_app_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("scope_id", sa.String(36), nullable=False),
        sa.Column("connection_revision", StringUUID(), nullable=False),
        sa.Column("connections", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="installed_app_connection_configurations_pkey"),
        sa.UniqueConstraint("installed_app_id", "account_id", "scope_id", name="installed_connection_owner_key"),
    )
    op.create_index("installed_connection_app_idx", "installed_app_connection_configurations", ["tenant_id", "app_id"])


def backfill_recent_usage(connection: Connection) -> None:
    """Seed recent owned WebApp usage into the expanded schema without changing existing preferences."""
    users = sa.table(
        "end_users",
        sa.column("id", StringUUID()),
        sa.column("account_id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("type", sa.String()),
    )
    runs = sa.table(
        "workflow_runs",
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("created_by", StringUUID()),
        sa.column("created_by_role", sa.String()),
        sa.column("triggered_from", sa.String()),
        sa.column("created_at", sa.DateTime()),
    )
    apps = sa.table(
        "apps", sa.column("id", StringUUID()), sa.column("tenant_id", StringUUID()), sa.column("mode", sa.String())
    )
    target = sa.table(
        "account_webapps",
        sa.column("id", StringUUID()),
        sa.column("account_id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("last_used_at", sa.DateTime()),
    )
    # Existing identity IDs seed independent rows without dialect-specific UUID generators.
    source = (
        sa.select(users.c.id, users.c.account_id, users.c.tenant_id, users.c.app_id, sa.func.max(runs.c.created_at))
        .select_from(users)
        .join(apps, sa.and_(apps.c.id == users.c.app_id, apps.c.tenant_id == users.c.tenant_id))
        .join(
            runs,
            sa.and_(
                runs.c.created_by == users.c.id, runs.c.tenant_id == users.c.tenant_id, runs.c.app_id == users.c.app_id
            ),
        )
        .where(
            users.c.account_id.is_not(None),
            users.c.type == "browser",
            apps.c.mode.in_(("advanced-chat", "workflow")),
            runs.c.created_by_role.in_(("end_user", "end-user")),
            runs.c.triggered_from == "app-run",
        )
        .group_by(users.c.id, users.c.account_id, users.c.tenant_id, users.c.app_id)
    )
    columns = ["id", "account_id", "tenant_id", "app_id", "last_used_at"]
    if connection.dialect.name == "postgresql":
        statement = postgresql.insert(target).from_select(columns, source).on_conflict_do_nothing()
    elif connection.dialect.name == "mysql":
        statement = mysql.insert(target).from_select(columns, source).on_duplicate_key_update(id=target.c.id)
    elif connection.dialect.name == "sqlite":
        statement = sqlite.insert(target).from_select(columns, source).on_conflict_do_nothing()
    else:
        raise RuntimeError(f"Unsupported WebApp backfill dialect: {connection.dialect.name}")
    connection.execute(statement)
