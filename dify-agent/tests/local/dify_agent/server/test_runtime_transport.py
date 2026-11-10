"""Composition decisions use existing credentials and never activate native owners."""

import asyncio

import pytest

from dify_agent.adapters.native_testing.transport import (
    AgentRuntimeHTTPClient,
    AgentRuntimeTransportError,
    bind_runtime_identity,
)
from dify_agent.protocol.native_testing import AgentRuntimeIdentity
from dify_agent.server.app import create_app, create_dify_api_inner_http_client
from dify_agent.server.settings import ServerSettings


def test_existing_inner_key_selects_legacy_composition_and_absence_selects_strict():
    async def exercise():
        async with create_dify_api_inner_http_client(
            ServerSettings(_env_file=None, inner_api_key="legacy", api_token="backend")
        ) as legacy:
            assert not isinstance(legacy, AgentRuntimeHTTPClient)
        async with create_dify_api_inner_http_client(
            ServerSettings(_env_file=None, inner_api_key=None, api_token="backend")
        ) as strict:
            assert isinstance(strict, AgentRuntimeHTTPClient)

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "credentials", [{"inner_api_key": "legacy"}, {"plugin_daemon_api_key": "daemon"}, {"api_token": None}]
)
def test_native_owner_is_refused_while_legacy_authority_remains_or_bearer_missing(credentials):
    with pytest.raises(AgentRuntimeTransportError):
        create_app(
            ServerSettings(
                _env_file=None, api_token="backend", **{k: v for k, v in credentials.items() if k != "api_token"}
            )
            if "api_token" not in credentials
            else ServerSettings(_env_file=None, api_token=None),
            native_owner=object(),
        )


def test_unconfigured_ordinary_control_composition_has_no_outbound_business_authority():
    async def exercise():
        async with create_dify_api_inner_http_client(
            ServerSettings(_env_file=None, api_token=None, inner_api_key=None)
        ) as client:
            with bind_runtime_identity(
                AgentRuntimeIdentity(
                    run_id="run",
                    parent_node=None,
                    execution_mode="ordinary",
                    request_digest="a" * 64,
                    agent_generation=0,
                )
            ):
                with pytest.raises(AgentRuntimeTransportError):
                    await client.post("http://localhost:5001/inner/api/agent/runtime/tools/invoke", json={})

    asyncio.run(exercise())


def test_actual_lifespan_daemon_owner_and_generic_direct_client_refuse_native(monkeypatch):
    import httpx
    import dify_agent.server.app as app_module
    from dify_agent.layers.dify_plugin.tool_client import DifyPluginDaemonToolClient
    from dify_agent.server.app import create_plugin_daemon_http_client

    async def exercise():
        seen = []
        monkeypatch.setenv("HTTP_PROXY", "http://untrusted-proxy.invalid")
        monkeypatch.setattr(
            app_module.httpx,
            "AsyncHTTPTransport",
            lambda **kwargs: httpx.MockTransport(
                lambda request: (
                    seen.append(request)
                    or httpx.Response(
                        200, text='data: {"code":0,"message":"ok","data":{"type":"text","message":{"text":"answer"}}}\n'
                    )
                )
            ),
        )
        actual = AgentRuntimeIdentity(
            run_id="run",
            execution_mode="builder_test",
            agent_generation=0,
            request_digest="a" * 64,
            parent_node={
                "ref": {
                    "policy_version": "builder-native-test-v1",
                    "request_id": "request",
                    "invocation_id": "invocation",
                    "context_digest": "b" * 64,
                },
                "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                "input_result_ref": "input",
                "input_digest": "c" * 64,
            },
        )
        async with create_plugin_daemon_http_client(
            ServerSettings(_env_file=None, plugin_daemon_api_key="daemon")
        ) as client:
            url = "http://daemon/plugin/tenant/dispatch/tool/invoke"
            with bind_runtime_identity(actual):
                with pytest.raises(AgentRuntimeTransportError):
                    await client.send(httpx.Request("POST", url, json={}))
                with pytest.raises(AgentRuntimeTransportError):
                    async with client.stream("POST", url, json={}):
                        pass
                # Even an injected generic HTTPX client cannot bypass the direct producer's guard.
                async with httpx.AsyncClient(
                    transport=httpx.MockTransport(lambda request: seen.append(request) or httpx.Response(200))
                ) as raw:
                    tool = DifyPluginDaemonToolClient(
                        plugin_daemon_url="http://daemon",
                        plugin_daemon_api_key="daemon",
                        tenant_id="tenant",
                        plugin_id="plugin",
                        user_id="user",
                        http_client=raw,
                    )
                    with pytest.raises(AgentRuntimeTransportError):
                        await tool.invoke(
                            provider="provider",
                            tool_name="tool",
                            credential_type="unauthorized",
                            credentials={},
                            tool_parameters={},
                        )
        assert seen == []

    asyncio.run(exercise())
