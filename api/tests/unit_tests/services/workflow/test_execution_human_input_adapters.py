from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

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
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.nodes.human_input_v2.events import NodeRunHumanInputV2FormFilledEvent
from core.workflow.nodes.human_input_v2.presentation import build_human_input_v2_pause_reason
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from core.workflow.system_variables import build_system_variables
from enums.human_input import HumanInputFormKind, HumanInputFormStatus, ValueSourceType
from graphon.engine_events import GraphRunPausedEvent, NodeRunStartedEvent, NodeRunSucceededEvent
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.enums import BuiltinNodeTypes
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.human_input_contracts import PauseFormSnapshot
from models.human_input_entities import SelectInputConfig, StringListSource
from models.model import AppMode
from repositories.human_input_v2.form_repository import Form
from services.workflow.execution.adapters import events as event_adapter
from services.workflow.execution.adapters.events import WorkflowEventPublisher, enqueue_human_input_notifications
from services.workflow.execution.adapters.human_input_events import (
    HumanInputFormEventFilter,
    enrich_graph_pause_reasons,
)
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter


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


def _response_converter(contexts: MagicMock) -> WorkflowResponseConverter:
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
        tool_providers=MagicMock(),
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
    contexts = MagicMock()
    contexts.pause_forms.return_value = [
        PauseFormSnapshot(
            id="form-1",
            expiration_time=datetime(2026, 1, 2),
            form_definition="{}",
            recipients=(),
        )
    ]
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
    assert responses[0].data.inputs[0].option_source.value == ["Frozen"]
    assert responses[1].data.form_version == "1"
    assert responses[1].data.inputs[0].option_source.value == ["One", "Two"]
    assert [reason["TYPE"] for reason in responses[2].data.reasons] == [
        "human_input_required",
        "scheduled_pause",
        "human_input_required",
    ]
    assert [responses[2].data.reasons[index]["form_version"] for index in (0, 2)] == ["2", "1"]
    contexts.pause_forms.assert_called_once_with(
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_run_id="run-id",
        form_ids=["form-1"],
    )


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
    queue_manager = MagicMock()
    notify_pause = MagicMock()
    publisher = WorkflowEventPublisher(queue_manager, notify_pause=notify_pause)

    publisher.publish(
        MagicMock(),
        GraphRunPausedEvent(),
        pause_reasons=[v2_reason, v1_reason],
        human_input_v2_forms={prepared.form.id: prepared},
    )

    notify_pause.assert_called_once_with([v1_reason])
    queued = queue_manager.publish.call_args.args[0]
    assert isinstance(queued, QueueWorkflowPausedEvent)
    assert queued.human_input_v2_forms == {prepared.form.id: prepared}
    assert queue_manager.publish.call_args.args[1] is PublishFrom.APPLICATION_MANAGER


def test_notification_adapter_dispatches_only_v1_with_generic_delivery_task(monkeypatch: pytest.MonkeyPatch) -> None:
    delivery_task = MagicMock()
    monkeypatch.setattr(event_adapter, "dispatch_human_input_form_delivery_task", delivery_task)
    v1_reason = HumanInputRequired(
        form_id="form-1",
        node_id="node-1",
        node_title="V1",
        form_content="Choose",
    )
    v2_reason = v1_reason.model_copy(update={"form_version": "2", "form_id": "form-2"})

    enqueue_human_input_notifications([v2_reason, v1_reason])

    delivery_task.apply_async.assert_called_once_with(
        kwargs={"form_id": "form-1", "node_title": "V1"},
        queue="mail",
    )


def test_event_publisher_uses_v2_form_id_for_completion() -> None:
    queue_manager = MagicMock()
    publisher = WorkflowEventPublisher(queue_manager, notify_pause=MagicMock())
    entry = SimpleNamespace(graph_engine=SimpleNamespace(runtime_state=SimpleNamespace(variable_pool=VariablePool())))
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

    publisher.publish(entry, event)

    queued = queue_manager.publish.call_args.args[0]
    assert isinstance(queued, QueueHumanInputFormFilledEvent)
    assert queued.form_id == "form-2"


def test_event_filter_does_not_synthesize_v1_completion_for_v2_node() -> None:
    v2_node = SimpleNamespace(
        id="node-2",
        node_type=BuiltinNodeTypes.HUMAN_INPUT,
        version=lambda: "2",
    )
    root_node = SimpleNamespace(id="start", node_type=BuiltinNodeTypes.START, version=lambda: "1")
    context = SimpleNamespace(
        graph=SimpleNamespace(root_node=root_node, nodes={v2_node.id: v2_node}),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
    )
    event_filter = HumanInputFormEventFilter(form_repository=MagicMock())
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
    form_repository = MagicMock()

    with pytest.raises(ValueError, match="Expected a Human Input v1 session"):
        enrich_graph_pause_reasons(
            reasons=[HitlRequired(session_id="hitlv2:form-2", node_id="node-2", node_title="V2")],
            form_repository=form_repository,
            variable_pool=None,
        )

    form_repository.get_by_form_id.assert_not_called()
