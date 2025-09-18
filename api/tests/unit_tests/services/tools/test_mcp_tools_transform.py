"""Test cases for MCP tool transformation functionality."""

from unittest.mock import Mock

from core.mcp.types import Tool as MCPTool
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService


class TestMCPToolTransform:
    """Test cases for MCP tool transformation methods."""

    def test_mcp_tool_to_user_tool_with_none_description(self):
        """Test that mcp_tool_to_user_tool handles None description correctly."""
        # Create mock MCP provider
        mock_provider = Mock(spec=MCPToolProvider)
        mock_user = Mock()
        mock_user.name = "Test User"
        mock_provider.load_user.return_value = mock_user

        # Create MCP tools with None description
        tools = [
            MCPTool(
                name="tool1",
                description=None,  # This is the case that caused the error
                inputSchema={"type": "object", "properties": {}},
            ),
            MCPTool(
                name="tool2",
                description=None,
                inputSchema={
                    "type": "object",
                    "properties": {"param1": {"type": "string", "description": "A parameter"}},
                },
            ),
        ]

        # Call the method
        result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

        # Verify the result
        assert len(result) == 2
        assert all(isinstance(tool, ToolApiEntity) for tool in result)

        # Check first tool
        assert result[0].name == "tool1"
        assert result[0].author == "Test User"
        assert isinstance(result[0].label, I18nObject)
        assert result[0].label.en_US == "tool1"
        assert isinstance(result[0].description, I18nObject)
        assert result[0].description.en_US == ""  # Should be empty string, not None
        assert result[0].description.zh_Hans == ""

        # Check second tool
        assert result[1].name == "tool2"
        assert result[1].description.en_US == ""
        assert result[1].description.zh_Hans == ""

    def test_mcp_tool_to_user_tool_with_description(self):
        """Test that mcp_tool_to_user_tool handles normal description correctly."""
        # Create mock MCP provider
        mock_provider = Mock(spec=MCPToolProvider)
        mock_user = Mock()
        mock_user.name = "Test User"
        mock_provider.load_user.return_value = mock_user

        # Create MCP tools with description
        tools = [
            MCPTool(
                name="tool_with_desc",
                description="This is a test tool that does something useful",
                inputSchema={"type": "object", "properties": {}},
            )
        ]

        # Call the method
        result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

        # Verify the result
        assert len(result) == 1
        assert isinstance(result[0], ToolApiEntity)
        assert result[0].name == "tool_with_desc"
        assert result[0].description.en_US == "This is a test tool that does something useful"
        assert result[0].description.zh_Hans == "This is a test tool that does something useful"

    def test_mcp_tool_to_user_tool_with_no_user(self):
        """Test that mcp_tool_to_user_tool handles None user correctly."""
        # Create mock MCP provider with no user
        mock_provider = Mock(spec=MCPToolProvider)
        mock_provider.load_user.return_value = None

        # Create MCP tool
        tools = [MCPTool(name="tool1", description="Test tool", inputSchema={"type": "object", "properties": {}})]

        # Call the method
        result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

        # Verify the result
        assert len(result) == 1
        assert result[0].author == "Anonymous"

    def test_mcp_tool_to_user_tool_with_complex_schema(self):
        """Test that mcp_tool_to_user_tool correctly converts complex input schemas."""
        # Create mock MCP provider
        mock_provider = Mock(spec=MCPToolProvider)
        mock_user = Mock()
        mock_user.name = "Test User"
        mock_provider.load_user.return_value = mock_user

        # Create MCP tool with complex schema
        tools = [
            MCPTool(
                name="complex_tool",
                description="A tool with complex parameters",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Input text"},
                        "count": {"type": "integer", "description": "Number of items", "minimum": 1, "maximum": 100},
                        "options": {"type": "array", "items": {"type": "string"}, "description": "List of options"},
                    },
                    "required": ["text"],
                },
            )
        ]

        # Call the method
        result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

        # Verify the result
        assert len(result) == 1
        assert result[0].name == "complex_tool"
        assert result[0].parameters is not None
        # The actual parameter conversion is handled by convert_mcp_schema_to_parameter
        # which should be tested separately

    def test_mcp_provider_to_user_provider_for_list(self):
        """Test mcp_provider_to_user_provider with for_list=True."""
        # Create mock MCP provider
        mock_provider = Mock(spec=MCPToolProvider)
        mock_provider.id = "provider-id-123"
        mock_provider.server_identifier = "server-identifier-456"
        mock_provider.name = "Test MCP Provider"
        mock_provider.provider_icon = "icon.png"
        mock_provider.authed = True
        mock_provider.masked_server_url = "https://*****.com/mcp"
        mock_provider.timeout = 30
        mock_provider.sse_read_timeout = 300
        mock_provider.masked_headers = {"Authorization": "Bearer *****"}
        mock_provider.decrypted_headers = {"Authorization": "Bearer secret-token"}
        mock_updated_at = Mock()
        mock_updated_at.timestamp.return_value = 1234567890
        mock_provider.updated_at = mock_updated_at
        mock_provider.tools = '[{"name": "tool1", "description": null, "inputSchema": {}}]'
        mock_user = Mock()
        mock_user.name = "Test User"
        mock_provider.load_user.return_value = mock_user

        # Call the method with for_list=True
        result = ToolTransformService.mcp_provider_to_user_provider(mock_provider, for_list=True)

        # Verify the result
        assert isinstance(result, ToolProviderApiEntity)
        assert result.id == "provider-id-123"  # Should use provider.id when for_list=True
        assert result.name == "Test MCP Provider"
        assert result.type == ToolProviderType.MCP
        assert result.is_team_authorization is True
        assert result.server_url == "https://*****.com/mcp"
        assert len(result.tools) == 1
        assert result.tools[0].description.en_US == ""  # Should handle None description

    def test_mcp_provider_to_user_provider_not_for_list(self):
        """Test mcp_provider_to_user_provider with for_list=False."""
        # Create mock MCP provider
        mock_provider = Mock(spec=MCPToolProvider)
        mock_provider.id = "provider-id-123"
        mock_provider.server_identifier = "server-identifier-456"
        mock_provider.name = "Test MCP Provider"
        mock_provider.provider_icon = "icon.png"
        mock_provider.authed = True
        mock_provider.masked_server_url = "https://*****.com/mcp"
        mock_provider.timeout = 30
        mock_provider.sse_read_timeout = 300
        mock_provider.masked_headers = {"Authorization": "Bearer *****"}
        mock_provider.decrypted_headers = {"Authorization": "Bearer secret-token"}
        mock_updated_at = Mock()
        mock_updated_at.timestamp.return_value = 1234567890
        mock_provider.updated_at = mock_updated_at
        mock_provider.tools = '[{"name": "tool1", "description": "Tool description", "inputSchema": {}}]'
        mock_user = Mock()
        mock_user.name = "Test User"
        mock_provider.load_user.return_value = mock_user

        # Call the method with for_list=False
        result = ToolTransformService.mcp_provider_to_user_provider(mock_provider, for_list=False)

        # Verify the result
        assert isinstance(result, ToolProviderApiEntity)
        assert result.id == "server-identifier-456"  # Should use server_identifier when for_list=False
        assert result.server_identifier == "server-identifier-456"
        assert result.timeout == 30
        assert result.sse_read_timeout == 300
        assert result.original_headers == {"Authorization": "Bearer secret-token"}
        assert len(result.tools) == 1
        assert result.tools[0].description.en_US == "Tool description"
