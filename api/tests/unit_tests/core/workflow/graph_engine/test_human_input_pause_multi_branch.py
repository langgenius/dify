import time
from collections.abc import Iterable

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


def _build_branching_graph(mock_config: MockConfig) -> tuple[Graph, GraphRuntimeState]:
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

    llm_initial = _create_llm_node("llm_initial", "Initial LLM", "Initial stream")

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

    llm_primary = _create_llm_node("llm_primary", "Primary LLM", "Primary stream output")
    llm_secondary = _create_llm_node("llm_secondary", "Secondary LLM", "Secondary")

    end_primary_data = EndNodeData(
        title="End Primary",
        outputs=[
            VariableSelector(variable="initial_text", value_selector=["llm_initial", "text"]),
            VariableSelector(variable="primary_text", value_selector=["llm_primary", "text"]),
        ],
        desc=None,
    )
    end_primary_config = {"id": "end_primary", "data": end_primary_data.model_dump()}
    end_primary = EndNode(
        id=end_primary_config["id"],
        config=end_primary_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    end_primary.init_node_data(end_primary_config["data"])

    end_secondary_data = EndNodeData(
        title="End Secondary",
        outputs=[
            VariableSelector(variable="initial_text", value_selector=["llm_initial", "text"]),
            VariableSelector(variable="secondary_text", value_selector=["llm_secondary", "text"]),
        ],
        desc=None,
    )
    end_secondary_config = {"id": "end_secondary", "data": end_secondary_data.model_dump()}
    end_secondary = EndNode(
        id=end_secondary_config["id"],
        config=end_secondary_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    end_secondary.init_node_data(end_secondary_config["data"])

    graph = (
        Graph.new()
        .add_root(start_node)
        .add_node(llm_initial)
        .add_node(human_node)
        .add_node(llm_primary, from_node_id="human", source_handle="primary")
        .add_node(end_primary, from_node_id="llm_primary")
        .add_node(llm_secondary, from_node_id="human", source_handle="secondary")
        .add_node(end_secondary, from_node_id="llm_secondary")
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


def _assert_stream_chunk_sequence(
    chunk_events: Iterable[NodeRunStreamChunkEvent],
    expected_nodes: list[str],
    expected_chunks: list[str],
) -> None:
    actual_nodes = [event.node_id for event in chunk_events]
    actual_chunks = [event.chunk for event in chunk_events]
    assert actual_nodes == expected_nodes
    assert actual_chunks == expected_chunks


def test_human_input_llm_streaming_across_multiple_branches() -> None:
    mock_config = MockConfig()
    mock_config.set_node_outputs("llm_initial", {"text": "Initial stream"})
    mock_config.set_node_outputs("llm_primary", {"text": "Primary stream output"})
    mock_config.set_node_outputs("llm_secondary", {"text": "Secondary"})

    branch_scenarios = [
        {
            "handle": "primary",
            "resume_llm": "llm_primary",
            "end_node": "end_primary",
            "expected_pre_chunks": [
                ("llm_initial", _expected_mock_llm_chunks("Initial stream")),  # cached output before branch completes
                ("end_primary", ["\n"]),  # literal segment emitted when end_primary session activates
            ],
            "expected_post_chunks": [
                ("llm_primary", _expected_mock_llm_chunks("Primary stream output")),  # live stream from chosen branch
            ],
        },
        {
            "handle": "secondary",
            "resume_llm": "llm_secondary",
            "end_node": "end_secondary",
            "expected_pre_chunks": [
                ("llm_initial", _expected_mock_llm_chunks("Initial stream")),  # cached output before branch completes
                ("end_secondary", ["\n"]),  # literal segment emitted when end_secondary session activates
            ],
            "expected_post_chunks": [
                ("llm_secondary", _expected_mock_llm_chunks("Secondary")),  # live stream from chosen branch
            ],
        },
    ]

    for scenario in branch_scenarios:
        runner = TableTestRunner()

        def initial_graph_factory() -> tuple[Graph, GraphRuntimeState]:
            return _build_branching_graph(mock_config)

        initial_case = WorkflowTestCase(
            description="HumanInput pause before branching decision",
            graph_factory=initial_graph_factory,
            expected_event_sequence=[
                GraphRunStartedEvent,  # initial run: graph execution starts
                NodeRunStartedEvent,  # start node begins execution
                NodeRunSucceededEvent,  # start node completes
                NodeRunStartedEvent,  # llm_initial starts streaming
                NodeRunSucceededEvent,  # llm_initial completes streaming
                NodeRunStartedEvent,  # human node begins and issues pause
                NodeRunPauseRequestedEvent,  # human node requests pause awaiting input
                GraphRunPausedEvent,  # graph run pauses awaiting resume
            ],
        )

        initial_result = runner.run_test_case(initial_case)

        assert initial_result.success, initial_result.event_mismatch_details
        assert not any(isinstance(event, NodeRunStreamChunkEvent) for event in initial_result.events)

        graph_runtime_state = initial_result.graph_runtime_state
        graph = initial_result.graph
        assert graph_runtime_state is not None
        assert graph is not None

        graph_runtime_state.variable_pool.add(("human", "input_ready"), True)
        graph_runtime_state.variable_pool.add(("human", "edge_source_handle"), scenario["handle"])
        graph_runtime_state.graph_execution.pause_reason = None

        pre_chunk_count = sum(len(chunks) for _, chunks in scenario["expected_pre_chunks"])
        post_chunk_count = sum(len(chunks) for _, chunks in scenario["expected_post_chunks"])

        expected_resume_sequence: list[type] = (
            [
                GraphRunStartedEvent,
                NodeRunStartedEvent,
            ]
            + [NodeRunStreamChunkEvent] * pre_chunk_count
            + [
                NodeRunSucceededEvent,
                NodeRunStartedEvent,
            ]
            + [NodeRunStreamChunkEvent] * post_chunk_count
            + [
                NodeRunSucceededEvent,
                NodeRunStartedEvent,
                NodeRunSucceededEvent,
                GraphRunSucceededEvent,
            ]
        )

        def resume_graph_factory(
            graph_snapshot: Graph = graph,
            state_snapshot: GraphRuntimeState = graph_runtime_state,
        ) -> tuple[Graph, GraphRuntimeState]:
            return graph_snapshot, state_snapshot

        resume_case = WorkflowTestCase(
            description=f"HumanInput resumes via {scenario['handle']} branch",
            graph_factory=resume_graph_factory,
            expected_event_sequence=expected_resume_sequence,
        )

        resume_result = runner.run_test_case(resume_case)

        assert resume_result.success, resume_result.event_mismatch_details

        resume_events = resume_result.events

        chunk_events = [event for event in resume_events if isinstance(event, NodeRunStreamChunkEvent)]
        assert len(chunk_events) == pre_chunk_count + post_chunk_count

        pre_chunk_events = chunk_events[:pre_chunk_count]
        post_chunk_events = chunk_events[pre_chunk_count:]

        expected_pre_nodes: list[str] = []
        expected_pre_chunks: list[str] = []
        for node_id, chunks in scenario["expected_pre_chunks"]:
            expected_pre_nodes.extend([node_id] * len(chunks))
            expected_pre_chunks.extend(chunks)
        _assert_stream_chunk_sequence(pre_chunk_events, expected_pre_nodes, expected_pre_chunks)

        expected_post_nodes: list[str] = []
        expected_post_chunks: list[str] = []
        for node_id, chunks in scenario["expected_post_chunks"]:
            expected_post_nodes.extend([node_id] * len(chunks))
            expected_post_chunks.extend(chunks)
        _assert_stream_chunk_sequence(post_chunk_events, expected_post_nodes, expected_post_chunks)

        human_success_index = next(
            index
            for index, event in enumerate(resume_events)
            if isinstance(event, NodeRunSucceededEvent) and event.node_id == "human"
        )
        pre_indices = [
            index
            for index, event in enumerate(resume_events)
            if isinstance(event, NodeRunStreamChunkEvent) and index < human_success_index
        ]
        assert pre_indices == list(range(2, 2 + pre_chunk_count))

        resume_chunk_indices = [
            index
            for index, event in enumerate(resume_events)
            if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == scenario["resume_llm"]
        ]
        assert resume_chunk_indices, "Expected streaming output from the selected branch"
        resume_start_index = next(
            index
            for index, event in enumerate(resume_events)
            if isinstance(event, NodeRunStartedEvent) and event.node_id == scenario["resume_llm"]
        )
        resume_success_index = next(
            index
            for index, event in enumerate(resume_events)
            if isinstance(event, NodeRunSucceededEvent) and event.node_id == scenario["resume_llm"]
        )
        assert resume_start_index < min(resume_chunk_indices)
        assert max(resume_chunk_indices) < resume_success_index

        started_nodes = [event.node_id for event in resume_events if isinstance(event, NodeRunStartedEvent)]
        assert started_nodes == ["human", scenario["resume_llm"], scenario["end_node"]]
