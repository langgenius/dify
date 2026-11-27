"""Exercise migration retries against a real PostgreSQL catalog and transaction manager."""

from collections.abc import Iterator
from datetime import datetime
from importlib import import_module
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import URL, Connection
from sqlalchemy.exc import DBAPIError, IntegrityError
from testcontainers.postgres import PostgresContainer

from migrations.builder_workspace_origin_v1 import backfill_at_cutover

_LINK = "2026_10_16_1000-b27e8d49a103_link_browser_end_users_to_accounts"
_CONSUMER_INDEXES = "2026_10_30_1600-b73e9c40a215_add_consumer_execution_indexes"
_BUILDER_ORIGIN = "2026_11_03_1000-b43e8c1d9a72_record_builder_workspace_origin"
_MESSAGE_INDEX = "2026_11_11_1600-2c7e9a4b1d60_add_message_app_workflow_run_index"


@pytest.fixture
def migration_database(postgres_container: PostgresContainer) -> Iterator[Connection]:
    """Provide an isolated schema on the CI PostgreSQL worker, without touching its app tables."""
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
            bind.commit()
            try:
                yield bind
            finally:
                bind.rollback()
                bind.execute(sa.schema.DropSchema(schema, cascade=True))
                bind.commit()
    finally:
        engine.dispose()


def _apply(bind: Connection, migration_name: str, *, upgrade: bool = True) -> None:
    """Apply the DDL without stamping; a second invocation represents recovery before the stamp."""
    assert not bind.in_transaction()
    migration = import_module(f"migrations.versions.{migration_name}")
    context = MigrationContext.configure(bind)
    with Operations.context(context), context.begin_transaction():
        if upgrade:
            migration.upgrade()
        else:
            migration.downgrade()


def _end_users(bind: Connection) -> None:
    """Create the prior table with two unrelated guest rows in one scope."""
    bind.exec_driver_sql("CREATE TABLE end_users (id int PRIMARY KEY, tenant_id text, app_id text, type text)")
    bind.exec_driver_sql(
        "INSERT INTO end_users VALUES (1, 'tenant', 'app', 'browser'), (2, 'tenant', 'app', 'browser')"
    )


def _index_id(bind: Connection, name: str) -> int | None:
    """Read an index's catalog identity, or None if absent, without mutations."""
    return bind.scalar(sa.text("SELECT CAST(pg_catalog.to_regclass(:name) AS oid)"), {"name": name})


def test_link_attaches_a_completed_unique_index_without_rebuilding(migration_database: Connection) -> None:
    """Recover after the index commit, keep guest rows, and enforce the original unique key."""
    bind = migration_database
    _end_users(bind)
    bind.exec_driver_sql("ALTER TABLE end_users ADD COLUMN account_id UUID")
    bind.exec_driver_sql(
        "CREATE UNIQUE INDEX end_user_app_account_key ON end_users (tenant_id, app_id, type, account_id)"
    )
    index_id = _index_id(bind, "end_user_app_account_key")
    assert index_id is not None
    bind.commit()

    _apply(bind, _LINK)
    _apply(bind, _LINK)
    keys = sa.inspect(bind).get_unique_constraints("end_users")
    assert [(key["name"], key["column_names"]) for key in keys] == [
        ("end_user_app_account_key", ["tenant_id", "app_id", "type", "account_id"])
    ]
    assert _index_id(bind, "end_user_app_account_key") == index_id
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users WHERE account_id IS NULL")) == 2
    bind.commit()

    with pytest.raises(IntegrityError, match="end_user_app_account_key"), bind.begin():
        bind.execute(sa.text("UPDATE end_users SET account_id = '11111111-1111-1111-1111-111111111111'"))

    _apply(bind, _LINK, upgrade=False)
    _apply(bind, _LINK, upgrade=False)
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users")) == 2
    assert _index_id(bind, "end_user_app_account_key") is None


def test_link_refuses_an_abandoned_invalid_unique_index(migration_database: Connection) -> None:
    """Leave invalid concurrent-build residue for inspection instead of attaching or replacing it."""
    bind = migration_database
    _end_users(bind)
    bind.exec_driver_sql("ALTER TABLE end_users ADD COLUMN account_id UUID")
    bind.exec_driver_sql("UPDATE end_users SET account_id = '11111111-1111-1111-1111-111111111111'")
    bind.commit()

    with pytest.raises(IntegrityError):
        _apply(bind, _LINK)
    index_id = _index_id(bind, "end_user_app_account_key")
    assert index_id is not None
    assert not sa.inspect(bind).get_unique_constraints("end_users")
    bind.commit()

    with pytest.raises(RuntimeError, match="unhealthy"):
        _apply(bind, _LINK)
    assert _index_id(bind, "end_user_app_account_key") == index_id
    assert bind.scalar(sa.text("SELECT count(*) FROM end_users WHERE account_id IS NOT NULL")) == 2


def test_consumer_indexes_resume_after_only_one_build_commits(migration_database: Connection) -> None:
    """Keep a previously completed index and complete the missing workflow index."""
    bind = migration_database
    _end_users(bind)
    bind.exec_driver_sql("ALTER TABLE end_users ADD COLUMN account_id UUID")
    bind.exec_driver_sql(
        "CREATE TABLE workflow_runs (tenant_id text, app_id text, created_by_role text, "
        "created_by text, triggered_from text, created_at timestamp)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX end_user_account_apps_idx ON end_users (account_id, type, tenant_id, app_id, id)"
    )
    index_id = _index_id(bind, "end_user_account_apps_idx")
    assert index_id is not None
    bind.commit()

    _apply(bind, _CONSUMER_INDEXES)
    assert _index_id(bind, "end_user_account_apps_idx") == index_id
    assert _index_id(bind, "workflow_run_end_user_recent_idx") is not None
    bind.commit()
    _apply(bind, _CONSUMER_INDEXES, upgrade=False)
    _apply(bind, _CONSUMER_INDEXES, upgrade=False)
    assert _index_id(bind, "end_user_account_apps_idx") is None
    assert _index_id(bind, "workflow_run_end_user_recent_idx") is None


def test_message_index_retries_preserve_healthy_and_conflicting_relations(migration_database: Connection) -> None:
    """Replay both directions without replacing healthy indexes or dropping unrelated relations."""
    bind = migration_database
    bind.exec_driver_sql("CREATE TABLE messages (app_id text, workflow_run_id text, conversation_id text)")
    bind.commit()
    _apply(bind, _MESSAGE_INDEX)
    index_name = "message_app_workflow_run_idx"
    index_id = _index_id(bind, index_name)
    assert index_id is not None
    bind.commit()
    _apply(bind, _MESSAGE_INDEX)
    assert _index_id(bind, index_name) == index_id
    bind.commit()
    _apply(bind, _MESSAGE_INDEX, upgrade=False)
    _apply(bind, _MESSAGE_INDEX, upgrade=False)

    bind.exec_driver_sql("CREATE TABLE unrelated (app_id text, workflow_run_id text, conversation_id text)")
    bind.exec_driver_sql(
        "CREATE INDEX message_app_workflow_run_idx ON unrelated (app_id, workflow_run_id, conversation_id)"
    )
    conflicting_id = _index_id(bind, index_name)
    assert conflicting_id is not None
    bind.commit()
    for upgrade in (True, False):
        with pytest.raises(RuntimeError, match="conflicts with the required index"):
            _apply(bind, _MESSAGE_INDEX, upgrade=upgrade)
    assert _index_id(bind, index_name) == conflicting_id


def test_builder_backfill_keeps_committed_batches_and_catches_late_legacy_writes(
    migration_database: Connection,
) -> None:
    """Interrupt the second batch, finish the interrupted upgrade, and run the cutover pass."""
    bind = migration_database
    bind.exec_driver_sql(
        "CREATE TABLE accounts (id uuid PRIMARY KEY, status text NOT NULL, initialized_at timestamp, "
        "created_at timestamp NOT NULL)"
    )
    bind.exec_driver_sql("CREATE TABLE tenants (id uuid PRIMARY KEY, created_at timestamp NOT NULL)")
    bind.exec_driver_sql("CREATE TABLE tenant_account_joins (tenant_id uuid, account_id uuid, role text)")
    bind.exec_driver_sql("""
        INSERT INTO accounts
        SELECT CAST('00000000-0000-0000-0000-' || lpad(id::text, 12, '0') AS uuid),
               'active', NULL, TIMESTAMP '2026-01-01'
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
        _apply(bind, _BUILDER_ORIGIN)
    assert bind.scalar(sa.text("SELECT count(*) FROM accounts WHERE first_workspace_created_at IS NOT NULL")) == 1000
    bind.exec_driver_sql("DROP TRIGGER fail_later_batch ON accounts")
    bind.exec_driver_sql("""
        UPDATE accounts SET first_workspace_created_at = TIMESTAMP '2026-02-01'
        WHERE id = '00000000-0000-0000-0000-000000000001'
    """)
    bind.commit()
    _apply(bind, _BUILDER_ORIGIN)

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
