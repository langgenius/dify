"""CI-only PostgreSQL locking and actual Alembic migration controls."""

import importlib.util
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from typing import TYPE_CHECKING, cast
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.environment import EnvironmentContext
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.runtime.migration import RevisionStep
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from core.dify_builder.execution_policy import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    TrustedExecutionCompletion,
)
from models.dify_builder import DifyBuilderExecutionRequest
from models.workflow import Workflow
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import configure
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)

if TYPE_CHECKING:
    from dify_app import DifyApp


def prepare(owner, http=False):
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


def race(*calls):
    barrier = Barrier(len(calls))

    def run(call):
        barrier.wait(timeout=10)
        try:
            return call()
        except BuilderExecutionPolicyError as error:
            return error.reason_code

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def test_postgres_duplicate_claim_has_one_winner(native_owner):
    service, context = prepare(native_owner)
    run_id = str(uuid4())

    def claim():
        service.claim_launch(context=context, native_run_id=run_id, task_id="task")
        return "claimed"

    assert sorted(race(claim, claim)) == ["claimed", "execution_already_claimed"]


def test_postgres_append_race_preserves_both_receipts(native_owner):
    service, context = prepare(native_owner, http=True)
    run_id = str(uuid4())
    service.claim_launch(context=context, native_run_id=run_id, task_id="task")

    def append(identity):
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
        assert {
            o["observation_id"] for o in session.get(DifyBuilderExecutionRequest, context.request_id).observations
        } == {"a", "b"}


def test_postgres_append_seal_and_duplicate_seal_are_serialized(native_owner):
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

    def append():
        service.record(context=context, native_run_id=run_id, task_id="task", observation=observation)
        return "recorded"

    def seal():
        return service.seal(request_id=context.request_id, completion=done).safety_outcome

    results = race(append, seal)
    assert results[0] in {"recorded", "execution_launch_mismatch"}
    assert results[1] == "execution_evidence_unknown"
    assert race(seal, seal) == ["execution_evidence_unknown", "execution_evidence_unknown"]
    with pytest.raises(BuilderExecutionPolicyError, match="execution_launch_mismatch"):
        append()
    with native_owner[0]() as session:
        row = session.get(DifyBuilderExecutionRequest, context.request_id)
        assert row.state == "sealed"
        assert len(row.observations) == (1 if results[0] == "recorded" else 0)


def test_real_postgres_execution_migration_upgrade_downgrade(flask_app_with_containers):
    """Exercise the actual Task1 migration in an isolated PG schema, preserving old input rows."""
    from extensions.ext_database import db

    path = (
        Path(__file__).parents[4] / "migrations/versions/2026_10_09_1300-c84e6a217b90_add_builder_execution_requests.py"
    )
    spec = importlib.util.spec_from_file_location("builder_execution_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
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
            migration.upgrade()
            assert "dify_builder_execution_requests" in inspect(connection).get_table_names(schema=schema)
            assert connection.execute(text("SELECT http_fixtures FROM dify_builder_test_inputs")).scalar() is None
            migration.downgrade()
            assert "dify_builder_execution_requests" not in inspect(connection).get_table_names(schema=schema)
            assert (
                connection.execute(text("SELECT start_schema_hash FROM dify_builder_test_inputs")).scalar()
                == "historical"
            )
            migration.upgrade()
        connection.execute(text("SET LOCAL search_path TO public"))
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def test_real_postgres_forward_merge_preserves_both_branches(flask_app_with_containers: "DifyApp") -> None:
    """Real Alembic traversal upgrades both branches, merges/splits heads without changing their data."""
    from extensions.ext_database import db

    merge_revision = "f9a3c62de418"
    branch_heads = {"d82f9a6c31e0", "a8c9e2f1b704"}
    predecessor = "733e4c46f90e"
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parents[4] / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == [merge_revision]
    merged = scripts.get_revision(merge_revision)
    assert merged is not None
    assert isinstance(merged.down_revision, tuple)
    assert set(merged.down_revision) == branch_heads

    schema = "builder_forward_merge_" + uuid4().hex
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        # Only the two preexisting tables touched by descendants of 733 are prerequisites.
        # Their structures come from the real database; remove the later nullable additions.
        for table in ("dify_builder_test_inputs", "dify_builder_runs"):
            connection.execute(text(f"CREATE TABLE {table} (LIKE public.{table} INCLUDING ALL)"))
        connection.execute(text("ALTER TABLE dify_builder_test_inputs DROP COLUMN http_fixtures"))
        connection.execute(text("ALTER TABLE dify_builder_runs DROP COLUMN verification"))
        identity = str(uuid4())
        connection.execute(
            text(
                "INSERT INTO dify_builder_test_inputs (id,session_id,source,inputs,start_schema_hash) "
                "VALUES (:id,:id,'user','{}','historical')"
            ),
            {"id": identity},
        )
        context = MigrationContext.configure(connection, opts={"version_table_schema": schema})
        context.stamp(scripts, predecessor)

        def migrate(target: str, *, downgrade: bool = False) -> tuple[str, ...]:
            def revisions(current: tuple[str, ...], _context: MigrationContext) -> list[RevisionStep]:
                if downgrade:
                    assert target == merge_revision
                    assert current == (merge_revision,)
                    # A relative -1 cannot choose between a merge's two parents.
                    # Inclusive traversal of the exact merge reverts only that script;
                    # Alembic's real HeadMaintainer then splits its two parent revisions.
                    to_revert = list(
                        scripts.iterate_revisions(current, target, inclusive=True, select_for_downgrade=True)
                    )
                    assert [revision.revision for revision in to_revert] == [merge_revision]
                    return [
                        RevisionStep.downgrade_from_script(scripts.revision_map, revision) for revision in to_revert
                    ]
                # Alembic passes head tuples here; its upgrade planner annotation declares a scalar.
                planner = cast(
                    Callable[[str, tuple[str, ...]], list[RevisionStep]],
                    scripts._upgrade_revs,
                )
                return planner(target, current)

            with EnvironmentContext(config, scripts, fn=revisions) as environment:
                environment.configure(connection=connection, version_table_schema=schema)
                environment.run_migrations()
            return MigrationContext.configure(connection, opts={"version_table_schema": schema}).get_current_heads()

        # Execute real b6/c84/d82 and a8 migrations, not metadata.create_all or handwritten branch DDL.
        assert migrate("d82f9a6c31e0") == ("d82f9a6c31e0",)
        assert set(migrate("a8c9e2f1b704")) == branch_heads
        parameters = {"id": identity}
        connection.execute(
            text(
                "INSERT INTO dify_builder_execution_requests "
                "(id,tenant_id,app_id,workflow_id,actor_id,session_id,test_input_id,"
                "context,context_digest,state,observations) "
                "VALUES (:id,:id,:id,:id,:id,:id,:id,'{}',repeat('0',64),'prepared','[]')"
            ),
            parameters,
        )
        connection.execute(
            text(
                "INSERT INTO dify_builder_real_call_consents "
                "(id,tenant_id,app_id,workflow_id,actor_id,session_id,prepared_commit_id,test_input_id,prepared_version,"
                "binding,scope_digest,disclosure,disclosure_digest,expires_at,state,prepare_key,prepare_body_digest,"
                "prepare_receipt,initial_credential_revision,oauth_client_revision) "
                "VALUES (:id,:id,:id,:id,:id,:id,:id,:id,1,'{}',repeat('0',64),'{}',repeat('0',64),"
                "CURRENT_TIMESTAMP,'prepared','merge-control',repeat('0',64),'{}',repeat('0',64),repeat('0',64))"
            ),
            parameters,
        )
        connection.execute(
            text(
                "INSERT INTO resource_access_tokens (id,tenant_id,name,track_id,token,created_by) "
                "VALUES (:id,:id,'merge-control','merge-control','synthetic-merge-token',:id)"
            ),
            parameters,
        )
        connection.execute(
            text(
                "INSERT INTO resource_access_tokens_relation (id,token_id,resource_type,app_id) "
                "VALUES (:id,:id,'app',:id)"
            ),
            parameters,
        )
        tables = (
            "dify_builder_test_inputs",
            "dify_builder_runs",
            "dify_builder_execution_requests",
            "dify_builder_real_call_consents",
            "resource_access_tokens",
            "resource_access_tokens_relation",
        )

        def witness() -> dict[str, object]:
            inspector = inspect(connection)
            assert set(inspector.get_table_names(schema=schema)) == {*tables, "alembic_version"}
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
                for table in tables
            }

        before = witness()
        assert migrate("head") == (merge_revision,)
        assert witness() == before
        assert set(migrate(merge_revision, downgrade=True)) == branch_heads
        assert witness() == before
        assert migrate("head") == (merge_revision,)
        assert witness() == before
        connection.execute(text("SET LOCAL search_path TO public"))
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


@pytest.mark.parametrize(
    "field", ["tenant_id", "app_id", "workflow_id", "actor_id", "session_id", "test_input_id", "request_id"]
)
def test_postgres_context_owner_replay_is_rejected(native_owner, field):
    service, context = prepare(native_owner)
    forged = context.model_copy(update={field: str(uuid4())})
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_launch(context=forged, native_run_id=str(uuid4()), task_id="replay")
    with native_owner[0]() as session:
        assert session.get(DifyBuilderExecutionRequest, context.request_id).state == "prepared"
