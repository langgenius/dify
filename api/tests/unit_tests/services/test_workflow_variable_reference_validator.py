"""Unit tests for the preflight workflow variable-reference validator.

See GitHub issue #34358. A node that can read a producer on a skipped branch
is flagged. A producer that always runs, a parallel branch, and an aggregator
are not.
"""

from services.workflow_variable_reference_validator import (
    format_variable_reference_errors,
    validate_variable_references,
)


def _node(node_id: str, node_type: str, title: str = "", *, selector: list[str] | None = None) -> dict[str, object]:
    data: dict[str, object] = {"type": node_type, "title": title or node_id}
    if selector is not None:
        data["variables"] = [{"value_selector": selector, "variable": "x"}]
    return {"id": node_id, "data": data}


def _edge(source: str, target: str, handle: str = "source") -> dict[str, str]:
    return {"source": source, "target": target, "sourceHandle": handle}


def _node_data(node: dict[str, object]) -> dict[str, object]:
    raw = node["data"]
    if not isinstance(raw, dict):
        raise AssertionError("node data must be a mapping")
    return raw


class TestValidateVariableReferences:
    def test_same_selected_handle_runs_producer_and_consumer_together(self) -> None:
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else"),
                _node("prod", "tool"),
                _node("cons", "llm", selector=["prod", "text"]),
                _node("end", "end"),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "prod", "true"),
                _edge("router", "cons", "true"),
                _edge("router", "end", "false"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_unwired_else_can_skip_all_wired_cases(self) -> None:
        router = _node("router", "if-else")
        _node_data(router)["cases"] = [{"case_id": "true"}, {"case_id": "elif"}]
        graph = {
            "nodes": [
                _node("start", "start"),
                router,
                _node("prod", "tool"),
                _node("cons", "llm", selector=["prod", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("start", "cons"),
                _edge("router", "prod", "true"),
                _edge("router", "prod", "elif"),
            ],
        }
        assert [(issue.node_id, issue.referenced_node_id) for issue in validate_variable_references(graph)] == [
            ("cons", "prod")
        ]

    def test_trigger_can_run_without_the_manual_start_path(self) -> None:
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("trigger", "trigger-webhook"),
                _node("prod", "tool"),
                _node("cons", "llm", selector=["prod", "text"]),
            ],
            "edges": [_edge("start", "prod"), _edge("trigger", "cons")],
        }
        assert [(issue.node_id, issue.referenced_node_id) for issue in validate_variable_references(graph)] == [
            ("cons", "prod")
        ]

    def test_disconnected_consumer_is_not_an_entry(self) -> None:
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else"),
                _node("prod", "tool"),
                _node("cons", "llm", selector=["prod", "text"]),
            ],
            "edges": [_edge("start", "router"), _edge("router", "prod", "true")],
        }
        assert validate_variable_references(graph) == []

    def test_empty_graph_returns_no_issues(self) -> None:
        """An empty or node-less graph is accepted without issues."""
        assert validate_variable_references({}) == []
        assert validate_variable_references({"nodes": [], "edges": []}) == []

    def test_upstream_always_run_reference_is_safe(self) -> None:
        """Reading a node that runs before the branch split is safe."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("norm", "tool", "Normalizer"),
                _node("router", "if-else", "Router"),
                _node("b", "llm", "B", selector=["norm", "text"]),
            ],
            "edges": [
                _edge("start", "norm"),
                _edge("norm", "router"),
                _edge("router", "b", "true"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_cross_branch_reference_is_flagged(self) -> None:
        """Reading a producer that sits on the opposite branch is flagged."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "tool", "A"),
                _node("b", "llm", "B", selector=["a", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "a", "true"),
                _edge("router", "b", "false"),
            ],
        }
        issues = validate_variable_references(graph)
        assert len(issues) == 1
        assert issues[0].node_id == "b"
        assert issues[0].referenced_node_id == "a"

    def test_join_after_conditional_skip_is_flagged(self) -> None:
        """A join reading a node skipped on the taken branch is flagged."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "llm", "A"),
                _node("join", "llm", "Join", selector=["a", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "join", "true"),
                _edge("router", "a", "false"),
                _edge("a", "join"),
            ],
        }
        issues = validate_variable_references(graph)
        assert len(issues) == 1
        assert issues[0].node_id == "join"
        assert issues[0].referenced_node_id == "a"

    def test_single_wired_if_else_branch_is_flagged(self) -> None:
        """An if-else with only one branch wired skips it when the other is taken."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("prod", "tool", "Producer"),
                _node("cons", "llm", "Consumer", selector=["prod", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "prod", "true"),
                _edge("start", "cons"),
            ],
        }
        issues = validate_variable_references(graph)
        assert len(issues) == 1
        assert issues[0].referenced_node_id == "prod"

    def test_fail_branch_producer_is_flagged(self) -> None:
        """A producer behind a fail-branch node's success handle is skipped on failure."""
        risky = _node("risky", "tool", "Risky")
        _node_data(risky)["error_strategy"] = "fail-branch"
        graph = {
            "nodes": [
                _node("start", "start"),
                risky,
                _node("prod", "tool", "Producer"),
                _node("cons", "llm", "Consumer", selector=["prod", "text"]),
            ],
            "edges": [
                _edge("start", "risky"),
                _edge("risky", "prod", "success"),
                _edge("start", "cons"),
            ],
        }
        issues = validate_variable_references(graph)
        assert len(issues) == 1
        assert issues[0].referenced_node_id == "prod"

    def test_branches_converging_into_producer_are_not_flagged(self) -> None:
        """When every wired branch leads into the producer it runs on every path."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("prod", "tool", "Producer"),
                _node("cons", "llm", "Consumer", selector=["prod", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "prod", "true"),
                _edge("router", "prod", "false"),
                _edge("start", "cons"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_template_reference_is_detected(self) -> None:
        """A reference expressed as a {{#node.field#}} template is detected."""
        b = _node("b", "llm", "B")
        _node_data(b)["prompt"] = "Use {{#a.text#}} here"
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "tool", "A"),
                b,
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "a", "true"),
                _edge("router", "b", "false"),
            ],
        }
        issues = validate_variable_references(graph)
        assert len(issues) == 1
        assert issues[0].referenced_node_id == "a"

    def test_variable_typed_parameter_reference_is_detected(self) -> None:
        """A {type: variable} parameter selector is detected."""
        consumer = _node("c", "tool", "Consumer")
        _node_data(consumer)["parameters"] = [{"type": "variable", "value": ["a", "text"]}]
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "tool", "A"),
                consumer,
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "a", "true"),
                _edge("router", "c", "false"),
            ],
        }
        issues = validate_variable_references(graph)
        assert len(issues) == 1
        assert issues[0].referenced_node_id == "a"

    def test_bare_hash_text_is_not_a_placeholder(self) -> None:
        """Bare #a.text# text without braces is not treated as a reference."""
        b = _node("b", "llm", "B")
        _node_data(b)["prompt"] = "see #a.text# (not a placeholder)"
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "tool", "A"),
                b,
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "a", "true"),
                _edge("router", "b", "false"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_parallel_branches_are_not_flagged(self) -> None:
        """Parallel branches both run, so a join reading one of them is safe."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("split", "tool", "Split"),
                _node("a", "tool", "A"),
                _node("b", "tool", "B"),
                _node("join", "llm", "Join", selector=["a", "text"]),
            ],
            "edges": [
                _edge("start", "split"),
                _edge("split", "a"),
                _edge("split", "b"),
                _edge("a", "join"),
                _edge("b", "join"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_producer_on_an_independent_always_on_path_is_not_flagged(self) -> None:
        """A producer that also runs on an unconditional path is never skipped."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("p", "tool", "Producer"),
                _node("c", "llm", "Consumer", selector=["p", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "p", "true"),
                _edge("router", "c", "false"),
                _edge("p", "c"),
                _edge("start", "p"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_fan_out_forced_producer_is_not_flagged(self) -> None:
        """A fan-out that forces the producer in on every run is safe."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("m", "tool", "Fan-out"),
                _node("p", "tool", "Producer"),
                _node("c", "llm", "Consumer", selector=["p", "text"]),
            ],
            "edges": [
                _edge("start", "m"),
                _edge("m", "p"),
                _edge("m", "c"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_variable_aggregator_reference_is_exempt(self) -> None:
        """A Variable Aggregator merging branch outputs is exempt."""
        agg = _node("agg", "variable-aggregator", "Aggregator")
        _node_data(agg)["variables"] = [["a", "text"], ["b", "text"]]
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "tool", "A"),
                _node("b", "tool", "B"),
                agg,
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "a", "true"),
                _edge("router", "b", "false"),
                _edge("a", "agg"),
                _edge("b", "agg"),
            ],
        }
        assert validate_variable_references(graph) == []

    def test_reserved_selector_heads_are_ignored(self) -> None:
        """sys/conversation/env selector heads are always available and never flagged."""
        b = _node("b", "llm", "B", selector=["sys", "query"])
        _node_data(b)["prompt"] = "{{#conversation.foo#}} {{#env.bar#}}"
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                b,
            ],
            "edges": [_edge("start", "router"), _edge("router", "b", "true")],
        }
        assert validate_variable_references(graph) == []

    def test_question_classifier_unwired_class_can_skip_the_producer(self) -> None:
        """A declared class with no edge is still an exit. The consumer is reached from start."""
        router = _node("router", "question-classifier", "Router")
        _node_data(router)["classes"] = [{"id": "billing"}, {"id": "shipping"}]
        graph = {
            "nodes": [
                _node("start", "start"),
                router,
                _node("prod", "tool", "Producer"),
                _node("cons", "llm", "Consumer", selector=["prod", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("start", "cons"),
                _edge("router", "prod", "billing"),
            ],
        }
        assert [(issue.node_id, issue.referenced_node_id) for issue in validate_variable_references(graph)] == [
            ("cons", "prod")
        ]

    def test_human_input_unwired_timeout_can_skip_the_wired_action(self) -> None:
        """The implicit timeout handle is an exit even when no edge uses it."""
        review = _node("review", "human-input", "Review")
        _node_data(review)["user_actions"] = [{"id": "approve"}]
        graph = {
            "nodes": [
                _node("start", "start"),
                review,
                _node("prod", "tool", "Producer"),
                _node("cons", "llm", "Consumer", selector=["prod", "text"]),
            ],
            "edges": [
                _edge("start", "review"),
                _edge("start", "cons"),
                _edge("review", "prod", "approve"),
            ],
        }
        assert [(issue.node_id, issue.referenced_node_id) for issue in validate_variable_references(graph)] == [
            ("cons", "prod")
        ]

    def test_nested_parent_nodes_are_not_root_references(self) -> None:
        """Nodes inside a nested graph are neither consumers nor producers of the root check."""
        nested_prod = _node("nested-prod", "tool", "Nested producer")
        nested_prod["parentId"] = "loop-1"
        nested_cons = _node("nested-cons", "llm", "Nested consumer", selector=["prod", "text"])
        nested_cons["parentId"] = "loop-1"
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("prod", "tool", "Producer"),
                nested_prod,
                nested_cons,
                _node("root-cons", "llm", "Root consumer", selector=["nested-prod", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "prod", "true"),
                _edge("router", "nested-prod", "true"),
                _edge("router", "nested-cons", "false"),
                _edge("router", "root-cons", "false"),
            ],
        }
        assert validate_variable_references(graph) == []


class TestFormatVariableReferenceErrors:
    def test_message_includes_titles_and_count(self) -> None:
        """The rendered message names both nodes and reports the issue count."""
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                _node("a", "tool", "Producer"),
                _node("b", "llm", "Consumer", selector=["a", "text"]),
            ],
            "edges": [
                _edge("start", "router"),
                _edge("router", "a", "true"),
                _edge("router", "b", "false"),
            ],
        }
        issues = validate_variable_references(graph)
        message = format_variable_reference_errors(issues)
        assert "Consumer" in message
        assert "Producer" in message
        assert "1 variable reference " in message

    def test_message_truncates_after_ten_issues(self) -> None:
        """Only the first ten pairs are listed; the rest are a count."""
        nodes: list[dict[str, object]] = [_node("start", "start"), _node("router", "if-else", "Router")]
        edges = [_edge("start", "router")]
        for index in range(11):
            producer_id = f"p{index:02d}"
            consumer_id = f"c{index:02d}"
            nodes.append(_node(producer_id, "tool", f"Producer {index:02d}"))
            nodes.append(_node(consumer_id, "llm", f"Consumer {index:02d}", selector=[producer_id, "text"]))
            edges.append(_edge("router", producer_id, "true"))
            edges.append(_edge("router", consumer_id, "false"))
        issues = validate_variable_references({"nodes": nodes, "edges": edges})
        assert len(issues) == 11
        message = format_variable_reference_errors(issues)
        assert "11 variable references " in message
        assert message.count("←") == 10
        assert "+1 more" in message
        assert "Consumer 10" not in message
        assert "Producer 10" not in message
