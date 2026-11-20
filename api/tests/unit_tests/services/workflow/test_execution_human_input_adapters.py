from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

import pytest
from pydantic import SecretStr

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueHumanInputFormFilledEvent,
    QueueWorkflowPausedEvent,
)
from core.app.entities.task_entities import HumanInputRequiredResponse, WorkflowPauseStreamResponse
from core.human_input_v2.resolved_form import ResolvedForm, SelectInput
from core.human_input_v2.shared.values import TenantId
from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.nodes.human_input_v2.events import NodeRunHumanInputV2FormFilledEvent
from core.workflow.nodes.human_input_v2.presentation import build_human_input_v2_pause_reason
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from core.workflow.system_variables import build_system_variables
from enums.human_input import HumanInputFormKind, HumanInputFormStatus, ValueSourceType
from graphon.engine.filter import EngineEventFilterContext
from graphon.engine_events import GraphRunPausedEvent, NodeRunStartedEvent, NodeRunSucceededEvent
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from models.account import Account
from models.human_input_contracts import HumanInputFormRecord, PauseFormSnapshot
from models.human_input_entities import SelectInputConfig, StringListSource
from models.model import AppMode
from repositories.human_input_v2.form_repository import Form
from services.workflow.contracts import WorkflowSnapshot
from services.workflow.execution.adapters import events as event_adapter
from services.workflow.execution.adapters.events import WorkflowEventPublisher, enqueue_human_input_notifications
from services.workflow.execution.adapters.human_input_events import (
    HumanInputFormEventFilter,
    enrich_graph_pause_reasons,
)
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter
from services.workflow.execution.ports import PipelineDatasetSnapshot


@dataclass
class _StubExecutionContexts:
    snapshots: list[PauseFormSnapshot] = field(default_factory=list)
    calls: list[dict[str, object]] = field(default_factory=list)

    def pause_forms(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        form_ids: Sequence[str],
    ) -> list[PauseFormSnapshot]:
        self.calls.append(
            {
                "tenant_id": tenant_id,
                "app_id": app_id,
                "workflow_run_id": workflow_run_id,
                "form_ids": list(form_ids),
            }
        )
        return list(self.snapshots)

    def pipeline_workflow(self, *, tenant_id: str, pipeline_id: str, draft: bool) -> WorkflowSnapshot:
        _ = (tenant_id, pipeline_id, draft)
        raise NotImplementedError

    def pipeline_dataset(self, *, tenant_id: str, pipeline_id: str) -> PipelineDatasetSnapshot:
        _ = (tenant_id, pipeline_id)
        raise NotImplementedError

    def restore_graph(self, workflow: WorkflowSnapshot, workflow_run_id: str | None) -> WorkflowSnapshot:
        _ = workflow_run_id
        return workflow

    def workflow(self, *, tenant_id: str, app_id: str, workflow_id: str) -> WorkflowSnapshot:
        _ = (tenant_id, app_id, workflow_id)
        raise NotImplementedError


class _StubToolProviders:
    def icon(self, *, tenant_id: str, provider_type: ToolProviderType, provider_id: str) -> str | None:
        _ = (tenant_id, provider_type, provider_id)
        return None


@dataclass
class _StubQueueManager:
    published: list[tuple[object, PublishFrom]] = field(default_factory=list)

    def publish(self, event: object, publish_from: PublishFrom) -> None:
        self.published.append((event, publish_from))


@dataclass
class _StubDeliveryTask:
    calls: list[dict[str, object]] = field(default_factory=list)

    def apply_async(self, *, kwargs: dict[str, object], queue: str) -> None:
        self.calls.append({"kwargs": kwargs, "queue": queue})


@dataclass
class _StubGraphEngine:
    runtime_state: RuntimeState


@dataclass
class _StubWorkflowRunEntry:
    graph_engine: _StubGraphEngine


@dataclass
class _StubGraphNode:
    id: str
    node_type: NodeType
    _version: str

    def version(self) -> str:
        return self._version


@dataclass
class _StubGraph:
    root_node: _StubGraphNode
    nodes: dict[str, _StubGraphNode]


@dataclass
class _StubFormReader:
    calls: list[str] = field(default_factory=list)

    def get_by_form_id(self, form_id: str) -> HumanInputFormRecord | None:
        self.calls.append(form_id)
        return None


def _prepared_v2_form(*, form_id: str = "form-2") -> PreparedForm:
    now = datetime(2026, 1, 1)
    form = Form(
        id=form_id,
        tenant_id=TenantId("tenant-id"),
        app_id="app-id",
        workflow_run_id="run-id",
        node_execution_id="execution-2",
        form_kind=HumanInputFormKind.RUNTIME,
        status=HumanInputFormStatus.WAITING,
        created_at=now,
        updated_at=now,
        expiration_time=now,
        global_timeout_deadline=now,
        submission=None,
        resolved_form=ResolvedForm(
            title="Frozen V2",
            legacy_form_content="Choose",
            actions=(),
            parts=(SelectInput(output_variable_name="choice", options=("Frozen",), default_value=None),),
        ),
    )
    return PreparedForm(form=form, form_token=SecretStr("v2-token"))


def _response_converter(contexts: _StubExecutionContexts) -> WorkflowResponseConverter:
    entity = WorkflowAppGenerateEntity(
        user_from=UserFrom.END_USER,
        task_id="task",
        workflow_execution_id="run-id",
        user_id="user",
        stream=True,
        inputs={},
        files=[],
        invoke_from=InvokeFrom.SERVICE_API,
        app_config=WorkflowUIBasedAppConfig(
            app_id="app-id",
            tenant_id="tenant-id",
            workflow_id="workflow-id",
            app_mode=AppMode.WORKFLOW,
        ),
    )
    account = Account(name="Tester", email="tester@example.com")
    account.id = "account-id"
    return WorkflowResponseConverter(
        application_generate_entity=entity,
        user=account,
        system_variables=build_system_variables(
            user_id="user",
            app_id="app-id",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
        ),
        contexts=contexts,
        tool_providers=_StubToolProviders(),
    )


def test_pause_converter_preserves_mixed_version_order_and_uses_v2_snapshot() -> None:
    prepared = _prepared_v2_form()
    v1_reason = HumanInputRequired(
        form_id="form-1",
        node_id="node-1",
        node_title="V1",
        form_content="Choose",
        inputs=[
            SelectInputConfig(
                output_variable_name="choice",
                option_source=StringListSource(
                    type=ValueSourceType.VARIABLE,
                    selector=["upstream", "options"],
                ),
            )
        ],
    )
    contexts = _StubExecutionContexts(
        snapshots=[
            PauseFormSnapshot(
                id="form-1",
                expiration_time=datetime(2026, 1, 2),
                form_definition="{}",
                recipients=(),
            )
        ]
    )
    converter = _response_converter(contexts)
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    state.variable_pool.add(["upstream", "options"], ["One", "Two"])
    event = QueueWorkflowPausedEvent(
        reasons=[
            build_human_input_v2_pause_reason(
                prepared.form.resolved_form,
                form_id=prepared.form.id,
                node_id="node-2",
            ),
            SchedulingPause(message="scheduled"),
            v1_reason,
        ],
        paused_nodes=["node-2", "node-1"],
        human_input_v2_forms={prepared.form.id: prepared},
    )

    responses = converter.workflow_pause_to_stream_response(
        event=event,
        task_id="task",
        graph_runtime_state=state,
    )

    assert isinstance(responses[0], HumanInputRequiredResponse)
    assert isinstance(responses[1], HumanInputRequiredResponse)
    assert isinstance(responses[2], WorkflowPauseStreamResponse)
    assert responses[0].data.form_version == "2"
    assert responses[0].data.form_token == "v2-token"
    v2_input = responses[0].data.inputs[0]
    assert isinstance(v2_input, SelectInputConfig)
    v2_options = v2_input.option_source
    assert isinstance(v2_options, StringListSource)
    assert v2_options.value == ["Frozen"]
    assert responses[1].data.form_version == "1"
    v1_input = responses[1].data.inputs[0]
    assert isinstance(v1_input, SelectInputConfig)
    v1_options = v1_input.option_source
    assert isinstance(v1_options, StringListSource)
    assert v1_options.value == ["One", "Two"]
    assert [reason["TYPE"] for reason in responses[2].data.reasons] == [
        "human_input_required",
        "scheduled_pause",
        "human_input_required",
    ]
    assert [responses[2].data.reasons[index]["form_version"] for index in (0, 2)] == ["2", "1"]
    assert contexts.calls == [
        {
            "tenant_id": "tenant-id",
            "app_id": "app-id",
            "workflow_run_id": "run-id",
            "form_ids": ["form-1"],
        }
    ]


def test_event_publisher_carries_v2_snapshots_and_notifies_only_v1() -> None:
    prepared = _prepared_v2_form()
    v2_reason = build_human_input_v2_pause_reason(
        prepared.form.resolved_form,
        form_id=prepared.form.id,
        node_id="node-2",
    )
    v1_reason = HumanInputRequired(
        form_id="form-1",
        node_id="node-1",
        node_title="V1",
        form_content="Choose",
    )
    queue_manager = _StubQueueManager()
    notified: list[Sequence[object]] = []
    publisher = WorkflowEventPublisher(queue_manager, notify_pause=notified.append)  # type: ignore[arg-type]
    entry = _StubWorkflowRunEntry(
        graph_engine=_StubGraphEngine(
            runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
        )
    )

    publisher.publish(
        entry,  # type: ignore[arg-type]
        GraphRunPausedEvent(),
        pause_reasons=[v2_reason, v1_reason],
        human_input_v2_forms={prepared.form.id: prepared},
    )

    assert notified == [[v1_reason]]
    queued, publish_from = queue_manager.published[0]
    assert isinstance(queued, QueueWorkflowPausedEvent)
    assert queued.human_input_v2_forms == {prepared.form.id: prepared}
    assert publish_from is PublishFrom.APPLICATION_MANAGER


def test_notification_adapter_dispatches_only_v1_with_generic_delivery_task(monkeypatch: pytest.MonkeyPatch) -> None:
    delivery_task = _StubDeliveryTask()
    monkeypatch.setattr(event_adapter, "dispatch_human_input_form_delivery_task", delivery_task)
    v1_reason = HumanInputRequired(
        form_id="form-1",
        node_id="node-1",
        node_title="V1",
        form_content="Choose",
    )
    v2_reason = v1_reason.model_copy(update={"form_version": "2", "form_id": "form-2"})

    enqueue_human_input_notifications([v2_reason, v1_reason])

    assert delivery_task.calls == [
        {
            "kwargs": {"form_id": "form-1", "node_title": "V1"},
            "queue": "mail",
        }
    ]


def test_event_publisher_uses_v2_form_id_for_completion() -> None:
    queue_manager = _StubQueueManager()
    publisher = WorkflowEventPublisher(queue_manager, notify_pause=lambda _reasons: None)  # type: ignore[arg-type]
    entry = _StubWorkflowRunEntry(
        graph_engine=_StubGraphEngine(
            runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
        )
    )
    event = NodeRunHumanInputV2FormFilledEvent(
        id="execution-2",
        form_id="form-2",
        node_id="node-2",
        node_type=BuiltinNodeTypes.HUMAN_INPUT,
        node_title="V2",
        rendered_content="Frozen",
        action_id="approve",
        action_text="Approve",
    )

    publisher.publish(entry, event)  # type: ignore[arg-type]

    queued, _publish_from = queue_manager.published[0]
    assert isinstance(queued, QueueHumanInputFormFilledEvent)
    assert queued.form_id == "form-2"


def test_event_filter_does_not_synthesize_v1_completion_for_v2_node() -> None:
    v2_node = _StubGraphNode(id="node-2", node_type=BuiltinNodeTypes.HUMAN_INPUT, _version="2")
    root_node = _StubGraphNode(id="start", node_type=BuiltinNodeTypes.START, _version="1")
    graph = _StubGraph(root_node=root_node, nodes={v2_node.id: v2_node})
    context = EngineEventFilterContext(
        graph=graph,  # type: ignore[arg-type]
        runtime_state=ReadOnlyRuntimeStateWrapper(
            RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
        ),
    )
    event_filter = HumanInputFormEventFilter(form_repository=_StubFormReader())
    event_filter.initialize(context)
    started = NodeRunStartedEvent(
        id="execution-2",
        node_id="node-2",
        node_type=BuiltinNodeTypes.HUMAN_INPUT,
        node_title="V2",
        start_at=datetime(2026, 1, 1),
    )
    succeeded = NodeRunSucceededEvent(
        id="execution-2",
        node_id="node-2",
        node_type=BuiltinNodeTypes.HUMAN_INPUT,
        start_at=datetime(2026, 1, 1),
    )

    assert list(event_filter.on_event(started)) == [started]
    assert list(event_filter.on_event(succeeded)) == [succeeded]


def test_pause_reason_adapter_rejects_v2_session_before_legacy_lookup() -> None:
    form_repository = _StubFormReader()

    with pytest.raises(ValueError, match="Expected a Human Input v1 session"):
        enrich_graph_pause_reasons(
            reasons=[HitlRequired(session_id="hitlv2:form-2", node_id="node-2", node_title="V2")],
            form_repository=form_repository,
            variable_pool=None,
        )

    assert form_repository.calls == []
