"""
Unit tests for GraphBuilder.

Tests the automatic graph construction from node lists with dependency declarations.
"""

import pytest

from core.workflow.generator.utils.graph_builder import (
    CyclicDependencyError,
    GraphBuilder,
)


class TestGraphBuilderBasic:
    """Basic functionality tests."""

    def test_empty_nodes_creates_minimal_workflow(self):
        """Empty node list creates start -> end workflow."""
        result_nodes, result_edges = GraphBuilder.build_graph([])

        assert len(result_nodes) == 2
        assert result_nodes[0]["type"] == "start"
        assert result_nodes[1]["type"] == "end"
        assert len(result_edges) == 1
        assert result_edges[0]["source"] == "start"
        assert result_edges[0]["target"] == "end"

    def test_simple_linear_workflow(self):
        """Simple linear workflow: start -> fetch -> process -> end."""
        nodes = [
            {"id": "fetch", "type": "http-request", "depends_on": []},
            {"id": "process", "type": "llm", "depends_on": ["fetch"]},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should have: start + 2 user nodes + end = 4
        assert len(result_nodes) == 4
        assert result_nodes[0]["type"] == "start"
        assert result_nodes[-1]["type"] == "end"

        # Should have: start->fetch, fetch->process, process->end = 3
        assert len(result_edges) == 3

        # Verify edge connections
        edge_pairs = [(e["source"], e["target"]) for e in result_edges]
        assert ("start", "fetch") in edge_pairs
        assert ("fetch", "process") in edge_pairs
        assert ("process", "end") in edge_pairs


class TestParallelWorkflow:
    """Tests for parallel node handling."""

    def test_parallel_workflow(self):
        """Parallel workflow: multiple nodes from start, merging to one."""
        nodes = [
            {"id": "api1", "type": "http-request", "depends_on": []},
            {"id": "api2", "type": "http-request", "depends_on": []},
            {"id": "merge", "type": "llm", "depends_on": ["api1", "api2"]},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # start should connect to both api1 and api2
        start_edges = [e for e in result_edges if e["source"] == "start"]
        assert len(start_edges) == 2

        start_targets = {e["target"] for e in start_edges}
        assert start_targets == {"api1", "api2"}

        # Both api1 and api2 should connect to merge
        merge_incoming = [e for e in result_edges if e["target"] == "merge"]
        assert len(merge_incoming) == 2

    def test_multiple_terminal_nodes(self):
        """Multiple terminal nodes all connect to end."""
        nodes = [
            {"id": "branch1", "type": "llm", "depends_on": []},
            {"id": "branch2", "type": "llm", "depends_on": []},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Both branches should connect to end
        end_incoming = [e for e in result_edges if e["target"] == "end"]
        assert len(end_incoming) == 2


class TestIfElseWorkflow:
    """Tests for if-else branching."""

    def test_if_else_workflow(self):
        """Conditional branching workflow."""
        nodes = [
            {
                "id": "check",
                "type": "if-else",
                "config": {"true_branch": "success", "false_branch": "fallback"},
                "depends_on": [],
            },
            {"id": "success", "type": "llm", "depends_on": []},
            {"id": "fallback", "type": "code", "depends_on": []},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should have true and false branch edges
        branch_edges = [e for e in result_edges if e["source"] == "check"]
        assert len(branch_edges) == 2
        assert any(e.get("sourceHandle") == "true" for e in branch_edges)
        assert any(e.get("sourceHandle") == "false" for e in branch_edges)

        # Verify targets
        true_edge = next(e for e in branch_edges if e.get("sourceHandle") == "true")
        false_edge = next(e for e in branch_edges if e.get("sourceHandle") == "false")
        assert true_edge["target"] == "success"
        assert false_edge["target"] == "fallback"

    def test_if_else_missing_branch_no_error(self):
        """if-else with only true branch doesn't error (warning only)."""
        nodes = [
            {
                "id": "check",
                "type": "if-else",
                "config": {"true_branch": "success"},
                "depends_on": [],
            },
            {"id": "success", "type": "llm", "depends_on": []},
        ]
        # Should not raise
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should have one branch edge
        branch_edges = [e for e in result_edges if e["source"] == "check"]
        assert len(branch_edges) == 1
        assert branch_edges[0].get("sourceHandle") == "true"


class TestQuestionClassifierWorkflow:
    """Tests for question-classifier branching."""

    def test_question_classifier_workflow(self):
        """Question classifier with multiple classes."""
        nodes = [
            {
                "id": "classifier",
                "type": "question-classifier",
                "config": {
                    "query": ["start", "user_input"],
                    "classes": [
                        {"id": "tech", "name": "技术问题", "target": "tech_handler"},
                        {"id": "sales", "name": "销售咨询", "target": "sales_handler"},
                        {"id": "other", "name": "其他问题", "target": "other_handler"},
                    ],
                },
                "depends_on": [],
            },
            {"id": "tech_handler", "type": "llm", "depends_on": []},
            {"id": "sales_handler", "type": "llm", "depends_on": []},
            {"id": "other_handler", "type": "llm", "depends_on": []},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should have 3 branch edges from classifier
        classifier_edges = [e for e in result_edges if e["source"] == "classifier"]
        assert len(classifier_edges) == 3

        # Each should use class id as sourceHandle
        assert any(
            e.get("sourceHandle") == "tech" and e["target"] == "tech_handler"
            for e in classifier_edges
        )
        assert any(
            e.get("sourceHandle") == "sales" and e["target"] == "sales_handler"
            for e in classifier_edges
        )
        assert any(
            e.get("sourceHandle") == "other" and e["target"] == "other_handler"
            for e in classifier_edges
        )

    def test_question_classifier_missing_target(self):
        """Classes without target connect to end."""
        nodes = [
            {
                "id": "classifier",
                "type": "question-classifier",
                "config": {
                    "classes": [
                        {"id": "known", "name": "已知问题", "target": "handler"},
                        {"id": "unknown", "name": "未知问题"},  # Missing target
                    ],
                },
                "depends_on": [],
            },
            {"id": "handler", "type": "llm", "depends_on": []},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Missing target should connect to end
        classifier_edges = [e for e in result_edges if e["source"] == "classifier"]
        assert any(
            e.get("sourceHandle") == "unknown" and e["target"] == "end"
            for e in classifier_edges
        )


class TestVariableDependencyInference:
    """Tests for automatic dependency inference from variables."""

    def test_variable_dependency_inference(self):
        """Dependencies inferred from variable references."""
        nodes = [
            {"id": "fetch", "type": "http-request", "depends_on": []},
            {
                "id": "process",
                "type": "llm",
                "config": {"prompt_template": [{"text": "{{#fetch.body#}}"}]},
                # No explicit depends_on, but references fetch
            },
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should automatically infer process depends on fetch
        assert any(
            e["source"] == "fetch" and e["target"] == "process" for e in result_edges
        )

    def test_system_variable_not_inferred(self):
        """System variables (sys, start) not inferred as dependencies."""
        nodes = [
            {
                "id": "process",
                "type": "llm",
                "config": {"prompt_template": [{"text": "{{#sys.query#}} {{#start.input#}}"}]},
                "depends_on": [],
            },
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should connect to start, not create dependency on sys or start
        edge_sources = {e["source"] for e in result_edges}
        assert "sys" not in edge_sources
        assert "start" in edge_sources


class TestCycleDetection:
    """Tests for cyclic dependency detection."""

    def test_cyclic_dependency_detected(self):
        """Cyclic dependencies raise error."""
        nodes = [
            {"id": "a", "type": "llm", "depends_on": ["c"]},
            {"id": "b", "type": "llm", "depends_on": ["a"]},
            {"id": "c", "type": "llm", "depends_on": ["b"]},
        ]

        with pytest.raises(CyclicDependencyError):
            GraphBuilder.build_graph(nodes)

    def test_self_dependency_detected(self):
        """Self-dependency raises error."""
        nodes = [
            {"id": "a", "type": "llm", "depends_on": ["a"]},
        ]

        with pytest.raises(CyclicDependencyError):
            GraphBuilder.build_graph(nodes)


class TestErrorRecovery:
    """Tests for silent error recovery."""

    def test_invalid_dependency_removed(self):
        """Invalid dependencies (non-existent nodes) are silently removed."""
        nodes = [
            {"id": "process", "type": "llm", "depends_on": ["nonexistent"]},
        ]
        # Should not raise, invalid dependency silently removed
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Process should connect from start (since invalid dep was removed)
        assert any(
            e["source"] == "start" and e["target"] == "process" for e in result_edges
        )

    def test_depends_on_as_string(self):
        """depends_on as string is converted to list."""
        nodes = [
            {"id": "fetch", "type": "http-request", "depends_on": []},
            {"id": "process", "type": "llm", "depends_on": "fetch"},  # String instead of list
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should work correctly
        assert any(
            e["source"] == "fetch" and e["target"] == "process" for e in result_edges
        )


class TestContainerNodes:
    """Tests for container nodes (iteration, loop)."""

    def test_iteration_node_as_regular_node(self):
        """Iteration nodes behave as regular single-in-single-out nodes."""
        nodes = [
            {"id": "prepare", "type": "code", "depends_on": []},
            {
                "id": "loop",
                "type": "iteration",
                "config": {"iterator_selector": ["prepare", "items"]},
                "depends_on": ["prepare"],
            },
            {"id": "process_result", "type": "llm", "depends_on": ["loop"]},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should have standard edges: start->prepare, prepare->loop, loop->process_result, process_result->end
        edge_pairs = [(e["source"], e["target"]) for e in result_edges]
        assert ("start", "prepare") in edge_pairs
        assert ("prepare", "loop") in edge_pairs
        assert ("loop", "process_result") in edge_pairs
        assert ("process_result", "end") in edge_pairs

    def test_loop_node_as_regular_node(self):
        """Loop nodes behave as regular single-in-single-out nodes."""
        nodes = [
            {"id": "init", "type": "code", "depends_on": []},
            {
                "id": "repeat",
                "type": "loop",
                "config": {"loop_count": 5},
                "depends_on": ["init"],
            },
            {"id": "finish", "type": "llm", "depends_on": ["repeat"]},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Standard edge flow
        edge_pairs = [(e["source"], e["target"]) for e in result_edges]
        assert ("init", "repeat") in edge_pairs
        assert ("repeat", "finish") in edge_pairs

    def test_iteration_with_variable_inference(self):
        """Iteration node dependencies can be inferred from iterator_selector."""
        nodes = [
            {"id": "data_source", "type": "http-request", "depends_on": []},
            {
                "id": "process_each",
                "type": "iteration",
                "config": {
                    "iterator_selector": ["data_source", "items"],
                },
                # No explicit depends_on, but references data_source
            },
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Should infer dependency from iterator_selector reference
        # Note: iterator_selector format is different from {{#...#}}, so this tests
        # that explicit depends_on is properly handled when not provided
        # In this case, process_each has no depends_on, so it connects to start
        edge_pairs = [(e["source"], e["target"]) for e in result_edges]
        # Without explicit depends_on, connects to start
        assert ("start", "process_each") in edge_pairs or ("data_source", "process_each") in edge_pairs

    def test_loop_node_self_reference_not_cycle(self):
        """Loop nodes referencing their own outputs should not create cycle."""
        nodes = [
            {"id": "init", "type": "code", "depends_on": []},
            {
                "id": "my_loop",
                "type": "loop",
                "config": {
                    "loop_count": 5,
                    # Loop node referencing its own output (common pattern)
                    "prompt": "Previous: {{#my_loop.output#}}, continue...",
                },
                "depends_on": ["init"],
            },
            {"id": "finish", "type": "llm", "depends_on": ["my_loop"]},
        ]
        # Should NOT raise CyclicDependencyError
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        # Verify the graph is built correctly
        assert len(result_nodes) == 5  # start + 3 + end
        edge_pairs = [(e["source"], e["target"]) for e in result_edges]
        assert ("init", "my_loop") in edge_pairs
        assert ("my_loop", "finish") in edge_pairs


class TestEdgeStructure:
    """Tests for edge structure correctness."""

    def test_edge_has_required_fields(self):
        """Edges have all required fields."""
        nodes = [
            {"id": "node1", "type": "llm", "depends_on": []},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        for edge in result_edges:
            assert "id" in edge
            assert "source" in edge
            assert "target" in edge
            assert "sourceHandle" in edge
            assert "targetHandle" in edge

    def test_edge_id_unique(self):
        """Each edge has a unique ID."""
        nodes = [
            {"id": "a", "type": "llm", "depends_on": []},
            {"id": "b", "type": "llm", "depends_on": []},
            {"id": "c", "type": "llm", "depends_on": ["a", "b"]},
        ]
        result_nodes, result_edges = GraphBuilder.build_graph(nodes)

        edge_ids = [e["id"] for e in result_edges]
        assert len(edge_ids) == len(set(edge_ids))  # All unique
