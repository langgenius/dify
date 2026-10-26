"""Durable draft coordination: real PostgreSQL transactions, labeled fault doubles."""

import inspect
from collections.abc import Iterable
from copy import deepcopy
from datetime import timedelta
from typing import Protocol, cast
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from redis.lock import Lock as RedisLock
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app import workflow as workflow_api
from core.dify_builder.models import Graph
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.model import App, AppMode
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from models.workflow_draft_coordination import WorkflowDraftCoordination as Coordination
from services.trigger import webhook_service
from services.trigger.webhook_service import WebhookService
from services.workflow.draft_coordination_service import WorkflowDraftCoordinationService as Coordinator
from services.workflow_service import WorkflowService
from tasks.workflow_draft_coordination_task import (
    process_workflow_draft_coordination,
    sweep_workflow_draft_coordination,
)
from tests.workflow_empty_draft_test_utils import POPULATED_GRAPH, DraftOwner, seed_owner


class RoutedTask(Protocol):
    queue: str


def require[T](value: object, expected: type[T]) -> T:
    assert isinstance(value, expected)
    return value


def webhook_graph(count: int) -> Graph:
    return {"nodes": [{"id": f"hook-{i}", "data": {"type": "trigger-webhook"}} for i in range(count)], "edges": []}


def save(session: Session, owner: DraftOwner, graph: Graph) -> Workflow:
    assert owner.draft is not None
    return WorkflowService().sync_draft_workflow(
        app_model=owner.app,
        graph=graph,
        features={},
        unique_hash=owner.draft.unique_hash,
        account=owner.account,
        environment_variables=[],
        conversation_variables=[],
        session=session,
    )


def test_webhook_limit_rejects_before_commit(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = owner.draft.unique_hash
    with pytest.raises(ValueError, match="maximum webhook node limit"):
        save(session, owner, webhook_graph(6))
    session.rollback()
    with factory() as reader:
        assert require(reader.get(Workflow, owner.draft.id), Workflow).unique_hash == before


def test_retirement_failure_does_not_reject_committed_save(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    graph = deepcopy(cast(Graph, POPULATED_GRAPH))
    graph["nodes"][0]["data"]["title"] = "accepted"
    # Fault double only at the downstream retirement boundary, after real SQL commit.
    with patch(
        "services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned",
        side_effect=RuntimeError("fault"),
    ):
        result = save(session, owner, graph)
    with sessionmaker(bind=session.get_bind())() as reader:
        assert require(reader.get(Workflow, result.id), Workflow).graph_dict == graph


def test_console_receipt_survives_later_commit(
    flask_app_with_containers: Flask, db_session_with_containers: Session
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    first_graph = deepcopy(cast(Graph, POPULATED_GRAPH))
    first_graph["nodes"][0]["data"]["title"] = "first"
    later_graph = deepcopy(cast(Graph, POPULATED_GRAPH))
    later_graph["nodes"][0]["data"]["title"] = "later"
    receipt = Workflow(graph=__import__("json").dumps(first_graph)).unique_hash
    draft_id = owner.draft.id

    def later_commit(**_kwargs: object) -> None:
        with factory.begin() as writer:
            draft = writer.scalar(select(Workflow).where(Workflow.id == draft_id))
            assert draft is not None
            draft.graph = __import__("json").dumps(later_graph)

    assert db.session().expire_on_commit is True
    with workflow_api.session_factory.create_session() as receipt_session:
        assert receipt_session.get_bind() is session.get_bind()
        assert receipt_session.expire_on_commit is False
    api = workflow_api.DraftWorkflowApi()
    with patch(
        "services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned", side_effect=later_commit
    ):
        with flask_app_with_containers.test_request_context(
            method="POST", json={"graph": first_graph, "features": {}, "hash": owner.draft.unique_hash}
        ):
            response = inspect.unwrap(api.post)(api, owner.account, app_model=owner.app)
    assert response["hash"] == receipt
    with factory() as reader:
        assert require(reader.get(Workflow, draft_id), Workflow).graph_dict == later_graph


def stage_record(session: Session, owner: DraftOwner, *, candidates: Iterable[str] = (), emit: bool = True) -> str:
    assert owner.draft is not None
    operation = str(uuid4())
    Coordinator.stage(
        session,
        coordination_id=operation,
        workflow=owner.draft,
        account_id=owner.account.id,
        retirement_agent_ids=candidates,
        emit_draft_event=emit,
    )
    session.commit()
    return operation


def due(session: Session, operation: str) -> None:
    session.execute(
        update(Coordination)
        .where(Coordination.id == operation)
        .values(available_at=naive_utc_now() - timedelta(seconds=1))
    )
    session.commit()


@pytest.mark.parametrize("commit", [False, True])
def test_limit_does_not_mutate_in_composed_or_direct_save(db_session_with_containers: Session, commit: bool) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    before = owner.draft.unique_hash
    with pytest.raises(ValueError, match="maximum webhook node limit"):
        WorkflowService().sync_draft_workflow(
            app_model=owner.app,
            graph=webhook_graph(6),
            features={},
            unique_hash=before,
            account=owner.account,
            environment_variables=[],
            conversation_variables=[],
            session=session,
            commit=commit,
        )
    session.commit()  # caller can commit after catching a policy error
    with sessionmaker(bind=session.get_bind())() as reader:
        assert require(reader.get(Workflow, owner.draft.id), Workflow).unique_hash == before
        assert reader.scalar(select(Coordination)) is None


def test_five_hooks_create_relationships_and_chat_keeps_existing_gate(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    result = save(session, owner, webhook_graph(5))
    assert result.graph_dict == webhook_graph(5)
    assert len(session.scalars(select(WorkflowWebhookTrigger)).all()) == 5
    assert session.scalar(select(Coordination)) is None
    owner.app.mode = AppMode.ADVANCED_CHAT
    session.commit()
    result = save(session, owner, webhook_graph(6))
    assert result.graph_dict == webhook_graph(6)
    assert session.scalar(select(Coordination)) is None


def test_dsl_limit_failed_result_cannot_commit_metadata(db_session_with_containers: Session) -> None:
    import json

    from services.app_dsl_service import CURRENT_DSL_VERSION, AppDslService, ImportStatus

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    app_id, draft_id = owner.app.id, owner.draft.id
    before_name, before_hash = owner.app.name, owner.draft.unique_hash
    result = AppDslService(session).import_app(
        account=owner.account,
        app_id=app_id,
        import_mode="yaml-content",
        yaml_content=json.dumps(
            {
                "version": CURRENT_DSL_VERSION,
                "kind": "app",
                "app": {"mode": "workflow", "name": "must not persist"},
                "workflow": {"graph": webhook_graph(6), "features": {}},
            }
        ),
    )
    assert result.status == ImportStatus.FAILED
    session.commit()
    with sessionmaker(bind=session.get_bind())() as reader:
        assert require(reader.get(App, app_id), App).name == before_name
        assert require(reader.get(Workflow, draft_id), Workflow).unique_hash == before_hash
        assert reader.scalar(select(Coordination)) is None


def test_restore_limit_is_precommit(db_session_with_containers: Session) -> None:
    import json

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    published = require(session.get(Workflow, owner.app.workflow_id), Workflow)
    published.graph = json.dumps(webhook_graph(6))
    session.commit()
    before = owner.draft.unique_hash
    with pytest.raises(ValueError, match="maximum webhook node limit"):
        WorkflowService().restore_published_workflow_to_draft(
            app_model=owner.app, workflow_id=published.id, account=owner.account, session=session
        )
    session.commit()
    with sessionmaker(bind=session.get_bind())() as reader:
        assert require(reader.get(Workflow, owner.draft.id), Workflow).unique_hash == before
        assert reader.scalar(select(Coordination)) is None


def test_composed_operation_unions_candidates_and_rolls_back_atomically(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    operation = str(uuid4())
    first, second = str(uuid4()), str(uuid4())
    with patch(
        "services.agent.workflow_publish_service.WorkflowAgentPublishService.sync_agent_bindings_for_draft",
        return_value={first},
    ):
        workflow = WorkflowService().sync_draft_workflow(
            app_model=owner.app,
            graph=webhook_graph(1),
            features={},
            unique_hash=owner.draft.unique_hash,
            account=owner.account,
            environment_variables=[],
            conversation_variables=[],
            session=session,
            commit=False,
            coordination_id=operation,
        )
    row = require(session.get(Coordination, operation), Coordination)
    assert row.retirement_agent_ids == [first]
    assert not row.emit_draft_event
    Coordinator.stage(
        session,
        coordination_id=operation,
        workflow=workflow,
        account_id=owner.account.id,
        retirement_agent_ids={second, first},
        emit_draft_event=True,
    )
    assert row.retirement_agent_ids == sorted([first, second])
    assert row.emit_draft_event
    with sessionmaker(bind=session.get_bind())() as reader:
        assert reader.get(Coordination, operation) is None
        assert require(reader.get(Workflow, workflow.id), Workflow).graph_dict == POPULATED_GRAPH
    session.rollback()
    assert session.get(Coordination, operation) is None
    assert owner.draft.graph_dict == POPULATED_GRAPH


def test_record_insert_failure_rolls_back_graph(db_session_with_containers: Session) -> None:
    from sqlalchemy.exc import IntegrityError

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    operation = stage_record(session, owner)

    def invalid_row(write_session: Session, **kwargs: object) -> None:
        # A staging fault double supplies an invalid count; PostgreSQL rejects
        # the actual INSERT after the real graph flush in the same transaction.
        workflow = require(kwargs["workflow"], Workflow)
        write_session.add(
            Coordination(
                id=cast(str, kwargs["coordination_id"]),
                tenant_id=workflow.tenant_id,
                app_id=workflow.app_id,
                workflow_id=workflow.id,
                workflow_version=workflow.version,
                account_id=owner.account.id,
                retirement_agent_ids=[],
                emit_draft_event=True,
                attempt_count=-1,
            )
        )
        write_session.flush()

    with patch.object(Coordinator, "stage", side_effect=invalid_row):
        with pytest.raises(IntegrityError):
            save(session, owner, webhook_graph(1))
    session.rollback()
    with sessionmaker(bind=session.get_bind())() as reader:
        assert require(reader.get(Workflow, owner.draft.id), Workflow).graph_dict == POPULATED_GRAPH
        assert reader.get(Coordination, operation) is not None


@pytest.mark.parametrize("failed_step", ["retirement", "signal"])
def test_failure_retains_sanitized_work_and_independent_progress(
    db_session_with_containers: Session, caplog: pytest.LogCaptureFixture, failed_step: str
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    candidate = str(uuid4())
    operation = stage_record(session, owner, candidates=[candidate])
    secret = "SENTINEL_SQL_CREDENTIAL_DO_NOT_LOG"
    retirement_error = RuntimeError(secret) if failed_step == "retirement" else None
    signal_error = RuntimeError(secret) if failed_step == "signal" else None
    with patch(
        "services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned", side_effect=retirement_error
    ) as retirement:
        with patch(
            "services.workflow.draft_coordination_service.app_draft_workflow_was_synced.send", side_effect=signal_error
        ) as signal:
            assert Coordinator.execute(operation) is False
    assert retirement.call_args.kwargs["agent_ids"] == {candidate}
    signal.assert_called_once()
    session.expire_all()
    row = require(session.get(Coordination, operation), Coordination)
    assert row.retirement_agent_ids == [candidate]
    assert row.attempt_count == 1
    assert row.claim_token is None
    assert row.last_error is not None
    assert secret not in row.last_error
    assert secret not in caplog.text
    due(session, operation)
    with patch("services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned"):
        assert Coordinator.execute(operation)
    session.expire_all()
    assert session.get(Coordination, operation) is None


def test_sweep_dispatches_without_claim_and_worker_runs_immediately(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    operation = stage_record(session, owner)
    with patch.object(process_workflow_draft_coordination, "delay") as publication:
        sweep_workflow_draft_coordination()
    publication.assert_called_once_with(operation)
    session.expire_all()
    assert require(session.get(Coordination, operation), Coordination).claim_token is None
    process_workflow_draft_coordination(operation)
    session.expire_all()
    assert session.get(Coordination, operation) is None


def test_broker_loss_and_commit_before_kick_remain_discoverable(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    operation = stage_record(session, owner)
    with patch.object(process_workflow_draft_coordination, "delay", side_effect=RuntimeError("broker offline")):
        sweep_workflow_draft_coordination()
    assert operation in Coordinator.due_ids(100)
    with patch.object(Coordinator, "execute", side_effect=RuntimeError("claim SQL failure")):
        with patch.object(process_workflow_draft_coordination, "delay", side_effect=RuntimeError("broker offline")):
            Coordinator.kick(operation)
    assert operation in Coordinator.due_ids(100)
    process_workflow_draft_coordination(operation)
    session.expire_all()
    assert session.get(Coordination, operation) is None


@pytest.mark.parametrize("fail_after_reclaim", [False, True])
def test_live_claim_blocks_duplicates_expiry_recovers_and_stale_ack_is_fenced(
    db_session_with_containers: Session,
    fail_after_reclaim: bool,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    operation = stage_record(session, owner)
    replacement_token = str(uuid4())
    factory = sessionmaker(bind=session.get_bind())

    def competing_executor(**_kwargs: object) -> None:
        assert Coordinator.execute(operation)  # live claim causes no effects
        with factory.begin() as writer:
            writer.execute(
                update(Coordination).where(Coordination.id == operation).values(claim_token=replacement_token)
            )

        if fail_after_reclaim:
            raise RuntimeError("stale retry fault")

    with patch(
        "services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned",
        side_effect=competing_executor,
    ) as retirement:
        assert Coordinator.execute(operation) is (not fail_after_reclaim)
    assert retirement.call_count == 1
    session.expire_all()
    assert require(session.get(Coordination, operation), Coordination).claim_token == replacement_token
    due(session, operation)  # simulate worker death and elapsed lease using real persisted state
    assert Coordinator.execute(operation)
    session.expire_all()
    assert session.get(Coordination, operation) is None


def test_deleted_workflow_still_retires_candidates(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    candidate = str(uuid4())
    operation = stage_record(session, owner, candidates=[candidate])
    session.execute(delete(Workflow).where(Workflow.id == owner.draft.id))
    session.commit()
    with patch("services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned") as retirement:
        with patch("services.workflow.draft_coordination_service.app_draft_workflow_was_synced.send") as signal:
            assert Coordinator.execute(operation)
    assert retirement.call_args.kwargs["agent_ids"] == {candidate}
    signal.assert_not_called()


def test_cache_hit_never_suppresses_sql_and_cache_failure_is_advisory(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=webhook_graph(1))
    assert owner.draft is not None
    redis = webhook_service.redis_client
    redis.set(f"webhook_nodes:{owner.app.id}:hook-0", "stale proof")
    # Fault double only the cache SET after actual PostgreSQL relationship commit.
    with patch.object(redis, "set", side_effect=RuntimeError("cache unavailable")):
        WebhookService.sync_webhook_relationships(owner.app, owner.draft, remove_stale=False)
    with sessionmaker(bind=session.get_bind())() as reader:
        assert [row.node_id for row in reader.scalars(select(WorkflowWebhookTrigger))] == ["hook-0"]


def test_durable_delivery_reloads_current_draft_after_lock_wait(db_session_with_containers: Session) -> None:
    import json

    session = db_session_with_containers
    owner = seed_owner(session, graph=webhook_graph(1))
    assert owner.draft is not None
    draft_id = owner.draft.id
    factory = sessionmaker(bind=session.get_bind())
    with factory() as reader:
        stale = require(reader.get(Workflow, draft_id), Workflow)

    acquire = RedisLock.acquire

    def update_after_wait(lock: RedisLock, *, blocking: bool, blocking_timeout: float) -> bool:
        acquired = acquire(lock, blocking=blocking, blocking_timeout=blocking_timeout)
        assert acquired
        with factory.begin() as writer:
            require(writer.get(Workflow, draft_id), Workflow).graph = json.dumps(webhook_graph(2))
        return acquired

    with patch.object(RedisLock, "acquire", new=update_after_wait):
        WebhookService.sync_webhook_relationships(owner.app, stale, remove_stale=False, reconcile_current_draft=True)
    with factory() as reader:
        assert {row.node_id for row in reader.scalars(select(WorkflowWebhookTrigger))} == {"hook-0", "hook-1"}


def test_ack_sql_failure_keeps_lease_for_recovery(db_session_with_containers: Session) -> None:
    from sqlalchemy import event

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    operation = stage_record(session, owner)
    engine = session.get_bind()

    def fail_ack(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: object
    ) -> None:
        if statement.startswith("DELETE FROM workflow_draft_coordination"):
            raise RuntimeError("fault at acknowledgment SQL")

    event.listen(engine, "before_cursor_execute", fail_ack)
    try:
        with pytest.raises(RuntimeError, match="acknowledgment"):
            Coordinator.execute(operation)
    finally:
        event.remove(engine, "before_cursor_execute", fail_ack)
    session.expire_all()
    assert require(session.get(Coordination, operation), Coordination).claim_token is not None
    due(session, operation)
    assert Coordinator.execute(operation)
    session.expire_all()
    assert session.get(Coordination, operation) is None


def test_superseded_record_keeps_candidates_and_projects_current_graph(db_session_with_containers: Session) -> None:
    import json

    session = db_session_with_containers
    owner = seed_owner(session, graph=webhook_graph(1))
    assert owner.draft is not None
    first, second = str(uuid4()), str(uuid4())
    old_operation = stage_record(session, owner, candidates=[first])
    owner.draft.graph = json.dumps(webhook_graph(2))
    new_operation = stage_record(session, owner, candidates=[second])
    with patch("services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned") as retirement:
        assert Coordinator.execute(old_operation)
        assert Coordinator.execute(new_operation)
    assert [call.kwargs["agent_ids"] for call in retirement.call_args_list] == [{first}, {second}]
    with sessionmaker(bind=session.get_bind())() as reader:
        assert {row.node_id for row in reader.scalars(select(WorkflowWebhookTrigger))} == {"hook-0", "hook-1"}
        assert reader.scalar(select(Coordination)) is None


def test_operation_union_rejects_foreign_owner(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    other = seed_owner(session, graph=POPULATED_GRAPH)
    assert other.draft is not None
    operation = stage_record(session, owner)
    with pytest.raises(ValueError, match="owner mismatch"):
        Coordinator.stage(
            session,
            coordination_id=operation,
            workflow=other.draft,
            account_id=other.account.id,
            retirement_agent_ids=[str(uuid4())],
            emit_draft_event=True,
        )
    session.rollback()
    assert require(session.get(Coordination, operation), Coordination).app_id == owner.app.id


def test_work_and_sweep_explicit_workflow_queue(flask_app_with_containers: Flask) -> None:
    assert cast(RoutedTask, process_workflow_draft_coordination).queue == "workflow"
    assert cast(RoutedTask, sweep_workflow_draft_coordination).queue == "workflow"
    schedule = flask_app_with_containers.extensions["celery"].conf.beat_schedule["workflow_draft_coordination_sweeper"]
    assert schedule["options"]["queue"] == "workflow"


def test_coordination_actual_migration_upgrade_downgrade_and_offline(flask_app_with_containers: Flask) -> None:
    import importlib.util
    from io import StringIO
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    path = (
        Path(__file__).parents[4]
        / "migrations/versions/2026_10_25_1200-e832a94f210b_add_workflow_draft_coordination.py"
    )
    spec = importlib.util.spec_from_file_location("coordination_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "d41e6b8c2a75"
    schema = "draft_coordination_" + uuid4().hex
    table = "workflow_draft_coordination"
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            inspector = sa_inspect(connection)
            assert {c["name"] for c in inspector.get_columns(table, schema=schema)} == {
                c.name for c in Coordination.__table__.columns
            }
            assert len(inspector.get_columns(table, schema=schema)) == 13
            assert not inspector.get_foreign_keys(table, schema=schema)
            assert {i["name"] for i in inspector.get_indexes(table, schema=schema)} == {
                "workflow_draft_coordination_due",
                "workflow_draft_coordination_owner",
            }
            identity = str(uuid4())
            insert = text(
                f"INSERT INTO {table} (id,tenant_id,app_id,workflow_id,workflow_version,retirement_agent_ids,"
                "emit_draft_event,available_at,attempt_count,created_at) "
                "VALUES (:id,:id,:id,:id,'draft','[]',false,now(),:count,now())"
            )
            nested = connection.begin_nested()
            with pytest.raises(IntegrityError):
                connection.execute(insert, {"id": identity, "count": -1})
            nested.rollback()
            connection.execute(insert, {"id": identity, "count": 0})
            migration.downgrade()
            assert table not in sa_inspect(connection).get_table_names(schema=schema)
            migration.upgrade()
            assert table in sa_inspect(connection).get_table_names(schema=schema)
        connection.execute(text("SET LOCAL search_path TO public"))
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    output = StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    ):
        migration.upgrade()
        migration.downgrade()
    assert "CREATE TABLE workflow_draft_coordination" in output.getvalue()
    assert "DROP TABLE workflow_draft_coordination" in output.getvalue()


@pytest.mark.parametrize("fault", ["redis-lock", "relationship-sql"])
@pytest.mark.parametrize("hook_count", [0, 1])
def test_webhook_outage_preserves_accepted_receipt_and_recovers(
    db_session_with_containers: Session, fault: str, hook_count: int
) -> None:
    from sqlalchemy import event

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    engine = session.get_bind()

    def fail_insert(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: object
    ) -> None:
        if statement.startswith("INSERT INTO workflow_webhook_triggers"):
            raise RuntimeError("relationship SQL fault")

    def deny_acquire(_lock: RedisLock, **_kwargs: object) -> bool:
        return False

    if fault == "relationship-sql":
        event.listen(engine, "before_cursor_execute", fail_insert)
    try:
        with patch.object(process_workflow_draft_coordination, "delay"):
            with (
                patch.object(RedisLock, "acquire", new=deny_acquire)
                if fault == "redis-lock"
                else __import__("contextlib").nullcontext()
            ):
                result = save(session, owner, webhook_graph(hook_count))
    finally:
        if fault == "relationship-sql":
            event.remove(engine, "before_cursor_execute", fail_insert)
    assert result.graph_dict == webhook_graph(hook_count)
    with sessionmaker(bind=engine)() as reader:
        rows = reader.scalars(select(Coordination)).all()
        if fault == "relationship-sql" and hook_count == 0:
            assert not rows  # no SQL relationship INSERT exists to fault
            return
        assert len(rows) == 1
        operation = rows[0].id
        assert rows[0].claim_token is None
        assert not reader.scalars(select(WorkflowWebhookTrigger)).all()
    due(session, operation)
    assert Coordinator.execute(operation)
    with sessionmaker(bind=engine)() as reader:
        assert reader.scalar(select(Coordination)) is None
        assert len(reader.scalars(select(WorkflowWebhookTrigger)).all()) == hook_count


def test_restore_console_receipt_uses_accepted_snapshot(
    flask_app_with_containers: Flask, db_session_with_containers: Session
) -> None:
    import json

    session = db_session_with_containers
    owner = seed_owner(session, graph=webhook_graph(1))
    assert owner.draft is not None
    draft_id, source_id = owner.draft.id, owner.app.workflow_id
    expected_hash = require(session.get(Workflow, source_id), Workflow).unique_hash
    factory = sessionmaker(bind=session.get_bind())

    assert db.session().expire_on_commit is True
    with workflow_api.session_factory.create_session() as receipt_session:
        assert receipt_session.get_bind() is session.get_bind()
        assert receipt_session.expire_on_commit is False

    def later_commit(**_kwargs: object) -> None:
        with factory.begin() as writer:
            require(writer.get(Workflow, draft_id), Workflow).graph = json.dumps(webhook_graph(2))

    api = workflow_api.DraftWorkflowRestoreApi()
    with patch(
        "services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned", side_effect=later_commit
    ):
        with flask_app_with_containers.test_request_context(method="POST"):
            response = inspect.unwrap(api.post)(api, owner.account, app_model=owner.app, workflow_id=source_id)
    assert response["hash"] == expected_hash
    with factory() as reader:
        assert require(reader.get(Workflow, draft_id), Workflow).graph_dict == webhook_graph(2)


def test_dsl_package_caller_stages_exact_operation_before_commit(db_session_with_containers: Session) -> None:
    import json

    from services.app_dsl_service import CURRENT_DSL_VERSION, AppDslService, ImportStatus

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    candidate = str(uuid4())
    # Package materialization is a labeled boundary double. Caller/session/row union/commit are real.
    with patch(
        "services.app_dsl_service.AgentDslService.import_workflow_packages", return_value=(owner.draft, [], {candidate})
    ):
        with patch.object(Coordinator, "kick") as kick:
            result = AppDslService(session).import_app(
                account=owner.account,
                app_id=owner.app.id,
                import_mode="yaml-content",
                yaml_content=json.dumps(
                    {
                        "version": CURRENT_DSL_VERSION,
                        "kind": "app",
                        "app": {"mode": "workflow", "name": "package import"},
                        "workflow": {"graph": POPULATED_GRAPH, "features": {}},
                        "agent_packages": {"test": {}},
                    }
                ),
            )
    assert result.status == ImportStatus.COMPLETED
    operation = kick.call_args.args[0]
    with sessionmaker(bind=session.get_bind())() as reader:
        row = require(reader.get(Coordination, operation), Coordination)
        assert row.retirement_agent_ids == [candidate]
        assert row.emit_draft_event is False
        assert row.workflow_id == owner.draft.id
        assert row.tenant_id == owner.app.tenant_id


def test_builder_prepared_caller_stages_before_commit(db_session_with_containers: Session) -> None:
    from core.dify_builder.models import Actor, MutationIntent
    from services.dify_builder.dify_port import WorkflowServiceDifyPort
    from services.dify_builder.native_testing.agent_binding import AgentBindingService
    from services.dify_builder.revision import execution_revision

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    candidate = str(uuid4())
    actor = Actor(account_id=owner.account.id, tenant_id=owner.app.tenant_id)
    # Prepared binding materialization is a labeled double; production Builder/Workflow SQL owners are real.

    def prepared(**kwargs: object) -> tuple[Graph, AgentBindingService]:
        return cast(Graph, kwargs["graph"]), AgentBindingService(require(kwargs["session"], Session))

    def sync_prepared(_service: AgentBindingService, **_kwargs: object) -> set[str]:
        return {candidate}

    with (
        patch("services.dify_builder.dify_port._prepare_native_agent_graph", new=prepared),
        patch.object(AgentBindingService, "sync_prepared_bindings", new=sync_prepared),
    ):
        with patch.object(Coordinator, "kick") as kick:
            result = WorkflowServiceDifyPort().apply_repair(
                owner.app.id,
                actor,
                [MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "changed"})],
                expected_revision=execution_revision(owner.draft),
            )
    operation = kick.call_args.args[0]
    with sessionmaker(bind=session.get_bind())() as reader:
        row = require(reader.get(Coordination, operation), Coordination)
        assert row.retirement_agent_ids == [candidate]
        assert row.emit_draft_event is True
        assert row.workflow_id == owner.draft.id
        assert (
            require(reader.get(Workflow, row.workflow_id), Workflow).graph_dict["nodes"][0]["data"]["title"]
            == "changed"
        )
    assert result.changed_nodes == ["start"]


@pytest.mark.parametrize("ownership", ["rebound-draft", "historical", "wrong-version", "foreign-tenant"])
def test_retry_rechecks_actual_retirement_ownership(db_session_with_containers: Session, ownership: str) -> None:
    from models.agent import (
        Agent,
        AgentScope,
        AgentSource,
        AgentStatus,
        WorkflowAgentBindingType,
        WorkflowAgentNodeBinding,
    )

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    foreign = seed_owner(session, graph=POPULATED_GRAPH)
    agent = Agent(
        tenant_id=foreign.app.tenant_id if ownership == "foreign-tenant" else owner.app.tenant_id,
        name="Recovery ownership fixture",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
    )
    session.add(agent)
    session.commit()
    agent_id = agent.id
    operation = stage_record(session, owner, candidates=[agent_id])
    # First attempt fails before lifecycle effects. Ownership is added before the real retry.
    with patch(
        "services.agent.retirement_service.WorkflowAgentRetirementService.retire_unowned",
        side_effect=RuntimeError("fault"),
    ):
        assert not Coordinator.execute(operation)
    if ownership != "foreign-tenant":
        workflow = (
            owner.draft
            if ownership != "historical"
            else require(session.get(Workflow, owner.app.workflow_id), Workflow)
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=owner.app.tenant_id,
                app_id=owner.app.id,
                workflow_id=workflow.id,
                workflow_version="other-version" if ownership == "wrong-version" else workflow.version,
                node_id="retained",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=agent_id,
                node_job_config={},
                created_by=owner.account.id,
            )
        )
        if ownership == "historical":
            owner.app.workflow_id = None
        session.commit()
    due(session, operation)
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    # Bind the real retirement SQL owner to this ephemeral PostgreSQL database; no policy double.
    with patch("services.agent.retirement_service.session_factory.create_session", side_effect=factory):
        with patch("services.agent.retirement_service.enqueue_agent_resource_collection") as collector:
            assert Coordinator.execute(operation)
    session.expire_all()
    expected = AgentStatus.ARCHIVED if ownership == "wrong-version" else AgentStatus.ACTIVE
    assert require(session.get(Agent, agent_id), Agent).status == expected
    assert collector.call_args.kwargs["purge_agent_ids"] == ([agent_id] if ownership == "wrong-version" else [])
    assert session.get(Coordination, operation) is None


def test_real_retirement_partial_publication_failure_reconstructs_handoff(db_session_with_containers: Session) -> None:
    from models.agent import Agent, AgentScope, AgentSource, AgentStatus

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    hidden = App(
        tenant_id=owner.app.tenant_id,
        name="Synthetic hidden Agent App",
        mode=AppMode.AGENT,
        enable_site=False,
        enable_api=False,
        created_by=owner.account.id,
        updated_by=owner.account.id,
    )
    session.add(hidden)
    session.flush()
    hidden_id = hidden.id
    agent = Agent(
        tenant_id=owner.app.tenant_id,
        name="Synthetic orphan",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        backing_app_id=hidden_id,
    )
    session.add(agent)
    session.commit()
    agent_id = agent.id
    operation = stage_record(session, owner, candidates=[agent_id])
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    # Capture downstream task publication only. Real retirement commits before the collector fault.
    with patch("services.agent.retirement_service.session_factory.create_session", side_effect=factory):
        with patch("services.agent.retirement_service.remove_app_and_related_data_task.delay") as app_cleanup:
            with patch(
                "services.agent.retirement_service.enqueue_agent_resource_collection",
                side_effect=RuntimeError("broker fault"),
            ):
                assert not Coordinator.execute(operation)
            with factory() as reader:
                assert require(reader.get(Agent, agent_id), Agent).status == AgentStatus.ARCHIVED
                assert reader.get(App, hidden_id) is None
                assert require(reader.get(Coordination, operation), Coordination).retirement_agent_ids == [agent_id]
            due(session, operation)
            with patch("services.agent.retirement_service.enqueue_agent_resource_collection") as collector:
                assert Coordinator.execute(operation)
    assert app_cleanup.call_count == 2  # duplicate accepted handoff is allowed by the existing owner
    assert collector.call_args.kwargs["purge_agent_ids"] == [agent_id]
    assert all(call.kwargs["app_id"] == hidden_id for call in app_cleanup.call_args_list)
    session.expire_all()
    assert session.get(Coordination, operation) is None


def test_worker_and_sweep_sanitize_unexpected_sql_faults(
    db_session_with_containers: Session, caplog: pytest.LogCaptureFixture
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    operation = stage_record(session, owner)
    secret = "SENTINEL_TASK_SQL_CREDENTIAL"
    with patch.object(Coordinator, "execute", side_effect=RuntimeError(secret)):
        process_workflow_draft_coordination(operation)
    with patch.object(Coordinator, "due_ids", side_effect=RuntimeError(secret)):
        sweep_workflow_draft_coordination()
    assert secret not in caplog.text
    assert "worker:RuntimeError" in caplog.text
    assert "discovery:RuntimeError" in caplog.text
    assert operation in Coordinator.due_ids(100)


def test_committed_save_without_kick_is_recovered_without_graph_replay(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    with patch.object(Coordinator, "kick"):
        accepted = save(session, owner, webhook_graph(1))
    receipt = accepted.unique_hash
    with sessionmaker(bind=session.get_bind())() as reader:
        pending = require(reader.scalar(select(Coordination)), Coordination)
        assert require(reader.get(Workflow, pending.workflow_id), Workflow).unique_hash == receipt
        assert not reader.scalars(select(WorkflowWebhookTrigger)).all()
        operation = pending.id
    with patch.object(process_workflow_draft_coordination, "delay") as publication:
        sweep_workflow_draft_coordination()
    publication.assert_called_once_with(operation)
    process_workflow_draft_coordination(operation)
    with sessionmaker(bind=session.get_bind())() as reader:
        assert reader.get(Coordination, operation) is None
        assert require(reader.get(Workflow, accepted.id), Workflow).unique_hash == receipt
        assert len(reader.scalars(select(WorkflowWebhookTrigger)).all()) == 1
