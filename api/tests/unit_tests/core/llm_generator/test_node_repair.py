from core.workflow.generator.utils.node_repair import NodeRepair


class TestNodeRepair:
    """Tests for NodeRepair utility."""

    def test_repair_if_else_valid_operators(self):
        """Test that valid operators remain unchanged."""
        nodes = [
            {
                "id": "node1",
                "type": "if-else",
                "config": {
                    "cases": [
                        {
                            "conditions": [
                                {"comparison_operator": "≥", "value": "1"},
                                {"comparison_operator": "=", "value": "2"},
                            ]
                        }
                    ]
                },
            }
        ]
        result = NodeRepair.repair(nodes)
        assert result.was_repaired is False
        assert result.nodes == nodes

    def test_repair_if_else_invalid_operators(self):
        """Test that invalid operators are normalized."""
        nodes = [
            {
                "id": "node1",
                "type": "if-else",
                "config": {
                    "cases": [
                        {
                            "conditions": [
                                {"comparison_operator": ">=", "value": "1"},
                                {"comparison_operator": "<=", "value": "2"},
                                {"comparison_operator": "!=", "value": "3"},
                                {"comparison_operator": "==", "value": "4"},
                            ]
                        }
                    ]
                },
            }
        ]
        result = NodeRepair.repair(nodes)
        assert result.was_repaired is True
        assert len(result.repairs_made) == 4

        conditions = result.nodes[0]["config"]["cases"][0]["conditions"]
        assert conditions[0]["comparison_operator"] == "≥"
        assert conditions[1]["comparison_operator"] == "≤"
        assert conditions[2]["comparison_operator"] == "≠"
        assert conditions[3]["comparison_operator"] == "="

    def test_repair_ignores_other_nodes(self):
        """Test that other node types are ignored."""
        nodes = [{"id": "node1", "type": "llm", "config": {"some_field": ">="}}]
        result = NodeRepair.repair(nodes)
        assert result.was_repaired is False
        assert result.nodes[0]["config"]["some_field"] == ">="

    def test_repair_handles_missing_config(self):
        """Test robustness against missing fields."""
        nodes = [
            {
                "id": "node1",
                "type": "if-else",
                # Missing config
            },
            {
                "id": "node2",
                "type": "if-else",
                "config": {},  # Missing cases
            },
        ]
        result = NodeRepair.repair(nodes)
        assert result.was_repaired is False
