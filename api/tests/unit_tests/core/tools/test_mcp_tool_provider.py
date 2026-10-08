from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPProviderEntity
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.mcp_tool.tool import MCPTool
from models.tools import MCPToolProvider


def _build_mcp_entity(*, icon: str = "icon.svg") -> MCPProviderEntity:
    now = datetime.now()
    return MCPProviderEntity(
        id="db-id",
        server_identifier="mcp_server",
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
    # The runtime reference is the server identifier, never the primary key.
    assert tool.server_identifier == "mcp_server"

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


def test_mcp_tool_provider_controller_from_db_delegates_to_entity(sqlite_session: Session):
    entity = _build_mcp_entity()
    db_provider = MCPToolProvider(
        name=entity.name,
        server_identifier=entity.server_identifier,
        server_url=entity.server_url,
        server_url_hash="server-url-hash",
        icon=str(entity.icon),
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        encrypted_credentials=json.dumps(entity.credentials),
        authed=entity.authed,
        tools=json.dumps(entity.tools),
        timeout=entity.timeout,
        sse_read_timeout=entity.sse_read_timeout,
        encrypted_headers=json.dumps(entity.headers),
        identity_mode=entity.identity_mode,
    )
    sqlite_session.add(db_provider)
    sqlite_session.commit()
    with patch("core.tools.mcp_tool.provider.ToolTransformService.convert_mcp_schema_to_parameter", return_value=[]):
        controller = MCPToolProviderController.from_db(db_provider)
    assert isinstance(controller, MCPToolProviderController)
    assert controller.server_identifier == entity.server_identifier
    assert controller.entity.tools[0].identity.name == "remote-tool"


def _build_mcp_entity_with_tools(tools: list[dict]) -> MCPProviderEntity:
    now = datetime.now()
    return MCPProviderEntity(
        id="db-id",
        server_identifier="mcp_server",
        name="MCP Provider",
        tenant_id="tenant-1",
        user_id="user-1",
        server_url="https://mcp.example.com",
        headers={},
        timeout=30,
        sse_read_timeout=300,
        authed=False,
        credentials={},
        tools=tools,
        icon="icon.svg",
        created_at=now,
        updated_at=now,
    )


def test_mcp_tool_provider_controller_falls_back_to_name_when_title_is_null():
    """Tools where the server returned ``title: null`` should fall back to the tool name.

    Regression test for langgenius/dify#42453.
    """
    entity = _build_mcp_entity_with_tools(
        tools=[
            {
                "name": "search_web",
                "title": None,
                "description": "Search the web",
                "inputSchema": {},
                "outputSchema": {"type": "object"},
            },
            {
                # ``title`` key missing entirely
                "name": "get_content",
                "description": "Fetch page content",
                "inputSchema": {},
            },
        ]
    )
    with patch("core.tools.mcp_tool.provider.ToolTransformService.convert_mcp_schema_to_parameter", return_value=[]):
        controller = MCPToolProviderController.from_entity(entity)

    assert len(controller.entity.tools) == 2
    # ``title: null`` -> fallback to ``name``
    assert controller.entity.tools[0].identity.name == "search_web"
    assert controller.entity.tools[0].identity.label is not None
    assert controller.entity.tools[0].identity.label.en_US == "search_web"
    assert controller.entity.tools[0].identity.label.zh_Hans == "search_web"
    # ``title`` missing entirely -> also fallback to ``name``
    assert controller.entity.tools[1].identity.name == "get_content"
    assert controller.entity.tools[1].identity.label.en_US == "get_content"
    assert controller.entity.tools[1].identity.label.zh_Hans == "get_content"


def test_mcp_tool_provider_controller_uses_title_when_provided():
    """When the server provides a non-null title, it should drive the label."""
    entity = _build_mcp_entity_with_tools(
        tools=[
            {
                "name": "search_web",
                "title": "Search the Web",
                "description": "Search the web",
                "inputSchema": {},
            }
        ]
    )
    with patch("core.tools.mcp_tool.provider.ToolTransformService.convert_mcp_schema_to_parameter", return_value=[]):
        controller = MCPToolProviderController.from_entity(entity)

    assert len(controller.entity.tools) == 1
    assert controller.entity.tools[0].identity.name == "search_web"
    assert controller.entity.tools[0].identity.label.en_US == "Search the Web"
    assert controller.entity.tools[0].identity.label.zh_Hans == "Search the Web"
