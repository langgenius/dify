from __future__ import annotations

import json
from unittest.mock import patch

import httpx
from sqlalchemy.orm import Session

import core.plugin.impl.base as plugin_client_module
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


def test_plugin_tool_invoke_and_fork_runtime(unbound_session: Session):
    tool = _build_plugin_tool(has_runtime_parameters=False)
    requests: list[httpx.Request] = []

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            text='data: {"code": 0, "message": "", "data": {"type": "text", "message": {"text": "ok"}}}\n\n',
        )

    with httpx.Client(transport=httpx.MockTransport(handle_request)) as client:
        with (
            patch.object(plugin_client_module, "_httpx_client", client),
            patch(
                "core.tools.plugin_tool.tool.convert_parameters_to_plugin_format",
                return_value={"converted": 1},
            ),
        ):
            messages = list(tool.invoke(session=unbound_session, user_id="user-1", tool_parameters={"raw": 1}))

    assert [m.message.text for m in messages] == ["ok"]
    assert len(requests) == 1
    request_data = json.loads(requests[0].content)
    assert request_data["data"]["tool_parameters"] == {"converted": 1}

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
    returned = [
        ToolParameter.get_simple_instance(
            name="dyn",
            llm_description="dyn",
            typ=ToolParameter.ToolParameterType.STRING,
            required=False,
        )
    ]
    requests: list[httpx.Request] = []

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = {"code": 0, "message": "", "data": {"parameters": [returned[0].model_dump(mode="json")]}}
        return httpx.Response(200, text=f"data: {json.dumps(payload)}\n\n")

    with httpx.Client(transport=httpx.MockTransport(handle_request)) as client:
        with patch.object(plugin_client_module, "_httpx_client", client):
            assert tool.get_runtime_parameters(conversation_id="c1", app_id="a1", message_id="m1") == returned
    assert tool.runtime_parameters == returned
    assert len(requests) == 1
    request_data = json.loads(requests[0].content)
    assert request_data["conversation_id"] == "c1"
    assert request_data["app_id"] == "a1"
    assert request_data["message_id"] == "m1"
