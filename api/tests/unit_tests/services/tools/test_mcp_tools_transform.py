"""Test cases for MCP tool transformation functionality."""

from unittest.mock import Mock

import pytest

from core.mcp.types import Tool as MCPTool
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService


@pytest.fixture
def mock_user():
    """Provides a mock user object."""
    user = Mock()
    user.name = "Test User"
    return user


@pytest.fixture
def mock_provider(mock_user):
    """Provides a mock MCPToolProvider with a loaded user."""
    provider = Mock(spec=MCPToolProvider)
    provider.load_user.return_value = mock_user
    return provider


@pytest.fixture
def mock_provider_no_user():
    """Provides a mock MCPToolProvider with no user."""
    provider = Mock(spec=MCPToolProvider)
    provider.load_user.return_value = None
    return provider


@pytest.fixture
def mock_provider_full(mock_user):
    """Provides a fully configured mock MCPToolProvider for detailed tests."""
    provider = Mock(spec=MCPToolProvider)
    provider.id = "provider-id-123"
    provider.server_identifier = "server-identifier-456"
    provider.name = "Test MCP Provider"
    provider.provider_icon = "icon.png"
    provider.authed = True
    provider.masked_server_url = "https://*****.com/mcp"
    provider.timeout = 30
    provider.sse_read_timeout = 300
    provider.masked_headers = {"Authorization": "Bearer *****"}
    provider.decrypted_headers = {"Authorization": "Bearer secret-token"}

    # Mock timestamp
    mock_updated_at = Mock()
    mock_updated_at.timestamp.return_value = 1234567890
    provider.updated_at = mock_updated_at

    provider.load_user.return_value = mock_user
    return provider


@pytest.fixture
def sample_mcp_tools():
    """Provides sample MCP tools for testing."""
    return {
        "simple": MCPTool(
            name="simple_tool", description="A simple test tool", inputSchema={"type": "object", "properties": {}}
        ),
        "none_desc": MCPTool(name="tool_none_desc", description=None, inputSchema={"type": "object", "properties": {}}),
        "complex": MCPTool(
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
        ),
    }


class TestMCPToolTransform:
    """Test cases for MCP tool transformation methods."""

    def test_mcp_tool_to_user_tool_with_none_description(self, mock_provider):
        """Test that mcp_tool_to_user_tool handles None description correctly."""
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

    def test_mcp_tool_to_user_tool_with_description(self, mock_provider):
        """Test that mcp_tool_to_user_tool handles normal description correctly."""
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

    def test_mcp_tool_to_user_tool_with_no_user(self, mock_provider_no_user):
        """Test that mcp_tool_to_user_tool handles None user correctly."""
        # Create MCP tool
        tools = [MCPTool(name="tool1", description="Test tool", inputSchema={"type": "object", "properties": {}})]

        # Call the method
        result = ToolTransformService.mcp_tool_to_user_tool(mock_provider_no_user, tools)

        # Verify the result
        assert len(result) == 1
        assert result[0].author == "Anonymous"

    def test_mcp_tool_to_user_tool_with_complex_schema(self, mock_provider, sample_mcp_tools):
        """Test that mcp_tool_to_user_tool correctly converts complex input schemas."""
        # Use complex tool from fixtures
        tools = [sample_mcp_tools["complex"]]

        # Call the method
        result = ToolTransformService.mcp_tool_to_user_tool(mock_provider, tools)

        # Verify the result
        assert len(result) == 1
        assert result[0].name == "complex_tool"
        assert result[0].parameters is not None
        # The actual parameter conversion is handled by convert_mcp_schema_to_parameter
        # which should be tested separately

    def test_mcp_provider_to_user_provider_for_list(self, mock_provider_full):
        """Test mcp_provider_to_user_provider with for_list=True."""
        # Set tools data with null description
        mock_provider_full.tools = '[{"name": "tool1", "description": null, "inputSchema": {}}]'

        # Mock the to_entity and to_api_response methods
        mock_entity = Mock()
        mock_entity.to_api_response.return_value = {
            "name": "Test MCP Provider",
            "type": ToolProviderType.MCP,
            "is_team_authorization": True,
            "server_url": "https://*****.com/mcp",
            "provider_icon": "icon.png",
            "masked_headers": {"Authorization": "Bearer *****"},
            "updated_at": 1234567890,
            "labels": [],
            "author": "Test User",
            "description": I18nObject(en_US="Test MCP Provider Description", zh_Hans="Test MCP Provider Description"),
            "icon": "icon.png",
            "label": I18nObject(en_US="Test MCP Provider", zh_Hans="Test MCP Provider"),
            "masked_credentials": {},
        }
        mock_provider_full.to_entity.return_value = mock_entity

        # Call the method with for_list=True
        result = ToolTransformService.mcp_provider_to_user_provider(mock_provider_full, for_list=True)

        # Verify the result
        assert isinstance(result, ToolProviderApiEntity)
        assert result.id == "provider-id-123"  # Should use provider.id when for_list=True
        assert result.name == "Test MCP Provider"
        assert result.type == ToolProviderType.MCP
        assert result.is_team_authorization is True
        assert result.server_url == "https://*****.com/mcp"
        assert len(result.tools) == 1
        assert result.tools[0].description.en_US == ""  # Should handle None description

    def test_mcp_provider_to_user_provider_not_for_list(self, mock_provider_full):
        """Test mcp_provider_to_user_provider with for_list=False."""
        # Set tools data with description
        mock_provider_full.tools = '[{"name": "tool1", "description": "Tool description", "inputSchema": {}}]'

        # Mock the to_entity and to_api_response methods
        mock_entity = Mock()
        mock_entity.to_api_response.return_value = {
            "name": "Test MCP Provider",
            "type": ToolProviderType.MCP,
            "is_team_authorization": True,
            "server_url": "https://*****.com/mcp",
            "provider_icon": "icon.png",
            "masked_headers": {"Authorization": "Bearer *****"},
            "updated_at": 1234567890,
            "labels": [],
            "configuration": {"timeout": "30", "sse_read_timeout": "300"},
            "original_headers": {"Authorization": "Bearer secret-token"},
            "author": "Test User",
            "description": I18nObject(en_US="Test MCP Provider Description", zh_Hans="Test MCP Provider Description"),
            "icon": "icon.png",
            "label": I18nObject(en_US="Test MCP Provider", zh_Hans="Test MCP Provider"),
            "masked_credentials": {},
        }
        mock_provider_full.to_entity.return_value = mock_entity

        # Call the method with for_list=False
        result = ToolTransformService.mcp_provider_to_user_provider(mock_provider_full, for_list=False)

        # Verify the result
        assert isinstance(result, ToolProviderApiEntity)
        assert result.id == "server-identifier-456"  # Should use server_identifier when for_list=False
        assert result.server_identifier == "server-identifier-456"
        assert result.configuration is not None
        assert result.configuration.timeout == 30
        assert result.configuration.sse_read_timeout == 300
        assert result.original_headers == {"Authorization": "Bearer secret-token"}
        assert len(result.tools) == 1
        assert result.tools[0].description.en_US == "Tool description"
