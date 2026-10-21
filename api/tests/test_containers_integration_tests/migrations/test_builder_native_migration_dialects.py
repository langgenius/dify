"""Real database migration parity for retained native execution evidence."""

import importlib.util
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path
from types import ModuleType
from typing import cast
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
from models.types import StringUUID

_VERSIONS = Path(__file__).parents[3] / "migrations/versions"
_REVISIONS = ("c84e6a217b90", "c67e12a904bf", "d28f0e3c912a", "f47a1c90d2e8", "e59b7d32a6c1", "7d2b9c4e61a8")


def _migration(revision: str) -> ModuleType:
    path = next(_VERSIONS.glob(f"*-{revision}_*.py"))
    spec = importlib.util.spec_from_file_location(revision, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(params=["postgresql", "mysql"])
def migrated_connection(request: pytest.FixtureRequest) -> Iterator[Connection]:
    container = (
        PostgresContainer("postgres:14-alpine")
        if request.param == "postgresql"
        else MySqlContainer("mysql:8.0", dialect="pymysql", username="root", password="test")
    )
    # Docker accepts host-IP tuples; testcontainers annotates only scalar ports.
    # Explicit loopback publication also avoids Docker Desktop's dual-stack proxy
    # closing connections to these disposable local test databases.
    bind = cast(Callable[[int, tuple[str, None]], object], container.with_bind_ports)
    bind(container.port, ("127.0.0.1", None))
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
                    # This legacy table is the request migration's sole prerequisite.
                    sa.Table(
                        "dify_builder_test_inputs", sa.MetaData(), sa.Column("id", StringUUID(), primary_key=True)
                    ).create(connection)
                    for revision in _REVISIONS:
                        _migration(revision).upgrade()
                    yield connection
        finally:
            engine.dispose()


def test_native_migrations_preserve_checks_and_evidence_on_both_databases(migrated_connection: Connection) -> None:
    connection = migrated_connection
    # Empty-evidence downgrades and re-upgrades execute real DDL on each database.
    for revision in reversed(_REVISIONS[1:]):
        _migration(revision).downgrade()
    for revision in _REVISIONS[1:]:
        _migration(revision).upgrade()

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

    for revision, reason in (
        ("7d2b9c4e61a8", "Code physical evidence"),
        ("e59b7d32a6c1", "native dispatch claim evidence"),
        ("f47a1c90d2e8", "native invocation read owner evidence"),
        ("d28f0e3c912a", "native continuation recovery data"),
    ):
        with pytest.raises(RuntimeError, match=reason):
            _migration(revision).downgrade()
    assert connection.scalar(sa.text("SELECT count(*) FROM dify_builder_native_code_physical_operations")) == 1

    if connection.dialect.name == "mysql":
        # Apply the actual exported script twice: a refusal leaves the routine
        # behind, and retry must still fail on evidence rather than routine DDL.
        output = StringIO()
        with Operations.context(
            MigrationContext.configure(dialect_name="mysql", opts={"as_sql": True, "output_buffer": output})
        ):
            _migration("7d2b9c4e61a8").downgrade()
        for _attempt in range(2):
            try:
                with pytest.raises(DBAPIError, match="Code physical evidence must be retained"):
                    _execute_mysql_export(connection, output.getvalue())
            finally:
                connection.execute(sa.text("UNLOCK TABLES"))
        assert connection.scalar(sa.text("SELECT count(*) FROM dify_builder_native_code_physical_operations")) == 1

    # The legacy sequence rollback must regenerate the same per-app order on
    # both dialects without losing historical rows when upgraded again.
    connection.execute(
        sa.text(
            "CREATE TABLE workflow_runs (id VARCHAR(36) PRIMARY KEY, tenant_id VARCHAR(36) NOT NULL, "
            "app_id VARCHAR(36) NOT NULL, created_at TIMESTAMP NOT NULL)"
        )
    )
    tenant = str(uuid4())
    first_app, second_app = str(uuid4()), str(uuid4())
    first, second, independent = sorted(str(uuid4()) for _ in range(3))
    connection.execute(
        sa.text("INSERT INTO workflow_runs (id,tenant_id,app_id,created_at) VALUES (:id,:tenant,:app,:created)"),
        [
            {"id": second, "tenant": tenant, "app": first_app, "created": "2026-10-01 12:00:00"},
            {"id": first, "tenant": tenant, "app": first_app, "created": "2026-10-01 12:00:00"},
            {"id": independent, "tenant": tenant, "app": second_app, "created": "2026-10-01 12:00:00"},
        ],
    )
    legacy = _migration("0ab65e1cc7fa")
    with Operations.context(MigrationContext.configure(connection)):
        legacy.downgrade()
    assert dict(connection.execute(sa.text("SELECT id,sequence_number FROM workflow_runs")).tuples().all()) == {
        first: 1,
        second: 2,
        independent: 1,
    }
    with Operations.context(MigrationContext.configure(connection)):
        legacy.upgrade()
    assert connection.scalar(sa.text("SELECT count(*) FROM workflow_runs")) == 3
    assert "sequence_number" not in {column["name"] for column in sa.inspect(connection).get_columns("workflow_runs")}

    # Dropping the binding table must not try to remove indexes still needed
    # by MySQL's foreign keys, and must preserve both parent tables' rows.
    parents = sa.MetaData()
    for name in ("api_tokens", "datasets"):
        sa.Table(name, parents, sa.Column("id", StringUUID(), primary_key=True)).create(connection)
        connection.execute(sa.text(f"INSERT INTO {name} (id) VALUES (:id)"), {"id": tenant})
    binding_migration = _migration("c3f1a9b2e6d4")
    with Operations.context(MigrationContext.configure(connection, opts={"target_metadata": TypeBase.metadata})):
        binding_migration.upgrade()
        connection.execute(
            sa.text("INSERT INTO dataset_api_token_bindings (id,api_token_id,dataset_id) VALUES (:id,:id,:id)"),
            {"id": tenant},
        )
        binding_migration.downgrade()
    assert "dataset_api_token_bindings" not in sa.inspect(connection).get_table_names()
    for name in ("api_tokens", "datasets"):
        assert connection.scalar(sa.text(f"SELECT count(*) FROM {name}")) == 1

    debug = sa.Table(
        "agent_debug_conversations",
        sa.MetaData(),
        sa.Column("id", StringUUID(), primary_key=True),
        *(sa.Column(field, StringUUID(), nullable=False) for field in ("tenant_id", "agent_id", "account_id")),
        sa.Column("draft_type", sa.String(32), nullable=False),
        sa.UniqueConstraint(
            "tenant_id",
            "agent_id",
            "account_id",
            "draft_type",
            name="agent_debug_conversation_agent_account_draft_type_unique",
        ),
    )
    debug.create(connection)
    agent, account, other_account, other_tenant = (str(uuid4()) for _ in range(4))
    build_id, draft_id, draft_only_id, foreign_id = (str(uuid4()) for _ in range(4))
    connection.execute(
        debug.insert(),
        [
            {
                "id": build_id,
                "tenant_id": tenant,
                "agent_id": agent,
                "account_id": account,
                "draft_type": "debug_build",
            },
            {"id": draft_id, "tenant_id": tenant, "agent_id": agent, "account_id": account, "draft_type": "draft"},
            {
                "id": draft_only_id,
                "tenant_id": tenant,
                "agent_id": agent,
                "account_id": other_account,
                "draft_type": "draft",
            },
            {
                "id": foreign_id,
                "tenant_id": other_tenant,
                "agent_id": agent,
                "account_id": other_account,
                "draft_type": "debug_build",
            },
        ],
    )
    debug_migration = _migration("d2825e7b9c10")
    with Operations.context(MigrationContext.configure(connection)):
        debug_migration.downgrade()
        assert {str(row[0]) for row in connection.execute(sa.text("SELECT id FROM agent_debug_conversations"))} == {
            build_id,
            draft_only_id,
            foreign_id,
        }
        debug_migration.upgrade()
    assert connection.scalar(sa.text("SELECT count(*) FROM agent_debug_conversations")) == 3


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
