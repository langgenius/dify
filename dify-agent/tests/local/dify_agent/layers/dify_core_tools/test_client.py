import json
from collections.abc import Callable
from typing import cast

import httpx
import pytest

from dify_agent.layers.dify_core_tools.client import DifyCoreToolsClient, DifyCoreToolsClientError
from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        node_execution_id="node-exec-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        agent_config_version_id="snapshot-1",
        agent_mode="workflow_run",
        invoke_from="service-api",
        trace_id="trace-session-1",
    )


def _tool_config() -> DifyCoreToolConfig:
    return DifyCoreToolConfig(
        provider_type="builtin",
        provider_id="audio",
        tool_name="transcribe",
        credential_id="credential-1",
        runtime_parameters={"language": "en"},
        parameters=[],
        parameters_json_schema={"type": "object", "properties": {}, "required": []},
    )


def _read_timeout(request: httpx.Request) -> httpx.RequestError:
    return httpx.ReadTimeout("timed out", request=request)


def _connect_error(request: httpx.Request) -> httpx.RequestError:
    return httpx.ConnectError("connect failed", request=request)


@pytest.mark.parametrize("trace_id", ["trace-session-1", None])
def test_core_tools_client_posts_inner_api_request(trace_id: str | None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://dify-api/inner/api/agent/tools/invoke"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        payload = cast(dict[str, object], json.loads(request.content.decode("utf-8")))
        caller = cast(dict[str, object], payload["caller"])
        tool = cast(dict[str, object], payload["tool"])
        assert caller["tenant_id"] == "tenant-1"
        if trace_id is None:
            assert "trace_session_id" not in caller
        else:
            assert caller["trace_session_id"] == trace_id
        assert tool["provider_type"] == "builtin"
        assert tool["runtime_parameters"] == {"language": "en"}
        assert tool["tool_parameters"] == {"audio_url": "https://example.com/a.mp3"}
        return httpx.Response(
            200,
            json={
                "messages": [{"type": "text", "message": {"text": "ok"}}],
                "observation": "ok",
                "metadata": {"provider_type": "builtin"},
            },
        )

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = DifyCoreToolsClient(base_url="http://dify-api", api_key="inner-secret", http_client=http_client)
            response = await client.invoke(
                execution_context=_execution_context().model_copy(update={"trace_id": trace_id}),
                tool_config=_tool_config(),
                tool_parameters={"audio_url": "https://example.com/a.mp3"},
            )
            assert response.observation == "ok"

    import asyncio

    asyncio.run(scenario())


def test_core_tools_client_marks_retryable_http_failures() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(502, json={"code": "tool_failed"}))
        ) as http_client:
            client = DifyCoreToolsClient(base_url="http://dify-api", api_key="inner-secret", http_client=http_client)
            with pytest.raises(DifyCoreToolsClientError) as exc_info:
                _ = await client.invoke(
                    execution_context=_execution_context(),
                    tool_config=_tool_config(),
                    tool_parameters={"audio_url": "https://example.com/a.mp3"},
                )
            assert exc_info.value.retryable is True

    import asyncio

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("error_factory", "expected_substring"),
    [
        (
            _read_timeout,
            "timed out",
        ),
        (
            _connect_error,
            "request failed",
        ),
    ],
)
def test_core_tools_client_marks_transport_failures_retryable(
    error_factory: Callable[[httpx.Request], httpx.RequestError],
    expected_substring: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error_factory(request)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = DifyCoreToolsClient(base_url="http://dify-api", api_key="inner-secret", http_client=http_client)
            with pytest.raises(DifyCoreToolsClientError) as exc_info:
                _ = await client.invoke(
                    execution_context=_execution_context(),
                    tool_config=_tool_config(),
                    tool_parameters={"audio_url": "https://example.com/a.mp3"},
                )
            assert exc_info.value.retryable is True
            assert expected_substring in str(exc_info.value)

    import asyncio

    asyncio.run(scenario())


def test_core_tools_client_validates_execution_context_prerequisites_separately() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={}))
        ) as http_client:
            client = DifyCoreToolsClient(base_url="http://dify-api", api_key="inner-secret", http_client=http_client)
            with pytest.raises(DifyCoreToolsClientError) as exc_info:
                _ = await client.invoke(
                    execution_context=_execution_context().model_copy(update={"app_id": None}),
                    tool_config=_tool_config(),
                    tool_parameters={"audio_url": "https://example.com/a.mp3"},
                )
            assert exc_info.value.error_code == "missing_execution_context"
            assert exc_info.value.retryable is False
            assert "app_id" in str(exc_info.value)

    import asyncio

    asyncio.run(scenario())


def test_core_tools_client_raises_invalid_response_for_malformed_success_body() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"messages": []}))
        ) as http_client:
            client = DifyCoreToolsClient(base_url="http://dify-api", api_key="inner-secret", http_client=http_client)
            with pytest.raises(DifyCoreToolsClientError) as exc_info:
                _ = await client.invoke(
                    execution_context=_execution_context(),
                    tool_config=_tool_config(),
                    tool_parameters={"audio_url": "https://example.com/a.mp3"},
                )
            assert exc_info.value.error_code == "invalid_response"
            assert exc_info.value.retryable is False

    import asyncio

    asyncio.run(scenario())
