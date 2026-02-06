from unittest.mock import MagicMock, patch

import pytest

from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.agent.agent_node import AgentNode


class TestInferToolProviderType:
    """Test cases for AgentNode._infer_tool_provider_type method."""

    def test_infer_type_from_config_workflow(self):
        """Test inferring workflow provider type from config."""
        tool_config = {
            "type": "workflow",
            "provider_name": "workflow-provider-id",
        }
        tenant_id = "test-tenant"

        result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

        assert result == ToolProviderType.WORKFLOW

    def test_infer_type_from_config_builtin(self):
        """Test inferring builtin provider type from config."""
        tool_config = {
            "type": "builtin",
            "provider_name": "builtin-provider-id",
        }
        tenant_id = "test-tenant"

        result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

        assert result == ToolProviderType.BUILT_IN

    def test_infer_type_from_config_api(self):
        """Test inferring API provider type from config."""
        tool_config = {
            "type": "api",
            "provider_name": "api-provider-id",
        }
        tenant_id = "test-tenant"

        result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

        assert result == ToolProviderType.API

    def test_infer_type_from_config_mcp(self):
        """Test inferring MCP provider type from config."""
        tool_config = {
            "type": "mcp",
            "provider_name": "mcp-provider-id",
        }
        tenant_id = "test-tenant"

        result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

        assert result == ToolProviderType.MCP

    def test_infer_type_invalid_config_value_raises_error(self):
        """Test that invalid type value in config raises ValueError."""
        tool_config = {
            "type": "invalid-type",
            "provider_name": "workflow-provider-id",
        }
        tenant_id = "test-tenant"

        with pytest.raises(ValueError):
            AgentNode._infer_tool_provider_type(tool_config, tenant_id)

    def test_infer_workflow_type_from_database(self):
        """Test inferring workflow provider type from database."""
        tool_config = {
            "provider_name": "workflow-provider-id",
        }
        tenant_id = "test-tenant"

        with patch("core.db.session_factory.session_factory.create_session") as mock_create_session:
            mock_session = MagicMock()
            mock_create_session.return_value.__enter__.return_value = mock_session

            # First query (WorkflowToolProvider) returns a result
            mock_session.scalar.return_value = True

            result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

            assert result == ToolProviderType.WORKFLOW
            # Should only query once (after finding WorkflowToolProvider)
            assert mock_session.scalar.call_count == 1

    def test_infer_mcp_type_from_database(self):
        """Test inferring MCP provider type from database."""
        tool_config = {
            "provider_name": "mcp-provider-id",
        }
        tenant_id = "test-tenant"

        with patch("core.db.session_factory.session_factory.create_session") as mock_create_session:
            mock_session = MagicMock()
            mock_create_session.return_value.__enter__.return_value = mock_session

            # First query (WorkflowToolProvider) returns None
            # Second query (MCPToolProvider) returns a result
            mock_session.scalar.side_effect = [None, True]

            result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

            assert result == ToolProviderType.MCP
            assert mock_session.scalar.call_count == 2

    def test_infer_api_type_from_database(self):
        """Test inferring API provider type from database."""
        tool_config = {
            "provider_name": "api-provider-id",
        }
        tenant_id = "test-tenant"

        with patch("core.db.session_factory.session_factory.create_session") as mock_create_session:
            mock_session = MagicMock()
            mock_create_session.return_value.__enter__.return_value = mock_session

            # First query (WorkflowToolProvider) returns None
            # Second query (MCPToolProvider) returns None
            # Third query (ApiToolProvider) returns a result
            mock_session.scalar.side_effect = [None, None, True]

            result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

            assert result == ToolProviderType.API
            assert mock_session.scalar.call_count == 3

    def test_infer_builtin_type_from_database(self):
        """Test inferring builtin provider type from database."""
        tool_config = {
            "provider_name": "builtin-provider-id",
        }
        tenant_id = "test-tenant"

        with patch("core.db.session_factory.session_factory.create_session") as mock_create_session:
            mock_session = MagicMock()
            mock_create_session.return_value.__enter__.return_value = mock_session

            # First three queries return None
            # Fourth query (BuiltinToolProvider) returns a result
            mock_session.scalar.side_effect = [None, None, None, True]

            result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

            assert result == ToolProviderType.BUILT_IN
            assert mock_session.scalar.call_count == 4

    def test_infer_type_default_when_not_found(self):
        """Test raising AgentNodeError when provider is not found in database."""
        tool_config = {
            "provider_name": "unknown-provider-id",
        }
        tenant_id = "test-tenant"

        with patch("core.db.session_factory.session_factory.create_session") as mock_create_session:
            mock_session = MagicMock()
            mock_create_session.return_value.__enter__.return_value = mock_session

            # All queries return None
            mock_session.scalar.return_value = None

            # Current implementation raises AgentNodeError when provider not found
            from core.workflow.nodes.agent.exc import AgentNodeError

            with pytest.raises(AgentNodeError, match="Tool provider with ID 'unknown-provider-id' not found"):
                AgentNode._infer_tool_provider_type(tool_config, tenant_id)

    def test_infer_type_default_when_no_provider_name(self):
        """Test defaulting to BUILT_IN when provider_name is missing."""
        tool_config = {}
        tenant_id = "test-tenant"

        result = AgentNode._infer_tool_provider_type(tool_config, tenant_id)

        assert result == ToolProviderType.BUILT_IN

    def test_infer_type_database_exception_propagates(self):
        """Test that database exception propagates (current implementation doesn't catch it)."""
        tool_config = {
            "provider_name": "provider-id",
        }
        tenant_id = "test-tenant"

        with patch("core.db.session_factory.session_factory.create_session") as mock_create_session:
            mock_session = MagicMock()
            mock_create_session.return_value.__enter__.return_value = mock_session

            # Database query raises exception
            mock_session.scalar.side_effect = Exception("Database error")

            # Current implementation doesn't catch exceptions, so it propagates
            with pytest.raises(Exception, match="Database error"):
                AgentNode._infer_tool_provider_type(tool_config, tenant_id)
