from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock, patch

import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.mcp_tool.tool import MCPTool


def _build_mcp_entity(*, icon: str = "icon.svg") -> MCPProviderEntity:
    now = datetime.now()
    return MCPProviderEntity(
        id="db-id",
        provider_id="provider-id",
        name="MCP Provider",
        tenant_id="tenant-1",
        user_id="user-1",
        server_url="https://mcp.example.com",
        headers={},
        timeout=30,
        sse_read_timeout=300,
        authed=False,
        credentials={},
        tools=[
            {
                "name": "remote-tool",
                "description": "remote tool",
                "inputSchema": {},
                "outputSchema": {"type": "object"},
            }
        ],
        icon=icon,
        created_at=now,
        updated_at=now,
    )


def test_mcp_tool_provider_controller_from_entity_and_get_tools():
    entity = _build_mcp_entity()
    with patch("core.tools.mcp_tool.provider.ToolTransformService.convert_mcp_schema_to_parameter", return_value=[]):
        controller = MCPToolProviderController.from_entity(entity)

    assert controller.provider_type == ToolProviderType.MCP
    tool = controller.get_tool("remote-tool")
    assert isinstance(tool, MCPTool)
    assert tool.tenant_id == "tenant-1"

    tools = controller.get_tools()
    assert len(tools) == 1
    assert isinstance(tools[0], MCPTool)

    with pytest.raises(ValueError, match="not found"):
        controller.get_tool("missing")


def test_mcp_tool_provider_controller_from_entity_requires_icon():
    entity = _build_mcp_entity(icon="")
    with patch("core.tools.mcp_tool.provider.ToolTransformService.convert_mcp_schema_to_parameter", return_value=[]):
        with pytest.raises(ValueError, match="icon is required"):
            MCPToolProviderController.from_entity(entity)


def test_mcp_tool_provider_controller_from_db_delegates_to_entity():
    entity = _build_mcp_entity()
    db_provider = Mock()
    db_provider.to_entity.return_value = entity
    with patch("core.tools.mcp_tool.provider.ToolTransformService.convert_mcp_schema_to_parameter", return_value=[]):
        controller = MCPToolProviderController.from_db(db_provider)
    assert isinstance(controller, MCPToolProviderController)
