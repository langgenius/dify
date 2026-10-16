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


def _ordinary_config(provider_type="plugin", provider_id="langgenius/search/search", **layer):
    return Config(
        tools=[
            {
                "provider_type": provider_type,
                "provider_id": provider_id,
                "tool_name": "search",
                "credential_id": "credential-1",
                "runtime_parameters": {"query": "configured", "hidden": "kept"},
                "parameters": [
                    {"name": "query", "type": "string", "form": "llm"},
                    {"name": "hidden", "type": "string", "form": "form", "required": True},
                    {"name": "count", "type": "number", "form": "form", "default": 2},
                    {"name": "enabled", "type": "boolean", "form": "llm"},
                    {"name": "input", "type": "file", "form": "llm"},
                    {"name": "inputs", "type": "files", "form": "llm"},
                ],
                "parameters_json_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "enabled": {"type": "string"},
                        "input": {},
                        "inputs": {},
                    },
                    "required": ["query"],
                },
            }
        ],
        **layer,
    )


def _ordinary_deps(config, client):
    identity = DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        app_id="app",
        agent_mode="agent_app",
        invoke_from="web-app",
    )
    return Deps(
        layers={
            "core_tools": {"config": config.model_dump(mode="json"), "state": {}},
            "execution_context": {"config": identity.model_dump(mode="json"), "state": {}},
        },
        services=Services(client, client, inner_api_url="http://api", inner_api_key="legacy-unused"),
        run_id="ordinary-run",
    )


@pytest.mark.anyio
@pytest.mark.parametrize(
    "provider_type,provider_id", [("plugin", "langgenius/search/search"), ("builtin", "langgenius/search/search")]
)
async def test_ordinary_plugin_preparation_preserves_precedence_schema_and_observation(provider_type, provider_id):
    config = _ordinary_config(provider_type, provider_id)
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "observation": "API observation",
                "messages": [{"type": "image_link", "message": {"text": "/files/tools/synthetic.png"}}],
                "metadata": {},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = _ordinary_deps(config, client)
        result = await invoke_native_tool(
            deps,
            Toolset("core_tools"),
            "search",
            {"query": "live", "enabled": "false"},
            inspect=lambda info: _assert_schema(info, config),
        )
    assert result.output == "API observation"  # Structured messages are not user attachment delivery.
    assert sent[0]["tool"]["tool_parameters"] == {"query": "live", "hidden": "kept", "count": 2, "enabled": False}
    assert sent[0]["tool"]["credential_id"] == "credential-1"
    assert "credentials" not in sent[0]["tool"]
    assert config.tools[0].runtime_parameters == {"query": "configured", "hidden": "kept"}


def _assert_schema(info, config):
    assert info.function_tools[0].parameters_json_schema == config.tools[0].parameters_json_schema
    assert info.function_tools[0].strict is False


@pytest.mark.anyio
@pytest.mark.parametrize(
    "provider_type,provider_id",
    [
        ("api", "langgenius/search/search"),
        ("workflow", "workflow"),
        ("mcp", "mcp"),
        ("builtin", "audio"),
        ("builtin", "a//b"),
    ],
)
async def test_non_plugin_core_arguments_remain_unprepared(provider_type, provider_id):
    sent = []
    config = _ordinary_config(provider_type, provider_id)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: (
                sent.append(json.loads(req.content))
                or httpx.Response(200, json={"observation": "ok", "messages": [], "metadata": {}})
            )
        )
    ) as client:
        await invoke_native_tool(_ordinary_deps(config, client), Toolset("core_tools"), "search", {"query": "live"})
    assert sent[0]["tool"]["tool_parameters"] == {"query": "live"}


@pytest.mark.anyio
@pytest.mark.parametrize("transfer", ["local_file", "tool_file", "datasource_file"])
async def test_ordinary_plugin_canonical_file_uses_current_run_download_owner(transfer):
    import base64
    from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, bind_runtime_identity
    from dify_agent.protocol.native_testing import AgentRuntimeIdentity

    seen = []

    def handler(request):
        header = request.headers["X-Dify-Agent-Run"]
        identity = json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))
        assert identity["agent_run_id"] == "ordinary-run"
        assert "X-Inner-Api-Key" not in request.headers
        seen.append((request.url.path, json.loads(request.content)))
        if request.url.path.endswith("files/download-request"):
            return httpx.Response(
                200,
                json={
                    "filename": "sample.txt",
                    "mime_type": "text/plain",
                    "size": 7,
                    "download_uri": "https://files.example.test/signed",
                },
            )
        return httpx.Response(200, json={"observation": "ok", "messages": [], "metadata": {}})

    async with AgentRuntimeHTTPClient(
        api_url="http://api", api_token="synthetic", transport=httpx.MockTransport(handler)
    ) as client:
        deps = _ordinary_deps(_ordinary_config(), client)
        with bind_runtime_identity(
            AgentRuntimeIdentity(
                run_id="ordinary-run",
                agent_generation=0,
                request_digest="a" * 64,
                execution_mode="ordinary",
                parent_node=None,
            )
        ):
            await invoke_native_tool(
                deps,
                Toolset("core_tools"),
                "search",
                {"query": "live", "input": {"transfer_method": transfer, "reference": "canonical-ref"}},
            )
    assert [path for path, _ in seen] == [
        "/inner/api/agent/runtime/files/download-request",
        "/inner/api/agent/runtime/tools/invoke",
    ]
    assert seen[0][1] == {
        "tenant_id": "tenant",
        "user_id": "user",
        "user_from": "account",
        "invoke_from": "web-app",
        "file": {"transfer_method": transfer, "reference": "canonical-ref"},
    }
    assert seen[1][1]["tool"]["tool_parameters"]["input"] == {
        "dify_model_identity": "__dify__file__",
        "type": "custom",
        "url": "https://files.example.test/signed",
        "filename": "sample.txt",
        "mime_type": "text/plain",
        "extension": ".txt",
        "size": 7,
    }


@pytest.mark.anyio
async def test_ordinary_plugin_sandbox_path_reuses_shell_stub_upload_then_download():
    from types import SimpleNamespace
    from dify_agent.layers.dify_plugin.tools_layer import _FILE_UPLOAD_BEGIN, _FILE_UPLOAD_END

    calls = []

    class ShellBoundary:
        async def run_remote_script_complete(self, script, *, timeout, inject_agent_stub_env):
            calls.append("upload")
            assert "['dify-agent', 'file', 'upload', \"/sandbox/sample.txt\"]" in script
            assert timeout == 60.0 and inject_agent_stub_env is True
            return SimpleNamespace(
                exit_code=0,
                output=_FILE_UPLOAD_BEGIN
                + json.dumps({"transfer_method": "tool_file", "reference": "uploaded-ref"})
                + _FILE_UPLOAD_END,
            )

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith("download/file/request"):
            assert json.loads(request.content)["file"]["reference"] == "uploaded-ref"
            return httpx.Response(
                200,
                json={
                    "data": {"filename": "sample.txt", "size": 7, "download_url": "https://files.example.test/signed"}
                },
            )
        return httpx.Response(200, json={"observation": "ok", "messages": [], "metadata": {}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = _ordinary_deps(_ordinary_config(shell="shell"), client)
        deps.resources.shells["shell"] = ShellBoundary()
        await invoke_native_tool(
            deps, Toolset("core_tools"), "search", {"query": "live", "input": "/sandbox/sample.txt"}
        )
    assert calls == ["upload", "/inner/api/download/file/request", "/inner/api/agent/tools/invoke"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "file_input,expected",
    [
        ("https://example.test/a.txt", "https://example.test/a.txt"),
        ({"transfer_method": "remote_url", "url": "https://example.test/b.txt"}, "https://example.test/b.txt"),
        (
            {"dify_model_identity": "__dify__file__", "url": "https://example.test/c.txt", "size": 3},
            "https://example.test/c.txt",
        ),
    ],
)
async def test_ordinary_remote_files_require_no_shell_or_download(file_input, expected):
    sent = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: (
                sent.append(json.loads(req.content))
                or httpx.Response(200, json={"observation": "ok", "messages": [], "metadata": {}})
            )
        )
    ) as client:
        await invoke_native_tool(
            _ordinary_deps(_ordinary_config(), client),
            Toolset("core_tools"),
            "search",
            {"query": "live", "inputs": file_input},
        )
    assert len(sent) == 1
    assert sent[0]["tool"]["tool_parameters"]["inputs"][0]["url"] == expected


@pytest.mark.anyio
@pytest.mark.parametrize(
    "value", [{"transfer_method": "tool_file"}, "/sandbox/missing-shell", ["https://a", "https://b"]]
)
async def test_invalid_ordinary_file_stops_before_api_invocation(value):
    sent = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: sent.append(req) or httpx.Response(500))
    ) as client:
        result = await invoke_native_tool(
            _ordinary_deps(_ordinary_config(), client),
            Toolset("core_tools"),
            "search",
            {"query": "live", "input": value},
        )
    assert "tool parameters validation error" in result.output
    assert sent == []


@pytest.mark.anyio
@pytest.mark.parametrize("multiple", [False, True])
async def test_shared_direct_select_preparation_currently_loses_multiple_metadata(multiple):
    from dify_agent.layers.dify_plugin.configs import DifyPluginToolParameter
    from dify_agent.layers.dify_plugin.tools_layer import _prepare_tool_arguments

    parameter = DifyPluginToolParameter.model_validate(
        {
            "name": "selection",
            "type": "select",
            "form": "llm",
            "multiple": multiple,
            "options": [{"value": "a", "label": {"en_US": "A"}}],
        }
    )
    assert "multiple" not in parameter.model_dump()
    result = await _prepare_tool_arguments(
        [parameter], _ordinary_config().tools[0], {"selection": ["a"]}, file_context=None
    )
    assert result["selection"] == "['a']"  # Existing direct contract; API multiple=True rejects this wire value.


@pytest.mark.anyio
async def test_core_native_early_refusal_precedes_file_preparation_and_io():
    from dify_agent.protocol.native_testing import AgentNativeTestRef
    from dify_agent.runtime.native_continuation import NativeContinuation, NativePolicyStopped
    from dify_agent.runtime.native_effects import NativeEffectSession, NativeEffectDispatcher

    class UnusedOwner:
        async def before_call(self, **kwargs):
            pytest.fail("native policy owner must not be invoked")

        async def record_outcome(self, **kwargs):
            pytest.fail("native outcome owner must not be invoked")

        async def load(self, *args, **kwargs):
            pytest.fail("native result owner must not be invoked")

        async def store(self, *args, **kwargs):
            pytest.fail("native result owner must not be invoked")

    async def no_intent(**kwargs):
        pytest.fail("no intent preparation")

    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: pytest.fail("no HTTP activity"))) as client:
        deps = _ordinary_deps(_ordinary_config(), client)
        owner = UnusedOwner()
        deps.native_effects = NativeEffectSession(
            continuation=NativeContinuation(
                run_id="ordinary-run",
                ref=AgentNativeTestRef(
                    policy_version="builder-native-test-v1",
                    request_id="request",
                    invocation_id="invoke",
                    context_digest="a" * 64,
                ),
                generation=0,
                config_ref="config",
                config_digest="b" * 64,
            ),
            dispatcher=NativeEffectDispatcher(policy=owner),
            result_store=owner,
            prepare_intent=no_intent,
        )
        with pytest.raises(NativePolicyStopped, match="native_dispatch_fence_unavailable"):
            await invoke_native_tool(deps, Toolset("core_tools"), "search", {"query": "live", "input": "/no-shell"})


@pytest.mark.anyio
async def test_plugin_file_current_run_missing_refuses_without_legacy_fallback():
    from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, AgentRuntimeTransportError

    async with AgentRuntimeHTTPClient(
        api_url="http://api",
        api_token="synthetic",
        transport=httpx.MockTransport(lambda req: pytest.fail("unbound request must not be sent")),
    ) as client:
        with pytest.raises(AgentRuntimeTransportError, match="agent_runtime_binding_missing"):
            await invoke_native_tool(
                _ordinary_deps(_ordinary_config(), client),
                Toolset("core_tools"),
                "search",
                {"query": "live", "input": {"transfer_method": "tool_file", "reference": "reference"}},
            )


@pytest.mark.anyio
@pytest.mark.parametrize(
    "provider_type,provider_id",
    [
        ("api", "api-provider"),
        ("workflow", "workflow"),
        ("mcp", "mcp"),
        ("builtin", "audio"),
        ("plugin", "langgenius/search/search"),
        ("builtin", "langgenius/search/search"),
    ],
)
async def test_api_payload_validation_error_is_not_relabelled_as_preparation_error(provider_type, provider_id):
    from types import SimpleNamespace

    from pydantic import ValidationError

    from dify_agent.layers.dify_core_tools.client import DifyCoreToolsClient

    config = _ordinary_config(provider_type, provider_id)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: pytest.fail("no request expected"))
    ) as client:
        deps = _ordinary_deps(config, client)
        tool = Toolset._build_tool(
            client=DifyCoreToolsClient(base_url="http://api", api_key="key", http_client=client),
            execution_context=DifyExecutionContextLayerConfig.model_validate(
                deps.layers["execution_context"]["config"]
            ),
            tool_config=config.tools[0],
        )
        # Extra keys are intentionally retained by preparation. The real API
        # request model, rather than preparation, owns JSON payload validation.
        with pytest.raises(ValidationError):
            await tool.function(SimpleNamespace(deps=deps), query="live", extra=object())
