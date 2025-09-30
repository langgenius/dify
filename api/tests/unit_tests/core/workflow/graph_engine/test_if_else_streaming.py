import time

from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.if_else.entities import IfElseNodeData
from core.workflow.nodes.if_else.if_else_node import IfElseNode
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
from core.workflow.utils.condition.entities import Condition

from .test_mock_config import MockConfig
from .test_mock_nodes import MockLLMNode
from .test_table_runner import TableTestRunner, WorkflowTestCase


def _build_if_else_graph(branch_value: str, mock_config: MockConfig) -> tuple[Graph, GraphRuntimeState]:
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
    variable_pool.add(("branch", "value"), branch_value)
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

    if_else_data = IfElseNodeData(
        title="IfElse",
        cases=[
            IfElseNodeData.Case(
                case_id="primary",
                logical_operator="and",
                conditions=[
                    Condition(variable_selector=["branch", "value"], comparison_operator="is", value="primary")
                ],
            ),
            IfElseNodeData.Case(
                case_id="secondary",
                logical_operator="and",
                conditions=[
                    Condition(variable_selector=["branch", "value"], comparison_operator="is", value="secondary")
                ],
            ),
        ],
    )
    if_else_config = {"id": "if_else", "data": if_else_data.model_dump()}
    if_else_node = IfElseNode(
        id=if_else_config["id"],
        config=if_else_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    if_else_node.init_node_data(if_else_config["data"])

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
        .add_node(if_else_node)
        .add_node(llm_primary, from_node_id="if_else", source_handle="primary")
        .add_node(end_primary, from_node_id="llm_primary")
        .add_node(llm_secondary, from_node_id="if_else", source_handle="secondary")
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


def test_if_else_llm_streaming_order() -> None:
    mock_config = MockConfig()
    mock_config.set_node_outputs("llm_initial", {"text": "Initial stream"})
    mock_config.set_node_outputs("llm_primary", {"text": "Primary stream output"})
    mock_config.set_node_outputs("llm_secondary", {"text": "Secondary"})

    scenarios = [
        {
            "branch": "primary",
            "resume_llm": "llm_primary",
            "end_node": "end_primary",
            "expected_sequence": [
                GraphRunStartedEvent,  # graph run begins
                NodeRunStartedEvent,  # start node begins execution
                NodeRunSucceededEvent,  # start node completes
                NodeRunStartedEvent,  # llm_initial starts and streams
                NodeRunSucceededEvent,  # llm_initial completes streaming
                NodeRunStartedEvent,  # if_else evaluates conditions
                NodeRunStreamChunkEvent,  # cached llm_initial chunk 1 flushed
                NodeRunStreamChunkEvent,  # cached llm_initial chunk 2 flushed
                NodeRunStreamChunkEvent,  # cached llm_initial final chunk flushed
                NodeRunStreamChunkEvent,  # template literal newline emitted
                NodeRunSucceededEvent,  # if_else completes branch selection
                NodeRunStartedEvent,  # llm_primary begins streaming
                NodeRunStreamChunkEvent,  # llm_primary chunk 1
                NodeRunStreamChunkEvent,  # llm_primary chunk 2
                NodeRunStreamChunkEvent,  # llm_primary chunk 3
                NodeRunStreamChunkEvent,  # llm_primary final chunk
                NodeRunSucceededEvent,  # llm_primary completes streaming
                NodeRunStartedEvent,  # end_primary node starts
                NodeRunSucceededEvent,  # end_primary finishes aggregation
                GraphRunSucceededEvent,  # graph run succeeds
            ],
            "expected_chunks": [
                ("llm_initial", _expected_mock_llm_chunks("Initial stream")),
                ("end_primary", ["\n"]),
                ("llm_primary", _expected_mock_llm_chunks("Primary stream output")),
            ],
        },
        {
            "branch": "secondary",
            "resume_llm": "llm_secondary",
            "end_node": "end_secondary",
            "expected_sequence": [
                GraphRunStartedEvent,  # graph run begins
                NodeRunStartedEvent,  # start node begins execution
                NodeRunSucceededEvent,  # start node completes
                NodeRunStartedEvent,  # llm_initial starts and streams
                NodeRunSucceededEvent,  # llm_initial completes streaming
                NodeRunStartedEvent,  # if_else evaluates conditions
                NodeRunStreamChunkEvent,  # cached llm_initial chunk 1 flushed
                NodeRunStreamChunkEvent,  # cached llm_initial chunk 2 flushed
                NodeRunStreamChunkEvent,  # cached llm_initial final chunk flushed
                NodeRunStreamChunkEvent,  # template literal newline emitted
                NodeRunSucceededEvent,  # if_else completes branch selection
                NodeRunStartedEvent,  # llm_secondary begins streaming
                NodeRunStreamChunkEvent,  # llm_secondary chunk 1
                NodeRunStreamChunkEvent,  # llm_secondary final chunk
                NodeRunSucceededEvent,  # llm_secondary completes
                NodeRunStartedEvent,  # end_secondary node starts
                NodeRunSucceededEvent,  # end_secondary finishes aggregation
                GraphRunSucceededEvent,  # graph run succeeds
            ],
            "expected_chunks": [
                ("llm_initial", _expected_mock_llm_chunks("Initial stream")),
                ("end_secondary", ["\n"]),
                ("llm_secondary", _expected_mock_llm_chunks("Secondary")),
            ],
        },
    ]

    for scenario in scenarios:
        runner = TableTestRunner()

        def graph_factory(
            branch_value: str = scenario["branch"],
            cfg: MockConfig = mock_config,
        ) -> tuple[Graph, GraphRuntimeState]:
            return _build_if_else_graph(branch_value, cfg)

        test_case = WorkflowTestCase(
            description=f"IfElse streaming via {scenario['branch']} branch",
            graph_factory=graph_factory,
            expected_event_sequence=scenario["expected_sequence"],
        )

        result = runner.run_test_case(test_case)

        assert result.success, result.event_mismatch_details

        chunk_events = [event for event in result.events if isinstance(event, NodeRunStreamChunkEvent)]
        expected_nodes: list[str] = []
        expected_chunks: list[str] = []
        for node_id, chunks in scenario["expected_chunks"]:
            expected_nodes.extend([node_id] * len(chunks))
            expected_chunks.extend(chunks)
        assert [event.node_id for event in chunk_events] == expected_nodes
        assert [event.chunk for event in chunk_events] == expected_chunks

        branch_node_index = next(
            index
            for index, event in enumerate(result.events)
            if isinstance(event, NodeRunStartedEvent) and event.node_id == "if_else"
        )
        branch_success_index = next(
            index
            for index, event in enumerate(result.events)
            if isinstance(event, NodeRunSucceededEvent) and event.node_id == "if_else"
        )
        pre_branch_chunk_indices = [
            index
            for index, event in enumerate(result.events)
            if isinstance(event, NodeRunStreamChunkEvent) and index < branch_success_index
        ]
        assert len(pre_branch_chunk_indices) == len(_expected_mock_llm_chunks("Initial stream")) + 1
        assert min(pre_branch_chunk_indices) == branch_node_index + 1
        assert max(pre_branch_chunk_indices) < branch_success_index

        resume_chunk_indices = [
            index
            for index, event in enumerate(result.events)
            if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == scenario["resume_llm"]
        ]
        assert resume_chunk_indices
        resume_start_index = next(
            index
            for index, event in enumerate(result.events)
            if isinstance(event, NodeRunStartedEvent) and event.node_id == scenario["resume_llm"]
        )
        resume_success_index = next(
            index
            for index, event in enumerate(result.events)
            if isinstance(event, NodeRunSucceededEvent) and event.node_id == scenario["resume_llm"]
        )
        assert resume_start_index < min(resume_chunk_indices)
        assert max(resume_chunk_indices) < resume_success_index

        started_nodes = [event.node_id for event in result.events if isinstance(event, NodeRunStartedEvent)]
        assert started_nodes == ["start", "llm_initial", "if_else", scenario["resume_llm"], scenario["end_node"]]
