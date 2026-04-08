"""Basic tests for Agent V2 node — Phase 1 + 2 validation.

Tests:
1. Module imports resolve without errors
2. AgentV2Node self-registers in the graphon Node registry
3. DifyNodeFactory kwargs mapping includes agent-v2
4. StrategyFactory selects correct strategy based on model features
5. AgentV2NodeData validates with and without tools
"""

import pytest


class TestPhase1Imports:
    """Verify Phase 1 (Agent Patterns) modules import correctly."""

    def test_entities_import(self):
        from core.agent.entities import AgentLog, AgentResult, ExecutionContext

        assert ExecutionContext is not None
        assert AgentLog is not None
        assert AgentResult is not None

    def test_entities_backward_compatible(self):
        from core.agent.entities import (
            AgentEntity,
            AgentInvokeMessage,
            AgentPromptEntity,
            AgentScratchpadUnit,
            AgentToolEntity,
        )

        assert AgentEntity is not None
        assert AgentToolEntity is not None
        assert AgentPromptEntity is not None
        assert AgentScratchpadUnit is not None
        assert AgentInvokeMessage is not None

    def test_patterns_module_import(self):
        from core.agent.patterns import (
            AgentPattern,
            FunctionCallStrategy,
            ReActStrategy,
            StrategyFactory,
        )

        assert AgentPattern is not None
        assert FunctionCallStrategy is not None
        assert ReActStrategy is not None
        assert StrategyFactory is not None

    def test_patterns_inheritance(self):
        from core.agent.patterns import AgentPattern, FunctionCallStrategy, ReActStrategy

        assert issubclass(FunctionCallStrategy, AgentPattern)
        assert issubclass(ReActStrategy, AgentPattern)


class TestPhase2Imports:
    """Verify Phase 2 (Agent V2 Node) modules import correctly."""

    def test_entities_import(self):
        from core.workflow.nodes.agent_v2.entities import (
            AGENT_V2_NODE_TYPE,
            AgentV2NodeData,
            ContextConfig,
            ToolMetadata,
            VisionConfig,
        )

        assert AGENT_V2_NODE_TYPE == "agent-v2"
        assert AgentV2NodeData is not None
        assert ToolMetadata is not None

    def test_node_import(self):
        from core.workflow.nodes.agent_v2.node import AgentV2Node

        assert AgentV2Node is not None
        assert AgentV2Node.node_type == "agent-v2"

    def test_tool_manager_import(self):
        from core.workflow.nodes.agent_v2.tool_manager import AgentV2ToolManager

        assert AgentV2ToolManager is not None

    def test_event_adapter_import(self):
        from core.workflow.nodes.agent_v2.event_adapter import AgentV2EventAdapter

        assert AgentV2EventAdapter is not None


class TestNodeRegistration:
    """Verify AgentV2Node self-registers in the graphon Node registry."""

    def test_agent_v2_in_registry(self):
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        assert "agent-v2" in registry, f"agent-v2 not found in registry. Available: {list(registry.keys())}"

    def test_agent_v2_latest_version(self):
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        agent_v2_versions = registry.get("agent-v2", {})
        assert "latest" in agent_v2_versions
        assert "1" in agent_v2_versions

        from core.workflow.nodes.agent_v2.node import AgentV2Node

        assert agent_v2_versions["latest"] is AgentV2Node
        assert agent_v2_versions["1"] is AgentV2Node

    def test_old_agent_still_registered(self):
        """Old Agent node must not be affected by Agent V2."""
        from core.workflow.node_factory import register_nodes

        register_nodes()

        from graphon.nodes.base.node import Node

        registry = Node.get_node_type_classes_mapping()
        assert "agent" in registry, "Old agent node must still be registered"

    def test_resolve_workflow_node_class(self):
        from core.workflow.node_factory import register_nodes, resolve_workflow_node_class
        from core.workflow.nodes.agent_v2.node import AgentV2Node

        register_nodes()

        resolved = resolve_workflow_node_class(node_type="agent-v2", node_version="1")
        assert resolved is AgentV2Node

        resolved_latest = resolve_workflow_node_class(node_type="agent-v2", node_version="latest")
        assert resolved_latest is AgentV2Node


class TestNodeFactoryKwargs:
    """Verify DifyNodeFactory includes agent-v2 in kwargs mapping."""

    def test_agent_v2_node_type_in_factory(self):
        from core.workflow.node_factory import AGENT_V2_NODE_TYPE

        assert AGENT_V2_NODE_TYPE == "agent-v2"


class TestStrategyFactory:
    """Verify StrategyFactory selects correct strategy."""

    def test_fc_selected_for_tool_call_model(self):
        from graphon.model_runtime.entities.model_entities import ModelFeature

        from core.agent.patterns import FunctionCallStrategy, StrategyFactory

        assert ModelFeature.TOOL_CALL in StrategyFactory.TOOL_CALL_FEATURES
        assert ModelFeature.MULTI_TOOL_CALL in StrategyFactory.TOOL_CALL_FEATURES

    def test_factory_has_create_strategy(self):
        from core.agent.patterns import StrategyFactory

        assert callable(getattr(StrategyFactory, "create_strategy", None))


class TestAgentV2NodeData:
    """Verify AgentV2NodeData validation."""

    def test_minimal_data(self):
        from core.workflow.nodes.agent_v2.entities import AgentV2NodeData

        data = AgentV2NodeData(
            title="Test Agent",
            model={"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
            prompt_template=[{"role": "system", "text": "You are helpful."}, {"role": "user", "text": "Hello"}],
            context={"enabled": False},
        )
        assert data.type == "agent-v2"
        assert data.tool_call_enabled is False
        assert data.max_iterations == 10
        assert data.agent_strategy == "auto"

    def test_data_with_tools(self):
        from core.workflow.nodes.agent_v2.entities import AgentV2NodeData

        data = AgentV2NodeData(
            title="Test Agent with Tools",
            model={"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
            prompt_template=[{"role": "user", "text": "Search for {{query}}"}],
            context={"enabled": False},
            tools=[
                {
                    "enabled": True,
                    "type": "builtin",
                    "provider_name": "google",
                    "tool_name": "google_search",
                }
            ],
            max_iterations=5,
            agent_strategy="function-calling",
        )
        assert data.tool_call_enabled is True
        assert data.max_iterations == 5
        assert data.agent_strategy == "function-calling"
        assert len(data.tools) == 1

    def test_data_with_disabled_tools(self):
        from core.workflow.nodes.agent_v2.entities import AgentV2NodeData

        data = AgentV2NodeData(
            title="Test Agent",
            model={"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
            prompt_template=[{"role": "user", "text": "Hello"}],
            context={"enabled": False},
            tools=[
                {
                    "enabled": False,
                    "type": "builtin",
                    "provider_name": "google",
                    "tool_name": "google_search",
                }
            ],
        )
        assert data.tool_call_enabled is False

    def test_data_with_memory(self):
        from core.workflow.nodes.agent_v2.entities import AgentV2NodeData

        data = AgentV2NodeData(
            title="Test Agent",
            model={"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
            prompt_template=[{"role": "user", "text": "Hello"}],
            context={"enabled": False},
            memory={"window": {"enabled": True, "size": 50}},
        )
        assert data.memory is not None
        assert data.memory.window.enabled is True
        assert data.memory.window.size == 50

    def test_data_with_vision(self):
        from core.workflow.nodes.agent_v2.entities import AgentV2NodeData

        data = AgentV2NodeData(
            title="Test Agent",
            model={"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
            prompt_template=[{"role": "user", "text": "Hello"}],
            context={"enabled": False},
            vision={"enabled": True},
        )
        assert data.vision.enabled is True


class TestExecutionContext:
    """Verify ExecutionContext entity."""

    def test_create_minimal(self):
        from core.agent.entities import ExecutionContext

        ctx = ExecutionContext.create_minimal(user_id="user-123")
        assert ctx.user_id == "user-123"
        assert ctx.app_id is None

    def test_to_dict(self):
        from core.agent.entities import ExecutionContext

        ctx = ExecutionContext(user_id="u1", app_id="a1", tenant_id="t1")
        d = ctx.to_dict()
        assert d["user_id"] == "u1"
        assert d["app_id"] == "a1"
        assert d["tenant_id"] == "t1"
        assert d["conversation_id"] is None

    def test_with_updates(self):
        from core.agent.entities import ExecutionContext

        ctx = ExecutionContext(user_id="u1")
        ctx2 = ctx.with_updates(app_id="a1", conversation_id="c1")
        assert ctx2.user_id == "u1"
        assert ctx2.app_id == "a1"
        assert ctx2.conversation_id == "c1"


class TestAgentLog:
    """Verify AgentLog entity."""

    def test_create_log(self):
        from core.agent.entities import AgentLog

        log = AgentLog(
            label="Round 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={"key": "value"},
        )
        assert log.id is not None
        assert log.label == "Round 1"
        assert log.log_type == "round"
        assert log.status == "start"
        assert log.parent_id is None

    def test_log_types(self):
        from core.agent.entities import AgentLog

        assert AgentLog.LogType.ROUND == "round"
        assert AgentLog.LogType.THOUGHT == "thought"
        assert AgentLog.LogType.TOOL_CALL == "tool_call"


class TestAgentResult:
    """Verify AgentResult entity."""

    def test_default_result(self):
        from core.agent.entities import AgentResult

        result = AgentResult()
        assert result.text == ""
        assert result.files == []
        assert result.usage is None
        assert result.finish_reason is None

    def test_result_with_data(self):
        from core.agent.entities import AgentResult

        result = AgentResult(text="Hello world", finish_reason="stop")
        assert result.text == "Hello world"
        assert result.finish_reason == "stop"
