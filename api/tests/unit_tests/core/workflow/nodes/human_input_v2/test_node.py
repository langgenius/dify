from dataclasses import replace
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from pydantic import SecretStr, TypeAdapter

from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.queue_entities import (
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
    QueueNodeSucceededEvent,
)
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
    UserAction,
)
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.entities import (
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
)
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus, ValueSourceType
from core.workflow.nodes.human_input_v2.entities import (
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    MessageTemplateConfig,
)
from core.workflow.nodes.human_input_v2.events import NodeRunHumanInputV2FormRequiredEvent
from core.workflow.nodes.human_input_v2.node import HumanInputNode
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError, HumanInputRuntime, PreparedForm
from graphon.entities import GraphInitParams, WorkflowStartReason
from graphon.entities.pause_reason import PauseReason
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph_events import (
    NodeRunFailedEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.node_events import StreamCompletedEvent
from graphon.node_events.node import HumanInputFormFilledEvent, HumanInputFormTimeoutEvent
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from repositories.human_input_v2.form_repository import Form, FormSubmission
from tests.unit_tests.core.app.apps.common.test_workflow_response_converter_human_input import _build_converter


@pytest.fixture
def form() -> Form:
    return Form(
        id="form-1",
        tenant_id=TenantId("tenant-1"),
        app_id="app-1",
        workflow_run_id="run-1",
        node_execution_id="execution-1",
        form_kind=HumanInputFormKind.RUNTIME,
        status=HumanInputFormStatus.WAITING,
        created_at=datetime(2025, 1, 1),
        updated_at=datetime(2025, 1, 1),
        expiration_time=datetime(2025, 1, 2),
        global_timeout_deadline=datetime(2025, 1, 3),
        submission=None,
        resolved_form=ResolvedForm(
            title="Frozen title",
            legacy_form_content="Answer: {{#$output.answer#}}; files: {{#$output.files#}}",
            parts=(
                MarkdownFragment(text="Answer: "),
                ParagraphInput(output_variable_name="answer", default_value="original"),
                MarkdownFragment(text="; files: "),
                FileListInput(
                    output_variable_name="files",
                    allowed_file_types=(),
                    allowed_file_extensions=(),
                    allowed_file_upload_methods=(),
                    number_limits=3,
                ),
            ),
            actions=(UserAction(id="approve", title="Frozen approval", button_style=ButtonStyle.PRIMARY),),
        ),
    )


def build_node(form: Form, *, initiator: bool = False, token: str | None = None):
    runtime = MagicMock(spec=HumanInputRuntime)
    runtime.prepare_form.return_value = PreparedForm(form=form, form_token=SecretStr(token) if token else None)
    node = HumanInputNode(
        node_id="node-1",
        data=HumanInputNodeData.model_validate(
            {
                "type": "human-input",
                "version": "2",
                "title": "Changed title",
                "recipients_spec": [Initiator()] if initiator else [],
                "message_template": {"subject": "Notice", "body": "[Request URL]"},
                "debug_mode": {"enabled": False, "channels": []},
                "form_content": "Changed form",
                "user_actions": [],
            }
        ),
        graph_init_params=GraphInitParams(workflow_id="wf-1", graph_config={}, run_context={}, call_depth=0),
        graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
        human_input_runtime=runtime,
    )
    node.bind_execution_id("execution-1")
    return node, runtime


def submit(form: Form) -> Form:
    return replace(
        form,
        status=HumanInputFormStatus.SUBMITTED,
        submission=FormSubmission(
            submitted_at=datetime(2025, 1, 1, 1),
            submitted_by_recipient_id=RecipientId("recipient-1"),
            selected_action_id="approve",
            raw_submission_inputs={"answer": "yes", "files": []},
            normalized_submission_data={"answer": StringSegment(value="yes"), "files": ArrayFileSegment(value=[])},
        ),
    )


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_v1_event_filter_preserves_v2_completion_without_duplicate_events(form, status):
    from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
    from core.workflow.nodes.human_input.boundary import HumanInputFormEventFilter
    from graphon.filters import GraphEventFilterContext, filter_graph_events
    from graphon.graph import Graph
    from graphon.runtime import ReadOnlyGraphRuntimeStateWrapper

    form = submit(form) if status == HumanInputFormStatus.SUBMITTED else replace(form, status=status)
    node, _ = build_node(form)
    events = list(
        filter_graph_events(
            node.run(),
            context=GraphEventFilterContext(
                graph=Graph(root_node=node),
                runtime_state=ReadOnlyGraphRuntimeStateWrapper(node.graph_runtime_state),
            ),
            filters=[HumanInputFormEventFilter(form_repository=HumanInputFormSubmissionRepository())],
        )
    )

    completion_type = (
        NodeRunHumanInputFormFilledEvent
        if status == HumanInputFormStatus.SUBMITTED
        else NodeRunHumanInputFormTimeoutEvent
    )
    assert [type(event) for event in events] == [NodeRunStartedEvent, completion_type, NodeRunSucceededEvent]


def test_submitted_emits_filled_before_completion_from_frozen_values(form):
    form = submit(form)
    node, runtime = build_node(form)
    events = list(node.run())
    assert [type(event) for event in events] == [
        NodeRunStartedEvent,
        NodeRunHumanInputFormFilledEvent,
        NodeRunSucceededEvent,
    ]
    filled = events[1]
    assert isinstance(filled, NodeRunHumanInputFormFilledEvent)
    assert (filled.id, filled.node_id, filled.node_title) == ("execution-1", "node-1", "Frozen title")
    assert (filled.action_id, filled.action_text) == ("approve", "Frozen approval")
    assert filled.rendered_content == "Answer: yes; files: [0 files]"
    assert isinstance(filled.submitted_data["files"], ArrayFileSegment)
    completed = events[2]
    assert isinstance(completed, NodeRunSucceededEvent)
    assert completed.node_run_result.edge_source_handle == "approve"
    assert completed.node_run_result.outputs["__action_value"].text == "Frozen approval"
    assert runtime.prepare_form.call_args.kwargs["node_execution_id"] == "execution-1"


def test_waiting_does_not_infer_timeout_from_clock(form):
    node, _ = build_node(form, initiator=True, token="initiator-token")
    events = list(node.run())
    assert [type(event) for event in events] == [
        NodeRunStartedEvent,
        NodeRunHumanInputV2FormRequiredEvent,
        NodeRunPauseRequestedEvent,
    ]
    required = events[1]
    assert isinstance(required, NodeRunHumanInputV2FormRequiredEvent)
    assert required.prepared_form.form == form
    assert required.prepared_form.form_token.get_secret_value() == "initiator-token"
    assert required.id == "execution-1"
    assert required.node_id == "node-1"
    assert required.node_version == "2"
    assert events[2].reason.session_id == "hitlv2:form-1"
    assert events[2].reason.node_title == "Frozen title"


def test_waiting_reason_obeys_the_graphon_wire_contract(form):
    node, _ = build_node(form, initiator=True, token="initiator-token")
    pause = list(node.run())[-1]
    assert isinstance(pause, NodeRunPauseRequestedEvent)
    restored = TypeAdapter(PauseReason).validate_json(pause.reason.model_dump_json())
    assert restored.model_dump(mode="json") == {
        "TYPE": "hitl_required",
        "session_id": "hitlv2:form-1",
        "node_id": "node-1",
        "node_title": "Frozen title",
    }


@pytest.mark.parametrize("token", ["initiator-token", None])
@pytest.mark.parametrize("session_id", ["hitlv2:form-1", "engine-session"])
def test_waiting_form_crosses_engine_persistence_and_live_response_without_reloading(
    form, token, session_id, monkeypatch
):
    from types import SimpleNamespace

    from sqlalchemy.orm import sessionmaker

    from core.app.entities.queue_entities import QueueWorkflowPausedEvent
    from core.app.entities.task_entities import HumanInputRequiredResponse, WorkflowPauseStreamResponse
    from core.app.layers.pause_state_persist_layer import PauseStatePersistenceLayer
    from core.db.session_factory import session_factory
    from core.workflow.nodes.human_input.session_binding import default_session_binding
    from core.workflow.system_variables import SystemVariableKey, system_variable_selector
    from graphon.filters import GraphEventFilterContext, ResponseStreamFilter, filter_graph_events
    from graphon.graph import Graph
    from graphon.graph_engine import GraphEngine
    from graphon.graph_engine.command_channels import InMemoryChannel
    from graphon.graph_events import GraphRunPausedEvent
    from graphon.nodes.start import StartNode
    from graphon.nodes.start.entities import StartNodeData
    from repositories.factory import DifyAPIRepositoryFactory
    from tests.unit_tests.core.app.layers.test_pause_state_persist_layer import TestPauseStatePersistenceLayer

    session_ids = {form.id: session_id}
    form_ids = {session_id: form.id}

    def issue_session_id(*, node_version, form_id):
        assert node_version == "2"
        return session_ids[form_id]

    monkeypatch.setattr(default_session_binding, "issue_session_id_for_form", issue_session_id)
    monkeypatch.setattr(
        default_session_binding, "resolve_form_id_from_session_id", lambda *, session_id: ("2", form_ids[session_id])
    )
    node, _ = build_node(form, initiator=token is not None, token=token)
    state = node.graph_runtime_state
    state.variable_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "run-1")
    queue = MagicMock()
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app-1")
    legacy_repository = MagicMock()
    legacy_repository.get_by_form_id.side_effect = AssertionError("V2 must not use V1 enrichment")
    for module in ("core.app.apps.workflow_app_runner", "core.app.layers.pause_state_persist_layer"):
        monkeypatch.setattr(f"{module}.HumanInputFormSubmissionRepository", lambda: legacy_repository)
    monkeypatch.setattr(
        session_factory, "create_session", MagicMock(side_effect=AssertionError("Unexpected form reload"))
    )
    repository = MagicMock()
    monkeypatch.setattr(DifyAPIRepositoryFactory, "create_api_workflow_run_repository", lambda _: repository)
    notifications = MagicMock()
    monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_form_delivery_task", notifications)
    response_filter = ResponseStreamFilter()
    layer = PauseStatePersistenceLayer(
        session_factory=sessionmaker(),
        generate_entity=TestPauseStatePersistenceLayer._create_generate_entity("run-1"),
        state_owner_user_id="account",
        response_stream_filter=response_filter,
    )
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        graph_init_params=GraphInitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0),
        graph_runtime_state=state,
    )
    engine = GraphEngine(
        workflow_id="workflow",
        graph=Graph.new().add_root(start).add_node(node, from_node_id="start").build(),
        graph_runtime_state=state,
        command_channel=InMemoryChannel(),
    ).layer(layer)
    for event in filter_graph_events(
        engine.run(), context=GraphEventFilterContext.from_engine(engine), filters=[response_filter]
    ):
        runner._handle_event(SimpleNamespace(graph_engine=engine), event)

    assert isinstance(event, GraphRunPausedEvent)
    assert event.reasons[0].session_id == session_id
    paused = next(
        call.args[0] for call in queue.publish.call_args_list if isinstance(call.args[0], QueueWorkflowPausedEvent)
    )
    stored_reasons = repository.create_workflow_pause.call_args.kwargs["pause_reasons"]
    assert stored_reasons == []
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext

    checkpoint = WorkflowResumptionContext.loads(repository.create_workflow_pause.call_args.kwargs["state"])
    restored_state = GraphRuntimeState.from_snapshot(checkpoint.serialized_graph_runtime_state)
    assert restored_state.graph_execution.pause_reasons[0].session_id == session_id
    if token is not None:
        assert token not in repository.create_workflow_pause.call_args.kwargs["state"]
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    responses = converter.workflow_pause_to_stream_response(event=paused, task_id="task-1", graph_runtime_state=state)
    assert [type(response) for response in responses] == [HumanInputRequiredResponse, WorkflowPauseStreamResponse]
    data = responses[0].data.model_dump(mode="json")
    assert data["form_id"] == form.id
    assert data["form_content"] == form.resolved_form.legacy_form_content
    assert data["form_token"] == token
    assert data["display_in_ui"] == (token is not None)
    assert {"version", "form_version"}.isdisjoint(data)
    assert responses[1].data.reasons[0]["form_token"] == token
    notifications.apply_async.assert_not_called()


def test_mixed_pause_keeps_each_v2_execution_and_delivers_only_the_legacy_form(form, monkeypatch):
    from types import SimpleNamespace

    from core.app.entities.queue_entities import QueueWorkflowPausedEvent
    from core.workflow.nodes.human_input.entities import FormDefinition
    from graphon.entities.pause_reason import HitlRequired
    from graphon.graph_events import GraphRunPausedEvent

    queue = MagicMock()
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app-1")
    node, _ = build_node(form)
    entry = SimpleNamespace(
        graph_engine=SimpleNamespace(
            graph=SimpleNamespace(
                nodes={
                    "node-1": node,
                    "legacy-node": SimpleNamespace(node_type="human-input", version=lambda: "1"),
                }
            ),
            graph_runtime_state=GraphRuntimeState(
                variable_pool=VariablePool(),
                start_at=0,
            ),
        )
    )
    legacy_record = SimpleNamespace(
        form_id="legacy-form",
        node_id="legacy-node",
        rendered_content="Legacy content",
        definition=FormDefinition(
            form_content="Legacy content", rendered_content="Legacy content", expiration_time=datetime(2099, 1, 1)
        ),
    )
    legacy_repository = MagicMock()

    def read_legacy(form_id):
        assert form_id == "legacy-form", "V2 forms must not enter the legacy repository"
        return legacy_record

    legacy_repository.get_by_form_id.side_effect = read_legacy
    monkeypatch.setattr(
        "core.app.apps.workflow_app_runner.HumanInputFormSubmissionRepository", lambda: legacy_repository
    )
    notifications = MagicMock()
    monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_form_delivery_task", notifications)
    second = replace(form, id="second-form", node_execution_id="second-execution")
    for snapshot in (form, second):
        runner._handle_event(
            entry,
            NodeRunHumanInputV2FormRequiredEvent(
                id=snapshot.node_execution_id,
                node_id="node-1",
                node_type="human-input",
                node_version="2",
                prepared_form=PreparedForm(snapshot, None),
            ),
        )
    reasons = [
        HitlRequired(session_id="legacy-form", node_id="legacy-node", node_title="Legacy"),
        HitlRequired(session_id=f"hitlv2:{form.id}", node_id="node-1", node_title="First"),
        HitlRequired(session_id=f"hitlv2:{second.id}", node_id="node-1", node_title="Second"),
    ]
    runner._handle_event(entry, GraphRunPausedEvent(reasons=reasons, outputs={}))
    paused = queue.publish.call_args.args[0]
    assert isinstance(paused, QueueWorkflowPausedEvent)
    assert [reason.form_id for reason in paused.reasons] == ["legacy-form", form.id, second.id]
    assert set(paused.human_input_v2_forms) == {form.id, second.id}
    notifications.apply_async.assert_called_once_with(
        kwargs={"form_id": "legacy-form", "node_title": "Legacy"},
        queue="mail",
    )


def test_v2_missing_snapshot_is_not_resolved_by_the_legacy_repository(form, monkeypatch):
    from types import SimpleNamespace

    from graphon.entities.pause_reason import HitlRequired
    from graphon.graph_events import GraphRunPausedEvent

    node, _ = build_node(form)
    entry = SimpleNamespace(
        graph_engine=SimpleNamespace(
            graph=SimpleNamespace(nodes={node.id: node}),
            graph_runtime_state=node.graph_runtime_state,
        )
    )
    legacy_repository = MagicMock()
    legacy_repository.get_by_form_id.side_effect = AssertionError("V2 must not fall back to the legacy repository")
    monkeypatch.setattr(
        "core.app.apps.workflow_app_runner.HumanInputFormSubmissionRepository", lambda: legacy_repository
    )
    runner = WorkflowBasedAppRunner(queue_manager=MagicMock(), app_id="app-1")
    with pytest.raises(ValueError, match="snapshot"):
        runner._handle_event(
            entry,
            GraphRunPausedEvent(
                reasons=[
                    HitlRequired(session_id=f"hitlv2:{form.id}", node_id=node.id, node_title="Approval"),
                ],
                outputs={},
            ),
        )


def test_v2_pause_persistence_uses_graph_state_without_the_node_snapshot(form, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from core.app.layers.pause_state_persist_layer import PauseStatePersistenceLayer, WorkflowResumptionContext
    from graphon.entities.pause_reason import HitlRequired
    from graphon.graph_events import GraphRunPausedEvent
    from repositories.factory import DifyAPIRepositoryFactory
    from tests.unit_tests.core.app.layers.test_pause_state_persist_layer import (
        MockCommandChannel,
        TestPauseStatePersistenceLayer,
        _create_initialized_response_stream_filter,
    )

    repository = MagicMock()
    monkeypatch.setattr(DifyAPIRepositoryFactory, "create_api_workflow_run_repository", lambda _: repository)
    layer = PauseStatePersistenceLayer(
        session_factory=sessionmaker(),
        generate_entity=TestPauseStatePersistenceLayer._create_generate_entity("run-1"),
        state_owner_user_id="account",
        response_stream_filter=_create_initialized_response_stream_filter(),
    )
    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    from core.workflow.system_variables import SystemVariableKey, system_variable_selector

    state.variable_pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), "run-1")
    reason = HitlRequired(session_id=f"hitlv2:{form.id}", node_id="approval", node_title="Approval")
    state.graph_execution.pause(reason)
    layer.initialize(state, MockCommandChannel())
    layer.on_event(GraphRunPausedEvent(reasons=[reason], outputs={}))
    saved = repository.create_workflow_pause.call_args.kwargs
    assert saved["pause_reasons"] == []
    context = WorkflowResumptionContext.loads(saved["state"])
    restored = GraphRuntimeState.from_snapshot(context.serialized_graph_runtime_state)
    assert restored.graph_execution.pause_reasons == [reason]


def test_persisted_timeout_emits_timeout_before_timeout_branch(form):
    # Even a future deadline cannot undo an already persisted timeout.
    form = replace(form, status=HumanInputFormStatus.TIMEOUT, expiration_time=datetime(2099, 1, 1))
    node, _ = build_node(form)
    events = list(node.run())
    assert [type(event) for event in events] == [
        NodeRunStartedEvent,
        NodeRunHumanInputFormTimeoutEvent,
        NodeRunSucceededEvent,
    ]
    assert events[1].node_title == "Frozen title"
    assert events[1].expiration_time == datetime(2099, 1, 1)
    assert events[2].node_run_result.edge_source_handle == "__timeout"
    assert events[2].node_run_result.outputs["__action_id"].text == ""


def test_global_expiration_aborts_without_a_node_branch(form):
    node, _ = build_node(replace(form, status=HumanInputFormStatus.EXPIRED))
    assert [type(event) for event in node.run()] == [NodeRunStartedEvent]
    assert node.graph_runtime_state.graph_execution.aborted


def test_all_delivery_failure_emits_failure_not_pause(form):
    node, runtime = build_node(form)
    runtime.prepare_form.side_effect = HumanInputDeliveryError("All deliveries failed")
    events = list(node.run())
    assert [type(event) for event in events] == [NodeRunStartedEvent, NodeRunFailedEvent]
    assert events[-1].error == "All deliveries failed"


def test_reentry_consumes_the_new_persisted_outcome(form):
    node, runtime = build_node(form)
    runtime.prepare_form.side_effect = [PreparedForm(form, None), PreparedForm(submit(form), None)]
    assert isinstance(list(node.run())[-1], NodeRunPauseRequestedEvent)
    assert isinstance(list(node.run())[-1], NodeRunSucceededEvent)


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_actual_graph_queue_response_path_preserves_order_and_fields(form, status):
    form = submit(form) if status == HumanInputFormStatus.SUBMITTED else replace(form, status=status)
    node, _ = build_node(form)
    runner = MagicMock(spec=WorkflowBasedAppRunner)
    for event in list(node.run())[1:]:
        WorkflowBasedAppRunner._handle_event(runner, MagicMock(), event)
    queue_events = [call.args[0] for call in runner._publish_event.call_args_list]
    assert isinstance(queue_events[1], QueueNodeSucceededEvent)
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )
    if status == HumanInputFormStatus.SUBMITTED:
        assert isinstance(queue_events[0], QueueHumanInputFormFilledEvent)
        assert isinstance(queue_events[0].submitted_data["files"], ArrayFileSegment)
        response = converter.human_input_form_filled_to_stream_response(event=queue_events[0], task_id="task-1")
        assert response.data.action_text == "Frozen approval"
        assert response.data.rendered_content == "Answer: yes; files: [0 files]"
        assert response.data.submitted_data == {"answer": "yes", "files": []}
    else:
        assert isinstance(queue_events[0], QueueHumanInputFormTimeoutEvent)
        response = converter.human_input_form_timeout_to_stream_response(event=queue_events[0], task_id="task-1")
        assert response.data.expiration_time == 1735776000
    assert response.data.node_title == "Frozen title"
    completed_response = converter.workflow_node_finish_to_stream_response(event=queue_events[1], task_id="task-1")
    assert completed_response is not None
    assert completed_response.data.id == "execution-1"


@pytest.mark.parametrize("token", ["initiator-token", None])
def test_dify_projection_serializes_the_runtime_token_without_a_graph_reason(form, token):
    from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
    from core.app.entities.task_entities import HumanInputRequiredPauseReasonPayload

    prepared = PreparedForm(form, SecretStr(token) if token else None)
    with patch(
        "core.app.apps.common.workflow_response_converter.Session", side_effect=AssertionError("unexpected lookup")
    ):
        data = WorkflowResponseConverter.human_input_v2_required_data(prepared, node_id="node-1")
    assert data.form_token == token
    assert data.form_content == form.resolved_form.legacy_form_content
    assert data.resolved_default_values == {"answer": "original"}
    wire_fields = {
        "form_id",
        "node_id",
        "node_title",
        "form_content",
        "inputs",
        "actions",
        "display_in_ui",
        "form_token",
        "approval_channels",
        "resolved_default_values",
        "expiration_time",
    }
    assert set(data.model_dump(mode="json")) == wire_fields
    assert set(HumanInputRequiredPauseReasonPayload.from_response_data(data).model_dump(mode="json")) == {
        "TYPE",
        *wire_fields,
    }


def test_file_segments_survive_node_graph_queue_and_response(form):
    attachment = File(
        file_id="file-1",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/review.pdf",
        filename="review.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=100,
    )
    file_input = FileInput(
        output_variable_name="attachment",
        allowed_file_types=(FileType.DOCUMENT,),
        allowed_file_extensions=(".pdf",),
        allowed_file_upload_methods=(FileTransferMethod.REMOTE_URL,),
    )
    form = submit(form)
    assert form.submission is not None
    values = dict(form.submission.normalized_submission_data)
    values.update(attachment=FileSegment(value=attachment), files=ArrayFileSegment(value=[attachment]))
    form = replace(
        form,
        resolved_form=form.resolved_form.model_copy(
            update={"parts": form.resolved_form.parts + (MarkdownFragment(text="; attachment: "), file_input)}
        ),
        submission=replace(form.submission, normalized_submission_data=values),
    )
    node, _ = build_node(form)
    graph_events = list(node.run())
    assert graph_events[1].rendered_content == "Answer: yes; files: [1 files]; attachment: [file]"
    assert isinstance(graph_events[2].node_run_result.outputs["attachment"], FileSegment)
    runner = MagicMock(spec=WorkflowBasedAppRunner)
    WorkflowBasedAppRunner._handle_event(runner, MagicMock(), graph_events[1])
    queue_event = runner._publish_event.call_args.args[0]
    assert isinstance(queue_event.submitted_data["attachment"], FileSegment)
    assert isinstance(queue_event.submitted_data["files"], ArrayFileSegment)
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )
    response = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")
    assert response.data.submitted_data["attachment"]["filename"] == "review.pdf"
    assert response.data.submitted_data["files"][0]["filename"] == "review.pdf"


def test_filled_rendering_does_not_reinterpret_submission_as_a_template(form):
    form = submit(form)
    assert form.submission is not None
    values = dict(form.submission.normalized_submission_data)
    values["answer"] = StringSegment(value="{{#$output.files#}}")
    node, _ = build_node(replace(form, submission=replace(form.submission, normalized_submission_data=values)))
    assert list(node.run())[1].rendered_content == "Answer: {{#$output.files#}}; files: [0 files]"


def test_waiting_projection_freezes_select_options_and_deduplicates_slots(form):
    from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter

    option = SelectInput(output_variable_name="choice", options=("old-a", "old-b"), default_value="old-b")
    form = replace(form, resolved_form=form.resolved_form.model_copy(update={"parts": (option, option)}))
    prepared = PreparedForm(form, SecretStr("secret-token"))
    data = WorkflowResponseConverter.human_input_v2_required_data(prepared, node_id="node-1")
    assert len(data.inputs) == 1
    assert isinstance(data.inputs[0], SelectInputConfig)
    assert data.inputs[0].option_source.value == ["old-a", "old-b"]
    assert data.inputs[0].option_source.type == ValueSourceType.CONSTANT
    assert data.resolved_default_values == {"choice": "old-b"}
    assert "secret-token" not in repr(prepared)


def test_debug_dependencies_include_all_sources_and_complete_nested_paths(form):
    node, _ = build_node(form)
    data = node.node_data.model_copy(
        update={
            "form_content": "{{#upstream.data.name#}} {{#$output.answer#}}",
            "message_template": MessageTemplateConfig(
                subject="{{#upstream.subject#}}", body="{{#upstream.body#}} [Request URL]"
            ),
            "recipients_spec": [DynamicEmail(selector=("upstream", "data", "email"))],
            "inputs": [
                ParagraphInputConfig(
                    output_variable_name="answer",
                    default=StringSource(type=ValueSourceType.VARIABLE, selector=("upstream", "data", "default")),
                ),
                SelectInputConfig(
                    output_variable_name="choice",
                    option_source=StringListSource(type=ValueSourceType.VARIABLE, selector=("upstream", "options")),
                ),
            ],
        }
    )
    mapping = HumanInputNode.extract_variable_selector_to_variable_mapping(
        graph_config={}, config={"id": "node-1", "data": data}
    )
    assert set(map(tuple, mapping.values())) == {
        ("upstream", "data", "name"),
        ("upstream", "subject"),
        ("upstream", "body"),
        ("upstream", "data", "email"),
        ("upstream", "data", "default"),
        ("upstream", "options"),
    }


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_node_itself_yields_the_existing_business_event_before_completion(form, status):
    form = submit(form) if status == HumanInputFormStatus.SUBMITTED else replace(form, status=status)
    node, _ = build_node(form)
    events = list(node._run())
    expected = HumanInputFormFilledEvent if status == HumanInputFormStatus.SUBMITTED else HumanInputFormTimeoutEvent
    assert [type(event) for event in events] == [expected, StreamCompletedEvent]


def test_button_only_submission_completes_without_input_fields(form):
    form = submit(form)
    assert form.submission is not None
    form = replace(
        form,
        resolved_form=form.resolved_form.model_copy(update={"parts": (MarkdownFragment(text="Approve this"),)}),
        submission=replace(form.submission, raw_submission_inputs={}, normalized_submission_data={}),
    )
    node, _ = build_node(form)
    events = list(node.run())
    assert events[1].submitted_data == {}
    assert events[1].rendered_content == "Approve this"
    assert events[2].node_run_result.edge_source_handle == "approve"
