import datetime
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.node_runtime import DifyHumanInputNodeRuntime
from core.workflow.system_variables import default_system_variables
from graphon.entities import GraphInitParams
from graphon.enums import BuiltinNodeTypes
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph_events import (
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunStartedEvent,
)
from graphon.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    HumanInputNodeData,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
)
from graphon.nodes.human_input.enums import HumanInputFormStatus
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.protocols import FileReferenceFactoryProtocol
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now


class _FakeFormRepository:
    def __init__(self, form):
        self._form = form

    def get_form(self, *_args, **_kwargs):
        return self._form


class _TestFileReferenceFactory(FileReferenceFactoryProtocol):
    def build_from_mapping(self, *, mapping: Mapping[str, Any]):
        return File(
            file_id=mapping.get("id"),
            file_type=FileType(mapping["type"]),
            transfer_method=FileTransferMethod(mapping["transfer_method"]),
            remote_url=mapping.get("remote_url") or mapping.get("url"),
            related_id=mapping.get("related_id") or mapping.get("upload_file_id"),
            filename=mapping.get("filename"),
            extension=mapping.get("extension"),
            mime_type=mapping.get("mime_type"),
            size=mapping.get("size", -1),
        )


def _create_human_input_node(
    *,
    config: dict,
    graph_init_params: GraphInitParams,
    graph_runtime_state: GraphRuntimeState,
    repo: _FakeFormRepository,
) -> HumanInputNode:
    node_data = (
        config["data"]
        if isinstance(config["data"], HumanInputNodeData)
        else HumanInputNodeData.model_validate(config["data"])
    )
    runtime = DifyHumanInputNodeRuntime(graph_init_params.run_context)
    runtime._file_reference_factory = _TestFileReferenceFactory()  # type: ignore[attr-defined]
    return HumanInputNode(
        node_id=config["id"],
        data=node_data,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        form_repository=repo,
        file_reference_factory=_TestFileReferenceFactory(),
        runtime=runtime,
    )


def _build_node(
    form_content: str = (
        "Please enter your name:\n\n{{#$output.name#}}\n"
        "Decision: {{#$output.decision#}}\n"
        "Attachment: {{#$output.attachment#}}\n"
        "Attachments: {{#$output.attachments#}}"
    ),
) -> HumanInputNode:
    system_variables = default_system_variables()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(
            system_variables=system_variables,
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    config = {
        "id": "node-1",
        "type": BuiltinNodeTypes.HUMAN_INPUT,
        "data": {
            "title": "Human Input",
            "form_content": form_content,
            "inputs": [
                ParagraphInputConfig(output_variable_name="name").model_dump(mode="json"),
                SelectInputConfig(
                    output_variable_name="decision",
                    option_source=StringListSource(type="constant", value=["approve", "reject"]),
                ).model_dump(mode="json"),
                FileInputConfig(output_variable_name="attachment").model_dump(mode="json"),
                FileListInputConfig(output_variable_name="attachments", number_limits=2).model_dump(mode="json"),
            ],
            "user_actions": [UserActionConfig(id="Accept", title="Approve").model_dump(mode="json")],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content=form_content,
        submitted=True,
        selected_action_id="Accept",
        submitted_data={
            "name": "Alice",
            "decision": "approve",
            "attachment": {
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": "https://example.com/resume.pdf",
                "filename": "resume.pdf",
                "extension": ".pdf",
                "mime_type": "application/pdf",
            },
            "attachments": [
                {
                    "type": "image",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/a.png",
                    "filename": "a.png",
                    "extension": ".png",
                    "mime_type": "image/png",
                }
            ],
        },
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=naive_utc_now() + datetime.timedelta(days=1),
    )

    repo = _FakeFormRepository(fake_form)
    return _create_human_input_node(
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        repo=repo,
    )


def _build_timeout_node() -> HumanInputNode:
    system_variables = default_system_variables()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(
            system_variables=system_variables,
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    config = {
        "id": "node-1",
        "type": BuiltinNodeTypes.HUMAN_INPUT,
        "data": {
            "title": "Human Input",
            "form_content": "Please enter your name:\n\n{{#$output.name#}}",
            "inputs": [ParagraphInputConfig(output_variable_name="name").model_dump(mode="json")],
            "user_actions": [UserActionConfig(id="Accept", title="Approve").model_dump(mode="json")],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content="content",
        submitted=False,
        selected_action_id=None,
        submitted_data=None,
        status=HumanInputFormStatus.TIMEOUT,
        expiration_time=naive_utc_now() - datetime.timedelta(minutes=1),
    )

    repo = _FakeFormRepository(fake_form)
    return _create_human_input_node(
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        repo=repo,
    )


def test_human_input_node_emits_form_filled_event_before_succeeded():
    node = _build_node()

    events = list(node.run())

    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunHumanInputFormFilledEvent)

    filled_event = events[1]
    assert filled_event.node_title == "Human Input"
    assert filled_event.rendered_content == (
        "Please enter your name:\n\nAlice\nDecision: approve\nAttachment: [file]\nAttachments: [1 files]"
    )
    assert filled_event.action_id == "Accept"
    assert filled_event.action_text == "Approve"
    assert filled_event.submitted_data["name"] == StringSegment(value="Alice")
    assert filled_event.submitted_data["decision"] == StringSegment(value="approve")
    assert isinstance(filled_event.submitted_data["attachment"], FileSegment)
    assert filled_event.submitted_data["attachment"].value_type == SegmentType.FILE
    assert filled_event.submitted_data["attachment"].value.filename == "resume.pdf"
    assert filled_event.submitted_data["attachment"].value.type == FileType.DOCUMENT
    assert filled_event.submitted_data["attachment"].value.transfer_method == FileTransferMethod.REMOTE_URL
    assert isinstance(filled_event.submitted_data["attachments"], ArrayFileSegment)
    assert filled_event.submitted_data["attachments"].value_type == SegmentType.ARRAY_FILE
    assert filled_event.submitted_data["attachments"].value[0].filename == "a.png"
    assert filled_event.submitted_data["attachments"].value[0].type == FileType.IMAGE


def test_human_input_node_emits_timeout_event_before_succeeded():
    node = _build_timeout_node()

    events = list(node.run())

    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunHumanInputFormTimeoutEvent)

    timeout_event = events[1]
    assert timeout_event.node_title == "Human Input"
