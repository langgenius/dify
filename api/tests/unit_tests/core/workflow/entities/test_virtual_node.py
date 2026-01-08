"""
Unit tests for virtual node configuration.
"""

from core.workflow.nodes.base.entities import VirtualNodeConfig


class TestVirtualNodeConfig:
    """Tests for VirtualNodeConfig entity."""

    def test_create_basic_config(self):
        """Test creating a basic virtual node config."""
        config = VirtualNodeConfig(
            id="ext_1",
            type="llm",
            data={
                "title": "Extract keywords",
                "model": {"provider": "openai", "name": "gpt-4o-mini"},
            },
        )

        assert config.id == "ext_1"
        assert config.type == "llm"
        assert config.data["title"] == "Extract keywords"

    def test_get_global_id(self):
        """Test generating global ID from parent ID."""
        config = VirtualNodeConfig(
            id="ext_1",
            type="llm",
            data={},
        )

        global_id = config.get_global_id("tool1")
        assert global_id == "tool1.ext_1"

    def test_get_global_id_with_different_parents(self):
        """Test global ID generation with different parent IDs."""
        config = VirtualNodeConfig(id="sub_node", type="code", data={})

        assert config.get_global_id("parent1") == "parent1.sub_node"
        assert config.get_global_id("node_123") == "node_123.sub_node"

    def test_empty_data(self):
        """Test virtual node config with empty data."""
        config = VirtualNodeConfig(
            id="test",
            type="tool",
        )

        assert config.id == "test"
        assert config.type == "tool"
        assert config.data == {}

    def test_complex_data(self):
        """Test virtual node config with complex data."""
        config = VirtualNodeConfig(
            id="llm_1",
            type="llm",
            data={
                "title": "Generate summary",
                "model": {
                    "provider": "openai",
                    "name": "gpt-4",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.7, "max_tokens": 500},
                },
                "prompt_template": [
                    {"role": "user", "text": "{{#llm1.context#}}"},
                    {"role": "user", "text": "Please summarize the conversation"},
                ],
            },
        )

        assert config.data["model"]["provider"] == "openai"
        assert len(config.data["prompt_template"]) == 2

