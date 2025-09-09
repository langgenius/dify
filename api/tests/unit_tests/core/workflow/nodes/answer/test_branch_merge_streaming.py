from unittest.mock import Mock

from core.workflow.entities.variable_pool import VariablePool
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
            {"id": "if_else_1-if_else_2", "source": "if_else_1", "target": "if_else_2",
             "sourceHandle": "true"},
            {"id": "if_else_1-if_else_3", "source": "if_else_1", "target": "if_else_3",
             "sourceHandle": "false"},
            {"id": "if_else_1-do_something", "source": "if_else_1", "target": "do_something",
             "sourceHandle": "other"},

            # Secondary branches with their own sub-paths
            {"id": "if_else_2-code", "source": "if_else_2", "target": "code_join",
             "sourceHandle": "true"},
            {"id": "if_else_2-dummy_1", "source": "if_else_2", "target": "dummy_1",
             "sourceHandle": "false"},

            {"id": "if_else_3-code", "source": "if_else_3", "target": "code_join",
             "sourceHandle": "true"},
            {"id": "if_else_3-dummy_2", "source": "if_else_3", "target": "dummy_2",
             "sourceHandle": "false"},

            {"id": "do_something-code", "source": "do_something", "target": "code_join"},

            # All paths converge at code join point
            {"id": "code-llm", "source": "code_join", "target": "llm"},
            {"id": "llm-answer", "source": "llm", "target": "answer"},
        ],
        "nodes": {
            "start": {"data": {"type": "start"}},
            "input": {"data": {"type": "code"}},
            "if_else_1": {"data": {"type": "if_else"}},
            "if_else_2": {"data": {"type": "if_else"}},
            "if_else_3": {"data": {"type": "if_else"}},
            "do_something": {"data": {"type": "code"}},
            "code_join": {"data": {"type": "code"}},
            "llm": {"data": {"type": "llm"}},
            "answer": {
                "data": {
                    "type": "answer",
                    "answer": "Result: {{#llm.text#}}"
                }
            },
            "dummy_1": {"data": {"type": "code"}},
            "dummy_2": {"data": {"type": "code"}},
        }
    }

    # Create graph and generate routes
    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping=graph_config["nodes"],
        reverse_edge_mapping=graph.reverse_edge_mapping
    )
    graph.answer_stream_generate_routes = answer_routes

    # Create variable pool
    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
        environment_variables={}
    )

    # Create runtime state with nodes executed on the taken path
    runtime_state = RuntimeRouteState()

        # Simulate execution: One specific path is taken
    # Path: start -> input -> if_else_1 -> if_else_2 -> code_join -> llm -> answer
    start_state = runtime_state.create_node_state("start")
    start_state.set_finished(Mock(status="succeeded"))

    input_state = runtime_state.create_node_state("input")
    input_state.set_finished(Mock(status="succeeded"))

    # Primary branch takes "true" path
    if_else_1_state = runtime_state.create_node_state("if_else_1")
    if_else_1_state.set_finished(Mock(
        status="succeeded",
        edge_source_handle="true"  # Goes to if_else_2
    ))

    # Secondary branch takes "true" path to code_join
    if_else_2_state = runtime_state.create_node_state("if_else_2")
    if_else_2_state.set_finished(Mock(
        status="succeeded",
        edge_source_handle="true"  # Goes to code_join
    ))

    # Join point where multiple branches converge
    code_join_state = runtime_state.create_node_state("code_join")
    code_join_state.set_finished(Mock(status="succeeded"))

    # LLM is currently running (streaming)
    llm_state = runtime_state.create_node_state("llm")
    llm_state.status = RouteNodeState.Status.RUNNING

    # Create processor
    processor = AnswerStreamProcessor(
        graph=graph,
        variable_pool=variable_pool,
        node_run_state=runtime_state
    )

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
        "nodes": {
            "start": {"data": {"type": "start"}},
            "llm": {"data": {"type": "llm"}},
            "answer": {
                "data": {
                    "type": "answer",
                    "answer": "Result: {{#llm.text#}}"
                }
            },
        }
    }

    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping=graph_config["nodes"],
        reverse_edge_mapping=graph.reverse_edge_mapping
    )
    graph.answer_stream_generate_routes = answer_routes

    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
        environment_variables={}
    )

    processor = AnswerStreamProcessor(
        graph=graph,
        variable_pool=variable_pool,
        node_run_state=RuntimeRouteState()
    )

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
        "nodes": {
            "start": {"data": {"type": "start"}},
            "llm": {"data": {"type": "llm"}},
            "answer": {
                "data": {
                    "type": "answer",
                    "answer": "Result: {{#llm.text#}}"
                }
            },
        }
    }

    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping=graph_config["nodes"],
        reverse_edge_mapping=graph.reverse_edge_mapping
    )
    graph.answer_stream_generate_routes = answer_routes

    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
        environment_variables={}
    )

    # No runtime state provided
    processor = AnswerStreamProcessor(
        graph=graph,
        variable_pool=variable_pool,
        node_run_state=None
    )

    # Should fallback to original logic
    result = processor._is_dynamic_dependencies_met("answer", "llm")
    assert result is True, "Should fallback to original static logic"


def test_complex_nested_branch_merge():
    """
    Test very complex scenario with nested branches and multiple merge points:
    Start -> Input -> If/Else 1 -> [Multiple paths] -> Code -> LLM -> Answer

    This tests edge cases where branches split and merge at multiple levels.
    """
    graph_config = {
        "edges": [
            {"id": "start-input", "source": "start", "target": "input"},
            {"id": "input-if_else_1", "source": "input", "target": "if_else_1"},

            # Level 1: Primary split
            {"id": "if_else_1-path_a", "source": "if_else_1", "target": "path_a", "sourceHandle": "true"},
            {"id": "if_else_1-path_b", "source": "if_else_1", "target": "path_b", "sourceHandle": "false"},

            # Level 2: Path A continues
            {"id": "path_a-if_else_2", "source": "path_a", "target": "if_else_2"},
            {"id": "if_else_2-sub_a", "source": "if_else_2", "target": "sub_path_a", "sourceHandle": "true"},
            {"id": "if_else_2-sub_b", "source": "if_else_2", "target": "sub_path_b", "sourceHandle": "false"},

            # Level 2: Path B continues
            {"id": "path_b-if_else_3", "source": "path_b", "target": "if_else_3"},
            {"id": "if_else_3-sub_c", "source": "if_else_3", "target": "sub_path_c", "sourceHandle": "true"},
            {"id": "if_else_3-sub_d", "source": "if_else_3", "target": "sub_path_d", "sourceHandle": "false"},

            # All sub-paths merge to final join point
            {"id": "sub_a-join", "source": "sub_path_a", "target": "final_join"},
            {"id": "sub_b-join", "source": "sub_path_b", "target": "final_join"},
            {"id": "sub_c-join", "source": "sub_path_c", "target": "final_join"},
            {"id": "sub_d-join", "source": "sub_path_d", "target": "final_join"},

            # Final path to answer
            {"id": "join-llm", "source": "final_join", "target": "llm"},
            {"id": "llm-answer", "source": "llm", "target": "answer"},
        ],
        "nodes": {
            "start": {"data": {"type": "start"}},
            "input": {"data": {"type": "code"}},
            "if_else_1": {"data": {"type": "if_else"}},
            "path_a": {"data": {"type": "code"}},
            "path_b": {"data": {"type": "code"}},
            "if_else_2": {"data": {"type": "if_else"}},
            "if_else_3": {"data": {"type": "if_else"}},
            "sub_path_a": {"data": {"type": "code"}},
            "sub_path_b": {"data": {"type": "code"}},
            "sub_path_c": {"data": {"type": "code"}},
            "sub_path_d": {"data": {"type": "code"}},
            "final_join": {"data": {"type": "code"}},
            "llm": {"data": {"type": "llm"}},
            "answer": {
                "data": {
                    "type": "answer",
                    "answer": "Complex result: {{#llm.text#}}"
                }
            },
        }
    }

    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping=graph_config["nodes"],
        reverse_edge_mapping=graph.reverse_edge_mapping
    )
    graph.answer_stream_generate_routes = answer_routes

    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
        environment_variables={}
    )

    runtime_state = RuntimeRouteState()

    # Simulate one specific execution path:
    # start -> input -> if_else_1(true) -> path_a -> if_else_2(false) -> sub_path_b -> final_join -> llm
    nodes_executed = [
        ("start", "succeeded", None),
        ("input", "succeeded", None),
        ("if_else_1", "succeeded", "true"),
        ("path_a", "succeeded", None),
        ("if_else_2", "succeeded", "false"),
        ("sub_path_b", "succeeded", None),
        ("final_join", "succeeded", None),
    ]

    for node_id, status, edge_handle in nodes_executed:
        state = runtime_state.create_node_state(node_id)
        mock_result = Mock(status=status)
        if edge_handle:
            mock_result.edge_source_handle = edge_handle
        state.set_finished(mock_result)

    # LLM is currently streaming
    llm_state = runtime_state.create_node_state("llm")
    llm_state.status = RouteNodeState.Status.RUNNING

    processor = AnswerStreamProcessor(
        graph=graph,
        variable_pool=variable_pool,
        node_run_state=runtime_state
    )

    # Test: Even with this complex nested scenario, streaming should work
    result = processor._is_dynamic_dependencies_met("answer", "llm")

    # Should return True because dynamic check can trace the executed path
    assert result is True, "Streaming should work even in complex nested branch scenarios"


def test_multiple_answer_nodes_scenario():
    """
    Test scenario with multiple answer nodes affected by branch merging
    """
    graph_config = {
        "edges": [
            {"id": "start-input", "source": "start", "target": "input"},
            {"id": "input-if_else", "source": "input", "target": "if_else_main"},

            # Branch splits to different processing paths
            {"id": "if_else-proc_a", "source": "if_else_main", "target": "process_a", "sourceHandle": "true"},
            {"id": "if_else-proc_b", "source": "if_else_main", "target": "process_b", "sourceHandle": "false"},

            # Each process path has its own LLM
            {"id": "proc_a-llm_a", "source": "process_a", "target": "llm_a"},
            {"id": "proc_b-llm_b", "source": "process_b", "target": "llm_b"},

            # Both LLMs feed into a common join point
            {"id": "llm_a-join", "source": "llm_a", "target": "merge_point"},
            {"id": "llm_b-join", "source": "llm_b", "target": "merge_point"},

            # Join point to final processing
            {"id": "join-final_llm", "source": "merge_point", "target": "final_llm"},
            {"id": "final_llm-answer1", "source": "final_llm", "target": "answer_1"},
            {"id": "final_llm-answer2", "source": "final_llm", "target": "answer_2"},
        ],
        "nodes": {
            "start": {"data": {"type": "start"}},
            "input": {"data": {"type": "code"}},
            "if_else_main": {"data": {"type": "if_else"}},
            "process_a": {"data": {"type": "code"}},
            "process_b": {"data": {"type": "code"}},
            "llm_a": {"data": {"type": "llm"}},
            "llm_b": {"data": {"type": "llm"}},
            "merge_point": {"data": {"type": "code"}},
            "final_llm": {"data": {"type": "llm"}},
            "answer_1": {"data": {"type": "answer", "answer": "Answer 1: {{#final_llm.text#}}"}},
            "answer_2": {"data": {"type": "answer", "answer": "Answer 2: {{#final_llm.text#}}"}},
        }
    }

    graph = Graph.init(graph_config=graph_config)
    answer_routes = AnswerStreamGeneratorRouter.init(
        node_id_config_mapping=graph_config["nodes"],
        reverse_edge_mapping=graph.reverse_edge_mapping
    )
    graph.answer_stream_generate_routes = answer_routes

    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
        environment_variables={}
    )

    runtime_state = RuntimeRouteState()

    # Simulate execution of path A only
    nodes_executed = [
        ("start", "succeeded", None),
        ("input", "succeeded", None),
        ("if_else_main", "succeeded", "true"),  # Takes path A
        ("process_a", "succeeded", None),
        ("llm_a", "succeeded", None),
        ("merge_point", "succeeded", None),
    ]

    for node_id, status, edge_handle in nodes_executed:
        state = runtime_state.create_node_state(node_id)
        mock_result = Mock(status=status)
        if edge_handle:
            mock_result.edge_source_handle = edge_handle
        state.set_finished(mock_result)

    # Final LLM is streaming
    final_llm_state = runtime_state.create_node_state("final_llm")
    final_llm_state.status = RouteNodeState.Status.RUNNING

    processor = AnswerStreamProcessor(
        graph=graph,
        variable_pool=variable_pool,
        node_run_state=runtime_state
    )

    # Test both answer nodes
    result_1 = processor._is_dynamic_dependencies_met("answer_1", "final_llm")
    result_2 = processor._is_dynamic_dependencies_met("answer_2", "final_llm")

    # Both should work despite complex branch merging
    assert result_1 is True, "Answer 1 should support streaming"
    assert result_2 is True, "Answer 2 should support streaming"
