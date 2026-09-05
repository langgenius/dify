import json
from datetime import UTC, datetime, timedelta
from time import perf_counter
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
    QueueNodeStartedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.repositories.human_input_repository import HumanInputFormRepositoryImpl, HumanInputFormSubmissionRepository
from core.tools.workflow_as_tool.repository import WorkflowToolSourceRepository
from core.workflow.nodes.human_input.boundary import human_input_container_selector
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    HumanInputNodeData,
    ParagraphInputConfig,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from core.workflow.workflow_entry import WorkflowEntry
from graphon.engine.ready_queue import StartTask
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes
from graphon.graph import Graph
from graphon.nodes.human_input.entities import HumanInputNodeData as GraphonHumanInputNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.execution import ROOT_FRAME_ID
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from tests.unit_tests.core.app.apps.advanced_chat.test_generate_task_pipeline import _build_pipeline
from tests.workflow_test_utils import build_test_graph_init_params


def _persist_form(
    session: Session,
    *,
    status: HumanInputFormStatus,
    tenant_id: str = "tenant",
    app_id: str = "app",
    workflow_run_id: str = "run-1",
) -> HumanInputForm:
    now = datetime.now(UTC)
    definition = FormDefinition(
        form_content="Decision: {{#$output.answer#}}",
        rendered_content="Decision: {{#$output.answer#}}",
        inputs=[ParagraphInputConfig(output_variable_name="answer")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        expiration_time=now + timedelta(hours=1),
        node_title="Approval",
    )
    form = HumanInputForm(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_run_id=workflow_run_id,
        node_id="same-human-node",
        form_kind=HumanInputFormKind.RUNTIME,
        form_definition=definition.model_dump_json(),
        rendered_content=definition.rendered_content,
        expiration_time=definition.expiration_time,
        status=status,
        selected_action_id="approve" if status == HumanInputFormStatus.SUBMITTED else None,
        submitted_data=json.dumps({"answer": "approved"}) if status == HumanInputFormStatus.SUBMITTED else None,
        submitted_at=now if status == HumanInputFormStatus.SUBMITTED else None,
        created_at=now,
    )
    session.add(form)
    session.commit()
    return form


def _resuming_entry(
    runner: WorkflowBasedAppRunner, forms: list[HumanInputForm], *, human_input_form: HumanInputForm | None = None
) -> WorkflowEntry:
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=perf_counter())
    state.variable_pool.add(("sys", "workflow_run_id"), "run-1")
    graph = runner._init_graph(
        graph_config={
            "nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}],
            "edges": [],
        },
        graph_runtime_state=state,
        tenant_id="tenant",
        user_id="user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    if human_input_form is not None:
        node_data = HumanInputNodeData(
            title="Approval",
            form_content="Decision: {{#$output.answer#}}",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        )
        callback = DifyHITLCallback(
            form_repository=HumanInputFormRepositoryImpl(
                tenant_id="tenant", app_id="app", workflow_execution_id="run-1"
            ),
            node_data=node_data,
            execution_id_getter=lambda: human_input_form.id,
        )
        graph = (
            Graph.new()
            .add_root(graph.root_node)
            .add_node(
                HumanInputNode(
                    node_id=human_input_form.node_id,
                    data=GraphonHumanInputNodeData.model_validate(node_data.model_dump()),
                    init_params=build_test_graph_init_params(tenant_id="tenant", app_id="app"),
                    runtime_state=state,
                    hitl_callback=callback,
                ),
                from_node_id=graph.root_node.id,
            )
            .build()
        )
    state.graph_execution.start()
    for form in forms:
        state.graph_execution.pause(HitlRequired(session_id=form.id, node_id=form.node_id, node_title="Approval"))
        state.variable_pool.add(human_input_container_selector(form.id), "outer-tool")
    state.defer_ready_task(StartTask(frame_id=ROOT_FRAME_ID, node_id=graph.root_node.id))
    return WorkflowEntry(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph=graph,
        graph_config=graph.graph_config or {},
        user_id="user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        variable_pool=state.variable_pool,
        graph_runtime_state=state,
        workflow_tool_source_repository=MagicMock(spec=WorkflowToolSourceRepository),
    )


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_resume_publishes_only_the_completed_form_among_repeated_node_invocations(
    sqlite_session: Session, status: HumanInputFormStatus
) -> None:
    selected = _persist_form(sqlite_session, status=status)
    waiting = _persist_form(sqlite_session, status=HumanInputFormStatus.WAITING)
    expired = _persist_form(sqlite_session, status=HumanInputFormStatus.EXPIRED)
    _persist_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
    queue = MagicMock(spec=AppQueueManager)
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
    entry = _resuming_entry(runner, [selected, waiting, selected, expired])
    original_reasons = tuple(entry.graph_engine.runtime_state.graph_execution.pause_reasons)

    for event in runner._iter_workflow_events(entry):
        runner._handle_event(entry, event)

    published = [call.args[0] for call in queue.publish.call_args_list]
    assert isinstance(published[0], QueueWorkflowStartedEvent)
    completions = [
        item for item in published if isinstance(item, QueueHumanInputFormFilledEvent | QueueHumanInputFormTimeoutEvent)
    ]
    assert len(completions) == 1
    completion = completions[0]
    assert completion.form_id == selected.id
    assert completion.node_id == "outer-tool"
    if status == HumanInputFormStatus.SUBMITTED:
        assert isinstance(completion, QueueHumanInputFormFilledEvent)
        assert (completion.action_id, completion.action_text, completion.rendered_content) == (
            "approve",
            "Approve",
            "Decision: approved",
        )
        assert completion.submitted_data is not None
        assert completion.submitted_data["answer"].to_object() == "approved"
    else:
        assert isinstance(completion, QueueHumanInputFormTimeoutEvent)
    assert len(original_reasons) == 4
    assert all(isinstance(reason, HitlRequired) and reason.node_id == "same-human-node" for reason in original_reasons)
    assert entry.graph_engine.runtime_state.graph_execution.pause_reasons == []


@pytest.mark.parametrize("owner_field", ["tenant_id", "app_id", "workflow_run_id"])
def test_resume_rejects_form_outside_the_trusted_execution_owner(sqlite_session: Session, owner_field: str) -> None:
    form = _persist_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
    setattr(form, owner_field, "another-owner")
    sqlite_session.commit()
    queue = MagicMock(spec=AppQueueManager)
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
    entry = _resuming_entry(runner, [form])

    with pytest.raises(ValueError, match="does not belong"):
        list(runner._iter_workflow_events(entry))

    assert not any(isinstance(call.args[0], QueueHumanInputFormFilledEvent) for call in queue.publish.call_args_list)


@pytest.mark.parametrize("late_status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_form_completed_during_resume_is_published_once_before_the_terminal_event(
    sqlite_session: Session, late_status: HumanInputFormStatus
) -> None:
    first = _persist_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
    second = _persist_form(sqlite_session, status=HumanInputFormStatus.WAITING)
    queue = MagicMock(spec=AppQueueManager)
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
    entry = _resuming_entry(runner, [first, second])

    def complete_second_form_during_execution(event: AppQueueEvent, _publish_from: PublishFrom) -> None:
        # The second submission arrives after the initial completion query,
        # while this real Engine attempt is already processing node events.
        if not isinstance(event, QueueNodeStartedEvent):
            return
        repository = HumanInputFormSubmissionRepository()
        if late_status == HumanInputFormStatus.SUBMITTED:
            repository.mark_submitted(
                form_id=second.id,
                recipient_id=None,
                selected_action_id="approve",
                form_data={"answer": "approved"},
                submission_user_id=None,
                submission_end_user_id="user",
            )
        else:
            repository.mark_timeout(form_id=second.id, timeout_status=late_status)

    queue.publish.side_effect = complete_second_form_during_execution
    for event in runner._iter_workflow_events(entry):
        runner._handle_event(entry, event)

    published = [call.args[0] for call in queue.publish.call_args_list]
    completions = [
        event
        for event in published
        if isinstance(event, QueueHumanInputFormFilledEvent | QueueHumanInputFormTimeoutEvent)
    ]
    assert [event.form_id for event in completions] == [first.id, second.id]
    assert isinstance(published[0], QueueWorkflowStartedEvent)
    assert isinstance(published[-1], QueueWorkflowSucceededEvent)
    assert published.index(completions[-1]) < len(published) - 1


def test_waiting_form_expiring_during_resume_publishes_timeout_before_success(sqlite_session: Session) -> None:
    form = _persist_form(sqlite_session, status=HumanInputFormStatus.WAITING)
    form.expiration_time = datetime.now(UTC) - timedelta(seconds=1)
    sqlite_session.commit()
    queue = MagicMock(spec=AppQueueManager)
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
    entry = _resuming_entry(runner, [form], human_input_form=form)

    for event in runner._iter_workflow_events(entry):
        runner._handle_event(entry, event)

    published = [call.args[0] for call in queue.publish.call_args_list]
    assert isinstance(published[-1], QueueWorkflowSucceededEvent)
    timeouts = [event for event in published if isinstance(event, QueueHumanInputFormTimeoutEvent)]
    assert [event.form_id for event in timeouts] == [form.id]
    assert timeouts[0].node_id == "outer-tool"
    assert published.index(timeouts[0]) < len(published) - 1
    sqlite_session.refresh(form)
    assert form.status == HumanInputFormStatus.TIMEOUT


def test_chat_history_keeps_repeated_forms_by_form_id(sqlite_session: Session) -> None:
    first = _persist_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
    second = _persist_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
    pipeline = _build_pipeline()
    pipeline._workflow_tenant_id = "tenant"
    pipeline._application_generate_entity = MagicMock(task_id="task")
    pipeline._workflow_response_converter = MagicMock()
    for form in (first, second, first):
        event = QueueHumanInputFormFilledEvent(
            form_id=form.id,
            node_id=form.node_id,
            node_type=BuiltinNodeTypes.HUMAN_INPUT,
            node_title="Approval",
            rendered_content="Decision: approved",
            action_id="approve",
            action_text="Approve",
        )
        list(pipeline._handle_human_input_form_filled_event(event))

    contents = sqlite_session.scalars(select(HumanInputContent)).all()
    assert {(content.form_id, content.message_id) for content in contents} == {
        (first.id, "message-1"),
        (second.id, "message-1"),
    }
    assert len(contents) == 2
