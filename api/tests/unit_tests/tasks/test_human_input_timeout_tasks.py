from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any
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
from models.human_input import HumanInputForm
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


def test_handle_global_timeout_publishes_retained_trace_before_cleanup(monkeypatch: pytest.MonkeyPatch):
    started_at = datetime(2025, 1, 1, 10, 0, 0)
    timed_out_at = started_at + timedelta(hours=2)
    workflow_run = SimpleNamespace(
        id="run-global",
        app_id="app-id",
        created_by="creator-id",
        total_tokens=13,
        status=HumanInputFormStatus.WAITING,
        error=None,
        finished_at=None,
    )
    pause = SimpleNamespace(id="pause-id", state_object_key="pause-state", resumed_at=None)

    session = MagicMock()
    session.get.return_value = workflow_run
    session.scalar.return_value = pause
    session_factory = MagicMock()
    session_factory.return_value.__enter__.return_value = session
    session.begin.return_value.__enter__.return_value = None

    generate_entity = SimpleNamespace(
        app_config=SimpleNamespace(app_id="app-id"),
        user_id="end-user-id",
        conversation_id="conversation-id",
        extras={"trace_session_id": "trace-session"},
        workflow_trace_state=WorkflowTraceState(),
    )
    resumption_context = SimpleNamespace(get_generate_entity=lambda: generate_entity)
    monkeypatch.setattr(task_module.WorkflowResumptionContext, "loads", lambda _value: resumption_context)

    deleted: list[str] = []
    monkeypatch.setattr(task_module.storage, "load", lambda _key: b"serialized-pause-state")
    monkeypatch.setattr(task_module.storage, "delete", deleted.append)
    trace_tasks: list[Any] = []

    class _TraceManager:
        def __init__(self, app_id: str, user_id: str):
            assert app_id == "app-id"
            assert user_id == "end-user-id"

        def add_trace_task(self, task) -> None:
            trace_tasks.append(task)

    monkeypatch.setattr(task_module, "TraceQueueManager", _TraceManager)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: timed_out_at)
    wait = HumanWaitRecord(
        wait_id="form-global",
        owner_id="node-global",
        owner_kind="workflow_node",
        start_time=started_at,
        end_time=timed_out_at,
        outcome="expired",
    )

    task_module._handle_global_timeout(
        form_id="form-global",
        workflow_run_id="run-global",
        node_id="node-global",
        session_factory=session_factory,
        human_wait=wait,
    )

    assert len(trace_tasks) == 1
    trace_task = trace_tasks[0]
    assert trace_task.workflow_run_id == "run-global"
    assert trace_task.workflow_total_tokens == 13
    assert trace_task.kwargs["trace_session_id"] == "trace-session"
    assert trace_task.kwargs["human_waits"] == [wait.model_dump(mode="json")]
    assert deleted == ["pause-state"]


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
    assert global_timeout_call["human_wait"].wait_id == "form-global"
    assert global_timeout_call["human_wait"].outcome == "expired"
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
