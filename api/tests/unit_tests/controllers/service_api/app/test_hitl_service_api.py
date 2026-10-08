"""Dedicated tests for HITL behavior exposed through the Service API."""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from typing import override
from unittest.mock import ANY, Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as ags_module
from controllers.service_api.app.workflow_events import WorkflowEventsApi
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.app.entities.task_entities import (
    AdvancedChatPausedBlockingResponse,
    HumanInputRequiredResponse,
    WorkflowAppPausedBlockingResponse,
    WorkflowPauseStreamResponse,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.human_input_policy import FormDisposition, HumanInputSurface
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType, HumanInputRequired
from core.workflow.system_variables import build_system_variables
from enums import DeploymentEdition
from enums.human_input import FormInputType, HumanInputFormKind, HumanInputFormStatus, RecipientType
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import to_utc_timestamp
from models.account import Account
from models.enums import CreatorUserRole, EndUserType, MessageStatus
from models.human_input import HumanInputForm, HumanInputFormRecipient
from models.human_input_entities import ParagraphInputConfig, UserActionConfig
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowRun, WorkflowType
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity
from services.app.generation.ports import ConversationSnapshot, MessageSnapshot, WorkflowSnapshot
from services.app.generation.runtime import AppGenerationRuntime
from services.app_generate_service import AppGenerateService
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter
from services.workflow.variable_contracts import WorkflowExecutionVariables
from services.workflow_event_snapshot_service import _build_snapshot_events
from tests.unit_tests.config_override import apply_config_overrides


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


def _mock_repo_for_run(monkeypatch: pytest.MonkeyPatch, workflow_run, sqlite_engine: Engine):
    workflow_events_module = sys.modules["controllers.service_api.app.workflow_events"]
    repo = SimpleNamespace(get_workflow_run_by_id_and_tenant_id=lambda **_kwargs: workflow_run)
    monkeypatch.setattr(
        workflow_events_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: repo,
    )
    monkeypatch.setattr(workflow_events_module, "db", SimpleNamespace(engine=sqlite_engine))
    return workflow_events_module


def _app(*, app_id: str = "app-1", tenant_id: str = "tenant-1", mode: AppMode = AppMode.WORKFLOW) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Service API app",
        description="",
        mode=mode,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _end_user(*, user_id: str = "end-user-1", app_id: str = "app-1", tenant_id: str = "tenant-1") -> EndUser:
    return EndUser(
        id=user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=EndUserType.SERVICE_API,
        external_user_id="external-user-1",
        name="Service API user",
        session_id="session-1",
    )


def _workflow(*, workflow_id: str = "workflow-id", app_id: str = "app-id", tenant_id: str = "tenant-id") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW,
        version="1",
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by="owner-id",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _persist_human_input_form(
    sqlite_session: Session,
    *,
    expiration_time: datetime,
) -> HumanInputForm:
    form = HumanInputForm(
        id="form-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        conversation_id=None,
        form_kind=HumanInputFormKind.RUNTIME,
        node_id="node-1",
        form_definition=json.dumps({"display_in_ui": True}),
        rendered_content="Rendered",
        status=HumanInputFormStatus.WAITING,
        expiration_time=expiration_time,
    )
    sqlite_session.add(form)
    sqlite_session.commit()
    return form


def _build_service_api_pause_converter(*, workflow_contexts, tool_providers) -> WorkflowResponseConverter:
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
    user = Account(name="Tester", email="tester@example.com")
    user.id = "account-id"
    return WorkflowResponseConverter(
        contexts=workflow_contexts,
        application_generate_entity=application_generate_entity,
        user=user,
        system_variables=system_variables,
        tool_providers=tool_providers,
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
                "TYPE": DifyHITLEventType.HUMAN_INPUT_REQUIRED.value,
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
    @override
    def id(self) -> str:
        return self.pause_id

    @property
    @override
    def workflow_execution_id(self) -> str:
        return self.workflow_run_id

    @override
    def get_state(self) -> bytes:
        raise AssertionError("state is not required for snapshot tests")

    @property
    @override
    def resumed_at(self) -> datetime | None:
        return None

    @property
    @override
    def paused_at(self) -> datetime:
        return self.paused_at_value

    @override
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
    runtime_state.set_output("result", "value")
    wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
    return WorkflowResumptionContext(
        generate_entity=wrapper,
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


class TestHitlServiceApi:
    # Service API event-stream continuation
    def test_workflow_events_continue_on_pause_keeps_stream_open(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
    ) -> None:
        workflow_run = _build_workflow_run(WorkflowExecutionStatus.RUNNING)
        workflow_run.created_by = "end-user-1"
        workflow_events_module = _mock_repo_for_run(
            monkeypatch,
            workflow_run=workflow_run,
            sqlite_engine=sqlite_engine,
        )
        msg_generator = Mock()
        msg_generator.retrieve_events.return_value = ["raw-event"]
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: streamed\n\n"])
        monkeypatch.setattr(workflow_events_module, "WorkflowEventStream", msg_generator)
        monkeypatch.setattr(
            workflow_events_module, "convert_to_event_stream", workflow_generator.convert_to_event_stream
        )

        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context("/workflow/run-1/events?user=u1&continue_on_pause=true", method="GET"):
            response = handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

        assert response.get_data(as_text=True) == "data: streamed\n\n"
        msg_generator.retrieve_events.assert_called_once_with(
            AppMode.WORKFLOW,
            "run-1",
            terminal_events=[],
        )
        workflow_generator.convert_to_event_stream.assert_called_once_with(["raw-event"])

    def test_workflow_events_snapshot_continue_on_pause_keeps_pause_open(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
    ) -> None:
        workflow_run = _build_workflow_run(WorkflowExecutionStatus.RUNNING)
        workflow_run.created_by = "end-user-1"
        workflow_events_module = _mock_repo_for_run(
            monkeypatch,
            workflow_run=workflow_run,
            sqlite_engine=sqlite_engine,
        )
        msg_generator = Mock()
        workflow_generator = Mock()
        workflow_generator.convert_to_event_stream.return_value = iter(["data: snapshot\n\n"])
        snapshot_builder = Mock(return_value=["snapshot-events"])
        monkeypatch.setattr(workflow_events_module, "WorkflowEventStream", msg_generator)
        monkeypatch.setattr(
            workflow_events_module, "convert_to_event_stream", workflow_generator.convert_to_event_stream
        )
        monkeypatch.setattr(workflow_events_module, "build_workflow_event_stream", snapshot_builder)

        api = WorkflowEventsApi()
        handler = unwrap(api.get)
        app_model = _app()
        end_user = _end_user()

        with app.test_request_context(
            "/workflow/run-1/events?user=u1&include_state_snapshot=true&continue_on_pause=true",
            method="GET",
        ):
            response = handler(api, app_model=app_model, end_user=end_user, workflow_run_id="run-1")

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
        snapshot_session_maker = snapshot_builder.call_args.kwargs["session_maker"]
        assert isinstance(snapshot_session_maker, sessionmaker)
        assert snapshot_session_maker.kw["bind"] is sqlite_engine
        workflow_generator.convert_to_event_stream.assert_called_once_with(["snapshot-events"])

    def test_advanced_chat_blocking_injects_pause_state_config(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        monkeypatch.setattr(ags_module, "RateLimit", _DummyRateLimit)

        workflow = _workflow()
        monkeypatch.setattr(AppGenerateService, "_get_workflow", lambda *args, **kwargs: workflow)
        sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        monkeypatch.setattr(ags_module.session_factory, "get_session_maker", lambda: sqlite_session_maker)

        generator_instance = Mock()
        generator_instance.generate.return_value = {"result": "advanced-blocking"}
        generator_factory = Mock(return_value=generator_instance)
        monkeypatch.setattr(ags_module, "AdvancedChatAppGenerator", generator_factory)
        monkeypatch.setattr(ags_module, "convert_to_event_stream", lambda payload: payload)

        app_model = _app(app_id="app-id", tenant_id="tenant-id", mode=AppMode.ADVANCED_CHAT)
        user = _end_user(user_id="user-id", app_id="app-id", tenant_id="tenant-id")

        with sqlite_session_maker() as session:
            result = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=user,
                args={"workflow_id": None, "query": "hi", "inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )

        assert result == {"result": "advanced-blocking"}
        generator_factory.assert_called_once_with(
            runtime=workflow_runtime,
            draft_variable_loader=workflow_variables.workflow_loader,
            draft_variable_saver=workflow_variables.saver_factory,
        )
        call_kwargs = generator_instance.generate.call_args.kwargs
        assert call_kwargs["streaming"] is False
        assert call_kwargs["pause_state_config"] is not None
        assert call_kwargs["pause_state_config"].session_factory is sqlite_session_maker
        assert call_kwargs["pause_state_config"].state_owner_user_id == "owner-id"

    # Blocking payload contract
    def test_advanced_chat_blocking_pause_payload_contract(self) -> None:
        from services.workflow.execution.adapters.chatflow.generate_response_converter import (
            AdvancedChatAppGenerateResponseConverter,
        )

        response = AdvancedChatAppGenerateResponseConverter.convert_blocking_full_response(
            _build_advanced_chat_paused_blocking_response()
        )

        assert response["event"] == "workflow_paused"
        assert response["workflow_run_id"] == "run-1"
        assert response["answer"] == "partial"
        assert response["data"]["reasons"][0]["TYPE"] == DifyHITLEventType.HUMAN_INPUT_REQUIRED
        assert response["data"]["reasons"][0]["expiration_time"] == 100
        assert "human_input_forms" not in response["data"]

    def test_workflow_blocking_pause_payload_contract(self) -> None:
        from services.workflow.execution.adapters.workflow.generate_response_converter import (
            WorkflowAppGenerateResponseConverter,
        )

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

    def test_advanced_chat_blocking_pipeline_pause_payload_contract(
        self, app_records, *, workflow_contexts, tool_providers
    ) -> None:
        from core.app.app_config.entities import AppAdditionalFeatures
        from services.workflow.execution.adapters.chatflow.generate_task_pipeline import (
            AdvancedChatAppGenerateTaskPipeline,
        )

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
            contexts=workflow_contexts,
            chat_records=app_records,
            application_generate_entity=application_generate_entity,
            workflow=WorkflowSnapshot(id="workflow-id", tenant_id="tenant", features_dict={}),
            queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
            conversation=ConversationSnapshot(id="conv-id", mode=AppMode.ADVANCED_CHAT),
            message=MessageSnapshot(
                id="message-id",
                query="hello",
                created_at=datetime.utcnow(),
                status=MessageStatus.NORMAL,
                answer="",
            ),
            user=_end_user(user_id="user", app_id="app", tenant_id="tenant"),
            stream=False,
            dialogue_count=1,
            draft_var_saver_factory=lambda **kwargs: None,
            tool_providers=tool_providers,
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
                    actions=[UserActionConfig(id="approve", title="Approve")],
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
                            "TYPE": DifyHITLEventType.HUMAN_INPUT_REQUIRED.value,
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

    def test_workflow_blocking_pipeline_pause_payload_contract(
        self, monkeypatch: pytest.MonkeyPatch, *, workflow_runtime, tool_providers
    ) -> None:
        from services.workflow.execution.adapters.workflow import generate_task_pipeline as workflow_pipeline_module
        from services.workflow.execution.adapters.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline

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
            contexts=workflow_runtime.contexts,
            logs=workflow_runtime.logs,
            application_generate_entity=application_generate_entity,
            workflow=_workflow(workflow_id="workflow-id", app_id="app", tenant_id="tenant"),
            queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
            user=_end_user(user_id="user", app_id="app", tenant_id="tenant"),
            stream=False,
            draft_var_saver_factory=lambda **kwargs: None,
            tool_providers=tool_providers,
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

    def test_service_api_pause_event_serializes_hitl_reason(
        self, sqlite_session: Session, *, workflow_contexts, tool_providers
    ) -> None:
        converter = _build_service_api_pause_converter(
            workflow_contexts=workflow_contexts, tool_providers=tool_providers
        )
        converter.workflow_start_to_stream_response(
            task_id="task",
            workflow_run_id="run-id",
            workflow_id="workflow-id",
            reason=WorkflowStartReason.INITIAL,
        )

        expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
        form = _persist_human_input_form(sqlite_session, expiration_time=expiration_time)
        form.tenant_id = "tenant-id"
        form.app_id = "app-id"
        form.workflow_run_id = "run-id"
        sqlite_session.add(
            HumanInputFormRecipient(
                form_id=form.id,
                delivery_id="delivery-1",
                recipient_type=RecipientType.STANDALONE_WEB_APP,
                recipient_payload="{}",
                access_token="token",
            )
        )
        sqlite_session.commit()

        reason = HumanInputRequired(
            form_id="form-1",
            form_content="Rendered",
            inputs=[
                ParagraphInputConfig(
                    type=FormInputType.PARAGRAPH,
                    output_variable_name="field",
                    default=None,
                ),
            ],
            actions=[UserActionConfig(id="approve", title="Approve")],
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

        runtime_state = SimpleNamespace(total_tokens=0, node_run_steps=0, variable_pool=VariablePool())
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
        assert pause_resp.data.reasons[0]["expiration_time"] == to_utc_timestamp(expiration_time)

        assert isinstance(responses[0], HumanInputRequiredResponse)
        hi_resp = responses[0]
        assert hi_resp.data.form_id == "form-1"
        assert hi_resp.data.node_id == "node-id"
        assert hi_resp.data.node_title == "Human Step"
        assert hi_resp.data.inputs[0].output_variable_name == "field"
        assert hi_resp.data.actions[0].id == "approve"
        assert hi_resp.data.display_in_ui is True
        assert hi_resp.data.form_token == "token"
        assert hi_resp.data.expiration_time == to_utc_timestamp(expiration_time)

    # Snapshot payload contract
    def test_snapshot_events_include_pause_payload_contract(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        sqlite_session: Session,
    ) -> None:
        workflow_run = _build_workflow_run(WorkflowExecutionStatus.PAUSED)
        snapshot = _build_snapshot(WorkflowNodeExecutionStatus.PAUSED)
        resumption_context = _build_resumption_context("task-ctx")
        expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
        _persist_human_input_form(sqlite_session, expiration_time=expiration_time)
        monkeypatch.setattr(
            "services.workflow_event_snapshot_service.load_form_dispositions_by_form_id",
            lambda form_ids, session=None, surface=None: {
                "form-1": FormDisposition(form_token="wtok", approval_channels=[])
            },
        )

        sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

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
            session_maker=sqlite_session_maker,
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
        assert events[3]["data"]["expiration_time"] == to_utc_timestamp(expiration_time)
        pause_data = events[-1]["data"]
        assert pause_data["paused_nodes"] == ["node-1"]
        assert pause_data["outputs"] == {"result": "value"}
        assert pause_data["reasons"][0]["TYPE"] == "human_input_required"
        assert pause_data["reasons"][0]["form_token"] == "wtok"
        assert pause_data["reasons"][0]["expiration_time"] == to_utc_timestamp(expiration_time)
        assert pause_data["status"] == WorkflowExecutionStatus.PAUSED.value
        assert pause_data["created_at"] == int(workflow_run.created_at.timestamp())
        assert pause_data["elapsed_time"] == workflow_run.elapsed_time
        assert pause_data["total_tokens"] == workflow_run.total_tokens
        assert pause_data["total_steps"] == workflow_run.total_steps
