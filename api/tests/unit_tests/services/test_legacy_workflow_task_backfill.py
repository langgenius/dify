"""Upgrade backfill restores trusted task IDs without reviving old executions."""

import json
from collections.abc import Callable
from datetime import datetime
from uuid import uuid4

import pytest
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
def backfill_service(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> AppTaskControlService:
    monkeypatch.setattr(type(task_module.db), "engine", property(lambda _: sqlite_engine))
    return AppTaskControlService(redis_client=_StopRedis())


def _seed_pause(
    session: Session, states: dict[str, bytes], app_mode: AppMode = AppMode.WORKFLOW
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
        created_at=datetime(2026, 10, 10),
        elapsed_time=0,
        total_tokens=0,
        total_steps=1,
        exceptions_count=0,
    )
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key=f"pause/{run.id}")
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


@pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_backfill_restores_the_public_task_and_is_idempotent(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
    app_mode: AppMode,
) -> None:
    run, pause, context = _seed_pause(sqlite_session, pause_states, app_mode)
    task_id = context.get_generate_entity().task_id
    assert task_id != run.id

    assert backfill_service.backfill_legacy_workflow_task_ids() == 1
    sqlite_session.refresh(run)
    assert run.task_id == task_id
    assert run.status == WorkflowExecutionStatus.PAUSED
    assert run.stop_requested_at is None
    assert sqlite_session.get(WorkflowPause, pause.id) is not None
    sqlite_session.commit()
    pause_states.clear()
    assert backfill_service.backfill_legacy_workflow_task_ids() == 0


@pytest.mark.parametrize("field", ["task_id", "run_id", "tenant_id", "app_id", "user_id"])
def test_backfill_rejects_snapshot_identity_mismatches(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
    field: str,
) -> None:
    run, pause, _ = _seed_pause(sqlite_session, pause_states)
    state = json.loads(pause_states[pause.state_object_key])
    entity = state["generate_entity"]["entity"]
    if field in {"tenant_id", "app_id"}:
        entity["app_config"][field] = "other-owner"
    else:
        entity["workflow_execution_id" if field == "run_id" else field] = "invalid-task-or-owner"
    pause_states[pause.state_object_key] = json.dumps(state).encode()

    with pytest.raises(ValueError, match=rf"Legacy workflow task remains unindexed: {run.id} \(paused\)\."):
        backfill_service.backfill_legacy_workflow_task_ids()

    sqlite_session.refresh(run)
    assert run.task_id is None
    assert run.status == WorkflowExecutionStatus.PAUSED
    assert sqlite_session.get(WorkflowPause, pause.id) is not None


@pytest.mark.parametrize("missing", ["pause", "state", "corrupt_state"])
def test_backfill_reports_unrecoverable_pause_without_changing_it(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
    missing: str,
) -> None:
    run, pause, _ = _seed_pause(sqlite_session, pause_states)
    if missing == "pause":
        sqlite_session.delete(pause)
        sqlite_session.commit()
    elif missing == "state":
        pause_states.clear()
    else:
        pause_states[pause.state_object_key] = b"invalid JSON"

    with pytest.raises(ValueError, match=rf"Legacy workflow task remains unindexed: {run.id} \(paused\)\."):
        backfill_service.backfill_legacy_workflow_task_ids()

    sqlite_session.refresh(run)
    assert run.task_id is None
    assert run.status == WorkflowExecutionStatus.PAUSED
    assert run.stop_requested_at is None


def test_backfill_requires_old_running_work_to_drain_but_indexes_valid_pauses(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
) -> None:
    running, running_pause, _ = _seed_pause(sqlite_session, pause_states)
    running.status = WorkflowExecutionStatus.RUNNING
    sqlite_session.delete(running_pause)
    sqlite_session.commit()
    paused, _, context = _seed_pause(sqlite_session, pause_states)

    with pytest.raises(ValueError, match=rf"Legacy workflow task remains unindexed: {running.id} \(running\)\."):
        backfill_service.backfill_legacy_workflow_task_ids()

    sqlite_session.refresh(running)
    sqlite_session.refresh(paused)
    assert running.task_id is None
    assert running.status == WorkflowExecutionStatus.RUNNING
    assert running.stop_requested_at is None
    assert paused.task_id == context.get_generate_entity().task_id


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


def test_backfill_skips_new_writer_rows_terminal_runs_and_rag_pipelines(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
) -> None:
    bound, _, _ = _seed_pause(sqlite_session, pause_states)
    task_id = str(uuid4())
    bound.task_id = task_id
    finished, _, _ = _seed_pause(sqlite_session, pause_states)
    finished.status = WorkflowExecutionStatus.SUCCEEDED
    pipeline, _, _ = _seed_pause(sqlite_session, pause_states)
    pipeline.type = WorkflowType.RAG_PIPELINE
    sqlite_session.commit()
    pause_states.clear()

    assert backfill_service.backfill_legacy_workflow_task_ids() == 0
    sqlite_session.refresh(bound)
    sqlite_session.refresh(finished)
    sqlite_session.refresh(pipeline)
    assert bound.task_id == task_id
    assert finished.task_id is None
    assert pipeline.task_id is None
    assert pipeline.status == WorkflowExecutionStatus.PAUSED


def test_backfill_reads_every_page_even_as_previous_pages_leave_the_query(
    sqlite_session: Session,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
) -> None:
    expected = {}
    for _ in range(101):
        run, _, context = _seed_pause(sqlite_session, pause_states)
        expected[run.id] = context.get_generate_entity().task_id

    assert backfill_service.backfill_legacy_workflow_task_ids() == 101
    assert dict(sqlite_session.execute(select(WorkflowRun.id, WorkflowRun.task_id)).tuples().all()) == expected


def test_snapshot_storage_reads_do_not_hold_a_database_transaction(
    sqlite_session: Session,
    sqlite_engine: Engine,
    pause_states: dict[str, bytes],
    backfill_service: AppTaskControlService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_pause(sqlite_session, pause_states)
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
        assert backfill_service.backfill_legacy_workflow_task_ids() == 1
    finally:
        for name, listener in listeners:
            event.remove(sqlite_engine, name, listener)
