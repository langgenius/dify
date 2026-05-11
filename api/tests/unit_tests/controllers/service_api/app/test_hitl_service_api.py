"""Dedicated tests for HITL behavior exposed through the Service API."""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, Mock

import pytest
from flask import Flask

import services.app_generate_service as ags_module
from controllers.service_api.app.workflow_events import WorkflowEventsApi
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.common import workflow_response_converter
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.app.entities.task_entities import (
    AdvancedChatPausedBlockingResponse,
    HumanInputRequiredResponse,
    WorkflowAppPausedBlockingResponse,
    WorkflowPauseStreamResponse,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.human_input_policy import HumanInputSurface
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HumanInputRequired, PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.nodes.human_input.entities import FormInput, UserAction
from graphon.nodes.human_input.enums import FormInputType
from graphon.runtime import GraphRuntimeState, VariablePool
from models.account import Account
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowRun
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity
from services.app_generate_service import AppGenerateService
from services.workflow_event_snapshot_service import _build_snapshot_events
from tests.unit_tests.controllers.service_api.conftest import _unwrap


class _DummyRateLimit:
    @staticmethod
    def gen_request_key() -> str:
        return "dummy-request-id"

    def __init__(self, client_id: str, max_active_requests: int) -> None:
        self.client_id = client_id
        self.max_active_requests = max_active_requests

    def enter(self, request_id: str | None = None) -> str:
        return request_id or "dummy-request-id"

    def exit(self, request_id: str) -> None:
        return None

    def generate(self, generator, request_id: str):
        return generator


def _mock_repo_for_run(monkeypatch: pytest.MonkeyPatch, workflow_run):
    workflow_events_module = sys.modules["controllers.service_api.app.workflow_events"]
    repo = SimpleNamespace(get_workflow_run_by_id_and_tenant_id=lambda **_kwargs: workflow_run)
    monkeypatch.setattr(
        workflow_events_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: repo,
    )
    monkeypatch.setattr(workflow_events_module, "db", SimpleNamespace(engine=object()))
    return workflow_events_module


def _build_service_api_pause_converter() -> WorkflowResponseConverter:
    application_generate_entity = SimpleNamespace(
        inputs={},
        files=[],
        invoke_from=InvokeFrom.SERVICE_API,
        app_config=SimpleNamespace(app_id="app-id", tenant_id="tenant-id"),
    )
    system_variables = build_system_variables(
        user_id="user",
        app_id="app-id",
        workflow_id="workflow-id",
        workflow_execution_id="run-id",
    )
    user = MagicMock(spec=Account)
    user.id = "account-id"
    user.name = "Tester"
    user.email = "tester@example.com"
    return WorkflowResponseConverter(
        application_generate_entity=application_generate_entity,
        user=user,
        system_variables=system_variables,
    )


def _build_advanced_chat_paused_blocking_response() -> AdvancedChatPausedBlockingResponse:
    data = AdvancedChatPausedBlockingResponse.Data(
        id="msg-1",
        mode="chat",
        conversation_id="c1",
        message_id="m1",
        workflow_run_id="run-1",
        answer="partial",
        metadata={"usage": {"total_tokens": 1}},
        created_at=1,
        paused_nodes=["node-1"],
        reasons=[
            {
                "type": PauseReasonType.HUMAN_INPUT_REQUIRED,
                "form_id": "form-1",
                "expiration_time": 100,
            }
        ],
        status=WorkflowExecutionStatus.PAUSED,
        elapsed_time=0.1,
        total_tokens=0,
        total_steps=0,
    )
    return AdvancedChatPausedBlockingResponse(task_id="t1", data=data)


def _build_workflow_paused_blocking_response() -> WorkflowAppPausedBlockingResponse:
    return WorkflowAppPausedBlockingResponse(
        task_id="t1",
        workflow_run_id="r1",
        data=WorkflowAppPausedBlockingResponse.Data(
            id="r1",
            workflow_id="wf-1",
            status=WorkflowExecutionStatus.PAUSED,
            outputs={},
            error=None,
            elapsed_time=0.5,
            total_tokens=0,
            total_steps=2,
            created_at=1,
            finished_at=None,
            paused_nodes=["node-1"],
            reasons=[{"TYPE": "human_input_required", "form_id": "form-1", "expiration_time": 100}],
        ),
    )


@dataclass(frozen=True)
class _FakePauseEntity(WorkflowPauseEntity):
    pause_id: str
    workflow_run_id: str
    paused_at_value: datetime
    pause_reasons: Sequence[HumanInputRequired]

    @property
    def id(self) -> str:
        return self.pause_id

    @property
    def workflow_execution_id(self) -> str:
        return self.workflow_run_id

    def get_state(self) -> bytes:
        raise AssertionError("state is not required for snapshot tests")

    @property
    def resumed_at(self) -> datetime | None:
        return None

    @property
    def paused_at(self) -> datetime:
        return self.paused_at_value

    def get_pause_reasons(self) -> Sequence[HumanInputRequired]:
        return self.pause_reasons


def _build_workflow_run(status: WorkflowExecutionStatus) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type="workflow",
        triggered_from="app-run",
        version="v1",
        graph=None,
        inputs=json.dumps({"input": "value"}),
        status=status,
        outputs=json.dumps({}),
        error=None,
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _build_snapshot(status: WorkflowNodeExecutionStatus) -> WorkflowNodeExecutionSnapshot:
    created_at = datetime(2024, 1, 1, tzinfo=UTC)
    finished_at = datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC)
    return WorkflowNodeExecutionSnapshot(
        execution_id="exec-1",
        node_id="node-1",
        node_type="human-input",
        title="Human Input",
        index=1,
        status=status.value,
        elapsed_time=0.5,
        created_at=created_at,
        finished_at=finished_at,
        iteration_id=None,
        loop_id=None,
    )


def _build_resumption_context(task_id: str) -> WorkflowResumptionContext:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-1",
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id=task_id,
        app_config=app_config,
        inputs={},
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        call_depth=0,
        workflow_execution_id="run-1",
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    runtime_state.register_paused_node("node-1")
    runtime_state.outputs = {"result": "value"}
    wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
    return WorkflowResumptionContext(
        generate_entity=wrapper,
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


class TestHitlServiceApi:
    # Service API event-stream continuation
    def test_workflow_events_continue_on_pause_keeps_stream_open(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_run = SimpleNamespace(
            id="run-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
            finished_at=None,
        )
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run)
        msg_generator = Mock()
        msg_generator.retrieve_events.return_value = ["raw-event"]
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: streamed\n\n"])
        monkeypatch.setattr(workflow_events_module, "MessageGenerator", lambda: msg_generator)
        monkeypatch.setattr(workflow_events_module, "WorkflowAppGenerator", lambda: workflow_generator)

        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context("/workflow/run-1/events?user=u1&continue_on_pause=true", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

        assert response.get_data(as_text=True) == "data: streamed\n\n"
        msg_generator.retrieve_events.assert_called_once_with(
            AppMode.WORKFLOW,
            "run-1",
            terminal_events=[],
        )
        workflow_generator.convert_to_event_stream.assert_called_once_with(["raw-event"])

    def test_workflow_events_snapshot_continue_on_pause_keeps_pause_open(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        workflow_run = SimpleNamespace(
            id="run-1",
            app_id="app-1",
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
            finished_at=None,
        )
        workflow_events_module = _mock_repo_for_run(monkeypatch, workflow_run=workflow_run)
        msg_generator = Mock()
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: snapshot\n\n"])
        snapshot_builder = Mock(return_value=["snapshot-events"])
        monkeypatch.setattr(workflow_events_module, "MessageGenerator", lambda: msg_generator)
        monkeypatch.setattr(workflow_events_module, "WorkflowAppGenerator", lambda: workflow_generator)
        monkeypatch.setattr(workflow_events_module, "build_workflow_event_stream", snapshot_builder)

        api = WorkflowEventsApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context(
            "/workflow/run-1/events?user=u1&include_state_snapshot=true&continue_on_pause=true",
            method="GET",
        ):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="run-1")

        assert response.get_data(as_text=True) == "data: snapshot\n\n"
        msg_generator.retrieve_events.assert_not_called()
        snapshot_builder.assert_called_once_with(
            app_mode=AppMode.WORKFLOW,
            workflow_run=workflow_run,
            tenant_id="tenant-1",
            app_id="app-1",
            session_maker=ANY,
            human_input_surface=HumanInputSurface.SERVICE_API,
            close_on_pause=False,
        )
        workflow_generator.convert_to_event_stream.assert_called_once_with(["snapshot-events"])

    def test_advanced_chat_blocking_injects_pause_state_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", False)
        monkeypatch.setattr(ags_module, "RateLimit", _DummyRateLimit)

        workflow = MagicMock()
        workflow.created_by = "owner-id"
        monkeypatch.setattr(AppGenerateService, "_get_workflow", lambda *args, **kwargs: workflow)
        monkeypatch.setattr(ags_module.session_factory, "get_session_maker", lambda: "session-maker")

        generator_instance = MagicMock()
        generator_instance.generate.return_value = {"result": "advanced-blocking"}
        generator_instance.convert_to_event_stream.side_effect = lambda payload: payload
        monkeypatch.setattr(ags_module, "AdvancedChatAppGenerator", lambda: generator_instance)

        app_model = MagicMock()
        app_model.mode = AppMode.ADVANCED_CHAT
        app_model.id = "app-id"
        app_model.tenant_id = "tenant-id"
        app_model.max_active_requests = 0
        app_model.is_agent = False

        user = MagicMock()
        user.id = "user-id"

        result = AppGenerateService.generate(
            app_model=app_model,
            user=user,
            args={"workflow_id": None, "query": "hi", "inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )

        assert result == {"result": "advanced-blocking"}
        call_kwargs = generator_instance.generate.call_args.kwargs
        assert call_kwargs["streaming"] is False
        assert call_kwargs["pause_state_config"] is not None
        assert call_kwargs["pause_state_config"].session_factory == "session-maker"
        assert call_kwargs["pause_state_config"].state_owner_user_id == "owner-id"

    # Blocking payload contract
    def test_advanced_chat_blocking_pause_payload_contract(self) -> None:
        from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter

        response = AdvancedChatAppGenerateResponseConverter.convert_blocking_full_response(
            _build_advanced_chat_paused_blocking_response()
        )

        assert response["event"] == "workflow_paused"
        assert response["workflow_run_id"] == "run-1"
        assert response["answer"] == "partial"
        assert response["data"]["reasons"][0]["type"] == PauseReasonType.HUMAN_INPUT_REQUIRED
        assert response["data"]["reasons"][0]["expiration_time"] == 100
        assert "human_input_forms" not in response["data"]

    def test_workflow_blocking_pause_payload_contract(self) -> None:
        from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter

        response = WorkflowAppGenerateResponseConverter.convert_blocking_full_response(
            _build_workflow_paused_blocking_response()
        )

        assert response["workflow_run_id"] == "r1"
        assert response["data"]["status"] == WorkflowExecutionStatus.PAUSED
        assert response["data"]["paused_nodes"] == ["node-1"]
        assert response["data"]["reasons"] == [
            {"TYPE": "human_input_required", "form_id": "form-1", "expiration_time": 100}
        ]
        assert "human_input_forms" not in response["data"]

    def test_advanced_chat_blocking_pipeline_pause_payload_contract(self) -> None:
        from core.app.app_config.entities import AppAdditionalFeatures
        from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
        from models.enums import MessageStatus
        from models.model import EndUser

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )
        pipeline = AdvancedChatAppGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            workflow=SimpleNamespace(id="workflow-id", tenant_id="tenant", features_dict={}),
            queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
            conversation=SimpleNamespace(id="conv-id", mode=AppMode.ADVANCED_CHAT),
            message=SimpleNamespace(
                id="message-id",
                query="hello",
                created_at=datetime.utcnow(),
                status=MessageStatus.NORMAL,
                answer="",
            ),
            user=EndUser(tenant_id="tenant", type="session", name="tester", session_id="session"),
            stream=False,
            dialogue_count=1,
            draft_var_saver_factory=lambda **kwargs: None,
        )
        pipeline._task_state.answer = "partial answer"
        pipeline._workflow_run_id = "run-id"

        def _gen():
            yield HumanInputRequiredResponse(
                task_id="task",
                workflow_run_id="run-id",
                data=HumanInputRequiredResponse.Data(
                    form_id="form-1",
                    node_id="node-1",
                    node_title="Approval",
                    form_content="Need approval",
                    inputs=[],
                    actions=[UserAction(id="approve", title="Approve")],
                    display_in_ui=True,
                    form_token="token-1",
                    resolved_default_values={},
                    expiration_time=123,
                ),
            )
            yield WorkflowPauseStreamResponse(
                task_id="task",
                workflow_run_id="run-id",
                data=WorkflowPauseStreamResponse.Data(
                    workflow_run_id="run-id",
                    paused_nodes=["node-1"],
                    outputs={},
                    reasons=[
                        {
                            "type": PauseReasonType.HUMAN_INPUT_REQUIRED,
                            "form_id": "form-1",
                            "node_id": "node-1",
                            "expiration_time": 123,
                        },
                    ],
                    status="paused",
                    created_at=1,
                    elapsed_time=0.1,
                    total_tokens=0,
                    total_steps=0,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert isinstance(response, AdvancedChatPausedBlockingResponse)
        assert response.data.answer == "partial answer"
        assert response.data.workflow_run_id == "run-id"
        assert response.data.reasons[0]["form_id"] == "form-1"
        assert response.data.reasons[0]["expiration_time"] == 123

    def test_workflow_blocking_pipeline_pause_payload_contract(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from core.app.apps.workflow import generate_task_pipeline as workflow_pipeline_module
        from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            trace_manager=None,
            workflow_execution_id="run-id",
            extras={},
            call_depth=0,
        )
        pipeline = WorkflowAppGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            workflow=SimpleNamespace(id="workflow-id", tenant_id="tenant", features_dict={}),
            queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
            user=SimpleNamespace(id="user", session_id="session"),
            stream=False,
            draft_var_saver_factory=lambda **kwargs: None,
        )
        monkeypatch.setattr(workflow_pipeline_module.time, "time", lambda: 1700000000)

        def _gen():
            yield HumanInputRequiredResponse(
                task_id="task",
                workflow_run_id="run",
                data=HumanInputRequiredResponse.Data(
                    form_id="form-1",
                    node_id="node-1",
                    node_title="Human Input",
                    form_content="content",
                    expiration_time=1,
                ),
            )
            yield WorkflowPauseStreamResponse(
                task_id="task",
                workflow_run_id="run",
                data=WorkflowPauseStreamResponse.Data(
                    workflow_run_id="run",
                    status=WorkflowExecutionStatus.PAUSED,
                    outputs={},
                    paused_nodes=["node-1"],
                    reasons=[{"TYPE": "human_input_required", "form_id": "form-1", "expiration_time": 1}],
                    created_at=1,
                    elapsed_time=0.1,
                    total_tokens=0,
                    total_steps=0,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert isinstance(response, WorkflowAppPausedBlockingResponse)
        assert response.data.status == WorkflowExecutionStatus.PAUSED
        assert response.data.paused_nodes == ["node-1"]
        assert response.data.reasons == [{"TYPE": "human_input_required", "form_id": "form-1", "expiration_time": 1}]

    def test_service_api_pause_event_serializes_hitl_reason(self, monkeypatch: pytest.MonkeyPatch) -> None:
        converter = _build_service_api_pause_converter()
        converter.workflow_start_to_stream_response(
            task_id="task",
            workflow_run_id="run-id",
            workflow_id="workflow-id",
            reason=WorkflowStartReason.INITIAL,
        )

        expiration_time = datetime(2024, 1, 1, tzinfo=UTC)

        class _FakeSession:
            def execute(self, _stmt):
                return [("form-1", expiration_time, '{"display_in_ui": true}')]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        monkeypatch.setattr(workflow_response_converter, "Session", lambda **_: _FakeSession())
        monkeypatch.setattr(workflow_response_converter, "db", SimpleNamespace(engine=object()))
        monkeypatch.setattr(
            workflow_response_converter,
            "load_form_tokens_by_form_id",
            lambda form_ids, session=None, surface=None: {"form-1": "token"},
        )

        reason = HumanInputRequired(
            form_id="form-1",
            form_content="Rendered",
            inputs=[
                FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="field", default=None),
            ],
            actions=[UserAction(id="approve", title="Approve")],
            display_in_ui=True,
            node_id="node-id",
            node_title="Human Step",
            form_token="token",
        )
        queue_event = QueueWorkflowPausedEvent(
            reasons=[reason],
            outputs={"answer": "value"},
            paused_nodes=["node-id"],
        )

        runtime_state = SimpleNamespace(total_tokens=0, node_run_steps=0)
        responses = converter.workflow_pause_to_stream_response(
            event=queue_event,
            task_id="task",
            graph_runtime_state=runtime_state,
        )

        assert isinstance(responses[-1], WorkflowPauseStreamResponse)
        pause_resp = responses[-1]
        assert pause_resp.workflow_run_id == "run-id"
        assert pause_resp.data.paused_nodes == ["node-id"]
        assert pause_resp.data.outputs == {}
        assert pause_resp.data.reasons[0]["TYPE"] == "human_input_required"
        assert pause_resp.data.reasons[0]["form_id"] == "form-1"
        assert pause_resp.data.reasons[0]["form_token"] == "token"
        assert pause_resp.data.reasons[0]["expiration_time"] == int(expiration_time.timestamp())

        assert isinstance(responses[0], HumanInputRequiredResponse)
        hi_resp = responses[0]
        assert hi_resp.data.form_id == "form-1"
        assert hi_resp.data.node_id == "node-id"
        assert hi_resp.data.node_title == "Human Step"
        assert hi_resp.data.inputs[0].output_variable_name == "field"
        assert hi_resp.data.actions[0].id == "approve"
        assert hi_resp.data.display_in_ui is True
        assert hi_resp.data.form_token == "token"
        assert hi_resp.data.expiration_time == int(expiration_time.timestamp())

    # Snapshot payload contract
    def test_snapshot_events_include_pause_payload_contract(self, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_run = _build_workflow_run(WorkflowExecutionStatus.PAUSED)
        snapshot = _build_snapshot(WorkflowNodeExecutionStatus.PAUSED)
        resumption_context = _build_resumption_context("task-ctx")
        monkeypatch.setattr(
            "services.workflow_event_snapshot_service.load_form_tokens_by_form_id",
            lambda form_ids, session=None, surface=None: {"form-1": "wtok"},
        )

        class _SessionContext:
            def __init__(self, session):
                self._session = session

            def __enter__(self):
                return self._session

            def __exit__(self, exc_type, exc, tb):
                return False

        def session_maker() -> _SessionContext:
            return _SessionContext(
                SimpleNamespace(
                    execute=lambda _stmt: [("form-1", datetime(2024, 1, 1, tzinfo=UTC), '{"display_in_ui": true}')],
                )
            )

        pause_entity = _FakePauseEntity(
            pause_id="pause-1",
            workflow_run_id="run-1",
            paused_at_value=datetime(2024, 1, 1, tzinfo=UTC),
            pause_reasons=[
                HumanInputRequired(
                    form_id="form-1",
                    form_content="content",
                    node_id="node-1",
                    node_title="Human Input",
                    form_token="wtok",
                )
            ],
        )

        events = _build_snapshot_events(
            workflow_run=workflow_run,
            node_snapshots=[snapshot],
            task_id="task-ctx",
            message_context=None,
            pause_entity=pause_entity,
            resumption_context=resumption_context,
            session_maker=session_maker,
        )

        assert [event["event"] for event in events] == [
            "workflow_started",
            "node_started",
            "node_finished",
            "human_input_required",
            "workflow_paused",
        ]
        assert events[2]["data"]["status"] == WorkflowNodeExecutionStatus.PAUSED.value
        assert events[3]["data"]["form_token"] == "wtok"
        assert events[3]["data"]["expiration_time"] == int(datetime(2024, 1, 1, tzinfo=UTC).timestamp())
        pause_data = events[-1]["data"]
        assert pause_data["paused_nodes"] == ["node-1"]
        assert pause_data["outputs"] == {"result": "value"}
        assert pause_data["reasons"][0]["TYPE"] == "human_input_required"
        assert pause_data["reasons"][0]["form_token"] == "wtok"
        assert pause_data["reasons"][0]["expiration_time"] == int(datetime(2024, 1, 1, tzinfo=UTC).timestamp())
        assert pause_data["status"] == WorkflowExecutionStatus.PAUSED.value
        assert pause_data["created_at"] == int(workflow_run.created_at.timestamp())
        assert pause_data["elapsed_time"] == workflow_run.elapsed_time
        assert pause_data["total_tokens"] == workflow_run.total_tokens
        assert pause_data["total_steps"] == workflow_run.total_steps
