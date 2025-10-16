import time

from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input import HumanInputNode
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeData,
    ModelConfig,
    VisionConfig,
)
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable

from .test_mock_config import MockConfig
from .test_mock_nodes import MockLLMNode
from .test_table_runner import TableTestRunner, WorkflowTestCase


def _build_llm_human_llm_graph(mock_config: MockConfig) -> tuple[Graph, GraphRuntimeState]:
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

    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="user", app_id="app", workflow_id="workflow"),
        user_inputs={},
        conversation_variables=[],
    )
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    start_config = {"id": "start", "data": StartNodeData(title="Start", variables=[]).model_dump()}
    start_node = StartNode(
        id=start_config["id"],
        config=start_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    start_node.init_node_data(start_config["data"])

    def _create_llm_node(node_id: str, title: str, prompt_text: str) -> MockLLMNode:
        llm_data = LLMNodeData(
            title=title,
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
            prompt_template=[
                LLMNodeChatModelMessage(
                    text=prompt_text,
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                )
            ],
            context=ContextConfig(enabled=False, variable_selector=None),
            vision=VisionConfig(enabled=False),
            reasoning_format="tagged",
        )
        llm_config = {"id": node_id, "data": llm_data.model_dump()}
        llm_node = MockLLMNode(
            id=node_id,
            config=llm_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        llm_node.init_node_data(llm_config["data"])
        return llm_node

    llm_first = _create_llm_node("llm_initial", "Initial LLM", "Initial prompt")

    human_data = HumanInputNodeData(
        title="Human Input",
        required_variables=["human.input_ready"],
        pause_reason="Awaiting human input",
    )
    human_config = {"id": "human", "data": human_data.model_dump()}
    human_node = HumanInputNode(
        id=human_config["id"],
        config=human_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    human_node.init_node_data(human_config["data"])

    llm_second = _create_llm_node("llm_resume", "Follow-up LLM", "Follow-up prompt")

    end_data = EndNodeData(
        title="End",
        outputs=[
            VariableSelector(variable="initial_text", value_selector=["llm_initial", "text"]),
            VariableSelector(variable="resume_text", value_selector=["llm_resume", "text"]),
        ],
        desc=None,
    )
    end_config = {"id": "end", "data": end_data.model_dump()}
    end_node = EndNode(
        id=end_config["id"],
        config=end_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    end_node.init_node_data(end_config["data"])

    graph = (
        Graph.new()
        .add_root(start_node)
        .add_node(llm_first)
        .add_node(human_node)
        .add_node(llm_second)
        .add_node(end_node)
        .build()
    )
    return graph, graph_runtime_state


def _expected_mock_llm_chunks(text: str) -> list[str]:
    chunks: list[str] = []
    for index, word in enumerate(text.split(" ")):
        chunk = word if index == 0 else f" {word}"
        chunks.append(chunk)
    chunks.append("")
    return chunks


def test_human_input_llm_streaming_order_across_pause() -> None:
    runner = TableTestRunner()

    initial_text = "Hello, pause"
    resume_text = "Welcome back!"

    mock_config = MockConfig()
    mock_config.set_node_outputs("llm_initial", {"text": initial_text})
    mock_config.set_node_outputs("llm_resume", {"text": resume_text})

    expected_initial_sequence: list[type] = [
        GraphRunStartedEvent,  # graph run begins
        NodeRunStartedEvent,  # start node begins
        NodeRunSucceededEvent,  # start node completes
        NodeRunStartedEvent,  # llm_initial begins streaming
        NodeRunSucceededEvent,  # llm_initial completes streaming
        NodeRunStartedEvent,  # human node begins and requests pause
        NodeRunPauseRequestedEvent,  # human node pause requested
        GraphRunPausedEvent,  # graph run pauses awaiting resume
    ]

    def graph_factory() -> tuple[Graph, GraphRuntimeState]:
        return _build_llm_human_llm_graph(mock_config)

    initial_case = WorkflowTestCase(
        description="HumanInput pause preserves LLM streaming order",
        graph_factory=graph_factory,
        expected_event_sequence=expected_initial_sequence,
    )

    initial_result = runner.run_test_case(initial_case)

    assert initial_result.success, initial_result.event_mismatch_details

    initial_events = initial_result.events
    initial_chunks = _expected_mock_llm_chunks(initial_text)

    initial_stream_chunk_events = [event for event in initial_events if isinstance(event, NodeRunStreamChunkEvent)]
    assert initial_stream_chunk_events == []

    pause_index = next(i for i, event in enumerate(initial_events) if isinstance(event, GraphRunPausedEvent))
    llm_succeeded_index = next(
        i
        for i, event in enumerate(initial_events)
        if isinstance(event, NodeRunSucceededEvent) and event.node_id == "llm_initial"
    )
    assert llm_succeeded_index < pause_index

    graph_runtime_state = initial_result.graph_runtime_state
    graph = initial_result.graph
    assert graph_runtime_state is not None
    assert graph is not None

    coordinator = graph_runtime_state.response_coordinator
    stream_buffers = coordinator._stream_buffers  # Tests may access internals for assertions
    assert ("llm_initial", "text") in stream_buffers
    initial_stream_chunks = [event.chunk for event in stream_buffers[("llm_initial", "text")]]
    assert initial_stream_chunks == initial_chunks
    assert ("llm_resume", "text") not in stream_buffers

    resume_chunks = _expected_mock_llm_chunks(resume_text)
    expected_resume_sequence: list[type] = [
        GraphRunStartedEvent,  # resumed graph run begins
        NodeRunStartedEvent,  # human node restarts
        NodeRunStreamChunkEvent,  # cached llm_initial chunk 1
        NodeRunStreamChunkEvent,  # cached llm_initial chunk 2
        NodeRunStreamChunkEvent,  # cached llm_initial final chunk
        NodeRunStreamChunkEvent,  # end node emits combined template separator
        NodeRunSucceededEvent,  # human node finishes instantly after input
        NodeRunStartedEvent,  # llm_resume begins streaming
        NodeRunStreamChunkEvent,  # llm_resume chunk 1
        NodeRunStreamChunkEvent,  # llm_resume chunk 2
        NodeRunStreamChunkEvent,  # llm_resume final chunk
        NodeRunSucceededEvent,  # llm_resume completes streaming
        NodeRunStartedEvent,  # end node starts
        NodeRunSucceededEvent,  # end node finishes
        GraphRunSucceededEvent,  # graph run succeeds after resume
    ]

    def resume_graph_factory() -> tuple[Graph, GraphRuntimeState]:
        assert graph_runtime_state is not None
        assert graph is not None
        graph_runtime_state.variable_pool.add(("human", "input_ready"), True)
        graph_runtime_state.graph_execution.pause_reason = None
        return graph, graph_runtime_state

    resume_case = WorkflowTestCase(
        description="HumanInput resume continues LLM streaming order",
        graph_factory=resume_graph_factory,
        expected_event_sequence=expected_resume_sequence,
    )

    resume_result = runner.run_test_case(resume_case)

    assert resume_result.success, resume_result.event_mismatch_details

    resume_events = resume_result.events

    success_index = next(i for i, event in enumerate(resume_events) if isinstance(event, GraphRunSucceededEvent))
    llm_resume_succeeded_index = next(
        i
        for i, event in enumerate(resume_events)
        if isinstance(event, NodeRunSucceededEvent) and event.node_id == "llm_resume"
    )
    assert llm_resume_succeeded_index < success_index

    resume_chunk_events = [event for event in resume_events if isinstance(event, NodeRunStreamChunkEvent)]
    assert [event.node_id for event in resume_chunk_events[:3]] == ["llm_initial"] * 3
    assert [event.chunk for event in resume_chunk_events[:3]] == initial_chunks
    assert resume_chunk_events[3].node_id == "end"
    assert resume_chunk_events[3].chunk == "\n"
    assert [event.node_id for event in resume_chunk_events[4:]] == ["llm_resume"] * 3
    assert [event.chunk for event in resume_chunk_events[4:]] == resume_chunks

    human_success_index = next(
        i
        for i, event in enumerate(resume_events)
        if isinstance(event, NodeRunSucceededEvent) and event.node_id == "human"
    )
    cached_chunk_indices = [
        i
        for i, event in enumerate(resume_events)
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id in {"llm_initial", "end"}
    ]
    assert all(index < human_success_index for index in cached_chunk_indices)

    llm_resume_start_index = next(
        i
        for i, event in enumerate(resume_events)
        if isinstance(event, NodeRunStartedEvent) and event.node_id == "llm_resume"
    )
    llm_resume_success_index = next(
        i
        for i, event in enumerate(resume_events)
        if isinstance(event, NodeRunSucceededEvent) and event.node_id == "llm_resume"
    )
    llm_resume_chunk_indices = [
        i
        for i, event in enumerate(resume_events)
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "llm_resume"
    ]
    assert llm_resume_chunk_indices
    first_resume_chunk_index = min(llm_resume_chunk_indices)
    last_resume_chunk_index = max(llm_resume_chunk_indices)
    assert llm_resume_start_index < first_resume_chunk_index
    assert last_resume_chunk_index < llm_resume_success_index

    started_nodes = [event.node_id for event in resume_events if isinstance(event, NodeRunStartedEvent)]
    assert started_nodes == ["human", "llm_resume", "end"]
