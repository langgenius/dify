from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderAuthType, ToolProviderType


def _db_provider() -> SimpleNamespace:
    bundle = ApiToolBundle(
        server_url="https://api.example.com/items",
        method="GET",
        summary="List items",
        operation_id="list_items",
        parameters=[],
        author="author",
        openapi={"parameters": []},
    )
    return SimpleNamespace(
        id="provider-id",
        tenant_id="tenant-1",
        name="provider-a",
        description="desc",
        icon="icon.svg",
        user=SimpleNamespace(name="Alice"),
        tools=[bundle],
    )


def test_api_tool_provider_from_db_and_parse_tool_bundle():
    controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.API_KEY_HEADER)
    assert controller.provider_type == ToolProviderType.API
    assert any(c.name == "api_key_value" for c in controller.entity.credentials_schema)

    tool = controller._parse_tool_bundle(_db_provider().tools[0])
    assert isinstance(tool, ApiTool)
    assert tool.entity.identity.provider == "provider-id"


def test_api_tool_provider_from_db_query_auth_and_none_auth():
    query_controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.API_KEY_QUERY)
    assert any(c.name == "api_key_query_param" for c in query_controller.entity.credentials_schema)

    none_controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.NONE)
    assert [c.name for c in none_controller.entity.credentials_schema] == ["auth_type"]


def test_api_tool_provider_load_get_tools_and_get_tool():
    controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.NONE)
    loaded = controller.load_bundled_tools(_db_provider().tools)
    assert len(loaded) == 1

    assert isinstance(controller.get_tool("list_items"), ApiTool)

    with pytest.raises(ValueError, match="not found"):
        controller.get_tool("missing")

    # Return cached tools without querying database.
    cached = controller.get_tools("tenant-1")
    assert len(cached) == 1

    # Force DB fetch branch.
    controller.tools = []
    provider_with_tools = _db_provider()
    with patch("core.tools.custom_tool.provider.db") as mock_db:
        scalars_result = Mock()
        scalars_result.all.return_value = [provider_with_tools]
        mock_db.session.scalars.return_value = scalars_result
        tools = controller.get_tools("tenant-1")
    assert len(tools) == 1
