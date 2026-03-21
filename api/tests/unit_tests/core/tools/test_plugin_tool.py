from __future__ import annotations

from unittest.mock import Mock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolParameter
from core.tools.plugin_tool.tool import PluginTool


def _build_plugin_tool(*, has_runtime_parameters: bool) -> PluginTool:
    entity = ToolEntity(
        identity=ToolIdentity(
            author="author",
            name="tool-a",
            label=I18nObject(en_US="tool-a"),
            provider="provider-a",
        ),
        parameters=[
            ToolParameter.get_simple_instance(
                name="query",
                llm_description="query",
                typ=ToolParameter.ToolParameterType.STRING,
                required=False,
            )
        ],
        has_runtime_parameters=has_runtime_parameters,
    )
    runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER, credentials={"api_key": "x"})
    return PluginTool(
        entity=entity,
        runtime=runtime,
        tenant_id="tenant-1",
        icon="icon.svg",
        plugin_unique_identifier="plugin-uid",
    )


def test_plugin_tool_invoke_and_fork_runtime():
    tool = _build_plugin_tool(has_runtime_parameters=False)
    manager = Mock()
    manager.invoke.return_value = iter([tool.create_text_message("ok")])

    with patch("core.tools.plugin_tool.tool.PluginToolManager", return_value=manager):
        with patch(
            "core.tools.plugin_tool.tool.convert_parameters_to_plugin_format",
            return_value={"converted": 1},
        ):
            messages = list(tool.invoke(user_id="user-1", tool_parameters={"raw": 1}))

    assert [m.message.text for m in messages] == ["ok"]
    manager.invoke.assert_called_once()
    assert manager.invoke.call_args.kwargs["tool_parameters"] == {"converted": 1}

    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2"))
    assert isinstance(forked, PluginTool)
    assert forked.runtime.tenant_id == "tenant-2"
    assert forked.plugin_unique_identifier == "plugin-uid"


def test_plugin_tool_get_runtime_parameters_branches():
    tool = _build_plugin_tool(has_runtime_parameters=False)
    assert tool.get_runtime_parameters() == tool.entity.parameters

    tool = _build_plugin_tool(has_runtime_parameters=True)
    cached = [
        ToolParameter.get_simple_instance(
            name="k",
            llm_description="k",
            typ=ToolParameter.ToolParameterType.STRING,
            required=False,
        )
    ]
    tool.runtime_parameters = cached
    assert tool.get_runtime_parameters() == cached

    tool.runtime_parameters = None
    manager = Mock()
    returned = [
        ToolParameter.get_simple_instance(
            name="dyn",
            llm_description="dyn",
            typ=ToolParameter.ToolParameterType.STRING,
            required=False,
        )
    ]
    manager.get_runtime_parameters.return_value = returned
    with patch("core.tools.plugin_tool.tool.PluginToolManager", return_value=manager):
        assert tool.get_runtime_parameters(conversation_id="c1", app_id="a1", message_id="m1") == returned
    assert tool.runtime_parameters == returned
