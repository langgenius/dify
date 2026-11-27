"""Persist personal WebApp usage and preferences, seeding recent usage only.

Revision ID: 6a1f3e8c2d47
Revises: 4f2a90b8c317
Create Date: 2026-11-04 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.engine import Connection

from models.types import StringUUID

revision = "6a1f3e8c2d47"
down_revision = "4f2a90b8c317"
branch_labels = None
depends_on = None


def backfill_recent_usage(connection: Connection) -> None:
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


def upgrade() -> None:
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
    backfill_recent_usage(op.get_bind())


def downgrade() -> None:
    op.drop_table("account_webapps")
