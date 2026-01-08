"""
Unit tests for the Mermaid Generator.

Tests cover:
- Basic workflow rendering
- Reserved word handling ('end' → 'end_node')
- Question classifier multi-branch edges
- If-else branch labels
- Edge validation and skipping
- Tool node formatting
"""


from core.workflow.generator.utils.mermaid_generator import generate_mermaid


class TestBasicWorkflow:
    """Tests for basic workflow Mermaid generation."""

    def test_simple_start_end_workflow(self):
        """Test simple Start → End workflow."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "title": "Start"},
                {"id": "end", "type": "end", "title": "End"},
            ],
            "edges": [{"source": "start", "target": "end"}],
        }
        result = generate_mermaid(workflow_data)

        assert "flowchart TD" in result
        assert 'start["type=start|title=Start"]' in result
        assert 'end_node["type=end|title=End"]' in result
        assert "start --> end_node" in result

    def test_start_llm_end_workflow(self):
        """Test Start → LLM → End workflow."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "title": "Start"},
                {"id": "llm", "type": "llm", "title": "Generate"},
                {"id": "end", "type": "end", "title": "End"},
            ],
            "edges": [
                {"source": "start", "target": "llm"},
                {"source": "llm", "target": "end"},
            ],
        }
        result = generate_mermaid(workflow_data)

        assert 'llm["type=llm|title=Generate"]' in result
        assert "start --> llm" in result
        assert "llm --> end_node" in result

    def test_empty_workflow(self):
        """Test empty workflow returns minimal output."""
        workflow_data = {"nodes": [], "edges": []}
        result = generate_mermaid(workflow_data)

        assert result == "flowchart TD"

    def test_missing_keys_handled(self):
        """Test workflow with missing keys doesn't crash."""
        workflow_data = {}
        result = generate_mermaid(workflow_data)

        assert "flowchart TD" in result


class TestReservedWords:
    """Tests for reserved word handling in node IDs."""

    def test_end_node_id_is_replaced(self):
        """Test 'end' node ID is replaced with 'end_node'."""
        workflow_data = {
            "nodes": [{"id": "end", "type": "end", "title": "End"}],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        # Should use end_node instead of end
        assert "end_node[" in result
        assert '"type=end|title=End"' in result

    def test_subgraph_node_id_is_replaced(self):
        """Test 'subgraph' node ID is replaced with 'subgraph_node'."""
        workflow_data = {
            "nodes": [{"id": "subgraph", "type": "code", "title": "Process"}],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        assert "subgraph_node[" in result

    def test_edge_uses_safe_ids(self):
        """Test edges correctly reference safe IDs after replacement."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "title": "Start"},
                {"id": "end", "type": "end", "title": "End"},
            ],
            "edges": [{"source": "start", "target": "end"}],
        }
        result = generate_mermaid(workflow_data)

        # Edge should use end_node, not end
        assert "start --> end_node" in result
        assert "start --> end\n" not in result


class TestBranchEdges:
    """Tests for branching node edge labels."""

    def test_question_classifier_source_handles(self):
        """Test question-classifier edges with sourceHandle labels."""
        workflow_data = {
            "nodes": [
                {"id": "classifier", "type": "question-classifier", "title": "Classify"},
                {"id": "refund", "type": "llm", "title": "Handle Refund"},
                {"id": "inquiry", "type": "llm", "title": "Handle Inquiry"},
            ],
            "edges": [
                {"source": "classifier", "target": "refund", "sourceHandle": "refund"},
                {"source": "classifier", "target": "inquiry", "sourceHandle": "inquiry"},
            ],
        }
        result = generate_mermaid(workflow_data)

        assert "classifier -->|refund| refund" in result
        assert "classifier -->|inquiry| inquiry" in result

    def test_if_else_true_false_handles(self):
        """Test if-else edges with true/false labels."""
        workflow_data = {
            "nodes": [
                {"id": "ifelse", "type": "if-else", "title": "Check"},
                {"id": "yes_branch", "type": "llm", "title": "Yes"},
                {"id": "no_branch", "type": "llm", "title": "No"},
            ],
            "edges": [
                {"source": "ifelse", "target": "yes_branch", "sourceHandle": "true"},
                {"source": "ifelse", "target": "no_branch", "sourceHandle": "false"},
            ],
        }
        result = generate_mermaid(workflow_data)

        assert "ifelse -->|true| yes_branch" in result
        assert "ifelse -->|false| no_branch" in result

    def test_source_handle_source_is_ignored(self):
        """Test sourceHandle='source' doesn't add label."""
        workflow_data = {
            "nodes": [
                {"id": "llm1", "type": "llm", "title": "LLM 1"},
                {"id": "llm2", "type": "llm", "title": "LLM 2"},
            ],
            "edges": [{"source": "llm1", "target": "llm2", "sourceHandle": "source"}],
        }
        result = generate_mermaid(workflow_data)

        # Should be plain arrow without label
        assert "llm1 --> llm2" in result
        assert "llm1 -->|source|" not in result


class TestEdgeValidation:
    """Tests for edge validation and error handling."""

    def test_edge_with_missing_source_is_skipped(self):
        """Test edge with non-existent source node is skipped."""
        workflow_data = {
            "nodes": [{"id": "end", "type": "end", "title": "End"}],
            "edges": [{"source": "nonexistent", "target": "end"}],
        }
        result = generate_mermaid(workflow_data)

        # Should not contain the invalid edge
        assert "nonexistent" not in result
        assert "-->" not in result or "nonexistent" not in result

    def test_edge_with_missing_target_is_skipped(self):
        """Test edge with non-existent target node is skipped."""
        workflow_data = {
            "nodes": [{"id": "start", "type": "start", "title": "Start"}],
            "edges": [{"source": "start", "target": "nonexistent"}],
        }
        result = generate_mermaid(workflow_data)

        # Edge should be skipped
        assert "start --> nonexistent" not in result

    def test_edge_without_source_or_target_is_skipped(self):
        """Test edge missing source or target is skipped."""
        workflow_data = {
            "nodes": [{"id": "start", "type": "start", "title": "Start"}],
            "edges": [{"source": "start"}, {"target": "start"}, {}],
        }
        result = generate_mermaid(workflow_data)

        # No edges should be rendered
        assert result.count("-->") == 0


class TestToolNodes:
    """Tests for tool node formatting."""

    def test_tool_node_includes_tool_key(self):
        """Test tool node includes tool_key in label."""
        workflow_data = {
            "nodes": [
                {
                    "id": "search",
                    "type": "tool",
                    "title": "Search",
                    "config": {"tool_key": "google/search"},
                }
            ],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        assert 'search["type=tool|title=Search|tool=google/search"]' in result

    def test_tool_node_with_tool_name_fallback(self):
        """Test tool node uses tool_name as fallback."""
        workflow_data = {
            "nodes": [
                {
                    "id": "tool1",
                    "type": "tool",
                    "title": "My Tool",
                    "config": {"tool_name": "my_tool"},
                }
            ],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        assert "tool=my_tool" in result

    def test_tool_node_missing_tool_key_shows_unknown(self):
        """Test tool node without tool_key shows 'unknown'."""
        workflow_data = {
            "nodes": [{"id": "tool1", "type": "tool", "title": "Tool", "config": {}}],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        assert "tool=unknown" in result


class TestNodeFormatting:
    """Tests for node label formatting."""

    def test_quotes_in_title_are_escaped(self):
        """Test double quotes in title are replaced with single quotes."""
        workflow_data = {
            "nodes": [{"id": "llm", "type": "llm", "title": 'Say "Hello"'}],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        # Double quotes should be replaced
        assert "Say 'Hello'" in result
        assert 'Say "Hello"' not in result

    def test_node_without_id_is_skipped(self):
        """Test node without id is skipped."""
        workflow_data = {
            "nodes": [{"type": "llm", "title": "No ID"}],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        # Should only have flowchart header
        lines = [line for line in result.split("\n") if line.strip()]
        assert len(lines) == 1

    def test_node_default_values(self):
        """Test node with missing type/title uses defaults."""
        workflow_data = {
            "nodes": [{"id": "node1"}],
            "edges": [],
        }
        result = generate_mermaid(workflow_data)

        assert "type=unknown" in result
        assert "title=Untitled" in result
