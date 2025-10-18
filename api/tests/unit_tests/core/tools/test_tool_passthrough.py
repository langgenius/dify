"""
Unit tests for Tool passthrough functionality
"""

import pytest
from unittest.mock import MagicMock, patch
from core.tools.tool_engine import ToolEngine
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage


class MockTool(Tool):
    """Mock tool for testing"""
    
    def tool_provider_type(self):
        from core.tools.entities.tool_entities import ToolProviderType
        return ToolProviderType.BUILT_IN
    
    def _invoke(self, user_id: str, tool_parameters: dict, conversation_id: str | None= None, 
                app_id: str | None = None, message_id: str | None = None, passthrough: str | None = None):
        """Mock invoke method"""
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT,
            message=ToolInvokeMessage.TextMessage(text=f"passthrough: {passthrough}")
        )


class TestToolPassthrough:
    """Test Tool passthrough functionality"""

    def test_tool_invoke_with_passthrough(self):
        """Test tool invoke method with passthrough parameter"""
        # Create mock tool
        tool_entity = ToolEntity(
            identity=MagicMock(),
            parameters=[],
            description=None,
            output_schema={},
            has_runtime_parameters=False
        )
        tool_runtime = MagicMock()
        tool = MockTool(entity=tool_entity, runtime=tool_runtime)
        
        # Test invoke with passthrough
        result = tool.invoke(
            user_id="test_user",
            tool_parameters={"param1": "value1"},
            conversation_id="test_conversation",
            app_id="test_app",
            message_id="test_message",
            passthrough="test_passthrough_data"
        )
        
        # Verify result
        messages = list(result)
        assert len(messages) == 1
        assert messages[0].message.text == "passthrough: test_passthrough_data"

    def test_tool_invoke_without_passthrough(self):
        """Test tool invoke method without passthrough parameter"""
        # Create mock tool
        tool_entity = ToolEntity(
            identity=MagicMock(),
            parameters=[],
            description=None,
            output_schema={},
            has_runtime_parameters=False
        )
        tool_runtime = MagicMock()
        tool = MockTool(entity=tool_entity, runtime=tool_runtime)
        
        # Test invoke without passthrough
        result = tool.invoke(
            user_id="test_user",
            tool_parameters={"param1": "value1"},
            conversation_id="test_conversation",
            app_id="test_app",
            message_id="test_message",
            passthrough=None
        )
        
        # Verify result
        messages = list(result)
        assert len(messages) == 1
        assert messages[0].message.text == "passthrough: None"

    def test_tool_engine_generic_invoke_signature(self):
        """Test ToolEngine generic_invoke method signature"""
        import inspect
        
        signature = inspect.signature(ToolEngine.generic_invoke)
        params = list(signature.parameters.keys())
        
        assert 'passthrough' in params
        
        # Check parameter type
        passthrough_param = signature.parameters['passthrough']
        assert passthrough_param.annotation == str | None

    def test_tool_base_class_invoke_signature(self):
        """Test Tool base class invoke method signature"""
        import inspect
        
        signature = inspect.signature(Tool.invoke)
        params = list(signature.parameters.keys())
        
        assert 'passthrough' in params
        
        # Check parameter type
        passthrough_param = signature.parameters['passthrough']
        assert passthrough_param.annotation == str | None

    def test_tool_base_class_invoke_signature(self):
        """Test Tool base class _invoke method signature"""
        import inspect
        
        signature = inspect.signature(Tool._invoke)
        params = list(signature.parameters.keys())
        
        assert 'passthrough' in params
        
        # Check parameter type
        passthrough_param = signature.parameters['passthrough']
        assert passthrough_param.annotation == str | None
