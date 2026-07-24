from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from models.human_input import HumanInputForm
from tasks import human_input_timeout_tasks as task_module


class _FakeService:
    def __init__(self):
        self.enqueued: list[str] = []
        self.agent_app_resumed: list[tuple[str, str]] = []

    def enqueue_resume(self, workflow_run_id: str | None) -> None:
        if workflow_run_id is not None:
            self.enqueued.append(workflow_run_id)

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
