from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from enums.creator import CreatorUserRole
from graphon.entities.pause_reason import PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models.enums import WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from tasks import human_input_timeout_tasks as task_module
from tests.helpers.unit.config_override import apply_config_overrides


class _FakeService:
    def __init__(self) -> None:
        self.enqueued: list[str] = []
        self.agent_app_resumed: list[tuple[str, str]] = []

    def enqueue_resume(self, workflow_run_id: str | None) -> None:
        if workflow_run_id is not None:
            self.enqueued.append(workflow_run_id)

    def enqueue_agent_app_resume(self, *, conversation_id: str, form_id: str) -> None:
        self.agent_app_resumed.append((conversation_id, form_id))


class _FailOnceService(_FakeService):
    def __init__(self) -> None:
        super().__init__()
        self._failed = False

    def enqueue_resume(self, workflow_run_id: str | None) -> None:
        if not self._failed:
            self._failed = True
            raise RuntimeError("broker unavailable")
        super().enqueue_resume(workflow_run_id)


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


def _build_pause_for_form(form: HumanInputForm) -> tuple[WorkflowRun, WorkflowPause, WorkflowPauseReason]:
    assert form.workflow_run_id is not None
    run = WorkflowRun(
        id=form.workflow_run_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    pause = WorkflowPause(
        workflow_id=run.workflow_id,
        workflow_run_id=run.id,
        state_object_key=f"state-{form.id}",
    )
    pause.id = f"pause-{form.id}"
    reason = WorkflowPauseReason(
        pause_id=pause.id,
        type_=PauseReasonType.HITL_REQUIRED,
        form_id=form.id,
        node_id=form.node_id,
    )
    return run, pause, reason


def _build_paused_run_with_terminal_form(
    *,
    suffix: str,
    now: datetime,
    status: HumanInputFormStatus = HumanInputFormStatus.SUBMITTED,
) -> tuple[WorkflowRun, WorkflowPause, WorkflowPauseReason, HumanInputForm]:
    form = _build_form(
        form_id=f"form-{suffix}",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(minutes=1),
        expiration_time=now + timedelta(hours=1),
        workflow_run_id=f"run-{suffix}",
        node_id=f"node-{suffix}",
    )
    form.status = status
    if status == HumanInputFormStatus.SUBMITTED:
        form.submitted_at = now
    run, pause, reason = _build_pause_for_form(form)
    return run, pause, reason, form


@pytest.fixture
def sqlite_task_database(
    sqlite_engine: Engine,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "_session_maker", repository_session_maker)
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=sqlite_engine))


def test_is_global_timeout_uses_created_at() -> None:
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


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_marks_and_routes(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=3600)

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
    for form in forms[:2]:
        sqlite_session.add_all(_build_pause_for_form(form))
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
    global_timeout_handler.assert_called_once()
    global_timeout_call = global_timeout_handler.call_args.kwargs
    assert global_timeout_call["form_id"] == "form-global"
    assert global_timeout_call["workflow_run_id"] == "run-global"
    assert global_timeout_call["pause_id"] == "pause-form-global"
    assert global_timeout_call["node_id"] == "node-global"
    task_session_maker = global_timeout_call["session_factory"]
    assert isinstance(task_session_maker, sessionmaker)
    assert task_session_maker.kw["bind"] is sqlite_engine
    service_factory.assert_called_once_with(task_session_maker, form_repository=repo)

    sqlite_session.expire_all()
    assert sqlite_session.get(HumanInputForm, "form-global").status == HumanInputFormStatus.EXPIRED
    assert sqlite_session.get(HumanInputForm, "form-node").status == HumanInputFormStatus.TIMEOUT
    assert sqlite_session.get(HumanInputForm, "form-delivery").status == HumanInputFormStatus.TIMEOUT


def test_check_and_handle_human_input_timeouts_pages_through_submitted_pauses(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)
    for suffix in ("a", "b", "c"):
        sqlite_session.add_all(_build_paused_run_with_terminal_form(suffix=suffix, now=now))
    stale_run, stale_pause, current_reason, stale_submitted_form = _build_paused_run_with_terminal_form(
        suffix="0-stale",
        now=now,
    )
    current_waiting_form = _build_form(
        form_id="form-0-current",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(minutes=1),
        expiration_time=now + timedelta(hours=1),
        workflow_run_id=stale_run.id,
        node_id="node-0-current",
    )
    current_reason.form_id = current_waiting_form.id
    current_reason.node_id = current_waiting_form.node_id
    sqlite_session.add_all([stale_run, stale_pause, current_reason, stale_submitted_form, current_waiting_form])
    sqlite_session.commit()

    service = _FakeService()
    monkeypatch.setattr(task_module, "HumanInputService", lambda *_args, **_kwargs: service)

    task_module.check_and_handle_human_input_timeouts(limit=2)

    assert service.enqueued == ["run-a", "run-b", "run-c"]


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_resumable_pause_is_retried_on_the_next_scan_after_dispatch_failure(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
    status: HumanInputFormStatus,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    sqlite_session.add_all(_build_paused_run_with_terminal_form(suffix="retry", now=now, status=status))
    sqlite_session.commit()
    service = _FailOnceService()
    monkeypatch.setattr(task_module, "HumanInputService", lambda *_args, **_kwargs: service)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)

    task_module.check_and_handle_human_input_timeouts(limit=1)
    assert service.enqueued == []

    task_module.check_and_handle_human_input_timeouts(limit=1)
    assert service.enqueued == ["run-retry"]


def test_expired_pause_stop_is_retried_and_then_becomes_idempotent(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    run, pause, reason, form = _build_paused_run_with_terminal_form(
        suffix="expired",
        now=now,
        status=HumanInputFormStatus.EXPIRED,
    )
    sqlite_session.add_all([run, pause, reason, form])
    sqlite_session.commit()
    deleted_keys: list[str] = []
    monkeypatch.setattr(task_module.storage, "delete", deleted_keys.append)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)
    failed = False

    def fail_first_commit(_session: Session) -> None:
        nonlocal failed
        if not failed:
            failed = True
            raise RuntimeError("database unavailable")

    event.listen(Session, "before_commit", fail_first_commit)
    try:
        task_module.check_and_handle_human_input_timeouts(limit=1)
        sqlite_session.expire_all()
        assert sqlite_session.get(WorkflowRun, run.id).status == WorkflowExecutionStatus.PAUSED
        assert sqlite_session.get(WorkflowPause, pause.id).resumed_at is None
        assert deleted_keys == []
        sqlite_session.rollback()

        task_module.check_and_handle_human_input_timeouts(limit=1)
        task_module.check_and_handle_human_input_timeouts(limit=1)
    finally:
        event.remove(Session, "before_commit", fail_first_commit)

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowRun, run.id).status == WorkflowExecutionStatus.STOPPED
    assert sqlite_session.get(WorkflowPause, pause.id).resumed_at is not None
    assert deleted_keys == [pause.state_object_key]


def test_global_timeout_cannot_stop_a_replacement_pause(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    run, old_pause, old_reason, expired_form = _build_paused_run_with_terminal_form(
        suffix="replaced",
        now=now,
        status=HumanInputFormStatus.EXPIRED,
    )
    sqlite_session.add_all([run, old_pause, old_reason, expired_form])
    sqlite_session.commit()
    old_pause_id = old_pause.id
    old_form_id = expired_form.id
    old_node_id = expired_form.node_id

    current_form = _build_form(
        form_id="form-current",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now,
        expiration_time=now + timedelta(hours=1),
        workflow_run_id=run.id,
        node_id="node-current",
    )
    current_pause = WorkflowPause(
        workflow_id=run.workflow_id,
        workflow_run_id=run.id,
        state_object_key="state-current",
    )
    current_pause.id = "pause-current"
    current_reason = WorkflowPauseReason(
        pause_id=current_pause.id,
        type_=PauseReasonType.HITL_REQUIRED,
        form_id=current_form.id,
        node_id=current_form.node_id,
    )
    sqlite_session.delete(old_reason)
    sqlite_session.delete(old_pause)
    sqlite_session.flush()
    sqlite_session.add_all([current_form, current_pause, current_reason])
    sqlite_session.commit()
    deleted_keys: list[str] = []
    monkeypatch.setattr(task_module.storage, "delete", deleted_keys.append)

    stopped = task_module._handle_global_timeout(
        form_id=old_form_id,
        workflow_run_id=run.id,
        pause_id=old_pause_id,
        node_id=old_node_id,
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    assert stopped is False
    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowRun, run.id).status == WorkflowExecutionStatus.PAUSED
    assert sqlite_session.get(WorkflowPause, current_pause.id).resumed_at is None
    assert deleted_keys == []


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_orders_by_id_before_limit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)

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
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)

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
