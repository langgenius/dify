import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.workflow.entities import GraphInitParams
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_engine.config import GraphEngineConfig
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.graph_events import (
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserAction
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeData,
    ModelConfig,
    VisionConfig,
)
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

from .test_mock_config import MockConfig, NodeMockConfig
from .test_mock_nodes import MockLLMNode


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
    def __init__(self, form: HumanInputFormEntity) -> None:
        self._form = form

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        if node_id != "human_pause":
            return None
        return self._form

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        raise AssertionError("create_form should not be called in this test")


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


def _build_graph(runtime_state: GraphRuntimeState, repo: HumanInputFormRepository, mock_config: MockConfig) -> Graph:
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

    llm_a_data = LLMNodeData(
        title="LLM A",
        model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
        prompt_template=[
            LLMNodeChatModelMessage(
                text="Prompt A",
                role=PromptMessageRole.USER,
                edition_type="basic",
            )
        ],
        context=ContextConfig(enabled=False, variable_selector=None),
        vision=VisionConfig(enabled=False),
        reasoning_format="tagged",
        structured_output_enabled=False,
    )
    llm_a_config = {"id": "llm_a", "data": llm_a_data.model_dump()}
    llm_a = MockLLMNode(
        id=llm_a_config["id"],
        config=llm_a_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        mock_config=mock_config,
    )

    llm_b_data = LLMNodeData(
        title="LLM B",
        model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
        prompt_template=[
            LLMNodeChatModelMessage(
                text="Prompt B",
                role=PromptMessageRole.USER,
                edition_type="basic",
            )
        ],
        context=ContextConfig(enabled=False, variable_selector=None),
        vision=VisionConfig(enabled=False),
        reasoning_format="tagged",
        structured_output_enabled=False,
    )
    llm_b_config = {"id": "llm_b", "data": llm_b_data.model_dump()}
    llm_b = MockLLMNode(
        id=llm_b_config["id"],
        config=llm_b_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        mock_config=mock_config,
    )

    human_data = HumanInputNodeData(
        title="Human Input",
        form_content="Pause here",
        inputs=[],
        user_actions=[UserAction(id="approve", title="Approve")],
    )
    human_config = {"id": "human_pause", "data": human_data.model_dump()}
    human_node = HumanInputNode(
        id=human_config["id"],
        config=human_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        form_repository=repo,
    )

    end_human_data = EndNodeData(title="End Human", outputs=[], desc=None)
    end_human_config = {"id": "end_human", "data": end_human_data.model_dump()}
    end_human = EndNode(
        id=end_human_config["id"],
        config=end_human_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    return (
        Graph.new()
        .add_root(start_node)
        .add_node(llm_a, from_node_id="start")
        .add_node(human_node, from_node_id="start")
        .add_node(llm_b, from_node_id="llm_a")
        .add_node(end_human, from_node_id="human_pause", source_handle="approve")
        .build()
    )


def _get_node_started_event(events: list[object], node_id: str) -> NodeRunStartedEvent | None:
    for event in events:
        if isinstance(event, NodeRunStartedEvent) and event.node_id == node_id:
            return event
    return None


def test_pause_defers_ready_nodes_until_resume() -> None:
    runtime_state = _build_runtime_state()

    paused_form = StaticForm(
        form_id="form-pause",
        rendered="rendered",
        is_submitted=False,
        status_value=HumanInputFormStatus.WAITING,
    )
    pause_repo = StaticRepo(paused_form)

    mock_config = MockConfig()
    mock_config.simulate_delays = True
    mock_config.set_node_config(
        "llm_a",
        NodeMockConfig(node_id="llm_a", outputs={"text": "LLM A output"}, delay=0.5),
    )
    mock_config.set_node_config(
        "llm_b",
        NodeMockConfig(node_id="llm_b", outputs={"text": "LLM B output"}, delay=0.0),
    )

    graph = _build_graph(runtime_state, pause_repo, mock_config)
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

    paused_events = list(engine.run())

    assert any(isinstance(e, GraphRunPausedEvent) for e in paused_events)
    assert any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "llm_a" for e in paused_events)
    assert _get_node_started_event(paused_events, "llm_b") is None

    snapshot = runtime_state.dumps()
    resumed_state = GraphRuntimeState.from_snapshot(snapshot)

    submitted_form = StaticForm(
        form_id="form-pause",
        rendered="rendered",
        is_submitted=True,
        action_id="approve",
        data={},
        status_value=HumanInputFormStatus.SUBMITTED,
    )
    resume_repo = StaticRepo(submitted_form)

    resumed_graph = _build_graph(resumed_state, resume_repo, mock_config)
    resumed_engine = GraphEngine(
        workflow_id="workflow",
        graph=resumed_graph,
        graph_runtime_state=resumed_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(
            min_workers=2,
            max_workers=2,
            scale_up_threshold=1,
            scale_down_idle_time=30.0,
        ),
    )

    resumed_events = list(resumed_engine.run())

    start_event = next(e for e in resumed_events if isinstance(e, GraphRunStartedEvent))
    assert start_event.reason is WorkflowStartReason.RESUMPTION

    llm_b_started = _get_node_started_event(resumed_events, "llm_b")
    assert llm_b_started is not None
    assert any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "llm_b" for e in resumed_events)
