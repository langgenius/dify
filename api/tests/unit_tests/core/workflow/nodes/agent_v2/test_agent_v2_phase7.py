"""Tests for Phase 7 — New/old agent node parallel compatibility."""

import pytest


class TestAgentV2DefaultConfig:
    """Verify Agent V2 node provides default block configuration."""

    def test_has_default_config(self):
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        agent_v2_cls = registry["agent-v2"]["latest"]
        config = agent_v2_cls.get_default_config()

        assert config, "Agent V2 should have a default config"
        assert config["type"] == "agent-v2"
        assert "config" in config
        assert "prompt_templates" in config["config"]
        assert "agent_strategy" in config["config"]
        assert config["config"]["agent_strategy"] == "auto"
        assert config["config"]["max_iterations"] == 10

    def test_old_agent_no_default_config(self):
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        agent_cls = registry["agent"]["latest"]
        config = agent_cls.get_default_config()
        assert config == {} or config is None or not config


class TestParallelNodeRegistration:
    """Verify both agent and agent-v2 coexist in the registry."""

    def test_both_registered(self):
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        assert "agent" in registry
        assert "agent-v2" in registry

    def test_different_classes(self):
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        old_cls = registry["agent"]["latest"]
        new_cls = registry["agent-v2"]["latest"]
        assert old_cls is not new_cls

    def test_default_configs_list_contains_agent_v2(self):
        """Verify agent-v2 appears in the full default block configs list.

        Instead of instantiating WorkflowService (which requires Flask/DB),
        we replicate the same iteration logic over the node registry.
        """
        from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping, register_nodes

        register_nodes()

        types_with_config: set[str] = set()
        for node_type, mapping in get_node_type_classes_mapping().items():
            node_cls = mapping.get(LATEST_VERSION)
            if node_cls:
                cfg = node_cls.get_default_config()
                if cfg and isinstance(cfg, dict):
                    types_with_config.add(cfg.get("type", ""))

        assert "agent-v2" in types_with_config


class TestAgentModeWorkflowAccess:
    """Verify AGENT mode is allowed in workflow-related API mode checks."""

    def test_workflow_controller_allows_agent(self):
        """Check that the workflow.py source allows AppMode.AGENT."""
        import inspect

        from controllers.console.app import workflow

        source = inspect.getsource(workflow)
        assert "AppMode.AGENT" in source

    def test_service_api_chat_allows_agent(self):
        """Check that service API chat endpoint allows AGENT mode."""
        import inspect

        from controllers.service_api.app import completion

        source = inspect.getsource(completion)
        assert "AppMode.AGENT" in source

    def test_service_api_conversation_allows_agent(self):
        import inspect

        from controllers.service_api.app import conversation

        source = inspect.getsource(conversation)
        assert "AppMode.AGENT" in source
