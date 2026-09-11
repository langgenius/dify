from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource, TraceSpan, make_span_id
from core.ops.workflow_trace import ChildWorkflowTrace, WorkflowTraceState
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.human_input import HumanInputForm
from models.model import AppMode
from models.workflow import WorkflowPause, WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from tasks import human_input_timeout_tasks as task_module
from tests.unit_tests.config_override import apply_config_overrides


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


def test_global_timeout_restores_child_and_root_trace_destinations(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id, app_id, child_app_id, workflow_id, run_id, user_id = (str(uuid4()) for _ in range(6))
    source = TraceSource(
        tenant_id=tenant_id, app_id=app_id, operation_id=run_id, workflow_run_id=run_id, actor_id=user_id
    )
    root_settings, child_settings = (
        TraceProviderSettings(
            tenant_id=tenant_id, app_id=owner_app_id, provider_name="recording", config_id=str(uuid4())
        )
        for owner_app_id in (app_id, child_app_id)
    )
    root_span_id = make_span_id(tenant_id, run_id, "root")
    child_span_id = make_span_id(tenant_id, run_id, "workflow-tool")
    trace_state = WorkflowTraceState(
        source=source,
        provider_settings=[root_settings],
        workflow_id=workflow_id,
        workflow_version="1",
        spans=[
            TraceSpan(span_id=root_span_id, span_name="Workflow", source_app_id=app_id, status="incomplete"),
            TraceSpan(
                span_id=child_span_id,
                parent_span_id=root_span_id,
                span_name="Child workflow",
                source_app_id=app_id,
                status="incomplete",
            ),
        ],
        open_span_ids=[root_span_id, child_span_id],
        child_workflows={
            "workflow-tool": ChildWorkflowTrace(
                source=TraceSource(
                    tenant_id=tenant_id, app_id=child_app_id, operation_id=str(uuid4()), actor_id=user_id
                ),
                workflow_id=str(uuid4()),
                workflow_version="1",
                root_span_id=child_span_id,
                provider_settings=[child_settings],
            )
        },
    )
    checkpoint = WorkflowResumptionContext(
        serialized_graph_runtime_state="{}",
        generate_entity=_WorkflowGenerateEntityWrapper(
            entity=WorkflowAppGenerateEntity(
                task_id=str(uuid4()),
                app_config=WorkflowUIBasedAppConfig(
                    tenant_id=tenant_id, app_id=app_id, app_mode=AppMode.WORKFLOW, workflow_id=workflow_id
                ),
                inputs={},
                files=[],
                user_id=user_id,
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_execution_id=run_id,
            )
        ),
        ops_trace_state=trace_state.model_dump(mode="json"),
    )
    workflow_run = WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user_id,
    )
    pause = WorkflowPause(workflow_id=workflow_id, workflow_run_id=run_id, state_object_key="paused-workflow")
    sqlite_session.add_all([workflow_run, pause])
    sqlite_session.commit()
    storage = MagicMock()
    storage.load_once.return_value = checkpoint.dumps().encode()
    monkeypatch.setattr(task_module, "storage", storage)
    trace_queue = MagicMock()
    trace_queue.submit_trace.return_value = True
    monkeypatch.setitem(app.extensions, "ops_trace_queue", trace_queue)

    task_module._handle_global_timeout(
        tenant_id=tenant_id,
        app_id=app_id,
        form_id=str(uuid4()),
        workflow_run_id=run_id,
        node_id="human-input",
        session_factory=sqlite_session_factory,
    )

    assert trace_queue.submit_trace.call_count == 2
    child_queued, root_queued = (call.args[0] for call in trace_queue.submit_trace.call_args_list)
    assert child_queued.provider_settings == child_settings
    assert root_queued.provider_settings == root_settings
    for queued, owner_app_id in ((child_queued, child_app_id), (root_queued, app_id)):
        trace = CompletedTrace.model_validate_json(queued.trace_json)
        assert trace.source.tenant_id == tenant_id
        assert trace.source.app_id == owner_app_id
        assert trace.source.actor_id == user_id
        assert trace.complete is False
        assert trace.spans[0].error == "Human input global timeout at node human-input"
    sqlite_session.refresh(workflow_run)
    sqlite_session.refresh(pause)
    assert workflow_run.status == WorkflowExecutionStatus.STOPPED
    assert pause.resumed_at is not None
    storage.delete.assert_called_once_with("paused-workflow")


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_marks_and_routes(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
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
def test_check_and_handle_human_input_timeouts_orders_by_id_before_limit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
):
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
):
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
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=3600)

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
