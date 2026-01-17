from core.workflow.generator.utils.graph_validator import GraphValidator


def test_detect_cycle():
    """Test that cycles are detected."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "node1", "type": "llm"},
            {"id": "node2", "type": "code"},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "node1"},
            {"source": "node1", "target": "node2"},
            {"source": "node2", "target": "node1"},  # Cycle!
            {"source": "node2", "target": "end"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    cycle_errors = [e for e in result.errors if e.error_type == "cycle"]
    assert len(cycle_errors) > 0


def test_no_cycle_valid():
    """Test that valid DAG passes."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "node1", "type": "llm"},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "node1"},
            {"source": "node1", "target": "end"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is True


def test_parallel_branches_must_converge():
    """Test that parallel branches from if-else should converge."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "ifelse", "type": "if-else", "config": {"cases": [{"case_id": "case_1"}]}},
            {"id": "branch_true", "type": "llm"},
            {"id": "branch_false", "type": "code"},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "ifelse"},
            {"source": "ifelse", "target": "branch_true", "sourceHandle": "case_1"},
            {"source": "ifelse", "target": "branch_false", "sourceHandle": "false"},
            {"source": "branch_true", "target": "end"},
            # Missing: branch_false -> end
        ],
    }
    result = GraphValidator.validate(workflow)
    # Should warn about dead end (branch_false doesn't reach end)
    dead_end_warnings = [w for w in result.warnings if w.error_type == "dead_end"]
    assert len(dead_end_warnings) > 0


def test_missing_start_node():
    workflow = {
        "nodes": [
            {"id": "node1", "type": "llm"},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "node1", "target": "end"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    assert any(e.error_type == "missing_start" for e in result.errors)


def test_disconnected_node():
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "node1", "type": "llm"},
            {"id": "orphan", "type": "code"},  # Not connected
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "node1"},
            {"source": "node1", "target": "end"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    unreachable = [e for e in result.errors if e.error_type == "unreachable"]
    assert len(unreachable) > 0
    assert unreachable[0].node_id == "orphan"


def test_self_loop_detected():
    """A node pointing to itself should be detected as a cycle."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "loop", "type": "llm"},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "loop"},
            {"source": "loop", "target": "loop"},  # Self-loop
            {"source": "loop", "target": "end"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    assert any(e.error_type == "cycle" for e in result.errors)


def test_missing_end_node():
    """Workflow without end node should fail."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "node1", "type": "llm"},
        ],
        "edges": [
            {"source": "start", "target": "node1"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    assert any(e.error_type == "missing_end" for e in result.errors)


def test_empty_workflow():
    """Empty workflow should fail validation."""
    workflow = {"nodes": [], "edges": []}
    result = GraphValidator.validate(workflow)
    assert result.success is False


def test_start_node_no_outgoing():
    """Start node with no outgoing edges should be flagged."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "end", "type": "end"},
        ],
        "edges": [],  # No edges at all
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    disconnected_errors = [e for e in result.errors if e.error_type == "disconnected"]
    assert len(disconnected_errors) > 0


def test_if_else_missing_false_branch():
    """If-else node missing the false branch edge."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "ifelse", "type": "if-else", "config": {"cases": [{"case_id": "case_1"}]}},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "ifelse"},
            {"source": "ifelse", "target": "end", "sourceHandle": "case_1"},
            # Missing: sourceHandle "false"
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is False
    missing_branch_errors = [e for e in result.errors if e.error_type == "missing_branch"]
    assert len(missing_branch_errors) > 0


def test_stats_populated():
    """Test that stats are populated with useful information."""
    workflow = {
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "node1", "type": "llm"},
            {"id": "end", "type": "end"},
        ],
        "edges": [
            {"source": "start", "target": "node1"},
            {"source": "node1", "target": "end"},
        ],
    }
    result = GraphValidator.validate(workflow)
    assert result.success is True
    assert "nodes" in result.stats
    assert result.stats["nodes"] == 3
    assert "edges" in result.stats
    assert result.stats["edges"] == 2
    assert result.execution_time >= 0
