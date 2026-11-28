"""Exercise retries of the squashed revision against PostgreSQL's catalog and transaction manager."""

from collections.abc import Iterator
from datetime import datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import URL, Connection
from sqlalchemy.exc import DBAPIError, IntegrityError
from testcontainers.postgres import PostgresContainer

from migrations.builder_workspace_origin_v1 import backfill_at_cutover
from tests.helpers.end_user_auth_migration import create_end_user_parent_schema, end_user_auth_revision


@pytest.fixture
def migration_database(postgres_container: PostgresContainer) -> Iterator[Connection]:
    """Provide the parent schema in an isolated namespace without touching the worker's app tables."""
    engine = sa.create_engine(
        URL.create(
            "postgresql+psycopg2",
            username=postgres_container.username,
            password=postgres_container.password,
            host=postgres_container.get_container_host_ip(),
            port=int(postgres_container.get_exposed_port(5432)),
            database=postgres_container.dbname,
        )
    )
    schema = f"end_user_rollout_{uuid4().hex}"
    try:
        with engine.connect() as bind:
            bind.execute(sa.schema.CreateSchema(schema))
            bind.execute(sa.text("SELECT pg_catalog.set_config('search_path', :schema, false)"), {"schema": schema})
            parent = create_end_user_parent_schema(bind)
            bind.execute(
                parent.tables["end_users"].insert(),
                [
                    {
                        "id": str(uuid4()),
                        "tenant_id": "11111111-1111-1111-1111-111111111111",
                        "app_id": "22222222-2222-2222-2222-222222222222",
                        "type": "browser",
                        "session_id": "guest",
                    }
                    for _ in range(2)
                ],
            )
            bind.commit()
            try:
                yield bind
            finally:
                bind.rollback()
                bind.execute(sa.schema.DropSchema(schema, cascade=True))
                bind.commit()
    finally:
        engine.dispose()


def _apply(bind: Connection, *, upgrade: bool = True, interrupt_before_stamp: bool = False) -> None:
    """Run the revision in Alembic's transaction, optionally rolling back the unstamped final DDL."""
    assert not bind.in_transaction()
    context = MigrationContext.configure(bind)
    with Operations.context(context), context.begin_transaction():
        if upgrade:
            end_user_auth_revision.upgrade()
        else:
            end_user_auth_revision.downgrade()
        if interrupt_before_stamp:
            raise RuntimeError("interrupted before Alembic stamp")


def _index_id(bind: Connection, name: str) -> int | None:
    """Read the catalog identity of a present index without changing its definition."""
    return bind.scalar(sa.text("SELECT CAST(pg_catalog.to_regclass(:name) AS oid)"), {"name": name})


def test_link_attaches_a_completed_unique_index_without_rebuilding(migration_database: Connection) -> None:
    """Recover an index committed before constraint attachment; preserve guests and enforce linked uniqueness."""
    bind = migration_database
    bind.exec_driver_sql("ALTER TABLE end_users ADD COLUMN account_id UUID")
    bind.exec_driver_sql(
        "CREATE UNIQUE INDEX end_user_app_account_key ON end_users (tenant_id, app_id, type, account_id)"
    )
    index_id = _index_id(bind, "end_user_app_account_key")
    assert index_id is not None
    bind.commit()

    _apply(bind)
    keys = sa.inspect(bind).get_unique_constraints("end_users")
    assert [(key["name"], key["column_names"]) for key in keys] == [
        ("end_user_app_account_key", ["tenant_id", "app_id", "type", "account_id"])
    ]
    assert _index_id(bind, "end_user_app_account_key") == index_id
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users WHERE account_id IS NULL")) == 2
    bind.commit()

    with pytest.raises(IntegrityError, match="end_user_app_account_key"), bind.begin():
        bind.execute(sa.text("UPDATE end_users SET account_id = '33333333-3333-3333-3333-333333333333'"))

    _apply(bind, upgrade=False)
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users")) == 2
    assert _index_id(bind, "end_user_app_account_key") is None


def test_link_refuses_an_abandoned_invalid_unique_index(migration_database: Connection) -> None:
    """Leave invalid build residue for inspection rather than replacing or attaching it."""
    bind = migration_database
    bind.exec_driver_sql("ALTER TABLE end_users ADD COLUMN account_id UUID")
    bind.exec_driver_sql("UPDATE end_users SET account_id = '33333333-3333-3333-3333-333333333333'")
    bind.commit()

    with pytest.raises(IntegrityError):
        _apply(bind)
    index_id = _index_id(bind, "end_user_app_account_key")
    assert index_id is not None
    assert not sa.inspect(bind).get_unique_constraints("end_users")
    bind.commit()

    with pytest.raises(RuntimeError, match="unhealthy"):
        _apply(bind)
    assert _index_id(bind, "end_user_app_account_key") == index_id
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users WHERE account_id IS NOT NULL")) == 2


def test_upgrade_and_downgrade_resume_after_committed_indexes_but_no_stamp(migration_database: Connection) -> None:
    """Reuse a partial index build and roll back the final DDL when interrupted before either stamp."""
    bind = migration_database
    bind.exec_driver_sql("ALTER TABLE end_users ADD COLUMN account_id UUID")
    bind.exec_driver_sql(
        "CREATE INDEX end_user_account_apps_idx ON end_users (account_id, type, tenant_id, app_id, id)"
    )
    first_index = _index_id(bind, "end_user_account_apps_idx")
    assert first_index is not None
    bind.commit()

    with pytest.raises(RuntimeError, match="interrupted before Alembic stamp"):
        _apply(bind, interrupt_before_stamp=True)
    index_ids = {
        name: _index_id(bind, name)
        for name in (
            "end_user_app_account_key",
            "end_user_account_apps_idx",
            "workflow_run_end_user_recent_idx",
            "message_app_workflow_run_idx",
            "upload_file_owner_idx",
            "tool_file_owner_idx",
        )
    }
    assert index_ids["end_user_account_apps_idx"] == first_index
    assert all(index_id is not None for index_id in index_ids.values())
    inspector = sa.inspect(bind)
    assert "first_workspace_created_at" in {column["name"] for column in inspector.get_columns("accounts")}
    assert "be_end_user_at" not in {column["name"] for column in inspector.get_columns("accounts")}
    assert not inspector.has_table("end_user_connections")
    assert not inspector.has_table("account_webapps")
    bind.commit()

    _apply(bind)
    assert {name: _index_id(bind, name) for name in index_ids} == index_ids
    assert _index_id(bind, "upload_file_tenant_idx") is None
    assert sa.inspect(bind).has_table("account_webapps")
    bind.commit()

    with pytest.raises(RuntimeError, match="interrupted before Alembic stamp"):
        _apply(bind, upgrade=False, interrupt_before_stamp=True)
    assert all(_index_id(bind, name) is None for name in index_ids if name != "end_user_app_account_key")
    assert _index_id(bind, "end_user_app_account_key") == index_ids["end_user_app_account_key"]
    tenant_index = _index_id(bind, "upload_file_tenant_idx")
    assert tenant_index is not None
    assert sa.inspect(bind).has_table("account_webapps")
    bind.commit()

    _apply(bind, upgrade=False)
    assert _index_id(bind, "upload_file_tenant_idx") == tenant_index
    assert _index_id(bind, "end_user_app_account_key") is None
    assert not sa.inspect(bind).has_table("account_webapps")
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users")) == 2


def test_conflicting_message_index_is_not_reused_or_removed(migration_database: Connection) -> None:
    """A same-name index on an unrelated table blocks either direction without being altered."""
    bind = migration_database
    bind.exec_driver_sql("CREATE TABLE unrelated (app_id uuid, workflow_run_id uuid, conversation_id uuid)")
    conflicting_index = (
        "CREATE INDEX message_app_workflow_run_idx ON unrelated (app_id, workflow_run_id, conversation_id)"
    )
    bind.exec_driver_sql(conflicting_index)
    index_id = _index_id(bind, "message_app_workflow_run_idx")
    assert index_id is not None
    bind.commit()

    with pytest.raises(RuntimeError, match="conflicts with the required index"):
        _apply(bind)
    assert _index_id(bind, "message_app_workflow_run_idx") == index_id
    bind.exec_driver_sql("DROP INDEX message_app_workflow_run_idx")
    bind.commit()

    _apply(bind)
    bind.exec_driver_sql("DROP INDEX message_app_workflow_run_idx")
    bind.exec_driver_sql(conflicting_index)
    index_id = _index_id(bind, "message_app_workflow_run_idx")
    assert index_id is not None
    bind.commit()
    with pytest.raises(RuntimeError, match="conflicts with the required index"):
        _apply(bind, upgrade=False)
    assert _index_id(bind, "message_app_workflow_run_idx") == index_id
    assert sa.inspect(bind).has_table("account_webapps")


def test_downgrade_rejects_a_conflicting_account_constraint(migration_database: Connection) -> None:
    """Check the account key before committing any index changes during rollback."""
    bind = migration_database
    _apply(bind)
    bind.exec_driver_sql(
        "ALTER TABLE end_users DROP CONSTRAINT end_user_app_account_key, "
        "ADD CONSTRAINT end_user_app_account_key UNIQUE (id)"
    )
    bind.commit()

    with pytest.raises(RuntimeError, match="does not match the required end-user account key"):
        _apply(bind, upgrade=False)
    assert _index_id(bind, "upload_file_tenant_idx") is None
    assert _index_id(bind, "upload_file_owner_idx") is not None
    assert sa.inspect(bind).has_table("account_webapps")


def test_builder_backfill_keeps_committed_batches_and_catches_late_legacy_writes(
    migration_database: Connection,
) -> None:
    """Retry a partial backfill and run cutover before admitting new writes with deliberate nulls."""
    bind = migration_database
    bind.exec_driver_sql("""
        INSERT INTO accounts (id, status, created_at)
        SELECT CAST('00000000-0000-0000-0000-' || lpad(id::text, 12, '0') AS uuid),
               'active', TIMESTAMP '2026-01-01'
        FROM generate_series(1, 1001) AS id
    """)
    bind.exec_driver_sql("""
        CREATE FUNCTION fail_later_batch() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.id = '00000000-0000-0000-0000-000000001001' THEN
                RAISE EXCEPTION 'interrupted batch';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    bind.exec_driver_sql(
        "CREATE TRIGGER fail_later_batch BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION fail_later_batch()"
    )
    bind.commit()

    with pytest.raises(DBAPIError, match="interrupted batch"):
        _apply(bind)
    assert bind.scalar(sa.text("SELECT count(*) FROM accounts WHERE first_workspace_created_at IS NOT NULL")) == 1000
    bind.exec_driver_sql("DROP TRIGGER fail_later_batch ON accounts")
    bind.exec_driver_sql("""
        UPDATE accounts SET first_workspace_created_at = TIMESTAMP '2026-02-01'
        WHERE id = '00000000-0000-0000-0000-000000000001'
    """)
    bind.commit()
    _apply(bind)

    bind.exec_driver_sql("""
        INSERT INTO accounts (id, status, created_at) VALUES
            ('00000000-0000-0000-0000-000000000000', 'active', TIMESTAMP '2026-03-01'),
            ('00000000-0000-0000-0000-000000001002', 'uninitialized', TIMESTAMP '2026-03-01')
    """)
    bind.commit()
    backfill_at_cutover(bind)
    backfill_rows = (
        bind.execute(
            sa.text("""
            SELECT first_workspace_created_at FROM accounts
            WHERE id IN ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001',
                         '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001002')
            ORDER BY id
        """)
        )
        .scalars()
        .all()
    )
    assert list(backfill_rows) == [datetime(2026, 3, 1), datetime(2026, 2, 1), datetime(2026, 1, 1), None]
