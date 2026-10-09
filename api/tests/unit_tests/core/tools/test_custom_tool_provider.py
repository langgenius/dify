"""API provider construction consumes already loaded configuration."""

import pytest

from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderAuthType, ToolProviderType
from services.tools.api.contracts import ApiToolProviderRecord
from services.tools.api.provider import ApiToolProviderController


def provider_record() -> ApiToolProviderRecord:
    return ApiToolProviderRecord(
        schema_type="openapi",
        schema="{}",
        privacy_policy="",
        custom_disclaimer="",
        id="provider-id",
        tenant_id="tenant-1",
        name="provider-a",
        icon="icon.svg",
        description="desc",
        author="Alice",
        credentials={"auth_type": "none"},
        tools=[
            ApiToolBundle(
                server_url="https://api.example.com/items",
                method="GET",
                summary="List items",
                operation_id="list_items",
                parameters=[],
                author="Alice",
                openapi={"parameters": []},
            )
        ],
    )


@pytest.mark.parametrize(
    ("auth_type", "credential"),
    [
        (ApiProviderAuthType.API_KEY_HEADER, "api_key_header"),
        (ApiProviderAuthType.API_KEY_QUERY, "api_key_query_param"),
        (ApiProviderAuthType.NONE, "auth_type"),
    ],
)
def test_provider_constructs_auth_schema_and_tools_from_loaded_record(auth_type, credential):
    provider = provider_record()
    controller = ApiToolProviderController.from_provider(provider, auth_type, author=provider.author)
    assert controller.provider_type == ToolProviderType.API
    assert controller.entity.identity.author == "Alice"
    assert any(item.name == credential for item in controller.entity.credentials_schema)
    tool = controller.get_tool("list_items")
    assert isinstance(tool, ApiTool)
    assert tool.entity.identity.provider == provider.id
    assert controller.get_tools(provider.tenant_id) == [tool]
    with pytest.raises(ValueError, match="not found"):
        controller.get_tool("missing")


def test_empty_tools_do_not_trigger_implicit_provider_lookup():
    provider = provider_record()
    provider.tools.clear()
    controller = ApiToolProviderController.from_provider(provider, ApiProviderAuthType.NONE, author=provider.author)
    assert controller.get_tools(provider.tenant_id) == []
    with pytest.raises(ValueError, match="not found"):
        controller.get_tool("list_items")
