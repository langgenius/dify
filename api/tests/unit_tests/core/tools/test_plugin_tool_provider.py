from __future__ import annotations

from unittest.mock import Mock, patch

import pytest

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


def test_plugin_tool_provider_validate_credentials_success_and_failure():
    controller = _build_controller()
    manager = Mock()
    manager.validate_provider_credentials.return_value = True

    with patch("core.tools.plugin_tool.provider.PluginToolManager", return_value=manager):
        controller._validate_credentials(user_id="u1", credentials={"api_key": "x"})

    manager.validate_provider_credentials.return_value = False
    with patch("core.tools.plugin_tool.provider.PluginToolManager", return_value=manager):
        with pytest.raises(ToolProviderCredentialValidationError, match="Invalid credentials"):
            controller._validate_credentials(user_id="u1", credentials={"api_key": "x"})
