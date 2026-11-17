from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime
from unittest.mock import MagicMock, create_autospec, patch

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
from core.workflow.workflow_entry import WorkflowEntry
from graphon.engine_events import (
    EngineEvent,
    NodeRunFailedEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired, PauseReason
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph import Graph
from graphon.runtime import InitParams, RuntimeState, VariablePool
from graphon.variables.segments import ArrayFileSegment, FileSegment, NoneSegment, StringSegment
from repositories.human_input_v2.form_repository import Form, FormSubmission
from tests.unit_tests.core.app.apps.common.test_workflow_response_converter import (
    _workflow_response_converter_human_input_build_converter as _build_converter,
)


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


def build_node(form: Form, *, initiator: bool = False, token: str | None = None) -> tuple[HumanInputNode, MagicMock]:
    runtime = create_autospec(HumanInputRuntime, instance=True)
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
        init_params=InitParams(workflow_id="wf-1", graph_config={}, run_context={}, call_depth=0),
        runtime_state=RuntimeState(workflow_id="wf-1", variable_pool=VariablePool(), start_at=0),
        human_input_runtime=runtime,
    )
    node.bind_execution_id("execution-1")
    return node, runtime


def engine_events(node: HumanInputNode) -> Iterator[EngineEvent]:
    for event in node.run():
        assert isinstance(event, EngineEvent)
        yield event


def submit(form: Form) -> Form:
    return replace(
        form,
        status=HumanInputFormStatus.SUBMITTED,
        submission=FormSubmission(
            submitted_at=datetime(2025, 1, 1, 1),
            submitted_by_recipient_id=RecipientId("recipient-1"),
            submitted_by_delivery_id="delivery-1",
            selected_action_id="approve",
            raw_submission_inputs={"answer": "yes", "files": []},
            normalized_submission_data={"answer": StringSegment(value="yes"), "files": ArrayFileSegment(value=[])},
        ),
    )


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_v1_event_filter_preserves_v2_completion_without_duplicate_events(
    form: Form, status: HumanInputFormStatus
) -> None:
    from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
    from core.workflow.nodes.human_input.boundary import HumanInputFormEventFilter
    from graphon.engine.filter import EngineEventFilterContext, filter_engine_events
    from graphon.graph import Graph
    from graphon.runtime import ReadOnlyRuntimeStateWrapper

    form = submit(form) if status == HumanInputFormStatus.SUBMITTED else replace(form, status=status)
    node, _ = build_node(form)
    events = list(
        filter_engine_events(
            engine_events(node),
            context=EngineEventFilterContext(
                graph=Graph(root_node=node),
                runtime_state=ReadOnlyRuntimeStateWrapper(node.runtime_state),
            ),
            filters=[HumanInputFormEventFilter(form_repository=HumanInputFormSubmissionRepository())],
        )
    )

    completion_type = (
        NodeRunHumanInputFormFilledEvent
        if status == HumanInputFormStatus.SUBMITTED
        else NodeRunHumanInputFormTimeoutEvent
    )
    assert len(events) == 3
    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], completion_type)
    assert isinstance(events[2], NodeRunSucceededEvent)


def test_submitted_emits_filled_before_completion_from_frozen_values(form: Form) -> None:
    form = submit(form)
    node, runtime = build_node(form)
    events = list(node.run())
    assert len(events) == 3
    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunHumanInputFormFilledEvent)
    assert isinstance(events[2], NodeRunSucceededEvent)
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


def test_waiting_does_not_infer_timeout_from_clock(form: Form) -> None:
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
    assert required.prepared_form.form_token is not None
    assert required.prepared_form.form_token.get_secret_value() == "initiator-token"
    assert required.id == "execution-1"
    assert required.node_id == "node-1"
    assert required.node_version == "2"
    assert isinstance(events[2], NodeRunPauseRequestedEvent)
    assert isinstance(events[2].reason, HitlRequired)
    assert events[2].reason.session_id == "hitlv2:form-1"
    assert events[2].reason.node_title == "Frozen title"


def test_waiting_reason_obeys_the_graphon_wire_contract(form: Form) -> None:
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


def test_persisted_timeout_emits_timeout_before_timeout_branch(form: Form) -> None:
    # Even a future deadline cannot undo an already persisted timeout.
    form = replace(form, status=HumanInputFormStatus.TIMEOUT, expiration_time=datetime(2099, 1, 1))
    node, _ = build_node(form)
    events = list(node.run())
    assert len(events) == 3
    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunHumanInputFormTimeoutEvent)
    assert isinstance(events[2], NodeRunSucceededEvent)
    assert events[1].node_title == "Frozen title"
    assert events[1].expiration_time == datetime(2099, 1, 1)
    assert events[2].node_run_result.edge_source_handle == "__timeout"
    assert events[2].node_run_result.outputs["__action_id"].text == ""


def test_global_expiration_aborts_without_a_node_branch(form: Form) -> None:
    node, _ = build_node(replace(form, status=HumanInputFormStatus.EXPIRED))
    assert [type(event) for event in node.run()] == [NodeRunStartedEvent]
    assert node.runtime_state.graph_execution.aborted


def test_all_delivery_failure_emits_failure_not_pause(form: Form) -> None:
    node, runtime = build_node(form)
    runtime.prepare_form.side_effect = HumanInputDeliveryError("All deliveries failed")
    events = list(node.run())
    assert [type(event) for event in events] == [NodeRunStartedEvent, NodeRunFailedEvent]
    assert isinstance(events[-1], NodeRunFailedEvent)
    assert events[-1].error == "All deliveries failed"


def test_reentry_consumes_the_new_persisted_outcome(form: Form) -> None:
    node, runtime = build_node(form)
    runtime.prepare_form.side_effect = [PreparedForm(form, None), PreparedForm(submit(form), None)]
    assert isinstance(list(node.run())[-1], NodeRunPauseRequestedEvent)
    assert isinstance(list(node.run())[-1], NodeRunSucceededEvent)


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT])
def test_actual_graph_queue_response_path_preserves_order_and_fields(form: Form, status: HumanInputFormStatus) -> None:
    form = submit(form) if status == HumanInputFormStatus.SUBMITTED else replace(form, status=status)
    node, _ = build_node(form)
    runner = create_autospec(WorkflowBasedAppRunner, instance=True)
    entry = WorkflowEntry({}, Graph(root_node=node), 0, node.runtime_state)
    for event in list(engine_events(node))[1:]:
        WorkflowBasedAppRunner.handle_event(runner, entry, event)
    queue_events = [call.args[0] for call in runner._publish_event.call_args_list]
    assert isinstance(queue_events[1], QueueNodeSucceededEvent)
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )
    if status == HumanInputFormStatus.SUBMITTED:
        assert isinstance(queue_events[0], QueueHumanInputFormFilledEvent)
        assert queue_events[0].submitted_data is not None
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
    assert response.data.form_id == form.id
    completed_response = converter.workflow_node_finish_to_stream_response(event=queue_events[1], task_id="task-1")
    assert completed_response is not None
    assert completed_response.data.id == "execution-1"


@pytest.mark.parametrize("token", ["initiator-token", None])
def test_dify_projection_serializes_the_runtime_token_without_a_graph_reason(form: Form, token: str | None) -> None:
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
        "form_version",
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


def test_file_segments_survive_node_graph_queue_and_response(form: Form) -> None:
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
    assert isinstance(graph_events[1], NodeRunHumanInputFormFilledEvent)
    assert isinstance(graph_events[2], NodeRunSucceededEvent)
    assert graph_events[1].rendered_content == "Answer: yes; files: [1 files]; attachment: [file]"
    assert isinstance(graph_events[2].node_run_result.outputs["attachment"], FileSegment)
    runner = create_autospec(WorkflowBasedAppRunner, instance=True)
    WorkflowBasedAppRunner.handle_event(
        runner, WorkflowEntry({}, Graph(root_node=node), 0, node.runtime_state), graph_events[1]
    )
    queue_event = runner._publish_event.call_args.args[0]
    assert isinstance(queue_event.submitted_data["attachment"], FileSegment)
    assert isinstance(queue_event.submitted_data["files"], ArrayFileSegment)
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
    )
    response = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")
    assert response.data.submitted_data is not None
    assert response.data.submitted_data["attachment"]["filename"] == "review.pdf"
    assert response.data.submitted_data["files"][0]["filename"] == "review.pdf"


def test_filled_rendering_does_not_reinterpret_submission_as_a_template(form: Form) -> None:
    form = submit(form)
    assert form.submission is not None
    values = dict(form.submission.normalized_submission_data)
    values["answer"] = StringSegment(value="{{#$output.files#}}")
    node, _ = build_node(replace(form, submission=replace(form.submission, normalized_submission_data=values)))
    filled = list(node.run())[1]
    assert isinstance(filled, NodeRunHumanInputFormFilledEvent)
    assert filled.rendered_content == "Answer: {{#$output.files#}}; files: [0 files]"


def test_filled_rendering_skips_missing_and_null_inputs_and_preserves_select_text(form: Form) -> None:
    form = submit(form)
    assert form.submission is not None
    form = replace(
        form,
        resolved_form=form.resolved_form.model_copy(
            update={
                "parts": (
                    MarkdownFragment(text="Before "),
                    ParagraphInput(output_variable_name="missing", default_value="unused"),
                    ParagraphInput(output_variable_name="null", default_value=None),
                    SelectInput(output_variable_name="choice", options=("Yes", "No"), default_value=None),
                    MarkdownFragment(text=" after"),
                )
            }
        ),
        submission=replace(
            form.submission,
            normalized_submission_data={"null": NoneSegment(), "choice": StringSegment(value="Yes")},
        ),
    )

    node, _ = build_node(form)
    events = list(node.run())

    assert isinstance(events[1], NodeRunHumanInputFormFilledEvent)
    assert isinstance(events[2], NodeRunSucceededEvent)
    assert events[1].rendered_content == "Before Yes after"
    assert events[2].node_run_result.outputs["__rendered_content"].text == "Before Yes after"


def test_waiting_projection_freezes_select_options_and_deduplicates_slots(form: Form) -> None:
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


def test_debug_dependencies_include_all_sources_and_complete_nested_paths(form: Form) -> None:
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
def test_node_emits_form_outcome_before_completion(form: Form, status: HumanInputFormStatus) -> None:
    form = submit(form) if status == HumanInputFormStatus.SUBMITTED else replace(form, status=status)
    node, _ = build_node(form)
    events = list(node.run())
    expected = (
        NodeRunHumanInputFormFilledEvent
        if status == HumanInputFormStatus.SUBMITTED
        else NodeRunHumanInputFormTimeoutEvent
    )
    assert isinstance(events[1], expected)
    assert isinstance(events[2], NodeRunSucceededEvent)


def test_button_only_submission_completes_without_input_fields(form: Form) -> None:
    form = submit(form)
    assert form.submission is not None
    form = replace(
        form,
        resolved_form=form.resolved_form.model_copy(update={"parts": (MarkdownFragment(text="Approve this"),)}),
        submission=replace(form.submission, raw_submission_inputs={}, normalized_submission_data={}),
    )
    node, _ = build_node(form)
    events = list(node.run())
    assert isinstance(events[1], NodeRunHumanInputFormFilledEvent)
    assert isinstance(events[2], NodeRunSucceededEvent)
    assert events[1].submitted_data == {}
    assert events[1].rendered_content == "Approve this"
    assert events[2].node_run_result.edge_source_handle == "approve"
