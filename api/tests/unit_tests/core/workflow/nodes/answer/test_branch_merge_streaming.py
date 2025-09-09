from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState, RuntimeRouteState
from core.workflow.nodes.answer.answer_stream_generate_router import AnswerStreamGeneratorRouter
from core.workflow.nodes.answer.answer_stream_processor import AnswerStreamProcessor


def test_branch_merge_streaming_scenario():
    """
    Test streaming output for complex multi-branch merge scenario:
    Start -> Input -> If/Else 1 -> [If/Else 2, If/Else 3, Do Something] -> Code -> LLM -> Answer

    This tests the fix for issue where streaming fails when multiple conditional
    branches from different levels converge on a common join point.
    """
    # Define complex workflow with multi-branch merge (based on actual scenario)
    graph_config = {
        "edges": [
            {"id": "start-input", "source": "start", "target": "input"},
            {"id": "input-if_else_1", "source": "input", "target": "if_else_1"},
            # Primary branch splits into multiple paths
            {"id": "if_else_1-if_else_2", "source": "if_else_1", "target": "if_else_2", "sourceHandle": "true"},
            {"id": "if_else_1-if_else_3", "source": "if_else_1", "target": "if_else_3", "sourceHandle": "false"},
            {"id": "if_else_1-do_something", "source": "if_else_1", "target": "do_something", "sourceHandle": "other"},
            # Secondary branches with their own sub-paths
            {"id": "if_else_2-code", "source": "if_else_2", "target": "code_join", "sourceHandle": "true"},
            {"id": "if_else_2-dummy_1", "source": "if_else_2", "target": "dummy_1", "sourceHandle": "false"},
            {"id": "if_else_3-code", "source": "if_else_3", "target": "code_join", "sourceHandle": "true"},
            {"id": "if_else_3-dummy_2", "source": "if_else_3", "target": "dummy_2", "sourceHandle": "false"},
            {"id": "do_something-code", "source": "do_something", "target": "code_join"},
            # All paths converge at code join point
            {"id": "code-llm", "source": "code_join", "target": "llm"},
            {"id": "llm-answer", "source": "llm", "target": "answer"},
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {"data": {"type": "code"}, "id": "input"},
            {"data": {"type": "if_else"}, "id": "if_else_1"},
            {"data": {"type": "if_else"}, "id": "if_else_2"},
            {"data": {"type": "if_else"}, "id": "if_else_3"},
            {"data": {"type": "code"}, "id": "do_something"},
            {"data": {"type": "code"}, "id": "code_join"},
            {"data": {"type": "llm"}, "id": "llm"},
            {"data": {"type": "answer", "title": "answer", "answer": "Result: {{#llm.text#}}"}, "id": "answer"},
            {"data": {"type": "code"}, "id": "dummy_1"},
            {"data": {"type": "code"}, "id": "dummy_2"},
        ],
    }

    # Create graph and generate routes
    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping={node["id"]: node for node in graph_config["nodes"]},
        reverse_edge_mapping=graph.reverse_edge_mapping,
    )
    graph.answer_stream_generate_routes = answer_routes

    # Create variable pool
    variable_pool = VariablePool(system_variables={}, user_inputs={})

    # Create runtime state with nodes executed on the taken path
    runtime_state = RuntimeRouteState()

    # Simulate execution: One specific path is taken
    # Path: start -> input -> if_else_1 -> if_else_2 -> code_join -> llm -> answer
    start_state = runtime_state.create_node_state("start")
    start_result = NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs={}, outputs={})
    start_state.set_finished(start_result)

    input_state = runtime_state.create_node_state("input")
    input_result = NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs={}, outputs={})
    input_state.set_finished(input_result)

    # Primary branch takes "true" path
    if_else_1_state = runtime_state.create_node_state("if_else_1")
    if_else_1_result = NodeRunResult(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        inputs={},
        outputs={},
        edge_source_handle="true",  # Goes to if_else_2
    )
    if_else_1_state.set_finished(if_else_1_result)

    # Secondary branch takes "true" path to code_join
    if_else_2_state = runtime_state.create_node_state("if_else_2")
    if_else_2_result = NodeRunResult(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        inputs={},
        outputs={},
        edge_source_handle="true",  # Goes to code_join
    )
    if_else_2_state.set_finished(if_else_2_result)

    # Join point where multiple branches converge
    code_join_state = runtime_state.create_node_state("code_join")
    code_join_result = NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs={}, outputs={})
    code_join_state.set_finished(code_join_result)

    # LLM is currently running (streaming)
    llm_state = runtime_state.create_node_state("llm")
    llm_state.status = RouteNodeState.Status.RUNNING

    # Create processor
    processor = AnswerStreamProcessor(graph=graph, variable_pool=variable_pool, node_run_state=runtime_state)

    # Test: Check if dependencies are met for streaming
    result = processor._is_dynamic_dependencies_met("answer", "llm")

    # Should return True because:
    # 1. Static check fails (if_else_3, do_something not executed)
    # 2. But dynamic check succeeds (valid path: llm -> code_join -> if_else_2 -> if_else_1 -> input -> start)
    assert result is True, "Streaming should be enabled for multi-branch merge scenario"


def test_simple_workflow_uses_static_check():
    """
    Test that simple workflows still use static check for backward compatibility
    """
    # Simple linear workflow
    graph_config = {
        "edges": [
            {"id": "start-llm", "source": "start", "target": "llm"},
            {"id": "llm-answer", "source": "llm", "target": "answer"},
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {"data": {"type": "llm"}, "id": "llm"},
            {"data": {"type": "answer", "title": "answer", "answer": "Result: {{#llm.text#}}"}, "id": "answer"},
        ],
    }

    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping={node["id"]: node for node in graph_config["nodes"]},
        reverse_edge_mapping=graph.reverse_edge_mapping,
    )
    graph.answer_stream_generate_routes = answer_routes

    variable_pool = VariablePool(system_variables={}, user_inputs={})

    processor = AnswerStreamProcessor(graph=graph, variable_pool=variable_pool, node_run_state=RuntimeRouteState())

    # Simple workflow should use static check and pass
    result = processor._is_dynamic_dependencies_met("answer", "llm")
    assert result is True, "Simple workflow should use static check"


def test_fallback_without_runtime_state():
    """
    Test fallback to original logic when no runtime state is provided
    """
    graph_config = {
        "edges": [
            {"id": "start-llm", "source": "start", "target": "llm"},
            {"id": "llm-answer", "source": "llm", "target": "answer"},
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {"data": {"type": "llm"}, "id": "llm"},
            {"data": {"type": "answer", "title": "answer", "answer": "Result: {{#llm.text#}}"}, "id": "answer"},
        ],
    }

    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping={node["id"]: node for node in graph_config["nodes"]},
        reverse_edge_mapping=graph.reverse_edge_mapping,
    )
    graph.answer_stream_generate_routes = answer_routes

    variable_pool = VariablePool(system_variables={}, user_inputs={})

    # No runtime state provided
    processor = AnswerStreamProcessor(graph=graph, variable_pool=variable_pool, node_run_state=None)

    # Should fallback to original logic
    result = processor._is_dynamic_dependencies_met("answer", "llm")
    assert result is True, "Should fallback to original static logic"
