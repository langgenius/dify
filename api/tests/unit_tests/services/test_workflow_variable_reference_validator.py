"""Unit tests for the preflight workflow variable-reference validator.

See GitHub issue #34358: a node that reads the output of an unselected conditional
branch imports cleanly but fails at runtime ("caching variables" spinner). These
tests pin the *sound* detection: real cross-branch reads are flagged, while
always-run, parallel-branch, and aggregator references are not.
"""

from services.workflow_variable_reference_validator import (
    format_variable_reference_errors,
    validate_variable_references,
)


def _node(node_id: str, node_type: str, title: str = "", *, selector: list[str] | None = None) -> dict:
    data: dict = {"type": node_type, "title": title or node_id}
    if selector is not None:
        # A representative place a node stores a variable selector.
        data["variables"] = [{"value_selector": selector, "variable": "x"}]
    return {"id": node_id, "data": data}


def _edge(source: str, target: str, handle: str = "source") -> dict:
    return {"source": source, "target": target, "sourceHandle": handle}


class TestValidateVariableReferences:
    def test_empty_graph_returns_no_issues(self):
        assert validate_variable_references({}) == []
        assert validate_variable_references({"nodes": [], "edges": []}) == []

    def test_sequential_reference_is_safe(self):
        # start -> A -> B, where B reads A's output (A always runs before B).
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("a", "tool", "A"),
                _node("b", "llm", "B", selector=["a", "text"]),
            ],
            "edges": [_edge("start", "a"), _edge("a", "b")],
        }
        assert validate_variable_references(graph) == []

    def test_upstream_always_run_reference_is_safe(self):
        # B reads the normalizer that runs before the branch split -> always available.
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

    def test_cross_branch_reference_is_flagged(self):
        # if-else: 'true' -> A; 'false' -> B. B reads A's output, which never runs on
        # the false branch -> unsafe.
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

    def test_join_after_conditional_skip_is_flagged(self):
        # Mirrors the real bug: router 'true' goes straight to the join; 'false' goes
        # through A then to the join. The join reads A, which is skipped on 'true'.
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

    def test_template_reference_is_detected(self):
        # Reference expressed as a template string rather than a value_selector.
        b = _node("b", "llm", "B")
        b["data"]["prompt"] = "Use {{#a.text#}} here"
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

    def test_variable_typed_parameter_reference_is_detected(self):
        consumer = _node("c", "tool", "Consumer")
        consumer["data"]["parameters"] = [{"type": "variable", "value": ["a", "text"]}]
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

    def test_bare_hash_text_is_not_a_placeholder(self):
        b = _node("b", "llm", "B")
        b["data"]["prompt"] = "see #a.text# (not a placeholder)"
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

    def test_parallel_branches_are_not_flagged(self):
        # split fans out to A and B in parallel (same handle); both always run, so a
        # join reading A is safe and must not be a false positive.
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

    def test_producer_on_an_independent_always_on_path_is_not_flagged(self):
        # if-else 'false' reaches the consumer without the producer, BUT the producer
        # also runs on an unconditional path from start, so it is never actually skipped.
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
                _edge("start", "p"),  # unconditional path -> producer always runs
            ],
        }
        assert validate_variable_references(graph) == []

    def test_fan_out_forced_producer_is_not_flagged(self):
        # A non-exclusive node fans out to both the producer and (a path to) the consumer,
        # so reaching the consumer always drags the producer in -> safe, not a bug.
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

    def test_variable_aggregator_reference_is_exempt(self):
        # An aggregator merging both branch outputs is the legitimate pattern.
        agg = _node("agg", "variable-aggregator", "Aggregator")
        agg["data"]["variables"] = [["a", "text"], ["b", "text"]]
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

    def test_reserved_selector_heads_are_ignored(self):
        # sys/conversation/env are always available and must never be flagged.
        b = _node("b", "llm", "B", selector=["sys", "query"])
        b["data"]["prompt"] = "{{#conversation.foo#}} {{#env.bar#}}"
        graph = {
            "nodes": [
                _node("start", "start"),
                _node("router", "if-else", "Router"),
                b,
            ],
            "edges": [_edge("start", "router"), _edge("router", "b", "true")],
        }
        assert validate_variable_references(graph) == []


class TestFormatVariableReferenceErrors:
    def test_message_includes_titles_and_count(self):
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
