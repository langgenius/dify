"""Core tools retain their prepared schemas and API-owned credentials."""

import json

import httpx
import pytest

from dify_agent.layers.dify_core_tools.layer import Config, Toolset
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.module_support import invoke_native_tool


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status,body,expected",
    [
        (200, {"observation": "completed", "messages": [], "metadata": {}}, "completed"),
        (429, {"code": "rate_limit", "message": "busy"}, "temporarily unavailable"),
        (404, {"code": "app_not_found", "message": "missing"}, "app context no longer exists"),
        (403, {"code": "app_tenant_mismatch", "message": "invalid"}, "app context is invalid"),
        (422, {"code": "agent_tool_credential_invalid", "message": "invalid"}, "check your tool provider credentials"),
        (
            404,
            {"code": "agent_tool_declaration_not_found", "message": "missing"},
            "there is not a tool named transcribe",
        ),
        (
            422,
            {"code": "tool_parameters_invalid", "message": "query required"},
            "tool parameters validation error: query required",
        ),
    ],
)
async def test_native_tool_preserves_schema_invocation_and_observations(status, body, expected):
    schema = {"type": "object", "properties": {"source": {"type": "string"}}, "required": ["source"]}
    config = Config(
        tools=[
            {
                "provider_type": "builtin",
                "provider_id": "audio",
                "tool_name": "transcribe",
                "credential_id": "credential",
                "runtime_parameters": {"region": "hidden"},
                "parameters_json_schema": schema,
            }
        ]
    )
    identity = DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        app_id="app",
        agent_mode="agent_app",
        invoke_from="web-app",
    )
    sent = []

    def handler(request):
        assert request.url.path == "/inner/api/agent/tools/invoke"
        assert request.headers["X-Inner-Api-Key"] == "secret"
        sent.append(json.loads(request.content))
        return httpx.Response(status, json=body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "core_tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity.model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, inner_api_key="secret"),
            run_id="test",
        )

        def inspect(info):
            tool = info.function_tools[0]
            assert tool.name == "transcribe"
            assert tool.parameters_json_schema == schema
            assert tool.strict is False

        result = await invoke_native_tool(
            deps, Toolset("core_tools"), "transcribe", {"source": "audio.mp3"}, inspect=inspect
        )
        assert expected in result.output
        assert sent[0]["caller"]["tenant_id"] == "tenant"
        assert sent[0]["tool"]["runtime_parameters"] == {"region": "hidden"}
        assert sent[0]["tool"]["tool_parameters"] == {"source": "audio.mp3"}
        assert not client.is_closed
