import asyncio
import json
from uuid import NAMESPACE_URL, uuid5

import httpx
import pytest
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from pydantic_ai.exceptions import ModelHTTPError

from dify_agent.adapters.llm.provider import DifyApiLLMClient
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig

from ._test_support import build_stream_error, build_stream_response, single_text_chunk


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        agent_config_version_kind="draft",
        agent_mode="workflow_run",
        invoke_from="debugger",
        trace_id="trace-1",
    )


def test_api_client_uses_stable_per_run_call_identity() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return build_stream_response(*single_text_chunk("done"))

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False) as http_client:
            client = DifyApiLLMClient(
                plugin_id="acme/custom-model",
                inner_api_url="http://dify-api/",
                inner_api_key="inner-secret",
                execution_context=_execution_context(),
                agent_run_id=run_id,
                http_client=http_client,
            )

            for _ in range(2):
                chunks = [
                    chunk
                    async for chunk in client.iter_llm_result_chunks(
                        provider="openai",
                        model="gpt-test",
                        prompt_messages=[UserPromptMessage(content="hello")],
                        model_parameters={"temperature": 0.2},
                        tools=None,
                        stop=None,
                        stream=True,
                    )
                ]
                assert chunks[0].delta.message.content == "done"

    run_id = "00000000-0000-0000-0000-000000000001"
    asyncio.run(scenario())

    assert len(requests) == 2
    first_payload = json.loads(requests[0].content)
    second_payload = json.loads(requests[1].content)
    assert requests[0].url == "http://dify-api/inner/api/agent/llm/invoke"
    assert requests[0].headers["X-Inner-Api-Key"] == "inner-secret"
    assert first_payload["caller"]["call_index"] == 1
    assert first_payload["caller"]["invocation_id"] == str(uuid5(NAMESPACE_URL, f"dify-agent:{run_id}:llm:1"))
    assert second_payload["caller"]["call_index"] == 2
    assert second_payload["caller"]["invocation_id"] == str(uuid5(NAMESPACE_URL, f"dify-agent:{run_id}:llm:2"))
    assert first_payload["caller"]["agent_config_version_kind"] == "draft"
    assert first_payload["target"]["provider"] == "acme/custom-model/openai"
    assert "credentials" not in first_payload["target"]


def test_api_client_propagates_gateway_quota_error() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={
                "code": "agent_llm_quota_exceeded",
                "message": "Insufficient Message Credits.",
                "status": 429,
            },
        )

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False) as http_client:
            client = DifyApiLLMClient(
                plugin_id="langgenius/openai",
                inner_api_url="http://dify-api",
                inner_api_key="inner-secret",
                execution_context=_execution_context(),
                agent_run_id="00000000-0000-0000-0000-000000000001",
                http_client=http_client,
            )

            with pytest.raises(ModelHTTPError) as exc_info:
                _ = [
                    chunk
                    async for chunk in client.iter_llm_result_chunks(
                        provider="openai",
                        model="gpt-test",
                        prompt_messages=[UserPromptMessage(content="hello")],
                        model_parameters={},
                        tools=None,
                        stop=None,
                        stream=True,
                    )
                ]
            assert exc_info.value.status_code == 429
            assert "Insufficient Message Credits" in str(exc_info.value)

    asyncio.run(scenario())


def test_api_client_maps_stream_quota_error_to_http_429() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return build_stream_error(
            "AgentLLMQuotaExceededError",
            "Insufficient hosted model quota remaining.",
            code=-429,
        )

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False) as http_client:
            client = DifyApiLLMClient(
                plugin_id="langgenius/openai",
                inner_api_url="http://dify-api",
                inner_api_key="inner-secret",
                execution_context=_execution_context(),
                agent_run_id="00000000-0000-0000-0000-000000000001",
                http_client=http_client,
            )

            with pytest.raises(ModelHTTPError) as exc_info:
                _ = [
                    chunk
                    async for chunk in client.iter_llm_result_chunks(
                        provider="openai",
                        model="gpt-test",
                        prompt_messages=[UserPromptMessage(content="hello")],
                        model_parameters={},
                        tools=None,
                        stop=None,
                        stream=True,
                    )
                ]
            assert exc_info.value.status_code == 429
            assert "Insufficient hosted model quota" in str(exc_info.value)

    asyncio.run(scenario())
