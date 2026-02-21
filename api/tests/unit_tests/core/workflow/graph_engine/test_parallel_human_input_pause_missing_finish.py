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
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
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
    def __init__(self, forms_by_node_id: Mapping[str, HumanInputFormEntity]) -> None:
        self._forms_by_node_id = dict(forms_by_node_id)

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        return self._forms_by_node_id.get(node_id)

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        raise AssertionError("create_form should not be called in resume scenario")


class DelayedHumanInputNode(HumanInputNode):
    def __init__(self, delay_seconds: float, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._delay_seconds = delay_seconds

    def _run(self):
        if self._delay_seconds > 0:
            time.sleep(self._delay_seconds)
        yield from super()._run()


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
    human_b = DelayedHumanInputNode(
        id=human_b_config["id"],
        config=human_b_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        form_repository=repo,
        delay_seconds=0.2,
    )

    llm_data = LLMNodeData(
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
    llm_config = {"id": "llm_a", "data": llm_data.model_dump()}
    llm_a = MockLLMNode(
        id=llm_config["id"],
        config=llm_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        mock_config=mock_config,
    )

    return (
        Graph.new()
        .add_root(start_node)
        .add_node(human_a, from_node_id="start")
        .add_node(human_b, from_node_id="start")
        .add_node(llm_a, from_node_id="human_a", source_handle="approve")
        .build()
    )


def test_parallel_human_input_pause_preserves_node_finished() -> None:
    runtime_state = _build_runtime_state()

    runtime_state.graph_execution.start()
    runtime_state.register_paused_node("human_a")
    runtime_state.register_paused_node("human_b")

    submitted = StaticForm(
        form_id="form-a",
        rendered="rendered",
        is_submitted=True,
        action_id="approve",
        data={},
        status_value=HumanInputFormStatus.SUBMITTED,
    )
    pending = StaticForm(
        form_id="form-b",
        rendered="rendered",
        is_submitted=False,
        action_id=None,
        data=None,
        status_value=HumanInputFormStatus.WAITING,
    )
    repo = StaticRepo({"human_a": submitted, "human_b": pending})

    mock_config = MockConfig()
    mock_config.simulate_delays = True
    mock_config.set_node_config(
        "llm_a",
        NodeMockConfig(node_id="llm_a", outputs={"text": "LLM A output"}, delay=0.5),
    )

    graph = _build_graph(runtime_state, repo, mock_config)
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

    events = list(engine.run())

    llm_started = any(isinstance(e, NodeRunStartedEvent) and e.node_id == "llm_a" for e in events)
    llm_succeeded = any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "llm_a" for e in events)
    human_b_pause = any(isinstance(e, NodeRunPauseRequestedEvent) and e.node_id == "human_b" for e in events)
    graph_paused = any(isinstance(e, GraphRunPausedEvent) for e in events)
    graph_started = any(isinstance(e, GraphRunStartedEvent) for e in events)

    assert graph_started
    assert graph_paused
    assert human_b_pause
    assert llm_started
    assert llm_succeeded


def test_parallel_human_input_pause_preserves_node_finished_after_snapshot_resume() -> None:
    base_state = _build_runtime_state()
    base_state.graph_execution.start()
    base_state.register_paused_node("human_a")
    base_state.register_paused_node("human_b")
    snapshot = base_state.dumps()

    resumed_state = GraphRuntimeState.from_snapshot(snapshot)

    submitted = StaticForm(
        form_id="form-a",
        rendered="rendered",
        is_submitted=True,
        action_id="approve",
        data={},
        status_value=HumanInputFormStatus.SUBMITTED,
    )
    pending = StaticForm(
        form_id="form-b",
        rendered="rendered",
        is_submitted=False,
        action_id=None,
        data=None,
        status_value=HumanInputFormStatus.WAITING,
    )
    repo = StaticRepo({"human_a": submitted, "human_b": pending})

    mock_config = MockConfig()
    mock_config.simulate_delays = True
    mock_config.set_node_config(
        "llm_a",
        NodeMockConfig(node_id="llm_a", outputs={"text": "LLM A output"}, delay=0.5),
    )

    graph = _build_graph(resumed_state, repo, mock_config)
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=resumed_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(
            min_workers=2,
            max_workers=2,
            scale_up_threshold=1,
            scale_down_idle_time=30.0,
        ),
    )

    events = list(engine.run())

    start_event = next(e for e in events if isinstance(e, GraphRunStartedEvent))
    assert start_event.reason is WorkflowStartReason.RESUMPTION

    llm_started = any(isinstance(e, NodeRunStartedEvent) and e.node_id == "llm_a" for e in events)
    llm_succeeded = any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "llm_a" for e in events)
    human_b_pause = any(isinstance(e, NodeRunPauseRequestedEvent) and e.node_id == "human_b" for e in events)
    graph_paused = any(isinstance(e, GraphRunPausedEvent) for e in events)

    assert graph_paused
    assert human_b_pause
    assert llm_started
    assert llm_succeeded
