"""
Unit tests for PluginToolManager passthrough functionality
"""

import pytest
from unittest.mock import MagicMock, patch
from core.plugin.impl.tool import PluginToolManager
from core.tools.entities.tool_entities import CredentialType


class TestPluginToolManagerPassthrough:
    """Test PluginToolManager passthrough functionality"""

    def test_plugin_tool_manager_invoke_signature(self):
        """Test PluginToolManager invoke method signature"""
        import inspect
        
        signature = inspect.signature(PluginToolManager.invoke)
        params = list(signature.parameters.keys())
        
        assert 'passthrough' in params
        
        # Check parameter type
        passthrough_param = signature.parameters['passthrough']
        assert passthrough_param.annotation == str | None

    def test_plugin_tool_manager_invoke_with_passthrough(self):
        """Test PluginToolManager invoke with passthrough parameter"""
        manager = PluginToolManager()
        
        with patch.object(manager, '_request_with_plugin_daemon_response_stream') as mock_request:
            # Configure mock to return a generator
            mock_response = MagicMock()
            mock_request.return_value = iter([mock_response])
            
            # Test invoke with passthrough
            passthrough_value = "test_passthrough_data"
            list(manager.invoke(
                tenant_id="test_tenant",
                user_id="test_user",
                tool_provider="test_provider",
                tool_name="test_tool",
                credentials={},
                credential_type=CredentialType.API_KEY,
                tool_parameters={"param1": "value1"},
                conversation_id="test_conversation",
                app_id="test_app",
                message_id="test_message",
                passthrough=passthrough_value
            ))
            
            # Verify that passthrough was included in the request data
            mock_request.assert_called_once()
            call_args = mock_request.call_args
            
            # Check that passthrough was included in data
            data = call_args.kwargs['data']
            assert 'passthrough' in data
            assert data['passthrough'] == passthrough_value

    def test_plugin_tool_manager_invoke_without_passthrough(self):
        """Test PluginToolManager invoke without passthrough parameter"""
        manager = PluginToolManager()
        
        with patch.object(manager, '_request_with_plugin_daemon_response_stream') as mock_request:
            # Configure mock to return a generator
            mock_response = MagicMock()
            mock_request.return_value = iter([mock_response])
            
            # Test invoke without passthrough
            list(manager.invoke(
                tenant_id="test_tenant",
                user_id="test_user",
                tool_provider="test_provider",
                tool_name="test_tool",
                credentials={},
                credential_type=CredentialType.API_KEY,
                tool_parameters={"param1": "value1"},
                conversation_id="test_conversation",
                app_id="test_app",
                message_id="test_message",
                passthrough=None
            ))
            
            # Verify that passthrough was None in the request data
            mock_request.assert_called_once()
            call_args = mock_request.call_args
            
            # Check that passthrough was None
            data = call_args.kwargs['data']
            assert 'passthrough' in data
            assert data['passthrough'] is None
