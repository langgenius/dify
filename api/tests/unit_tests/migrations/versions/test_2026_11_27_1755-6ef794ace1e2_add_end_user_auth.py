"""Exercise the squash from the parent schema and render both deployment dialects."""

from collections.abc import Iterator
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.account_webapp import AccountWebApp
from models.end_user_connection import (
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevision,
    EndUserConnectionRevisionAcceptance,
    SessionConnection,
)
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.installed_app_connection import InstalledAppConnectionConfiguration
from models.model import App, AppMode, AppStar, EndUser, Message, UploadFile
from models.tools import ToolFile
from models.workflow import WorkflowRun
from tests.helpers.consumer import make_consumer_harness, new_consumer_run
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_auth_migration import create_end_user_parent_schema, end_user_auth_revision
from tests.helpers.end_user_connection_contract import ConnectionPersistenceTests, new_app_selection, new_connection

_FEATURE_MODELS = (
    AccountWebApp,
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevision,
    EndUserConnectionRevisionAcceptance,
    InstalledAppConnectionConfiguration,
    SessionConnection,
)


@pytest.fixture
def parent_connection() -> Iterator[Connection]:
    """Provide a disposable SQLite connection with foreign-key checks enabled."""
    engine = sa.create_engine("sqlite://")
    try:
        with engine.connect() as bind:
            bind.exec_driver_sql("PRAGMA foreign_keys=ON")
            yield bind
    finally:
        engine.dispose()


@pytest.fixture
def connection_session(parent_connection: Connection) -> Iterator[Session]:
    """Run the real revision before exercising persistence contracts against the migrated tables."""
    create_end_user_parent_schema(parent_connection)
    with Operations.context(MigrationContext.configure(parent_connection)):
        end_user_auth_revision.upgrade()
    parent_connection.commit()
    with Session(parent_connection) as session:
        yield session


class TestMigratedConnections(ConnectionPersistenceTests):
    """Require the same constraints when persistence uses migrated tables instead of ORM DDL."""


def _seed_parent_records(bind: Connection, schema: sa.MetaData, *, tenant_status: str) -> None:
    """Seed legacy accounts, ownership, executions, and workspace credentials before expanding."""
    tables = schema.tables
    created = datetime(2019, 1, 1)
    initialized = datetime(2020, 1, 1)
    bind.execute(
        tables["accounts"].insert(),
        [
            {"id": "owner", "status": "active", "initialized_at": initialized, "created_at": created},
            {"id": "removed", "status": "active", "initialized_at": initialized, "created_at": created},
            {"id": "legacy", "status": "active", "initialized_at": None, "created_at": created},
            {"id": "consumer", "status": "uninitialized", "initialized_at": None, "created_at": created},
            {"id": "invited", "status": "pending", "initialized_at": None, "created_at": created},
        ],
    )
    bind.execute(
        tables["tenants"].insert(),
        [
            {"id": "tenant", "status": tenant_status, "created_at": datetime(2020, 2, 1)},
            {"id": "other", "status": "normal", "created_at": datetime(2022, 1, 1)},
        ],
    )
    bind.execute(
        tables["tenant_account_joins"].insert(),
        [
            {"tenant_id": "tenant", "account_id": "owner", "role": "owner"},
            {"tenant_id": "other", "account_id": "owner", "role": "owner"},
            {"tenant_id": "tenant", "account_id": "invited", "role": "normal"},
        ],
    )
    bind.execute(tables["apps"].insert().values(id="app", tenant_id="tenant", mode="workflow"))
    bind.execute(
        tables["end_users"].insert(),
        [
            {"id": identifier, "tenant_id": "tenant", "app_id": "app", "type": "browser", "session_id": "guest"}
            for identifier in ("first", "second")
        ],
    )
    bind.execute(
        tables["workflow_runs"]
        .insert()
        .values(
            id="run",
            tenant_id="tenant",
            app_id="app",
            created_by_role="end_user",
            created_by="first",
            triggered_from="app-run",
            created_at=initialized,
            graph="{}",
        )
    )
    bind.execute(
        tables["messages"].insert().values(id="message", app_id="app", workflow_run_id="run", conversation_id="c")
    )
    bind.execute(
        tables["upload_files"]
        .insert()
        .values(id="upload", tenant_id="tenant", created_by_role="end_user", created_by="first")
    )
    bind.execute(tables["tool_files"].insert().values(id="file", tenant_id="tenant", user_id="first"))
    bind.execute(
        tables["builtin_tool_providers"].insert().values(id="workspace-credential", encrypted_credentials="ciphertext")
    )


@pytest.mark.parametrize("tenant_status", ["normal", "archive"])
def test_upgrade_and_downgrade_preserve_parent_rows(parent_connection: Connection, tenant_status: str) -> None:
    """Build the final schema directly, backfill only legacy origins, and restore the parent on rollback."""
    bind = parent_connection
    parent = create_end_user_parent_schema(bind)
    _seed_parent_records(bind, parent, tenant_status=tenant_status)
    rows = {table.name: bind.execute(table.select().order_by(*table.c)).all() for table in parent.tables.values()}
    indexes = {table.name: sa.inspect(bind).get_indexes(table.name) for table in parent.tables.values()}
    context = MigrationContext.configure(bind)
    with Operations.context(context):
        end_user_auth_revision.upgrade()

        # Historical guest runs do not confer account ownership or create onboarding events.
        assert bind.exec_driver_sql("SELECT account_id FROM end_users ORDER BY id").scalars().all() == [None, None]
        assert bind.exec_driver_sql("SELECT connection_context FROM workflow_runs").scalar_one() is None
        assert bind.exec_driver_sql("SELECT count(*) FROM account_webapps").scalar_one() == 0
        accounts = sa.Table("accounts", sa.MetaData(), autoload_with=bind)
        assert bind.execute(
            sa.select(accounts.c.id, accounts.c.first_workspace_created_at, accounts.c.be_end_user_at).order_by(
                accounts.c.id
            )
        ).all() == [
            ("consumer", None, None),
            ("invited", None, None),
            ("legacy", datetime(2019, 1, 1), None),
            ("owner", datetime(2020, 2, 1), None),
            ("removed", datetime(2020, 1, 1), None),
        ]
        assert "first_app_used_at" not in accounts.c
        with pytest.raises(IntegrityError), bind.begin_nested():
            bind.exec_driver_sql("UPDATE end_users SET account_id = 'owner'")
        for table, predicate, name in (
            (
                "upload_files",
                "tenant_id = 'tenant' AND created_by_role = 'end_user' AND created_by = 'first'",
                "upload_file_owner_idx",
            ),
            ("tool_files", "tenant_id = 'tenant' AND user_id = 'first'", "tool_file_owner_idx"),
        ):
            plan = bind.exec_driver_sql(f"EXPLAIN QUERY PLAN SELECT id FROM {table} WHERE {predicate}").all()
            assert any("SEARCH" in row[3] and name in row[3] for row in plan)
        with Session(bind) as session:
            credential = new_connection()
            session.add(credential)
            session.flush()
            session.add(new_app_selection(credential))
            session.commit()
        end_user_auth_revision.downgrade()

    inspector = sa.inspect(bind)
    assert set(inspector.get_table_names()) == set(parent.tables)
    for table in parent.tables.values():
        assert {column["name"] for column in inspector.get_columns(table.name)} == set(table.c.keys())
        assert inspector.get_indexes(table.name) == indexes[table.name]
        assert bind.execute(table.select().order_by(*table.c)).all() == rows[table.name]


def test_migrated_tables_match_runtime_models(connection_session: Session) -> None:
    """Check types, defaults, keys, and check constraints of the new tables against the models."""
    metadata = sa.MetaData()
    for model in _FEATURE_MODELS:
        model.metadata.tables[model.__tablename__].to_metadata(metadata)
    bind = connection_session.connection()
    context = MigrationContext.configure(
        bind,
        opts={
            "compare_type": True,
            "compare_server_default": True,
            "include_name": lambda name, type_, _parents: type_ != "table" or name in metadata.tables,
        },
    )
    assert compare_metadata(context, metadata) == []
    for table in metadata.sorted_tables:
        expected_checks = {
            str(constraint.name): str(
                constraint.sqltext.compile(dialect=bind.dialect, compile_kwargs={"literal_binds": True})
            )
            for constraint in table.constraints
            if isinstance(constraint, sa.CheckConstraint)
        }
        inspector = sa.inspect(bind)
        assert {
            check["name"]: check["sqltext"] for check in inspector.get_check_constraints(table.name)
        } == expected_checks
        assert inspector.get_pk_constraint(table.name)["name"] == table.primary_key.name


def test_live_indexes_match_runtime_models(connection_session: Session) -> None:
    """Verify access paths on existing tables without losing unrelated indexes."""
    inspector = sa.inspect(connection_session.connection())
    for model, index_name in (
        (EndUser, "end_user_account_apps_idx"),
        (WorkflowRun, "workflow_run_end_user_recent_idx"),
        (Message, "message_app_workflow_run_idx"),
        (UploadFile, "upload_file_owner_idx"),
        (ToolFile, "tool_file_owner_idx"),
    ):
        table = model.metadata.tables[model.__tablename__]
        model_index = next(index for index in table.indexes if index.name == index_name)
        index = next(index for index in inspector.get_indexes(table.name) if index["name"] == index_name)
        assert index["column_names"] == [column.name for column in model_index.columns]
        assert not index["unique"]
    assert {index["name"] for index in inspector.get_indexes("upload_files")} == {"upload_file_owner_idx"}
    assert "tool_file_conversation_id_idx" in {index["name"] for index in inspector.get_indexes("tool_files")}


@pytest.mark.parametrize("kind", ["wrong_columns", "unique", "partial"])
def test_conflicting_owner_index_does_not_remove_the_tenant_index(parent_connection: Connection, kind: str) -> None:
    """Reject a same-name index in the portable path and leave the old tenant index in place."""
    schema = create_end_user_parent_schema(parent_connection)
    table = schema.tables["upload_files"]
    columns = (
        (table.c.created_by,)
        if kind == "wrong_columns"
        else (table.c.tenant_id, table.c.created_by_role, table.c.created_by)
    )
    sa.Index(
        "upload_file_owner_idx",
        *columns,
        unique=kind == "unique",
        sqlite_where=table.c.created_by.is_not(None) if kind == "partial" else None,
    ).create(parent_connection)
    with (
        Operations.context(MigrationContext.configure(parent_connection)),
        pytest.raises(RuntimeError, match="differs from"),
    ):
        end_user_auth_revision.upgrade()
    assert "upload_file_tenant_idx" in {
        index["name"] for index in sa.inspect(parent_connection).get_indexes(table.name)
    }


def test_squash_is_one_revision_after_the_upstream_head() -> None:
    """Require a single connected migration chain without intermediate feature stamps."""
    scripts = ScriptDirectory(str(Path(__file__).resolve().parents[4] / "migrations"))
    assert len(scripts.get_heads()) == 1
    assert end_user_auth_revision.down_revision == "6b1d2f4e8a90"
    scripts_after_base = scripts.iterate_revisions(end_user_auth_revision.revision, "6b1d2f4e8a90")
    assert [script.revision for script in scripts_after_base] == [end_user_auth_revision.revision]


def _render(dialect: str) -> tuple[str, str]:
    """Render SQL offline from the declared parent or the upgraded schema."""
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name=dialect, opts={"as_sql": True, "output_buffer": output, "literal_binds": True}
    )
    with Operations.context(context), context.begin_transaction():
        end_user_auth_revision.upgrade()
    up = output.getvalue()
    output.seek(0)
    output.truncate()
    with Operations.context(context), context.begin_transaction():
        end_user_auth_revision.downgrade()
    return up, output.getvalue()


def test_postgresql_commits_live_ddl_before_data_scans_and_keeps_the_suffix_atomic() -> None:
    """Require independent live index DDL and no intermediate commit of the final schema suffix."""
    up, down = _render("postgresql")
    add_link = "ALTER TABLE end_users ADD COLUMN account_id UUID"
    build_key = (
        "CREATE UNIQUE INDEX CONCURRENTLY end_user_app_account_key ON end_users (tenant_id, app_id, type, account_id)"
    )
    attach_key = (
        "ALTER TABLE end_users ADD CONSTRAINT end_user_app_account_key UNIQUE USING INDEX end_user_app_account_key"
    )
    assert up.index(add_link) < up.index(build_key) < up.index(attach_key)
    for sql, expected_count in ((up, 7), (down, 6)):
        statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
        online = [stmt for stmt in statements if "INDEX CONCURRENTLY" in stmt]
        assert len(online) == expected_count
        if sql == up:
            online.extend((add_link, attach_key))
        for ddl in online:
            position = statements.index(ddl)
            assert statements[position - 1] == "COMMIT"
            assert statements[position + 1] == "BEGIN"
    assert "COMMIT;\n\nALTER TABLE accounts ADD COLUMN first_workspace_created_at TIMESTAMP WITHOUT TIME ZONE;" in up
    assert "TIMESTAMP WITHOUT TIME ZONE;\n\nDO $builder_origin$" in up
    assert "LIMIT 1000" in up
    assert "COMMIT;\n    END LOOP;" in up
    assert "WHERE account.id = origins.id AND account.first_workspace_created_at IS NULL" in up

    for sql, first_suffix_ddl in (
        (up, "CREATE TABLE end_user_connections"),
        (down, "DROP TABLE installed_app_connection_configurations"),
    ):
        assert sql.rindex("BEGIN;") < sql.index(first_suffix_ddl) < sql.rindex("COMMIT;")
        assert sql[sql.index(first_suffix_ddl) :].count("COMMIT;") == 1
    assert up.index("INSERT INTO account_webapps") < up.index("ALTER TABLE workflow_runs ADD COLUMN connection_context")


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_file_tenant_index_is_replaced_in_both_directions(dialect: str) -> None:
    """Keep tenant coverage while building the replacement and while restoring the parent."""
    up, down = _render(dialect)
    concurrent = "CONCURRENTLY " if dialect == "postgresql" else ""
    assert up.index(f"CREATE INDEX {concurrent}upload_file_owner_idx") < up.index(
        f"DROP INDEX {concurrent}upload_file_tenant_idx"
    )
    assert down.index(f"CREATE INDEX {concurrent}upload_file_tenant_idx") < down.index(
        f"DROP INDEX {concurrent}upload_file_owner_idx"
    )
    assert "tool_file_conversation_id_idx" not in up + down
    assert "source_run_id" not in up + down
    assert "first_app_used_at" not in up + down


def test_mysql_uses_portable_ddl_and_backfills() -> None:
    """Render both directions without PostgreSQL-only syntax or old intermediate schema."""
    up, down = _render("mysql")
    assert "CONCURRENTLY" not in up + down
    assert "USING INDEX" not in up + down
    assert "DO $builder_origin$" not in up
    assert "UPDATE accounts SET first_workspace_created_at=" in up
    assert "accounts.first_workspace_created_at IS NULL" in up
    assert "INSERT INTO account_webapps" in up
    assert "ON DUPLICATE KEY UPDATE" in up
    assert "DROP INDEX message_app_workflow_run_idx ON messages" in down


def test_backfill_seeds_only_owned_recent_usage_and_never_stars(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness = make_consumer_harness(sqlite_session_factory, monkeypatch)
    base = harness.oauth.base
    unused = make_harness(base.sessions)
    unsupported = make_harness(base.sessions)
    now = datetime(2026, 11, 4)
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
        session.execute(sa.update(App).where(App.id == unsupported.context.app_id).values(mode=AppMode.CHAT))
        session.add(new_consumer_run(unsupported, created_at=now + timedelta(days=1)))
        for moment in (now, now - timedelta(days=1), now + timedelta(hours=1)):
            session.add(new_consumer_run(base, created_at=moment))
        for mismatch in ("tenant", "app", "role", "source", "guest", "type"):
            run = new_consumer_run(base, created_at=now + timedelta(days=1))
            if mismatch == "tenant":
                run.tenant_id = str(uuid4())
            elif mismatch == "app":
                run.app_id = str(uuid4())
            elif mismatch == "role":
                run.created_by_role = CreatorUserRole.ACCOUNT
            elif mismatch == "source":
                run.triggered_from = WorkflowRunTriggeredFrom.DEBUGGING
            else:
                user = EndUser(
                    tenant_id=base.context.tenant_id,
                    app_id=base.context.app_id,
                    session_id=str(uuid4()),
                    type=EndUserType.SERVICE_API if mismatch == "type" else EndUserType.BROWSER,
                    account_id=harness.identity.account_id if mismatch == "type" else None,
                )
                session.add(user)
                run.created_by = user.id
            session.add(run)
        for app in (base, unused):
            session.add(
                AppStar(
                    tenant_id=app.context.tenant_id, app_id=app.context.app_id, account_id=harness.identity.account_id
                )
            )
    with sqlite_engine.begin() as connection:
        end_user_auth_revision.backfill_recent_usage(connection)
    with base.sessions() as session:
        rows = session.scalars(sa.select(AccountWebApp)).all()
        assert len(rows) == 1
        assert rows[0].account_id == harness.identity.account_id
        assert rows[0].tenant_id == base.context.tenant_id
        assert rows[0].app_id == base.context.app_id
        assert rows[0].last_used_at == now + timedelta(hours=1)
        assert rows[0].favorited_at is None
        assert rows[0].removed_at is None
        assert session.scalar(sa.select(sa.func.count()).select_from(AppStar)) == 2

    # Re-running a backfill must not overwrite live collection preferences.
    with base.sessions.begin() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        state.last_used_at = now + timedelta(days=2)
        state.favorited_at = now + timedelta(days=2)
    with sqlite_engine.begin() as connection:
        end_user_auth_revision.backfill_recent_usage(connection)
    with base.sessions() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.last_used_at == now + timedelta(days=2)
        assert state.favorited_at == now + timedelta(days=2)
    with base.sessions.begin() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        state.favorited_at = None
        state.removed_at = now + timedelta(days=3)
    with sqlite_engine.begin() as connection:
        end_user_auth_revision.backfill_recent_usage(connection)
    with base.sessions() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.removed_at == now + timedelta(days=3)
        assert state.favorited_at is None
