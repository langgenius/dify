"""Plugin tools use JSON identity, prepared schemas and native dispatch."""

import json

import httpx
import pytest

from dify_agent.layers.dify_plugin import tools_layer
from dify_agent.layers.dify_plugin.llm_layer import Capability as ModelCapability, Config as ModelConfig
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.module_support import invoke_native_tool


def identity():
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        app_id="app",
        agent_mode="agent_app",
        invoke_from="web-app",
    )


@pytest.mark.anyio
async def test_native_plugin_tool_prepares_schema_merges_hidden_parameters_and_decodes_stream():
    schema = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "langgenius/search",
                "provider": "search",
                "tool_name": "web_search",
                "name": "search",
                "credential_type": "api-key",
                "credentials": {"api_key": "tool-secret"},
                "runtime_parameters": {"scope": "workspace"},
                "parameters_json_schema": schema,
                "parameters": [
                    {"name": "query", "type": "string", "form": "llm", "required": True},
                    {"name": "scope", "type": "string", "form": "form", "required": True},
                    {"name": "region", "type": "string", "form": "form", "default": "global"},
                ],
            }
        ]
    )
    seen = []

    def handler(request):
        assert request.url.path == "/plugin/tenant/dispatch/tool/invoke"
        assert request.headers["X-Plugin-ID"] == "langgenius/search"
        assert request.headers["X-Api-Key"] == "daemon-secret"
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            text="data: "
            + json.dumps({"code": 0, "message": "ok", "data": {"type": "text", "message": {"text": "found"}}})
            + "\n",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, plugin_daemon_api_key="daemon-secret"),
            run_id="test",
        )

        def inspect(info):
            assert info.function_tools[0].name == "search"
            assert info.function_tools[0].parameters_json_schema == schema

        result = await invoke_native_tool(
            deps, tools_layer.Toolset("tools"), "search", {"query": "dify"}, inspect=inspect
        )
        assert result.output == "found"
        assert seen[0]["user_id"] == "user"
        assert seen[0]["data"]["tool_parameters"] == {"query": "dify", "scope": "workspace", "region": "global"}
        assert not client.is_closed


@pytest.mark.anyio
@pytest.mark.parametrize(
    "value,download",
    [
        ({"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}, True),
        ("https://example.com/file.pdf", False),
    ],
)
async def test_native_plugin_tool_converts_file_inputs(value, download):
    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "files",
                "provider": "file",
                "tool_name": "read",
                "credential_type": "unauthorized",
                "parameters": [{"name": "source", "type": "file", "form": "llm", "required": True}],
                "parameters_json_schema": {"type": "object", "properties": {"source": {}}, "required": ["source"]},
            }
        ]
    )
    sent = []

    def handler(request):
        payload = json.loads(request.content)
        if request.url.path.endswith("/download/file/request"):
            assert download
            assert payload["file"] == {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}
            return httpx.Response(
                200,
                json={
                    "data": {
                        "download_url": "https://example.com/file.pdf",
                        "filename": "file.pdf",
                        "mime_type": "application/pdf",
                        "size": 10,
                    }
                },
            )
        sent.append(payload["data"]["tool_parameters"]["source"])
        return httpx.Response(
            200, text='data: {"code":0,"message":"ok","data":{"type":"text","message":{"text":"read"}}}\n'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client),
            run_id="test",
        )
        result = await invoke_native_tool(deps, tools_layer.Toolset("tools"), "read", {"source": value})
        assert result.output == "read"
        assert sent[0]["url"] == "https://example.com/file.pdf"


@pytest.mark.anyio
async def test_model_assembly_reads_config_reference_and_borrows_shared_client():
    config = ModelConfig(
        plugin_id="langgenius/openai", model_provider="openai", model="demo", execution_context="renamed"
    )
    async with httpx.AsyncClient() as client:
        deps = Deps(
            layers={
                "llm": {"config": config.model_dump(mode="json"), "state": {}},
                "renamed": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client),
            run_id="test",
        )
        model = ModelCapability("llm").build_model(deps)
        assert model.model_name == "demo"
        assert model.provider.client.http_client is client
        assert model.provider.name == "DifyAPI/langgenius/openai"
