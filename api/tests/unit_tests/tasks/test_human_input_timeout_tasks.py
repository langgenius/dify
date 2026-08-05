from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.ops.unified_trace.human_wait import HumanWaitRecord
from core.ops.unified_trace.workflow_trace_state import WorkflowTraceState
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.workflow import (
    FinalTraceHandoffStatus,
    PauseReasonType,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
    WorkflowType,
)
from tasks import human_input_timeout_tasks as task_module


class _FakeService:
    def __init__(self):
        self.enqueued: list[str] = []
        self.enqueued_waits: list[HumanWaitRecord | None] = []
        self.agent_app_resumed: list[tuple[str, str]] = []

    def enqueue_resume(self, workflow_run_id: str | None, *, human_wait: HumanWaitRecord | None = None) -> None:
        if workflow_run_id is not None:
            self.enqueued.append(workflow_run_id)
            self.enqueued_waits.append(human_wait)

    def enqueue_agent_app_resume(self, *, conversation_id: str, form_id: str) -> None:
        self.agent_app_resumed.append((conversation_id, form_id))


def _build_form(
    *,
    form_id: str,
    form_kind: HumanInputFormKind,
    created_at: datetime,
    expiration_time: datetime,
    workflow_run_id: str | None,
    node_id: str,
    conversation_id: str | None = None,
) -> HumanInputForm:
    form_definition = FormDefinition(
        form_content="",
        rendered_content="",
        expiration_time=expiration_time,
    )
    return HumanInputForm(
        id=form_id,
        tenant_id="tenant-1",
        app_id="app-1",
        form_kind=form_kind,
        created_at=created_at,
        expiration_time=expiration_time,
        workflow_run_id=workflow_run_id,
        conversation_id=conversation_id,
        node_id=node_id,
        form_definition=form_definition.model_dump_json(),
        rendered_content="",
        status=HumanInputFormStatus.WAITING,
    )


def _build_workflow_run(*, run_id: str, created_at: datetime) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        outputs="{}",
        error=None,
        elapsed_time=0,
        total_tokens=13,
        total_steps=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="creator-1",
        created_at=created_at,
        finished_at=None,
        exceptions_count=0,
    )


@pytest.fixture
def sqlite_task_database(
    sqlite_engine: Engine,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "_session_maker", repository_session_maker)
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=sqlite_engine))


def test_is_global_timeout_uses_created_at():
    now = datetime(2025, 1, 1, 12, 0, 0)
    form = _build_form(
        form_id="form-1",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(seconds=61),
        expiration_time=now + timedelta(hours=1),
        workflow_run_id="run-1",
        node_id="node-1",
    )

    assert task_module._is_global_timeout(form, 60, now=now) is True

    form.workflow_run_id = None
    assert task_module._is_global_timeout(form, 60, now=now) is False

    form.workflow_run_id = "run-1"
    form.created_at = now - timedelta(seconds=59)
    assert task_module._is_global_timeout(form, 60, now=now) is False

    assert task_module._is_global_timeout(form, 0, now=now) is False


def test_handle_global_timeout_marks_final_trace_pending_without_deleting_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timed_out_at = datetime(2025, 1, 1, 12, 0, 0)
    workflow_run = SimpleNamespace(
        id="run-global",
        app_id="app-id",
        created_by="creator-id",
        total_tokens=13,
        status=HumanInputFormStatus.WAITING,
        error=None,
        finished_at=None,
    )
    pause = SimpleNamespace(
        id="pause-id",
        state_object_key="pause-state",
        resumed_at=None,
        final_trace_status=None,
        final_trace_attempts=9,
    )

    session = MagicMock()
    session.get.return_value = workflow_run
    session.scalar.return_value = pause
    session_factory = MagicMock()
    session_factory.return_value.__enter__.return_value = session
    session.begin.return_value.__enter__.return_value = None

    monkeypatch.setattr(task_module, "naive_utc_now", lambda: timed_out_at)
    attempt = MagicMock()
    monkeypatch.setattr(task_module, "_attempt_pending_final_trace_handoff", attempt)
    delete = MagicMock()
    monkeypatch.setattr(task_module.storage, "delete", delete)

    task_module._handle_global_timeout(
        form_id="form-global",
        workflow_run_id="run-global",
        node_id="node-global",
        session_factory=session_factory,
    )

    assert workflow_run.status == WorkflowExecutionStatus.STOPPED
    assert pause.resumed_at == timed_out_at
    assert pause.final_trace_status is FinalTraceHandoffStatus.PENDING
    assert pause.final_trace_attempts == 0
    delete.assert_not_called()
    attempt.assert_called_once_with("pause-id", session_factory)


def _add_pending_handoff(
    session: Session,
    *,
    attempts: int = 0,
) -> tuple[WorkflowPause, WorkflowRun, HumanInputForm]:
    started_at = datetime(2025, 1, 1, 10, 0, 0)
    finished_at = started_at + timedelta(hours=2)
    workflow_run = _build_workflow_run(run_id="run-global", created_at=started_at)
    workflow_run.status = WorkflowExecutionStatus.STOPPED
    workflow_run.finished_at = finished_at
    pause = WorkflowPause(
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        state_object_key="pause-state",
        resumed_at=finished_at,
        final_trace_status=FinalTraceHandoffStatus.PENDING,
        final_trace_attempts=attempts,
    )
    form = _build_form(
        form_id="form-global",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=started_at,
        expiration_time=finished_at,
        workflow_run_id=workflow_run.id,
        node_id="node-global",
    )
    form.status = HumanInputFormStatus.EXPIRED
    reason = WorkflowPauseReason(
        pause_id=pause.id,
        type_=PauseReasonType.HITL_REQUIRED,
        form_id=form.id,
        node_id=form.node_id,
    )
    session.add_all([workflow_run, pause, form, reason])
    session.commit()
    return pause, workflow_run, form


def _mock_resumption_context(monkeypatch: pytest.MonkeyPatch) -> None:
    generate_entity = SimpleNamespace(
        user_id="end-user-id",
        conversation_id="conversation-id",
        extras={"trace_session_id": "trace-session"},
        workflow_trace_state=WorkflowTraceState(),
    )
    resumption_context = SimpleNamespace(get_generate_entity=lambda: generate_entity)
    monkeypatch.setattr(task_module.WorkflowResumptionContext, "loads", lambda _value: resumption_context)


def test_pending_handoff_storage_failure_retains_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    pause, _, _ = _add_pending_handoff(sqlite_session)
    monkeypatch.setattr(task_module.dify_config, "OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES", 60)
    monkeypatch.setattr(task_module.storage, "load", MagicMock(side_effect=OSError("storage unavailable")))
    delete = MagicMock()
    monkeypatch.setattr(task_module.storage, "delete", delete)

    task_module._attempt_pending_final_trace_handoff(
        pause.id,
        sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    sqlite_session.expire_all()
    refreshed = sqlite_session.get(WorkflowPause, pause.id)
    assert refreshed is not None
    assert refreshed.final_trace_status is FinalTraceHandoffStatus.PENDING
    assert refreshed.final_trace_attempts == 1
    delete.assert_not_called()


def test_pending_handoff_success_rebuilds_expired_wait_and_deletes_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    pause, _, form = _add_pending_handoff(sqlite_session)
    monkeypatch.setattr(task_module.dify_config, "OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES", 60)
    monkeypatch.setattr(task_module.storage, "load", lambda _key: b"serialized-pause-state")
    delete = MagicMock()
    monkeypatch.setattr(task_module.storage, "delete", delete)
    _mock_resumption_context(monkeypatch)
    manager = MagicMock()
    manager.persist_trace_task.return_value = {
        "file_id": "workflow-final-run-global",
        "app_id": "app-1",
    }
    monkeypatch.setattr(task_module, "TraceQueueManager", MagicMock(return_value=manager))

    task_module._attempt_pending_final_trace_handoff(
        pause.id,
        sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    sqlite_session.expire_all()
    refreshed = sqlite_session.get(WorkflowPause, pause.id)
    assert refreshed is not None
    assert refreshed.final_trace_status is None
    assert refreshed.final_trace_attempts == 1
    persisted_task = manager.persist_trace_task.call_args.args[0]
    assert manager.persist_trace_task.call_args.kwargs["file_id"] == "workflow-final-run-global"
    assert persisted_task.kwargs["human_waits"][0]["wait_id"] == form.id
    assert persisted_task.kwargs["human_waits"][0]["outcome"] == "expired"
    manager.enqueue_persisted_trace.assert_called_once_with(manager.persist_trace_task.return_value)
    delete.assert_called_once_with(pause.state_object_key)


def test_pending_handoff_broker_failure_retains_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    pause, _, _ = _add_pending_handoff(sqlite_session)
    monkeypatch.setattr(task_module.dify_config, "OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES", 60)
    monkeypatch.setattr(task_module.storage, "load", lambda _key: b"serialized-pause-state")
    delete = MagicMock()
    monkeypatch.setattr(task_module.storage, "delete", delete)
    _mock_resumption_context(monkeypatch)
    manager = MagicMock()
    manager.persist_trace_task.return_value = {
        "file_id": "workflow-final-run-global",
        "app_id": "app-1",
    }
    manager.enqueue_persisted_trace.side_effect = ConnectionError("broker unavailable")
    monkeypatch.setattr(task_module, "TraceQueueManager", MagicMock(return_value=manager))

    task_module._attempt_pending_final_trace_handoff(
        pause.id,
        sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    sqlite_session.expire_all()
    refreshed = sqlite_session.get(WorkflowPause, pause.id)
    assert refreshed is not None
    assert refreshed.final_trace_status is FinalTraceHandoffStatus.PENDING
    assert refreshed.final_trace_attempts == 1
    delete.assert_not_called()


def test_pending_handoff_exhaustion_marks_failed_and_logs(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    pause, _, _ = _add_pending_handoff(sqlite_session)
    monkeypatch.setattr(task_module.dify_config, "OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES", 1)
    monkeypatch.setattr(task_module.storage, "load", MagicMock(side_effect=OSError("storage unavailable")))
    error_log = MagicMock()
    monkeypatch.setattr(task_module.logger, "log", error_log)

    task_module._attempt_pending_final_trace_handoff(
        pause.id,
        sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    sqlite_session.expire_all()
    refreshed = sqlite_session.get(WorkflowPause, pause.id)
    assert refreshed is not None
    assert refreshed.final_trace_status is FinalTraceHandoffStatus.FAILED
    assert refreshed.final_trace_attempts == 1
    error_log.assert_called_once()


def test_timeout_scan_retries_pending_final_trace_without_new_expired_forms(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    pause, _, _ = _add_pending_handoff(sqlite_session)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(task_module, "HumanInputService", MagicMock(return_value=_FakeService()))
    attempt = MagicMock()
    monkeypatch.setattr(task_module, "_attempt_pending_final_trace_handoff", attempt)

    task_module.check_and_handle_human_input_timeouts(limit=100)

    attempt.assert_called_once()
    assert attempt.call_args.args[0] == pause.id
    retry_session_maker = attempt.call_args.args[1]
    assert isinstance(retry_session_maker, sessionmaker)
    assert retry_session_maker.kw["bind"] is sqlite_engine


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_marks_and_routes(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 3600)

    forms = [
        _build_form(
            form_id="form-global",
            form_kind=HumanInputFormKind.RUNTIME,
            created_at=now - timedelta(hours=2),
            expiration_time=now + timedelta(hours=1),
            workflow_run_id="run-global",
            node_id="node-global",
        ),
        _build_form(
            form_id="form-node",
            form_kind=HumanInputFormKind.RUNTIME,
            created_at=now - timedelta(minutes=5),
            expiration_time=now - timedelta(seconds=1),
            workflow_run_id="run-node",
            node_id="node-node",
        ),
        _build_form(
            form_id="form-delivery",
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            created_at=now - timedelta(minutes=1),
            expiration_time=now - timedelta(seconds=1),
            workflow_run_id=None,
            node_id="node-delivery",
        ),
    ]
    sqlite_session.add_all(forms)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_spy = MagicMock(wraps=repo.mark_timeout)
    monkeypatch.setattr(repo, "mark_timeout", mark_timeout_spy)
    service = _FakeService()
    service_factory = MagicMock(return_value=service)
    global_timeout_handler = MagicMock()

    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(task_module, "HumanInputService", service_factory)
    monkeypatch.setattr(task_module, "_handle_global_timeout", global_timeout_handler)

    task_module.check_and_handle_human_input_timeouts(limit=100)

    assert {
        (call.kwargs["form_id"], call.kwargs["timeout_status"], call.kwargs["reason"])
        for call in mark_timeout_spy.call_args_list
    } == {
        ("form-global", HumanInputFormStatus.EXPIRED, "global_timeout"),
        ("form-node", HumanInputFormStatus.TIMEOUT, "node_timeout"),
        ("form-delivery", HumanInputFormStatus.TIMEOUT, "delivery_test_timeout"),
    }
    assert service.enqueued == ["run-node"]
    assert service.enqueued_waits[0] is not None
    assert service.enqueued_waits[0].wait_id == "form-node"
    assert service.enqueued_waits[0].outcome == "timed_out"
    global_timeout_handler.assert_called_once()
    global_timeout_call = global_timeout_handler.call_args.kwargs
    assert global_timeout_call["form_id"] == "form-global"
    assert global_timeout_call["workflow_run_id"] == "run-global"
    assert global_timeout_call["node_id"] == "node-global"
    task_session_maker = global_timeout_call["session_factory"]
    assert isinstance(task_session_maker, sessionmaker)
    assert task_session_maker.kw["bind"] is sqlite_engine
    service_factory.assert_called_once_with(task_session_maker, form_repository=repo)

    sqlite_session.expire_all()
    assert sqlite_session.get(HumanInputForm, "form-global").status == HumanInputFormStatus.EXPIRED
    assert sqlite_session.get(HumanInputForm, "form-node").status == HumanInputFormStatus.TIMEOUT
    assert sqlite_session.get(HumanInputForm, "form-delivery").status == HumanInputFormStatus.TIMEOUT


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_orders_by_id_before_limit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
):
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 0)

    forms = [
        _build_form(
            form_id=form_id,
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            created_at=now - timedelta(minutes=1),
            expiration_time=now - timedelta(seconds=1),
            workflow_run_id=None,
            node_id=f"node-{form_id}",
        )
        for form_id in ("form-b", "form-a")
    ]
    sqlite_session.add_all(forms)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_spy = MagicMock(wraps=repo.mark_timeout)
    monkeypatch.setattr(repo, "mark_timeout", mark_timeout_spy)
    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(task_module, "HumanInputService", MagicMock(return_value=_FakeService()))

    task_module.check_and_handle_human_input_timeouts(limit=1)

    mark_timeout_spy.assert_called_once_with(
        form_id="form-a",
        timeout_status=HumanInputFormStatus.TIMEOUT,
        reason="delivery_test_timeout",
    )
    sqlite_session.expire_all()
    assert sqlite_session.get(HumanInputForm, "form-a").status == HumanInputFormStatus.TIMEOUT
    assert sqlite_session.get(HumanInputForm, "form-b").status == HumanInputFormStatus.WAITING


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_omits_global_filter_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
):
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 0)

    old_unexpired_form = _build_form(
        form_id="form-old",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(hours=2),
        expiration_time=now + timedelta(hours=1),
        workflow_run_id="run-old",
        node_id="node-old",
    )
    sqlite_session.add(old_unexpired_form)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_spy = MagicMock(wraps=repo.mark_timeout)
    monkeypatch.setattr(repo, "mark_timeout", mark_timeout_spy)
    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(task_module, "HumanInputService", MagicMock(return_value=_FakeService()))
    global_timeout_handler = MagicMock()
    monkeypatch.setattr(task_module, "_handle_global_timeout", global_timeout_handler)

    task_module.check_and_handle_human_input_timeouts(limit=1)

    mark_timeout_spy.assert_not_called()
    global_timeout_handler.assert_not_called()
    sqlite_session.refresh(old_unexpired_form)
    assert old_unexpired_form.status == HumanInputFormStatus.WAITING


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_routes_conversation_owned_form_to_agent_app_resume(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
):
    # ENG-635 (review): a conversation-owned Agent v2 chat ask_human form has no
    # workflow_run_id. On timeout it must enqueue the Agent App resume (so the
    # timeout is threaded back as the ask_human result), instead of asserting on
    # workflow_run_id — which previously raised and was swallowed by the except.
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 3600)

    form = _build_form(
        form_id="form-chat",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(minutes=5),
        expiration_time=now - timedelta(seconds=1),
        workflow_run_id=None,
        conversation_id="conv-1",
        node_id="agent",
    )
    sqlite_session.add(form)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_spy = MagicMock(wraps=repo.mark_timeout)
    monkeypatch.setattr(repo, "mark_timeout", mark_timeout_spy)
    service = _FakeService()
    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(task_module, "HumanInputService", lambda *_args, **_kwargs: service)
    monkeypatch.setattr(task_module, "_handle_global_timeout", lambda **_kwargs: None)

    task_module.check_and_handle_human_input_timeouts(limit=100)

    # Node timeout (conversation forms are never "global"), routed to Agent App resume.
    mark_timeout_spy.assert_called_once_with(
        form_id="form-chat", timeout_status=HumanInputFormStatus.TIMEOUT, reason="node_timeout"
    )
    assert service.agent_app_resumed == [("conv-1", "form-chat")]
    assert service.enqueued == []
    sqlite_session.refresh(form)
    assert form.status == HumanInputFormStatus.TIMEOUT
