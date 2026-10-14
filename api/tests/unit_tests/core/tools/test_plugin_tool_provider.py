from __future__ import annotations

import json

import httpx
import pytest

import core.plugin.impl.base as plugin_client_module
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.plugin_tool.tool import PluginTool


def _build_controller() -> PluginToolProviderController:
    tool_entity = ToolEntity(
        identity=ToolIdentity(
            author="author",
            name="tool-a",
            label=I18nObject(en_US="tool-a"),
            provider="provider-a",
        ),
        parameters=[],
    )
    entity = ToolProviderEntityWithPlugin(
        identity=ToolProviderIdentity(
            author="author",
            name="provider-a",
            description=I18nObject(en_US="desc"),
            icon="icon.svg",
            label=I18nObject(en_US="Provider"),
        ),
        credentials_schema=[],
        plugin_id="plugin-id",
        tools=[tool_entity],
    )
    return PluginToolProviderController(
        entity=entity,
        plugin_id="plugin-id",
        plugin_unique_identifier="plugin-uid",
        tenant_id="tenant-1",
    )


def test_plugin_tool_provider_controller_basic_behaviors():
    controller = _build_controller()
    assert controller.provider_type == ToolProviderType.PLUGIN

    tool = controller.get_tool("tool-a")
    assert isinstance(tool, PluginTool)
    assert tool.runtime.tenant_id == "tenant-1"

    tools = controller.get_tools()
    assert len(tools) == 1
    assert isinstance(tools[0], PluginTool)

    with pytest.raises(ValueError, match="not found"):
        controller.get_tool("missing")


@pytest.mark.parametrize("valid", [True, False])
def test_validate_credentials(monkeypatch: pytest.MonkeyPatch, valid: bool):
    controller = _build_controller()
    requests: list[httpx.Request] = []

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"code": 0, "message": "", "data": {"result": valid}})

    with httpx.Client(transport=httpx.MockTransport(handle_request)) as client:
        monkeypatch.setattr(plugin_client_module, "_httpx_client", client)
        if valid:
            controller._validate_credentials(user_id="u1", credentials={"api_key": "x"})
        else:
            with pytest.raises(ToolProviderCredentialValidationError, match="Invalid credentials"):
                controller._validate_credentials(user_id="u1", credentials={"api_key": "x"})

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert request.url.path.endswith("/plugin/tenant-1/dispatch/tool/validate_credentials")
    assert request.headers["X-Plugin-ID"] == "langgenius/provider-a"
    assert json.loads(request.content) == {
        "user_id": "u1",
        "data": {"provider": "provider-a", "credentials": {"api_key": "x"}},
    }
