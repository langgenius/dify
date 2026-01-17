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
