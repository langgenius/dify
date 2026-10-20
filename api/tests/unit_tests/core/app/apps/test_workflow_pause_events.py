from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import AppQueueEvent, QueueWorkflowPausedEvent
from core.app.entities.task_entities import HumanInputRequiredResponse, WorkflowPauseStreamResponse
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import build_system_variables
from enums.human_input import RecipientType, ValueSourceType
from graphon.engine_events import GraphRunPausedEvent
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.human_input import HumanInputForm, HumanInputFormRecipient
from models.human_input_entities import (
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
)
from models.model import AppMode
from services.tools.provider_queries import ToolProviders
from services.workflow.execution.adapters.events import WorkflowEventPublisher
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter
from services.workflow.execution.ports import ExecutionContexts


class _FakeRuntimeState:
    variable_pool = object()


def _persist_human_input_form(
    session: Session,
    *,
    recipients: list[tuple[RecipientType, str]] | None = None,
) -> datetime:
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    form = HumanInputForm(
        id="form-1",
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_run_id="run-id",
        node_id="node-id",
        form_definition='{"display_in_ui": true}',
        rendered_content="Rendered",
        expiration_time=expiration_time,
    )
    recipient_models = [
        HumanInputFormRecipient(
            id=f"recipient-{index}",
            form_id=form.id,
            delivery_id=f"delivery-{index}",
            recipient_type=recipient_type,
            recipient_payload="{}",
            access_token=access_token,
        )
        for index, (recipient_type, access_token) in enumerate(recipients or ())
    ]
    session.add(form)
    session.add_all(recipient_models)
    session.commit()
    return expiration_time


@pytest.mark.parametrize("source_node_id", ["node-human", "nested-human"])
def test_graph_run_paused_event_uses_projected_nodes_for_highlighting(source_node_id: str) -> None:
    published: list[AppQueueEvent] = []

    def publish(event: AppQueueEvent, _pub_from: PublishFrom) -> None:
        published.append(event)

    graph_reason = HitlRequired(
        session_id="form-1",
        node_id=source_node_id,
        node_title="Human Step",
    )
    event = GraphRunPausedEvent(reasons=[graph_reason], outputs={"foo": "bar"})
    workflow_entry = SimpleNamespace(graph_engine=SimpleNamespace(runtime_state=_FakeRuntimeState()))

    enriched_reason = HumanInputRequired(
        form_id="form-1",
        form_content="content",
        inputs=[],
        actions=[],
        node_id="node-human",
        node_title="Human Step",
    )
    queue = cast(AppQueueManager, SimpleNamespace(publish=publish))
    publisher = WorkflowEventPublisher(queue, notify_pause=lambda _: None)
    publisher.publish(workflow_entry, event, pause_reasons=[enriched_reason])

    assert len(published) == 1
    queue_event = published[0]
    assert isinstance(queue_event, QueueWorkflowPausedEvent)
    assert queue_event.reasons == [enriched_reason]
    assert queue_event.outputs == {"foo": "bar"}
    assert queue_event.paused_nodes == ["node-human"]
    assert graph_reason.node_id == source_node_id


def _build_converter(
    *,
    invoke_from: InvokeFrom = InvokeFrom.SERVICE_API,
    workflow_contexts: ExecutionContexts,
    tool_providers: ToolProviders,
) -> WorkflowResponseConverter:
    application_generate_entity = WorkflowAppGenerateEntity(
        task_id="task",
        workflow_execution_id="run-id",
        user_id="user",
        stream=True,
        inputs={},
        files=[],
        invoke_from=invoke_from,
        app_config=WorkflowUIBasedAppConfig(
            app_id="app-id", tenant_id="tenant-id", workflow_id="workflow-id", app_mode=AppMode.WORKFLOW
        ),
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


@pytest.mark.parametrize(
    "sqlite_session",
    [(HumanInputForm, HumanInputFormRecipient)],
    indirect=True,
)
def test_queue_workflow_paused_event_to_stream_responses(
    sqlite_session: Session, *, workflow_contexts: ExecutionContexts, tool_providers: ToolProviders
) -> None:
    converter = _build_converter(workflow_contexts=workflow_contexts, tool_providers=tool_providers)
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )

    expiration_time = _persist_human_input_form(
        sqlite_session,
        recipients=[
            (RecipientType.CONSOLE, "console-token"),
            (RecipientType.BACKSTAGE, "backstage-token"),
        ],
    )

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Rendered",
        inputs=[ParagraphInputConfig(output_variable_name="field")],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="node-id",
        node_title="Human Step",
    )
    queue_event = QueueWorkflowPausedEvent(
        reasons=[reason],
        outputs={"answer": "value"},
        paused_nodes=["node-id"],
    )

    runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)
    responses = converter.workflow_pause_to_stream_response(
        event=queue_event,
        task_id="task",
        graph_runtime_state=runtime_state,
    )

    pause_resp = responses[-1]
    assert isinstance(pause_resp, WorkflowPauseStreamResponse)
    assert pause_resp.workflow_run_id == "run-id"
    assert pause_resp.data.paused_nodes == ["node-id"]
    assert pause_resp.data.outputs == {}
    assert pause_resp.data.reasons[0]["form_id"] == "form-1"

    hi_resp = responses[0]
    assert isinstance(hi_resp, HumanInputRequiredResponse)
    assert hi_resp.data.form_id == "form-1"
    assert hi_resp.data.node_id == "node-id"
    assert hi_resp.data.node_title == "Human Step"
    assert hi_resp.data.inputs[0].output_variable_name == "field"
    assert hi_resp.data.actions[0].id == "approve"
    assert hi_resp.data.display_in_ui is True
    assert hi_resp.data.form_token is None
    assert hi_resp.data.approval_channels == ["console"]
    assert hi_resp.data.expiration_time == int(expiration_time.timestamp())


def _build_paused_human_input_response(
    session: Session,
    recipients: list[tuple[RecipientType, str]],
    *,
    workflow_contexts: ExecutionContexts,
    tool_providers: ToolProviders,
) -> list[HumanInputRequiredResponse | WorkflowPauseStreamResponse]:
    """Drive the live OPENAPI pause path with persisted forms and recipients."""
    converter = _build_converter(
        workflow_contexts=workflow_contexts, invoke_from=InvokeFrom.OPENAPI, tool_providers=tool_providers
    )
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )

    _persist_human_input_form(session, recipients=recipients)

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Rendered",
        inputs=[ParagraphInputConfig(output_variable_name="field")],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="node-id",
        node_title="Human Step",
    )
    queue_event = QueueWorkflowPausedEvent(
        reasons=[reason],
        outputs={},
        paused_nodes=["node-id"],
    )

    runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)
    responses = converter.workflow_pause_to_stream_response(
        event=queue_event,
        task_id="task",
        graph_runtime_state=runtime_state,
    )
    assert isinstance(responses[0], HumanInputRequiredResponse)
    return cast(list[HumanInputRequiredResponse | WorkflowPauseStreamResponse], responses)


@pytest.mark.parametrize(
    "sqlite_session",
    [(HumanInputForm, HumanInputFormRecipient)],
    indirect=True,
)
def test_openapi_pause_without_web_app_recipient_emits_approval_channels(
    sqlite_session: Session, *, workflow_contexts: ExecutionContexts, tool_providers: ToolProviders
) -> None:
    responses = _build_paused_human_input_response(
        sqlite_session,
        workflow_contexts=workflow_contexts,
        recipients=[
            (RecipientType.EMAIL_MEMBER, "email-token"),
            (RecipientType.BACKSTAGE, "backstage-token"),
        ],
        tool_providers=tool_providers,
    )

    hi_resp = responses[0]
    assert isinstance(hi_resp, HumanInputRequiredResponse)
    assert hi_resp.data.form_token is None
    assert hi_resp.data.approval_channels == ["console", "email"]

    pause_resp = responses[-1]
    assert isinstance(pause_resp, WorkflowPauseStreamResponse)
    assert pause_resp.data.reasons[0]["approval_channels"] == ["console", "email"]


@pytest.mark.parametrize(
    "sqlite_session",
    [(HumanInputForm, HumanInputFormRecipient)],
    indirect=True,
)
def test_openapi_pause_with_web_app_recipient_sets_token_and_channels(
    sqlite_session: Session, *, workflow_contexts: ExecutionContexts, tool_providers: ToolProviders
) -> None:
    responses = _build_paused_human_input_response(
        sqlite_session,
        workflow_contexts=workflow_contexts,
        recipients=[
            (RecipientType.STANDALONE_WEB_APP, "web-app-token"),
            (RecipientType.BACKSTAGE, "backstage-token"),
        ],
        tool_providers=tool_providers,
    )

    hi_resp = responses[0]
    assert isinstance(hi_resp, HumanInputRequiredResponse)
    assert hi_resp.data.form_token == "web-app-token"
    assert hi_resp.data.approval_channels == ["console"]

    pause_resp = responses[-1]
    assert isinstance(pause_resp, WorkflowPauseStreamResponse)
    assert pause_resp.data.reasons[0]["approval_channels"] == ["console"]


@pytest.mark.parametrize(
    "sqlite_session",
    [(HumanInputForm, HumanInputFormRecipient)],
    indirect=True,
)
def test_queue_workflow_paused_event_resolves_variable_select_options(
    sqlite_session: Session, *, workflow_contexts: ExecutionContexts, tool_providers: ToolProviders
) -> None:
    converter = _build_converter(workflow_contexts=workflow_contexts, tool_providers=tool_providers)
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )

    _persist_human_input_form(sqlite_session)

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Rendered",
        inputs=[
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(
                    type=ValueSourceType.VARIABLE,
                    selector=["start", "options"],
                    value=[],
                ),
            )
        ],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="node-id",
        node_title="Human Step",
    )
    queue_event = QueueWorkflowPausedEvent(
        reasons=[reason],
        outputs={},
        paused_nodes=["node-id"],
    )

    runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)
    runtime_state.variable_pool.add(("start", "options"), ["approve", "reject"])
    responses = converter.workflow_pause_to_stream_response(
        event=queue_event,
        task_id="task",
        graph_runtime_state=runtime_state,
    )

    hi_resp = responses[0]
    assert isinstance(hi_resp, HumanInputRequiredResponse)
    select_input = hi_resp.data.inputs[0]
    assert isinstance(select_input, SelectInputConfig)
    assert select_input.option_source.value == ["approve", "reject"]

    pause_resp = responses[-1]
    assert isinstance(pause_resp, WorkflowPauseStreamResponse)
    assert pause_resp.data.reasons[0]["inputs"][0]["option_source"]["value"] == ["approve", "reject"]
