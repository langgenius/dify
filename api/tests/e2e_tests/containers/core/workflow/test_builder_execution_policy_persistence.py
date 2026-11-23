"""CI-only PostgreSQL locking and actual Alembic migration controls."""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    pass


from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Barrier
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.environment import EnvironmentContext
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.runtime.migration import RevisionStep
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, inspect, text
from sqlalchemy.engine.interfaces import (
    ReflectedCheckConstraint,
    ReflectedIndex,
    ReflectedPrimaryKeyConstraint,
    ReflectedUniqueConstraint,
)

from dify_app import DifyApp
from models.dify_builder import DifyBuilderExecutionRequest
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionContext, JsonToolExecutionContext
from services.dify_builder.application.execution_policy import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    TrustedExecutionCompletion,
)
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from tests.e2e_tests.containers.core.workflow.test_builder_restricted_native import NativeOwner, configure
from tests.e2e_tests.containers.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)
from tests.helpers.builder_migration import (
    BUILDER_MAIN_REVISION,
    BUILDER_REVISION,
    MIGRATIONS_DIR,
    load_builder_migration,
)


class _TableWitness(TypedDict):
    columns: list[tuple[str, str, bool, str | None]]
    primary_key: ReflectedPrimaryKeyConstraint
    indexes: list[ReflectedIndex]
    unique: list[ReflectedUniqueConstraint]
    checks: list[ReflectedCheckConstraint]
    rows: list[tuple[object, ...]]


def prepare(
    owner: NativeOwner, http: bool = False
) -> tuple[BuilderExecutionPolicyService, BuilderExecutionContext | JsonToolExecutionContext]:
    inputs = configure(owner, "http_text.yml" if http else "scalar.yml")
    factory, actor, app, workflow, sid, tid = owner
    with factory() as session:
        committed_workflow = session.get(Workflow, workflow.id)
        assert committed_workflow is not None
    service = BuilderExecutionPolicyService(factory)
    context = service.prepare(
        session_id=sid,
        test_input_id=tid,
        app_id=app.id,
        actor=actor,
        workflow=committed_workflow,
        submitted_inputs=inputs,
        effective_inputs=inputs,
    )
    return service, context


def race[T](*calls: Callable[[], T]) -> list[T | str]:
    barrier = Barrier(len(calls))

    def run(call: Callable[[], T]) -> T | str:
        barrier.wait(timeout=10)
        try:
            return call()
        except BuilderExecutionPolicyError as error:
            return error.reason_code

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def test_postgres_duplicate_claim_has_one_winner(native_owner: NativeOwner) -> None:
    service, context = prepare(native_owner)
    run_id = str(uuid4())

    def claim() -> str:
        service.claim_launch(context=context, native_run_id=run_id, task_id="task")
        return "claimed"

    assert sorted(race(claim, claim)) == ["claimed", "execution_already_claimed"]


def test_postgres_append_race_preserves_both_receipts(native_owner: NativeOwner) -> None:
    service, context = prepare(native_owner, http=True)
    run_id = str(uuid4())
    service.claim_launch(context=context, native_run_id=run_id, task_id="task")

    def append(identity: str) -> str:
        service.record(
            context=context,
            native_run_id=run_id,
            task_id="task",
            observation=BuilderExecutionObservation(
                observation_id=identity,
                invocation_id=identity,
                request_id=context.request_id,
                node_id="http",
                kind="effect_blocked",
                implementation_version="graphon.nodes.http_request.node.HttpRequestNode:1",
                reason_code="test",
            ),
        )
        return "recorded"

    assert race(lambda: append("a"), lambda: append("b")) == ["recorded", "recorded"]
    with native_owner[0]() as session:
        _loaded_dify_builder_execution_request2 = session.get(DifyBuilderExecutionRequest, context.request_id)
        assert _loaded_dify_builder_execution_request2 is not None
        assert {o["observation_id"] for o in _loaded_dify_builder_execution_request2.observations} == {"a", "b"}


def test_postgres_append_seal_and_duplicate_seal_are_serialized(native_owner: NativeOwner) -> None:
    service, context = prepare(native_owner, http=True)
    run_id = str(uuid4())
    service.claim_launch(context=context, native_run_id=run_id, task_id="task")
    done = TrustedExecutionCompletion(
        context=context,
        native_run_id=run_id,
        task_id="task",
        worker_finished=False,
        worker_exit="not_observed",
        recorder_healthy=True,
        response_completed=False,
    )
    observation = BuilderExecutionObservation(
        observation_id="o",
        invocation_id="i",
        request_id=context.request_id,
        node_id="http",
        kind="effect_blocked",
        implementation_version="graphon.nodes.http_request.node.HttpRequestNode:1",
        reason_code="test",
    )

    def append() -> str:
        service.record(context=context, native_run_id=run_id, task_id="task", observation=observation)
        return "recorded"

    def seal() -> str:
        return service.seal(request_id=context.request_id, completion=done).safety_outcome

    results = race(append, seal)
    assert results[0] in {"recorded", "execution_launch_mismatch"}
    assert results[1] == "execution_evidence_unknown"
    assert race(seal, seal) == ["execution_evidence_unknown", "execution_evidence_unknown"]
    with pytest.raises(BuilderExecutionPolicyError, match="execution_launch_mismatch"):
        append()
    with native_owner[0]() as session:
        row = session.get(DifyBuilderExecutionRequest, context.request_id)
        assert row is not None
        assert row.state == "sealed"
        assert len(row.observations) == (1 if results[0] == "recorded" else 0)


def test_real_postgres_execution_migration_upgrade_downgrade(flask_app_with_containers: DifyApp) -> None:
    """Exercise the execution-request migration phase in an isolated PG schema, preserving old input rows."""
    from extensions.ext_database import db

    migration = load_builder_migration()
    schema = "builder_migration_" + uuid4().hex
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        connection.execute(
            text("CREATE TABLE dify_builder_test_inputs (LIKE public.dify_builder_test_inputs INCLUDING ALL)")
        )
        connection.execute(text("ALTER TABLE dify_builder_test_inputs DROP COLUMN http_fixtures"))
        identity = str(uuid4())
        connection.execute(
            text(
                "INSERT INTO dify_builder_test_inputs (id,session_id,source,inputs,start_schema_hash) "
                "VALUES (:id,:sid,'user','{}','historical')"
            ),
            {"id": identity, "sid": str(uuid4())},
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration._create_execution_requests()
            assert "dify_builder_execution_requests" in inspect(connection).get_table_names(schema=schema)
            assert connection.execute(text("SELECT http_fixtures FROM dify_builder_test_inputs")).scalar() is None
            migration._drop_execution_requests()
            assert "dify_builder_execution_requests" not in inspect(connection).get_table_names(schema=schema)
            assert (
                connection.execute(text("SELECT start_schema_hash FROM dify_builder_test_inputs")).scalar()
                == "historical"
            )
            migration._create_execution_requests()
        connection.execute(text("SET LOCAL search_path TO public"))
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


@contextmanager
def _isolated_migration_schema(connection: Connection, schema: str) -> Generator[None]:
    """Retain the selected schema across Alembic's commits and always reset the pool connection."""
    connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    connection.execute(text(f'SET search_path TO "{schema}"'))
    try:
        yield
    finally:
        connection.rollback()
        connection.execute(text("SET search_path TO public"))
        connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        connection.commit()


def test_real_postgres_builder_revision_preserves_main_schema_and_data(flask_app_with_containers: DifyApp) -> None:
    """Upgrade and downgrade only Builder while retaining real main table contents."""
    from extensions.ext_database import db

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    scripts = ScriptDirectory.from_config(config)
    revision = scripts.get_revision(BUILDER_REVISION)
    assert revision is not None
    assert scripts.get_heads() == [BUILDER_REVISION]
    assert revision.down_revision == BUILDER_MAIN_REVISION
    schema = "builder_single_migration_" + uuid4().hex
    main_tables = ("resource_access_tokens", "resource_access_tokens_relation", "workflow_run_archive_bundles")

    with (
        flask_app_with_containers.app_context(),
        db.engine.connect() as connection,
        _isolated_migration_schema(connection, schema),
    ):
        assert connection.dialect.name == "postgresql"
        for table in main_tables:
            connection.execute(text(f"CREATE TABLE {table} (LIKE public.{table} INCLUDING ALL)"))
        identity = str(uuid4())
        connection.execute(
            text(
                "INSERT INTO resource_access_tokens (id,tenant_id,name,track_id,token,created_by) "
                "VALUES (:id,:id,'builder-control','builder-control','synthetic-builder-token',:id)"
            ),
            {"id": identity},
        )
        connection.execute(
            text(
                "INSERT INTO resource_access_tokens_relation (id,token_id,resource_type,app_id) "
                "VALUES (:id,:id,'app',:id)"
            ),
            {"id": identity},
        )
        connection.execute(
            text(
                "INSERT INTO workflow_run_archive_bundles "
                "(id,tenant_id,year,month,shard,bundle_id,workflow_run_count,row_count,archive_bytes,archived_at) "
                "VALUES (:id,:id,2026,10,'builder-shard','builder-archive-control',2,5,128,CURRENT_TIMESTAMP)"
            ),
            {"id": identity},
        )

        def witness() -> dict[str, _TableWitness]:
            """Capture current definitions and rows for each copied main table."""
            inspector = inspect(connection)
            return {
                table: {
                    "columns": [
                        (column["name"], str(column["type"]), column["nullable"], column["default"])
                        for column in inspector.get_columns(table, schema=schema)
                    ],
                    "primary_key": inspector.get_pk_constraint(table, schema=schema),
                    "indexes": inspector.get_indexes(table, schema=schema),
                    "unique": inspector.get_unique_constraints(table, schema=schema),
                    "checks": inspector.get_check_constraints(table, schema=schema),
                    "rows": list(connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).tuples()),
                }
                for table in main_tables
            }

        def migrate(*, downgrade: bool = False) -> tuple[str, ...]:
            """Apply one step to the isolated schema and return its persisted revisions."""

            def revisions(current: tuple[str, ...], _context: MigrationContext) -> list[RevisionStep]:
                if downgrade:
                    assert current == (BUILDER_REVISION,)
                    return [RevisionStep.downgrade_from_script(scripts.revision_map, revision)]
                assert current == (BUILDER_MAIN_REVISION,)
                return [RevisionStep.upgrade_from_script(scripts.revision_map, revision)]

            connection.commit()
            with EnvironmentContext(config, scripts, fn=revisions) as environment:
                environment.configure(connection=connection, version_table_schema=schema)
                with environment.begin_transaction():
                    environment.run_migrations()
            return MigrationContext.configure(connection, opts={"version_table_schema": schema}).get_current_heads()

        baseline = witness()
        MigrationContext.configure(connection, opts={"version_table_schema": schema}).stamp(
            scripts, BUILDER_MAIN_REVISION
        )
        assert migrate() == (BUILDER_REVISION,)
        assert witness() == baseline

        builder_tables = {
            name
            for name in db.metadata.tables
            if name.startswith("dify_builder_") or name == "workflow_draft_coordination"
        }
        installed = {*main_tables, "alembic_version", *builder_tables}
        assert set(inspect(connection).get_table_names(schema=schema)) == installed
        connection.execute(
            text(
                """
                INSERT INTO dify_builder_execution_requests
                    (id,tenant_id,app_id,workflow_id,actor_id,session_id,test_input_id,
                     context,context_digest,state,observations)
                VALUES (:id,:id,:id,:id,:id,:id,:id,
                        '{"policy_version":"builder-native-test-v1"}',repeat('0',64),'waiting','[]')
                """
            ),
            {"id": identity},
        )
        with pytest.raises(RuntimeError, match="terminate native waits before downgrade"):
            migrate(downgrade=True)
        connection.rollback()
        assert set(inspect(connection).get_table_names(schema=schema)) == installed
        assert witness() == baseline

        connection.execute(text("DELETE FROM dify_builder_execution_requests WHERE id=:id"), {"id": identity})
        assert migrate(downgrade=True) == (BUILDER_MAIN_REVISION,)
        assert set(inspect(connection).get_table_names(schema=schema)) == {*main_tables, "alembic_version"}
        assert witness() == baseline
        assert migrate() == (BUILDER_REVISION,)
        assert witness() == baseline


@pytest.mark.parametrize(
    "field", ["tenant_id", "app_id", "workflow_id", "actor_id", "session_id", "test_input_id", "request_id"]
)
def test_postgres_context_owner_replay_is_rejected(native_owner: NativeOwner, field: str) -> None:
    service, context = prepare(native_owner)
    forged = context.model_copy(update={field: str(uuid4())})
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_launch(context=forged, native_run_id=str(uuid4()), task_id="replay")
    with native_owner[0]() as session:
        _loaded_dify_builder_execution_request1 = session.get(DifyBuilderExecutionRequest, context.request_id)
        assert _loaded_dify_builder_execution_request1 is not None
        assert _loaded_dify_builder_execution_request1.state == "prepared"
