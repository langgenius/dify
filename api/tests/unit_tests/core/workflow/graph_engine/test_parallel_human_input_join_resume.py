import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from core.repositories.human_input_repository import (
    FormCreateParams,
    HumanInputFormEntity,
    HumanInputFormRepository,
)
from core.workflow.node_runtime import DifyHumanInputNodeRuntime
from core.workflow.nodes.human_input.callback import (
    DifyHITLCallback,
    render_form_content_before_submission,
    resolve_default_values,
)
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    HumanInputNodeData,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import HumanInputFormStatus, ValueSourceType
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import (
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from graphon.nodes.base.entities import OutputVariableEntity
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from tests.workflow_test_utils import build_test_graph_init_params


class PauseStateStore(Protocol):
    def save(self, runtime_state: GraphRuntimeState) -> None: ...

    def load(self) -> GraphRuntimeState: ...


class InMemoryPauseStore:
    def __init__(self) -> None:
        self._snapshot: str | None = None

    def save(self, runtime_state: GraphRuntimeState) -> None:
        self._snapshot = runtime_state.dumps()

    def load(self) -> GraphRuntimeState:
        assert self._snapshot is not None
        return GraphRuntimeState.from_snapshot(self._snapshot)


class _TestFileReferenceFactory:
    def build_from_mapping(self, *, mapping: Mapping[str, Any]) -> File:
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


@dataclass
class StaticForm(HumanInputFormEntity):
    form_id: str
    rendered: str
    is_submitted: bool
    action_id: str | None = None
    data: Mapping[str, Any] | None = None
    status_value: HumanInputFormStatus = HumanInputFormStatus.WAITING
    created: datetime = naive_utc_now()
    expiration: datetime = naive_utc_now() + timedelta(days=1)

    @property
    def id(self) -> str:
        return self.form_id

    @property
    def submission_token(self) -> str | None:
        return "token"

    @property
    def recipients(self) -> list:
        return []

    @property
    def rendered_content(self) -> str:
        return self.rendered

    @property
    def selected_action_id(self) -> str | None:
        return self.action_id

    @property
    def created_at(self) -> datetime:
        return self.created

    @property
    def submitted_data(self) -> Mapping[str, Any] | None:
        return self.data

    @property
    def submitted(self) -> bool:
        return self.is_submitted

    @property
    def status(self) -> HumanInputFormStatus:
        return self.status_value

    @property
    def expiration_time(self) -> datetime:
        return self.expiration


class StaticRepo(HumanInputFormRepository):
    def __init__(self, forms_by_node_id: Mapping[str, HumanInputFormEntity]) -> None:
        self._forms_by_node_id = dict(forms_by_node_id)

    def get_form(self, node_id: str) -> HumanInputFormEntity | None:
        return self._forms_by_node_id.get(node_id)

    def set_forms(self, forms_by_node_id: Mapping[str, HumanInputFormEntity]) -> None:
        self._forms_by_node_id = dict(forms_by_node_id)

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        raise AssertionError("create_form should not be called in resume scenario")


def _build_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            user_id="user",
            app_id="app",
            workflow_id="workflow",
            workflow_execution_id="exec-1",
        ),
        user_inputs={},
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _build_graph(runtime_state: GraphRuntimeState, repo: HumanInputFormRepository) -> Graph:
    graph_config: dict[str, object] = {"nodes": [], "edges": []}
    graph_init_params = build_test_graph_init_params(
        workflow_id="workflow",
        graph_config=graph_config,
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    start_config = {"id": "start", "data": StartNodeData(title="Start", variables=[]).model_dump()}
    start_node = StartNode(
        node_id=start_config["id"],
        data=StartNodeData(title="Start", variables=[]),
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    human_data = HumanInputNodeData(
        title="Human Input",
        form_content="Human input required",
        inputs=[
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(type=ValueSourceType.CONSTANT, value=["approve", "reject"]),
            ),
            FileInputConfig(output_variable_name="attachment"),
            FileListInputConfig(output_variable_name="attachments", number_limits=2),
        ],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )

    human_a_config = {"id": "human_a", "data": human_data.model_dump()}
    human_a_runtime = DifyHumanInputNodeRuntime(graph_init_params.run_context)
    human_a_runtime._file_reference_factory = _TestFileReferenceFactory()  # type: ignore[attr-defined]
    human_a_callback = DifyHITLCallback(
        form_repository=repo,
        node_data=human_data,
        rendered_content=lambda ctx: render_form_content_before_submission(human_data, ctx=ctx),
        resolved_default_values=lambda ctx: resolve_default_values(human_data, ctx=ctx),
        file_reference_factory=_TestFileReferenceFactory(),
    )
    human_a = HumanInputNode(
        node_id=human_a_config["id"],
        data=human_data,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        hitl_callback=human_a_callback,
    )

    human_b_config = {"id": "human_b", "data": human_data.model_dump()}
    human_b_runtime = DifyHumanInputNodeRuntime(graph_init_params.run_context)
    human_b_runtime._file_reference_factory = _TestFileReferenceFactory()  # type: ignore[attr-defined]
    human_b_callback = DifyHITLCallback(
        form_repository=repo,
        node_data=human_data,
        rendered_content=lambda ctx: render_form_content_before_submission(human_data, ctx=ctx),
        resolved_default_values=lambda ctx: resolve_default_values(human_data, ctx=ctx),
        file_reference_factory=_TestFileReferenceFactory(),
    )
    human_b = HumanInputNode(
        node_id=human_b_config["id"],
        data=human_data,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        hitl_callback=human_b_callback,
    )

    end_data = EndNodeData(
        title="End",
        outputs=[
            OutputVariableEntity(variable="res_a_action", value_selector=["human_a", "__action_id"]),
            OutputVariableEntity(variable="res_a_decision", value_selector=["human_a", "decision"]),
            OutputVariableEntity(variable="res_a_attachment", value_selector=["human_a", "attachment"]),
            OutputVariableEntity(variable="res_b_action", value_selector=["human_b", "__action_id"]),
            OutputVariableEntity(variable="res_b_decision", value_selector=["human_b", "decision"]),
            OutputVariableEntity(variable="res_b_attachments", value_selector=["human_b", "attachments"]),
        ],
        desc=None,
    )
    end_config = {"id": "end", "data": end_data.model_dump()}
    end_node = EndNode(
        node_id=end_config["id"],
        data=end_data,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    builder = (
        Graph.new()
        .add_root(start_node)
        .add_node(human_a, from_node_id="start")
        .add_node(human_b, from_node_id="start")
        .add_node(end_node, from_node_id="human_a", source_handle="approve")
    )
    return builder.connect(tail="human_b", head="end", source_handle="approve").build()


def _run_graph(graph: Graph, runtime_state: GraphRuntimeState) -> list[object]:
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(
            min_workers=2,
            max_workers=2,
            scale_up_threshold=1,
            scale_down_idle_time=30.0,
        ),
    )
    return list(engine.run())


def _form(submitted: bool, action_id: str | None, data: Mapping[str, Any] | None = None) -> StaticForm:
    return StaticForm(
        form_id="form",
        rendered="rendered",
        is_submitted=submitted,
        action_id=action_id,
        data=data,
        status_value=HumanInputFormStatus.SUBMITTED if submitted else HumanInputFormStatus.WAITING,
    )


def test_parallel_human_input_join_completes_after_second_resume() -> None:
    pause_store: PauseStateStore = InMemoryPauseStore()

    initial_state = _build_runtime_state()
    initial_repo = StaticRepo(
        {
            "human_a": _form(submitted=False, action_id=None),
            "human_b": _form(submitted=False, action_id=None),
        }
    )
    initial_graph = _build_graph(initial_state, initial_repo)
    initial_events = _run_graph(initial_graph, initial_state)

    assert isinstance(initial_events[-1], GraphRunPausedEvent)
    pause_store.save(initial_state)

    first_resume_state = pause_store.load()
    first_resume_repo = StaticRepo(
        {
            "human_a": _form(
                submitted=True,
                action_id="approve",
                data={
                    "decision": "approve",
                    "attachment": {
                        "type": "document",
                        "transfer_method": "remote_url",
                        "remote_url": "https://example.com/resume.pdf",
                        "filename": "resume.pdf",
                        "extension": ".pdf",
                        "mime_type": "application/pdf",
                    },
                },
            ),
            "human_b": _form(submitted=False, action_id=None),
        }
    )
    first_resume_graph = _build_graph(first_resume_state, first_resume_repo)
    first_resume_events = _run_graph(first_resume_graph, first_resume_state)

    assert isinstance(first_resume_events[0], GraphRunStartedEvent)
    assert first_resume_events[0].reason is WorkflowStartReason.RESUMPTION
    assert isinstance(first_resume_events[-1], GraphRunPausedEvent)
    second_resume_state = first_resume_state
    first_resume_repo.set_forms(
        {
            "human_a": _form(
                submitted=True,
                action_id="approve",
                data={
                    "decision": "approve",
                    "attachment": {
                        "type": "document",
                        "transfer_method": "remote_url",
                        "remote_url": "https://example.com/resume.pdf",
                        "filename": "resume.pdf",
                        "extension": ".pdf",
                        "mime_type": "application/pdf",
                    },
                },
            ),
            "human_b": _form(
                submitted=True,
                action_id="approve",
                data={
                    "decision": "reject",
                    "attachments": [
                        {
                            "type": "image",
                            "transfer_method": "remote_url",
                            "remote_url": "https://example.com/a.png",
                            "filename": "a.png",
                            "extension": ".png",
                            "mime_type": "image/png",
                        },
                        {
                            "type": "image",
                            "transfer_method": "remote_url",
                            "remote_url": "https://example.com/b.png",
                            "filename": "b.png",
                            "extension": ".png",
                            "mime_type": "image/png",
                        },
                    ],
                },
            ),
        }
    )
    second_resume_events = _run_graph(first_resume_graph, second_resume_state)

    assert isinstance(second_resume_events[0], GraphRunStartedEvent)
    assert second_resume_events[0].reason is WorkflowStartReason.RESUMPTION
    assert isinstance(second_resume_events[-1], GraphRunSucceededEvent)
    assert any(isinstance(event, NodeRunSucceededEvent) and event.node_id == "end" for event in second_resume_events)
    second_resume_outputs = second_resume_state.outputs
    assert second_resume_outputs["res_a_action"] == "approve"
    assert second_resume_outputs["res_a_decision"] == "approve"
    assert isinstance(second_resume_outputs["res_a_attachment"], File)
    res_a_attachment_in_second_outputs = second_resume_outputs["res_a_attachment"]
    assert isinstance(res_a_attachment_in_second_outputs, File)
    assert res_a_attachment_in_second_outputs.filename == "resume.pdf"
    assert res_a_attachment_in_second_outputs.type == FileType.DOCUMENT
    assert res_a_attachment_in_second_outputs.transfer_method == FileTransferMethod.REMOTE_URL
    assert second_resume_outputs["res_b_action"] == "approve"
    assert second_resume_outputs["res_b_decision"] == "reject"
    assert isinstance(second_resume_outputs["res_b_attachments"], list)
    assert [file.filename for file in second_resume_outputs["res_b_attachments"]] == ["a.png", "b.png"]
    assert all(file.type == FileType.IMAGE for file in second_resume_outputs["res_b_attachments"])
