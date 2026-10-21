"""Legacy pauses recover task IDs on demand without an offline backfill."""

import json
from collections.abc import Callable
from datetime import datetime
from uuid import UUID, uuid4

import pytest
from redis import Redis
from sqlalchemy import event, select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker

import services.app_task_service as task_module
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import (
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _WorkflowGenerateEntityWrapper,
)
from graphon.enums import WorkflowExecutionStatus
from libs.broadcast_channel.redis.pubsub_channel import Topic
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.app_task_service import AppTaskControlService, AppTaskService
from tests.unit_tests.services.test_app_task_service import _StopRedis


@pytest.fixture
def pause_states(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    states: dict[str, bytes] = {}

    def load(key: str) -> bytes:
        try:
            return states[key]
        except KeyError as error:
            raise FileNotFoundError(key) from error

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", load)
    return states


@pytest.fixture
def recovery_redis() -> _StopRedis:
    return _StopRedis(read_error=AssertionError("Recovery must use persisted ownership"))


@pytest.fixture
def recovery_service(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, recovery_redis: _StopRedis
) -> AppTaskControlService:
    monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_engine))
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.delete", lambda _: None)
    monkeypatch.setattr(AppTaskService, "_persist_stopped_history", lambda _: None)
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.WorkflowAgentWorkspaceStore.retire_workflow_run",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr("tasks.collect_agent_resources_task.enqueue_agent_resource_collection", lambda **_kwargs: None)
    topic = Topic(Redis(), "recovery-test")
    monkeypatch.setattr(topic, "publish", lambda _payload: None)
    monkeypatch.setattr(task_module.MessageBasedAppGenerator, "get_response_topic", lambda *_: topic)
    return AppTaskControlService(redis_client=recovery_redis)


def _seed_pause(
    session: Session,
    states: dict[str, bytes],
    app_mode: AppMode = AppMode.WORKFLOW,
    *,
    pause_id: str | None = None,
) -> tuple[WorkflowRun, WorkflowPause, WorkflowResumptionContext]:
    run = WorkflowRun(
        id=str(uuid4()),
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW if app_mode == AppMode.WORKFLOW else WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        elapsed_time=0,
        total_tokens=0,
        total_steps=1,
        exceptions_count=0,
    )
    run.created_at = datetime(2026, 10, 10)
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key=f"pause/{run.id}")
    if pause_id is not None:
        pause.id = pause_id
    config = WorkflowUIBasedAppConfig(
        tenant_id=run.tenant_id, app_id=run.app_id, app_mode=app_mode, workflow_id=run.workflow_id
    )
    if app_mode == AppMode.WORKFLOW:
        wrapper = _WorkflowGenerateEntityWrapper(
            entity=WorkflowAppGenerateEntity(
                task_id=str(uuid4()),
                app_config=config,
                inputs={},
                files=[],
                user_id=run.created_by,
                stream=True,
                invoke_from=InvokeFrom.WEB_APP,
                workflow_execution_id=run.id,
            )
        )
    else:
        wrapper = _AdvancedChatAppGenerateEntityWrapper(
            entity=AdvancedChatAppGenerateEntity(
                task_id=str(uuid4()),
                app_config=config,
                inputs={},
                files=[],
                user_id=run.created_by,
                stream=True,
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id=run.id,
                query="Approve this run",
                conversation_id="conversation-1",
            )
        )
    context = WorkflowResumptionContext(generate_entity=wrapper, serialized_graph_runtime_state="{}")
    states[pause.state_object_key] = context.dumps().encode()
    session.add_all([run, pause])
    session.commit()
    return run, pause, context


def _stop(service: AppTaskControlService, task_id: str, app_mode: AppMode = AppMode.WORKFLOW) -> bool:
    return service.stop_workflow_task(
        tenant_id="tenant-1",
        app_id="app-1",
        task_id=task_id,
        app_mode=app_mode,
        owner=(CreatorUserRole.END_USER, "user-1"),
    )


@pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_stop_recovers_and_cancels_a_legacy_pause_without_prior_replay(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    app_mode: AppMode,
    recovery_redis: _StopRedis,
) -> None:
    run, pause, context = _seed_pause(sqlite_session, pause_states, app_mode)
    task_id = context.get_generate_entity().task_id
    assert task_id != run.id
    assert run.task_id is None
    context.get_generate_entity().task_id = task_id.upper()
    pause_states[pause.state_object_key] = context.dumps().encode()

    assert _stop(recovery_service, task_id.upper(), app_mode)

    sqlite_session.refresh(run)
    assert run.task_id == task_id
    assert run.status == WorkflowExecutionStatus.STOPPED
    assert run.stop_requested_at is not None
    assert sqlite_session.scalar(select(WorkflowPause.id).where(WorkflowPause.id == pause.id)) is None
    sqlite_session.commit()
    pause_states.clear()
    assert _stop(recovery_service, task_id, app_mode)
    assert recovery_redis.reads == []
    assert recovery_redis.operations == []


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "created_by", "created_by_role"])
def test_recovery_excludes_unauthorized_pauses_before_storage_reads(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    monkeypatch: pytest.MonkeyPatch,
    field: str,
) -> None:
    run, _, context = _seed_pause(sqlite_session, pause_states)
    setattr(run, field, CreatorUserRole.ACCOUNT if field == "created_by_role" else "other-owner")
    sqlite_session.commit()

    def reject_load(_key: str) -> bytes:
        pytest.fail("Unauthorized pauses must not reach snapshot storage")

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", reject_load)
    assert not _stop(recovery_service, context.get_generate_entity().task_id)
    sqlite_session.refresh(run)
    assert run.task_id is None
    assert run.stop_requested_at is None
    assert run.status == WorkflowExecutionStatus.PAUSED


@pytest.mark.parametrize("field", ["task_id", "run_id", "tenant_id", "app_id", "user_id", "app_config"])
def test_recovery_rejects_snapshot_identity_mismatches_and_continues(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    field: str,
) -> None:
    invalid, pause, invalid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=1)))
    valid, _, valid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=2)))
    state = json.loads(pause_states[pause.state_object_key])
    entity = state["generate_entity"]["entity"]
    if field in {"tenant_id", "app_id"}:
        entity["app_config"][field] = "other-owner"
    elif field == "app_config":
        del entity["app_config"]
    else:
        entity["workflow_execution_id" if field == "run_id" else field] = "invalid-task-or-owner"
    pause_states[pause.state_object_key] = json.dumps(state).encode()

    assert not _stop(recovery_service, invalid_context.get_generate_entity().task_id)
    sqlite_session.refresh(invalid)
    sqlite_session.refresh(valid)
    assert invalid.task_id is None
    assert invalid.status == WorkflowExecutionStatus.PAUSED
    assert invalid.stop_requested_at is None
    assert valid.task_id is None
    sqlite_session.commit()

    assert _stop(recovery_service, valid_context.get_generate_entity().task_id)
    sqlite_session.refresh(invalid)
    sqlite_session.refresh(valid)
    assert invalid.task_id is None
    assert valid.task_id == valid_context.get_generate_entity().task_id
    assert valid.status == WorkflowExecutionStatus.STOPPED


@pytest.mark.parametrize("missing", ["pause", "state", "corrupt_state"])
def test_recovery_skips_unrecoverable_pause_and_finds_later_match(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    missing: str,
) -> None:
    invalid, pause, invalid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=1)))
    valid, _, valid_context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=2)))
    if missing == "pause":
        sqlite_session.delete(pause)
        sqlite_session.commit()
    elif missing == "state":
        del pause_states[pause.state_object_key]
    else:
        pause_states[pause.state_object_key] = b"invalid JSON"

    assert not _stop(recovery_service, invalid_context.get_generate_entity().task_id)
    assert _stop(recovery_service, valid_context.get_generate_entity().task_id)

    sqlite_session.refresh(invalid)
    sqlite_session.refresh(valid)
    assert invalid.task_id is None
    assert invalid.status == WorkflowExecutionStatus.PAUSED
    assert invalid.stop_requested_at is None
    assert valid.status == WorkflowExecutionStatus.STOPPED


@pytest.mark.parametrize("change", ["replaced_pause", "resumed", "already_bound"])
def test_indexing_does_not_overwrite_a_concurrent_transition(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    pause_states: dict[str, bytes],
    change: str,
) -> None:
    run, pause, context = _seed_pause(sqlite_session, pause_states)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    saved_pause = repository.get_workflow_pause(run.id)
    assert saved_pause is not None
    task_id = str(uuid4()) if change == "already_bound" else None
    if change == "replaced_pause":
        sqlite_session.delete(pause)
        sqlite_session.flush()
        sqlite_session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="replacement")
        )
    elif change == "resumed":
        run.status = WorkflowExecutionStatus.RUNNING
        pause.resumed_at = datetime(2026, 10, 10, 1)
    else:
        run.task_id = task_id
    sqlite_session.commit()

    assert not AppTaskService.index_workflow_pause_task(
        workflow_run=run,
        pause_entity=saved_pause,
        resumption_context=context,
        workflow_run_repo=repository,
    )

    sqlite_session.refresh(run)
    assert run.task_id == task_id


@pytest.mark.parametrize("resumed", [False, True])
def test_stop_retries_durable_admission_after_another_request_binds_the_task(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    monkeypatch: pytest.MonkeyPatch,
    resumed: bool,
    recovery_redis: _StopRedis,
) -> None:
    run, pause, context = _seed_pause(sqlite_session, pause_states)
    task_id = context.get_generate_entity().task_id

    def load(key: str) -> bytes:
        with sqlite_session_factory() as session, session.begin():
            concurrent_run = session.get(WorkflowRun, run.id)
            assert concurrent_run is not None
            concurrent_run.task_id = task_id
            if resumed:
                concurrent_run.status = WorkflowExecutionStatus.RUNNING
                concurrent_pause = session.get(WorkflowPause, pause.id)
                assert concurrent_pause is not None
                concurrent_pause.resumed_at = datetime(2026, 10, 10, 1)
        return pause_states[key]

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", load)
    assert _stop(recovery_service, task_id)
    sqlite_session.refresh(run)
    assert run.task_id == task_id
    assert run.stop_requested_at is not None
    assert run.status == (WorkflowExecutionStatus.RUNNING if resumed else WorkflowExecutionStatus.STOPPED)
    assert recovery_redis.reads == []
    assert recovery_redis.operations == (["legacy_flag", "graph_command"] if resumed else [])


@pytest.mark.parametrize("status", [WorkflowExecutionStatus.PAUSED, WorkflowExecutionStatus.RUNNING])
def test_prebound_tasks_stop_without_reading_legacy_snapshots(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    monkeypatch: pytest.MonkeyPatch,
    status: WorkflowExecutionStatus,
) -> None:
    run, _, context = _seed_pause(sqlite_session, pause_states)
    run.task_id = context.get_generate_entity().task_id
    run.status = status
    sqlite_session.commit()

    def reject_load(_key: str) -> bytes:
        pytest.fail("Already indexed tasks must not read snapshots")

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", reject_load)
    assert _stop(recovery_service, context.get_generate_entity().task_id)
    sqlite_session.refresh(run)
    assert run.stop_requested_at is not None


@pytest.mark.parametrize("excluded", ["terminal", "pipeline", "resumed", "running"])
def test_recovery_excludes_nonrecoverable_runs_before_storage_reads(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    monkeypatch: pytest.MonkeyPatch,
    excluded: str,
) -> None:
    run, pause, context = _seed_pause(sqlite_session, pause_states)
    if excluded == "terminal":
        run.status = WorkflowExecutionStatus.SUCCEEDED
    elif excluded == "pipeline":
        run.type = WorkflowType.RAG_PIPELINE
    elif excluded == "resumed":
        pause.resumed_at = datetime(2026, 10, 10, 1)
    else:
        run.status = WorkflowExecutionStatus.RUNNING
    sqlite_session.commit()

    def reject_load(_key: str) -> bytes:
        pytest.fail("Ineligible runs must not read snapshots")

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", reject_load)
    assert not _stop(recovery_service, context.get_generate_entity().task_id)
    sqlite_session.refresh(run)
    assert run.task_id is None
    assert run.stop_requested_at is None


def test_recovery_pages_pauses_without_backfilling_unrelated_runs(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
) -> None:
    for index in range(1, 101):
        _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=index)))
    run, _, context = _seed_pause(sqlite_session, pause_states, pause_id=str(UUID(int=101)))
    task_id = context.get_generate_entity().task_id

    assert _stop(recovery_service, task_id)

    indexed = sqlite_session.execute(
        select(WorkflowRun.id, WorkflowRun.task_id).where(WorkflowRun.task_id.is_not(None))
    )
    assert indexed.tuples().all() == [(run.id, task_id)]


def test_snapshot_storage_reads_do_not_hold_a_database_transaction(
    sqlite_session: Session,
    sqlite_engine: Engine,
    pause_states: dict[str, bytes],
    recovery_service: AppTaskControlService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, context = _seed_pause(sqlite_session, pause_states)
    active_transactions: set[Connection] = set()

    def load(key: str) -> bytes:
        assert not active_transactions
        return pause_states[key]

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", load)
    listeners: tuple[tuple[str, Callable[[Connection], None]], ...] = (
        ("begin", active_transactions.add),
        ("commit", active_transactions.discard),
        ("rollback", active_transactions.discard),
    )
    for name, listener in listeners:
        event.listen(sqlite_engine, name, listener)
    try:
        assert _stop(recovery_service, context.get_generate_entity().task_id)
    finally:
        for name, listener in listeners:
            event.remove(sqlite_engine, name, listener)
