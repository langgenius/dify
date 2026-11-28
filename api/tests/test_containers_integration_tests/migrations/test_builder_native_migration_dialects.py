"""Real database migration parity for retained native execution evidence."""

from collections.abc import Iterator
from datetime import UTC, datetime
from io import StringIO
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.exc import DBAPIError
from testcontainers.core.wait_strategies import ExecWaitStrategy
from testcontainers.mysql import MySqlContainer
from testcontainers.postgres import PostgresContainer

from models.base import TypeBase
from tests.helpers.builder_migration import load_builder_migration


@pytest.fixture(params=["postgresql", "mysql"])
def migrated_connection(request: pytest.FixtureRequest, free_tcp_port: int) -> Iterator[Connection]:
    container = (
        PostgresContainer("postgres:14-alpine")
        if request.param == "postgresql"
        else MySqlContainer("mysql:8.0", dialect="pymysql", username="root", password="test")
    )
    # Use an OS-assigned unused port: Docker's empty HostPort allocation collided
    # on the Linux CI daemon.
    container.with_bind_ports(container.port, free_tcp_port)
    probe = (
        'PGPASSWORD="$POSTGRES_PASSWORD" psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" '
        '--host 127.0.0.1 -tAc "SELECT 1"'
        if request.param == "postgresql"
        else 'mysql --protocol=TCP --host=127.0.0.1 --user=root --password="$MYSQL_ROOT_PASSWORD" '
        '--database="$MYSQL_DATABASE" -Nse "SELECT 1"'
    )
    container.waiting_for(ExecWaitStrategy(["sh", "-c", probe]).with_startup_timeout(30))
    with container:
        engine = sa.create_engine(make_url(container.get_connection_url()).set(host="127.0.0.1"))
        try:
            with engine.connect() as connection:
                with Operations.context(
                    MigrationContext.configure(connection, opts={"target_metadata": TypeBase.metadata})
                ):
                    load_builder_migration().upgrade()
                    yield connection
        finally:
            engine.dispose()


def test_native_migrations_preserve_checks_and_evidence_on_both_databases(migrated_connection: Connection) -> None:
    connection = migrated_connection
    migration = load_builder_migration()
    # Roll back and reinstall the complete schema on each database.
    migration.downgrade()
    migration.upgrade()

    def seed(name: str, **overrides: object) -> str:
        table = sa.Table("dify_builder_" + name, sa.MetaData(), autoload_with=connection)
        values: dict[str, object] = {}
        for column in table.columns:
            if column.nullable or column.server_default is not None:
                continue
            if isinstance(column.type, sa.JSON):
                value: object = {}
            elif isinstance(column.type, sa.Boolean):
                value = False
            elif isinstance(column.type, sa.DateTime):
                value = datetime.now(UTC)
            elif isinstance(column.type, sa.Integer):
                value = 0
            else:
                value = str(uuid4())
            values[column.name] = value
        values.update(overrides)
        connection.execute(table.insert().values(**values))
        return str(values["id"])

    def refused(sql: str, reason: str) -> None:
        with pytest.raises(DBAPIError, match=reason), connection.begin_nested():
            connection.execute(sa.text(sql))

    # A native-only waiting state must not become an ordinary execution escape.
    with pytest.raises(DBAPIError), connection.begin_nested():
        seed("execution_requests", state="waiting", context={"policy_version": "ordinary"}, observations=[])
    request_id = seed(
        "execution_requests", state="waiting", context={"policy_version": "builder-native-test-v1"}, observations=[]
    )
    connection.execute(sa.text("UPDATE dify_builder_execution_requests SET state='running'"))

    tenant_id = str(uuid4())
    invocation = "NativeOccurrence"
    owner = {"tenant_id": tenant_id, "request_id": request_id, "invocation_id": invocation}
    operation_id = seed(
        "native_operations",
        **owner,
        operation_digest="0" * 64,
        intent_digest="0" * 64,
        scope_digest="0" * 64,
        state="claimed",
    )
    attempt_id = seed(
        "native_attempts",
        **owner,
        operation_id=operation_id,
        dispatch_index=1,
        permit_digest="0" * 64,
        invocation_digest="0" * 64,
    )
    seed("native_outcomes", **owner, operation_id=operation_id, attempt_id=attempt_id, outcome="unknown")
    claim_id = seed("native_effect_dispatch_claims", **owner, operation_id=operation_id, attempt_id=attempt_id)
    seed("native_invocations", **owner, active=True, bindings={})
    dispatch_id = seed("native_dispatches", **owner, state="queued", idempotency_digest="0" * 64)
    seed(
        "native_payload_objects",
        **owner,
        kind="context",
        logical_key="context",
        storage_key="context",
        payload_digest="0" * 64,
        value_digest="0" * 64,
    )
    seed("native_continuations", **owner, checkpoint_id="checkpoint", payload_digest="0" * 64, payload_ref="payload")
    for table in ("attempts", "outcomes", "effect_dispatch_claims", "payload_objects", "continuations"):
        refused(f"UPDATE dify_builder_native_{table} SET invocation_id='changed'", "append-only")
        refused(f"DELETE FROM dify_builder_native_{table}", "append-only")

    seed("native_invocation_states", **owner, state="running", pending_ids=[], resolution={})
    connection.execute(sa.text("UPDATE dify_builder_native_invocation_states SET generation=1"))
    refused(
        "UPDATE dify_builder_native_invocation_states SET invocation_id='nativeoccurrence'", "read owner is immutable"
    )
    refused(
        "UPDATE dify_builder_native_invocation_states SET app_id='00000000-0000-0000-0000-000000000001'",
        "read owner is immutable",
    )

    physical = dict(
        owner,
        actor_id=str(uuid4()),
        operation_id=operation_id,
        attempt_id=attempt_id,
        effect_claim_id=claim_id,
        host_dispatch_id=dispatch_id,
        scope_id="code_" + uuid4().hex,
        scope_generation=1,
        base_snapshot_ref="snapshot",
        operation_digest="0" * 64,
        intent_digest="0" * 64,
        scope_spec_digest="0" * 64,
        environment_digest="0" * 64,
        payload_digest="0" * 64,
        profile_digest="0" * 64,
        base_snapshot_digest="0" * 64,
    )
    with pytest.raises(DBAPIError), connection.begin_nested():
        seed("native_code_physical_operations", **{**physical, "scope_id": "code_" + "A" * 32})
    seed("native_code_physical_operations", **physical)
    connection.execute(sa.text("UPDATE dify_builder_native_code_physical_operations SET observed_output_offset=2"))
    refused("UPDATE dify_builder_native_code_physical_operations SET observed_output_offset=1", "cannot regress")
    refused(
        "UPDATE dify_builder_native_code_physical_operations SET base_snapshot_ref='Snapshot'", "identity is immutable"
    )
    refused("DELETE FROM dify_builder_native_code_physical_operations", "must be retained")
    connection.execute(sa.text("UPDATE dify_builder_native_code_physical_operations SET ambiguous=true"))
    refused("UPDATE dify_builder_native_code_physical_operations SET scope_create_acked=true", "cannot regress")
    connection.execute(
        sa.text("UPDATE dify_builder_native_code_physical_operations SET destroyed_at=CURRENT_TIMESTAMP")
    )
    refused("UPDATE dify_builder_native_code_physical_operations SET observed_output_offset=3", "cannot regress")

    with pytest.raises(RuntimeError, match="Code physical evidence"):
        migration.downgrade()
    assert sa.inspect(connection).has_table("dify_builder_fix_intents")

    for operation, reason in (
        (migration._drop_code_physical_scopes, "Code physical evidence"),
        (migration._drop_dispatch_claims, "native dispatch claim evidence"),
        (migration._unbind_native_read_owners, "native invocation read owner evidence"),
        (migration._drop_native_continuation, "native continuation recovery data"),
    ):
        with pytest.raises(RuntimeError, match=reason):
            operation()
    assert connection.scalar(sa.text("SELECT count(*) FROM dify_builder_native_code_physical_operations")) == 1

    if connection.dialect.name == "mysql":
        # Apply the actual exported script twice: a refusal leaves the routine
        # behind, and retry must still fail on evidence rather than routine DDL.
        output = StringIO()
        with Operations.context(
            MigrationContext.configure(dialect_name="mysql", opts={"as_sql": True, "output_buffer": output})
        ):
            migration._drop_code_physical_scopes()
        for _attempt in range(2):
            try:
                with pytest.raises(DBAPIError, match="Code physical evidence must be retained"):
                    _execute_mysql_export(connection, output.getvalue())
            finally:
                connection.execute(sa.text("UNLOCK TABLES"))
        assert connection.scalar(sa.text("SELECT count(*) FROM dify_builder_native_code_physical_operations")) == 1


def _execute_mysql_export(connection: Connection, script: str) -> None:
    delimiter = ";"
    pending = ""
    for line in script.splitlines():
        if line.startswith("DELIMITER "):
            delimiter = line.removeprefix("DELIMITER ")
        else:
            pending += line + "\n"
            if pending.rstrip().endswith(delimiter):
                connection.execute(sa.text(pending.rstrip()[: -len(delimiter)]))
                pending = ""
