"""CI-only PostgreSQL locking and actual Alembic migration controls."""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict, cast

if TYPE_CHECKING:
    pass


import importlib.util
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
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
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import NativeOwner, configure
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
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


def test_real_postgres_forward_merge_preserves_both_branches(flask_app_with_containers: DifyApp) -> None:
    """Real Alembic traversal upgrades both branches, merges/splits heads without changing their data."""
    from extensions.ext_database import db

    merge_revision = "f9a3c62de418"
    current_head = "d41e6b8c2a75"
    code_head = "7d2b9c4e61a8"
    task_head = "c6f4a90d8b31"
    dispatch_head = "e59b7d32a6c1"
    owner_head = "f47a1c90d2e8"
    continuation_head = "d28f0e3c912a"
    native_head = "c67e12a904bf"
    previous_merge = "a61e9b2c7d40"
    branch_heads = {"d82f9a6c31e0", "a8c9e2f1b704"}
    predecessor = "733e4c46f90e"
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parents[4] / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == [current_head]
    merged_head = scripts.get_revision(current_head)
    assert merged_head is not None
    assert isinstance(merged_head.down_revision, tuple)
    assert set(merged_head.down_revision) == {code_head, task_head}
    task_revision = scripts.get_revision(task_head)
    assert task_revision is not None
    assert task_revision.down_revision == "f1d3c5b7a902"
    code_revision = scripts.get_revision(code_head)
    assert code_revision is not None
    assert code_revision.down_revision == dispatch_head
    dispatch_revision = scripts.get_revision(dispatch_head)
    assert dispatch_revision is not None
    assert dispatch_revision.down_revision == owner_head
    owner_revision = scripts.get_revision(owner_head)
    assert owner_revision is not None
    assert owner_revision.down_revision == continuation_head
    continuation_revision = scripts.get_revision(continuation_head)
    assert continuation_revision is not None
    assert continuation_revision.down_revision == native_head
    native_revision = scripts.get_revision(native_head)
    assert native_revision is not None
    assert native_revision.down_revision == previous_merge
    current_merge = scripts.get_revision(previous_merge)
    assert current_merge is not None
    assert isinstance(current_merge.down_revision, tuple)
    assert set(current_merge.down_revision) == {merge_revision, "f1d3c5b7a902"}
    merged = scripts.get_revision(merge_revision)
    assert merged is not None
    assert isinstance(merged.down_revision, tuple)
    assert set(merged.down_revision) == branch_heads

    schema = "builder_forward_merge_" + uuid4().hex
    with (
        flask_app_with_containers.app_context(),
        db.engine.connect() as connection,
        _isolated_migration_schema(connection, schema),
    ):
        assert connection.dialect.name == "postgresql"
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

            # Main builds its task index concurrently; let Alembic own each transaction
            # and keep the isolated schema in the session search path across commits.
            connection.commit()
            with EnvironmentContext(config, scripts, fn=revisions) as environment:
                environment.configure(connection=connection, version_table_schema=schema)
                with environment.begin_transaction():
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

        native_tables = {
            "dify_builder_native_" + suffix
            for suffix in (
                "scopes",
                "invocations",
                "grants",
                "operations",
                "attempts",
                "outcomes",
                "continuations",
                "pending_actions",
            )
        }

        continuation_tables = {
            "dify_builder_native_payload_objects",
            "dify_builder_native_invocation_states",
            "dify_builder_native_dispatches",
        }

        def witness(
            *,
            include_archive: bool = False,
            include_native: bool = False,
            include_continuation: bool = False,
            include_dispatch_claims: bool = False,
            include_code_physical: bool = False,
            include_workflow_tasks: bool = False,
        ) -> dict[str, _TableWitness]:
            inspector = inspect(connection)
            expected_tables = {*tables, "alembic_version"}
            if include_workflow_tasks:
                expected_tables.add("workflow_runs")
            if include_archive:
                expected_tables.add("workflow_run_archive_bundles")
            if include_native:
                expected_tables.update(native_tables)
            if include_continuation:
                expected_tables.update(continuation_tables)
            if include_dispatch_claims:
                expected_tables.add("dify_builder_native_effect_dispatch_claims")
            if include_code_physical:
                expected_tables.add("dify_builder_native_code_physical_operations")
            assert set(inspector.get_table_names(schema=schema)) == expected_tables
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
        assert migrate(merge_revision) == (merge_revision,)
        assert witness() == before
        assert set(migrate(merge_revision, downgrade=True)) == branch_heads
        assert witness() == before
        assert migrate(merge_revision) == (merge_revision,)
        assert witness() == before

        # The new archive branch touches this preexisting table, not the original
        # six witnesses. Clone its real structure only after the legacy merge/split controls.
        archive_table = "workflow_run_archive_bundles"
        connection.execute(text(f"CREATE TABLE {archive_table} (LIKE public.{archive_table} INCLUDING ALL)"))
        connection.execute(text(f"ALTER TABLE {archive_table} DROP COLUMN deletion_status"))
        archive_id = str(uuid4())
        connection.execute(
            text(
                "INSERT INTO workflow_run_archive_bundles "
                "(id,tenant_id,year,month,shard,bundle_id,workflow_run_count,row_count,archive_bytes,archived_at) "
                "VALUES (:archive_id,:tenant_id,2026,10,'merge-shard','merge-archive-control',2,5,128,"
                "TIMESTAMP '2026-10-01 12:00:00')"
            ),
            {"archive_id": archive_id, "tenant_id": identity},
        )
        archive_fields = [column["name"] for column in inspect(connection).get_columns(archive_table, schema=schema)]
        assert "deletion_status" not in archive_fields
        archive_projection = ",".join(f'"{field}"' for field in archive_fields)

        def archive_witness() -> _TableWitness:
            inspector = inspect(connection)
            return {
                "columns": [
                    (column["name"], str(column["type"]), column["nullable"], column["default"])
                    for column in inspector.get_columns(archive_table, schema=schema)
                    if column["name"] != "deletion_status"
                ],
                "primary_key": inspector.get_pk_constraint(archive_table, schema=schema),
                "indexes": inspector.get_indexes(archive_table, schema=schema),
                "unique": inspector.get_unique_constraints(archive_table, schema=schema),
                "checks": inspector.get_check_constraints(archive_table, schema=schema),
                "rows": list(
                    connection.execute(text(f"SELECT {archive_projection} FROM {archive_table} ORDER BY id")).tuples()
                ),
            }

        archive_before = archive_witness()
        assert witness(include_archive=True) == before
        assert migrate(previous_merge) == (previous_merge,)
        assert witness(include_archive=True) == before
        assert archive_witness() == archive_before
        archive_after_columns = inspect(connection).get_columns(archive_table, schema=schema)
        assert {column["name"] for column in archive_after_columns} == {*archive_fields, "deletion_status"}
        deletion_column = next(column for column in archive_after_columns if column["name"] == "deletion_status")
        assert str(deletion_column["type"]) == "VARCHAR(16)"
        assert deletion_column["nullable"] is True
        assert deletion_column["default"] is None
        assert (
            connection.execute(
                text("SELECT deletion_status FROM workflow_run_archive_bundles WHERE id=:id"), {"id": archive_id}
            ).scalar_one()
            is None
        )
        assert migrate(native_head) == (native_head,)
        after_native = witness(include_archive=True, include_native=True)
        request_table = "dify_builder_execution_requests"
        previous_request = before[request_table]
        current_request = after_native[request_table]
        waiting_indexes = [
            index for index in current_request["indexes"] if index["name"] == "builder_native_waiting_idx"
        ]
        assert len(waiting_indexes) == 1
        assert waiting_indexes[0]["column_names"] == ["tenant_id", "app_id", "state"]
        assert "waiting" in waiting_indexes[0]["dialect_options"]["postgresql_where"]
        assert len(current_request["checks"]) == len(previous_request["checks"]) == 1
        assert "waiting" in current_request["checks"][0]["sqltext"]
        assert "builder-native-test-v1" in current_request["checks"][0]["sqltext"]
        # Only the reviewed native waiting CHECK/index may change on the old
        # request table; all preexisting rows/columns/other constraints persist.
        current_request["indexes"] = [index for index in current_request["indexes"] if index not in waiting_indexes]
        current_request["checks"] = previous_request["checks"]
        assert after_native == before
        assert archive_witness() == archive_before

        def native_ledger_witness() -> dict[str, _TableWitness]:
            inspector = inspect(connection)
            result: dict[str, _TableWitness] = {}
            for table in sorted(native_tables):
                primary_key = inspector.get_pk_constraint(table, schema=schema)
                order = ",".join(f'"{name}"' for name in primary_key["constrained_columns"])
                result[table] = {
                    "columns": [
                        (column["name"], str(column["type"]), column["nullable"], column["default"])
                        for column in inspector.get_columns(table, schema=schema)
                    ],
                    "primary_key": primary_key,
                    "indexes": inspector.get_indexes(table, schema=schema),
                    "unique": inspector.get_unique_constraints(table, schema=schema),
                    "checks": inspector.get_check_constraints(table, schema=schema),
                    "rows": list(connection.execute(text(f"SELECT * FROM {table} ORDER BY {order}")).tuples()),
                }
            return result

        before_continuation = witness(include_archive=True, include_native=True)
        ledger_before = native_ledger_witness()
        assert migrate(continuation_head) == (continuation_head,)
        assert witness(include_archive=True, include_native=True, include_continuation=True) == before_continuation
        assert native_ledger_witness() == ledger_before
        assert archive_witness() == archive_before

        # An acknowledged pre-provenance invocation remains explicitly unowned;
        # the forward migration must not invent app/workflow authority for it.
        connection.execute(
            text(
                "INSERT INTO dify_builder_native_invocation_states "
                "(id,tenant_id,request_id,invocation_id,context_object_id,generation,state,pending_ids,resolution) "
                "VALUES (:id,:id,:id,'legacy-native',:id,0,'waiting','[]','{}')"
            ),
            {"id": identity},
        )
        continuation_before = {
            table: {
                "columns": [
                    (column["name"], str(column["type"]), column["nullable"], column["default"])
                    for column in inspect(connection).get_columns(table, schema=schema)
                ],
                "rows": list(connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).tuples()),
            }
            for table in sorted(continuation_tables)
        }
        connection.execute(text("CREATE TABLE workflow_runs (LIKE public.workflow_runs INCLUDING ALL)"))
        connection.execute(text("ALTER TABLE workflow_runs DROP COLUMN task_id"))
        connection.execute(text("ALTER TABLE workflow_runs DROP COLUMN stop_requested_at"))
        workflow_columns = {
            column["name"] for column in inspect(connection).get_columns("workflow_runs", schema=schema)
        }
        assert migrate("head") == (current_head,)
        workflow_after = inspect(connection).get_columns("workflow_runs", schema=schema)
        assert {column["name"] for column in workflow_after} == {*workflow_columns, "task_id", "stop_requested_at"}
        assert all(column["nullable"] for column in workflow_after if column["name"] not in workflow_columns)
        assert any(
            index["name"] == "workflow_run_task_id_idx"
            for index in inspect(connection).get_indexes("workflow_runs", schema=schema)
        )
        assert (
            witness(
                include_archive=True,
                include_native=True,
                include_continuation=True,
                include_dispatch_claims=True,
                include_code_physical=True,
                include_workflow_tasks=True,
            )
            == before_continuation
        )
        assert connection.scalar(text("SELECT count(*) FROM dify_builder_native_effect_dispatch_claims")) == 0
        assert native_ledger_witness() == ledger_before
        assert archive_witness() == archive_before
        for table, previous in continuation_before.items():
            columns = inspect(connection).get_columns(table, schema=schema)
            names = {column["name"] for column in columns}
            old_names = [column[0] for column in previous["columns"]]
            additions = {"app_id", "workflow_id"} if table.endswith("invocation_states") else set()
            assert names == {*old_names, *additions}
            assert [
                (column["name"], str(column["type"]), column["nullable"], column["default"])
                for column in columns
                if column["name"] not in additions
            ] == previous["columns"]
            for column in columns:
                if column["name"] in additions:
                    assert column["nullable"] is True
                    assert column["default"] is None
            projection = ",".join(f'"{name}"' for name in old_names)
            assert (
                list(connection.execute(text(f"SELECT {projection} FROM {table} ORDER BY id")).tuples())
                == previous["rows"]
            )
        assert connection.execute(
            text("SELECT app_id,workflow_id FROM dify_builder_native_invocation_states WHERE id=:id"),
            {"id": identity},
        ).one() == (None, None)


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
