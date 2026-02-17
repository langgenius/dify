import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from core.workflow.entities import GraphInitParams
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_engine.config import GraphEngineConfig
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.graph_events import (
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.base.entities import OutputVariableEntity
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserAction
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.repositories.human_input_form_repository import (
    FormCreateParams,
    HumanInputFormEntity,
    HumanInputFormRepository,
)
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from libs.datetime_utils import naive_utc_now


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


@dataclass
class StaticForm(HumanInputFormEntity):
    form_id: str
    rendered: str
    is_submitted: bool
    action_id: str | None = None
    data: Mapping[str, Any] | None = None
    status_value: HumanInputFormStatus = HumanInputFormStatus.WAITING
    expiration: datetime = naive_utc_now() + timedelta(days=1)

    @property
    def id(self) -> str:
        return self.form_id

    @property
    def web_app_token(self) -> str | None:
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

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        return self._forms_by_node_id.get(node_id)

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        raise AssertionError("create_form should not be called in resume scenario")


def _build_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable(
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
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    start_config = {"id": "start", "data": StartNodeData(title="Start", variables=[]).model_dump()}
    start_node = StartNode(
        id=start_config["id"],
        config=start_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    human_data = HumanInputNodeData(
        title="Human Input",
        form_content="Human input required",
        inputs=[],
        user_actions=[UserAction(id="approve", title="Approve")],
    )

    human_a_config = {"id": "human_a", "data": human_data.model_dump()}
    human_a = HumanInputNode(
        id=human_a_config["id"],
        config=human_a_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        form_repository=repo,
    )

    human_b_config = {"id": "human_b", "data": human_data.model_dump()}
    human_b = HumanInputNode(
        id=human_b_config["id"],
        config=human_b_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        form_repository=repo,
    )

    end_data = EndNodeData(
        title="End",
        outputs=[
            OutputVariableEntity(variable="res_a", value_selector=["human_a", "__action_id"]),
            OutputVariableEntity(variable="res_b", value_selector=["human_b", "__action_id"]),
        ],
        desc=None,
    )
    end_config = {"id": "end", "data": end_data.model_dump()}
    end_node = EndNode(
        id=end_config["id"],
        config=end_config,
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


def _form(submitted: bool, action_id: str | None) -> StaticForm:
    return StaticForm(
        form_id="form",
        rendered="rendered",
        is_submitted=submitted,
        action_id=action_id,
        data={},
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
            "human_a": _form(submitted=True, action_id="approve"),
            "human_b": _form(submitted=False, action_id=None),
        }
    )
    first_resume_graph = _build_graph(first_resume_state, first_resume_repo)
    first_resume_events = _run_graph(first_resume_graph, first_resume_state)

    assert isinstance(first_resume_events[0], GraphRunStartedEvent)
    assert first_resume_events[0].reason is WorkflowStartReason.RESUMPTION
    assert isinstance(first_resume_events[-1], GraphRunPausedEvent)
    pause_store.save(first_resume_state)

    second_resume_state = pause_store.load()
    second_resume_repo = StaticRepo(
        {
            "human_a": _form(submitted=True, action_id="approve"),
            "human_b": _form(submitted=True, action_id="approve"),
        }
    )
    second_resume_graph = _build_graph(second_resume_state, second_resume_repo)
    second_resume_events = _run_graph(second_resume_graph, second_resume_state)

    assert isinstance(second_resume_events[0], GraphRunStartedEvent)
    assert second_resume_events[0].reason is WorkflowStartReason.RESUMPTION
    assert isinstance(second_resume_events[-1], GraphRunSucceededEvent)
    assert any(isinstance(event, NodeRunSucceededEvent) and event.node_id == "end" for event in second_resume_events)
