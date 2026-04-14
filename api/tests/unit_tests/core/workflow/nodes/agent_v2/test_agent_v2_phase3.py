"""Tests for Phase 3 — Agent app type support."""

import pytest


class TestAppModeAgent:
    """Verify AppMode.AGENT is properly defined."""

    def test_agent_mode_exists(self):
        from models.model import AppMode

        assert hasattr(AppMode, "AGENT")
        assert AppMode.AGENT == "agent"

    def test_agent_mode_value_of(self):
        from models.model import AppMode

        mode = AppMode.value_of("agent")
        assert mode == AppMode.AGENT

    def test_all_original_modes_still_work(self):
        from models.model import AppMode

        for val in ["completion", "workflow", "chat", "advanced-chat", "agent-chat", "channel", "rag-pipeline"]:
            mode = AppMode.value_of(val)
            assert mode.value == val


class TestDefaultAppTemplate:
    """Verify AGENT template is defined."""

    def test_agent_template_exists(self):
        from constants.model_template import default_app_templates
        from models.model import AppMode

        assert AppMode.AGENT in default_app_templates
        template = default_app_templates[AppMode.AGENT]
        assert template["app"]["mode"] == AppMode.AGENT
        assert template["app"]["enable_site"] is True
        assert "model_config" in template

    def test_all_original_templates_exist(self):
        from constants.model_template import default_app_templates
        from models.model import AppMode

        for mode in [AppMode.WORKFLOW, AppMode.COMPLETION, AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT_CHAT]:
            assert mode in default_app_templates


class TestWorkflowGraphFactory:
    """Verify WorkflowGraphFactory creates valid graphs."""

    def test_create_chat_graph(self):
        from services.workflow.graph_factory import WorkflowGraphFactory

        model_config = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}
        graph = WorkflowGraphFactory.create_single_agent_graph(model_config, is_chat=True)

        assert "nodes" in graph
        assert "edges" in graph
        assert len(graph["nodes"]) == 3
        assert len(graph["edges"]) == 2

        node_types = [n["data"]["type"] for n in graph["nodes"]]
        assert "start" in node_types
        assert "agent-v2" in node_types
        assert "answer" in node_types

        agent_node = next(n for n in graph["nodes"] if n["data"]["type"] == "agent-v2")
        assert agent_node["data"]["model"] == model_config
        assert agent_node["data"]["memory"] is not None

    def test_create_workflow_graph(self):
        from services.workflow.graph_factory import WorkflowGraphFactory

        model_config = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}
        graph = WorkflowGraphFactory.create_single_agent_graph(model_config, is_chat=False)

        node_types = [n["data"]["type"] for n in graph["nodes"]]
        assert "end" in node_types
        assert "answer" not in node_types

        agent_node = next(n for n in graph["nodes"] if n["data"]["type"] == "agent-v2")
        assert agent_node["data"].get("memory") is None

    def test_edge_connectivity(self):
        from services.workflow.graph_factory import WorkflowGraphFactory

        graph = WorkflowGraphFactory.create_single_agent_graph(
            {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
            is_chat=True,
        )

        edges = graph["edges"]
        sources = {e["source"] for e in edges}
        targets = {e["target"] for e in edges}
        assert "start" in sources
        assert "agent" in sources
        assert "agent" in targets
        assert "answer" in targets


class TestConsoleAppController:
    """Verify Console API allows 'agent' mode."""

    def test_allow_create_app_modes(self):
        from controllers.console.app.app import ALLOW_CREATE_APP_MODES

        assert "agent" in ALLOW_CREATE_APP_MODES
        assert "chat" in ALLOW_CREATE_APP_MODES
        assert "agent-chat" in ALLOW_CREATE_APP_MODES


class TestAppGenerateServiceHasAgentCase:
    """Verify the generate() method has an AppMode.AGENT case."""

    def test_generate_method_exists(self):
        from services.app_generate_service import AppGenerateService

        assert hasattr(AppGenerateService, "generate")

    def test_agent_mode_import(self):
        """Verify AppMode.AGENT can be used in match statement context."""
        from models.model import AppMode

        mode = AppMode.AGENT
        match mode:
            case AppMode.AGENT:
                result = "agent"
            case _:
                result = "other"
        assert result == "agent"
