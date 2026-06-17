import asyncio
import json

import httpx
import pytest
from pydantic_ai import Tool

from agenton.compositor import Compositor, LayerNode, LayerProvider
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.knowledge.client import DifyKnowledgeBaseClientError
from dify_agent.layers.knowledge.configs import DifyKnowledgeBaseLayerConfig
from dify_agent.layers.knowledge.layer import (
    BLANK_QUERY_OBSERVATION,
    DifyKnowledgeBaseLayer,
    NO_RESULTS_OBSERVATION,
    TEMPORARY_UNAVAILABLE_OBSERVATION,
)


def _execution_context_config(**overrides: object) -> DifyExecutionContextLayerConfig:
    payload: dict[str, object] = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_from": "account",
        "app_id": "app-1",
        "agent_mode": "agent_app",
        "invoke_from": "web-app",
    }
    payload.update(overrides)
    return DifyExecutionContextLayerConfig.model_validate(payload)


def _knowledge_config(**overrides: object) -> DifyKnowledgeBaseLayerConfig:
    payload: dict[str, object] = {
        "dataset_ids": ["dataset-1"],
        "retrieval": {"mode": "multiple", "top_k": 4},
    }
    payload.update(overrides)
    return DifyKnowledgeBaseLayerConfig.model_validate(payload)


def _execution_context_provider() -> LayerProvider[DifyExecutionContextLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyExecutionContextLayer,
        create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
            DifyExecutionContextLayerConfig.model_validate(config),
            daemon_url="http://plugin-daemon",
            daemon_api_key="daemon-secret",
        ),
    )


def _knowledge_provider() -> LayerProvider[DifyKnowledgeBaseLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyKnowledgeBaseLayer,
        create=lambda config: DifyKnowledgeBaseLayer.from_config_with_settings(
            DifyKnowledgeBaseLayerConfig.model_validate(config),
            dify_api_inner_url="http://dify-api",
            dify_api_inner_api_key="inner-secret",
        ),
    )


def test_knowledge_layer_exposes_one_query_only_tool_definition() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient() as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                tool_def = await tool.prepare_tool_def(None)  # pyright: ignore[reportArgumentType]
                assert isinstance(tool, Tool)
                assert tool.name == "knowledge_base_search"
                assert tool.description == "Search configured knowledge bases for information relevant to the query."
                assert tool_def is not None
                assert (
                    tool_def.description == "Search configured knowledge bases for information relevant to the query."
                )
                assert tool_def.parameters_json_schema == {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for the configured knowledge bases.",
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                }

    asyncio.run(scenario())


def test_knowledge_layer_rejects_blank_query_locally() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient() as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({"query": "   "}, None)  # pyright: ignore[reportArgumentType]
                assert result == BLANK_QUERY_OBSERVATION

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("field_name", "field_value"),
    [
        ("user_id", None),
        ("user_from", None),
        ("app_id", None),
    ],
)
def test_knowledge_layer_fails_fast_when_execution_context_is_missing_required_fields(
    field_name: str,
    field_value: object,
) -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient() as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                execution_context_layer = run.get_layer("execution_context", DifyExecutionContextLayer)
                setattr(execution_context_layer.config, field_name, field_value)
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                with pytest.raises(ValueError, match=field_name):
                    _ = await knowledge_layer.get_tools(http_client=http_client)

    asyncio.run(scenario())


def test_knowledge_layer_formats_results_and_truncates_observation() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "metadata": {
                            "_source": "knowledge",
                            "dataset_name": "Docs",
                            "document_name": "Guide.md",
                            "score": 0.9,
                        },
                        "title": "Guide",
                        "files": [],
                        "content": "ABCDEFGHIJKL",
                        "summary": None,
                    }
                ],
                "usage": {},
            },
        )

    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(max_result_content_chars=8, max_observation_chars=160),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert result.startswith("Knowledge base search results:\n1. Title: Guide")
                assert "Dataset: Docs" in result
                assert "Document: Guide.md" in result
                assert "Score: 0.9" in result
                assert "Content: ABCDE..." in result
                assert len(result) <= 160

    asyncio.run(scenario())


def test_knowledge_layer_returns_no_results_observation() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"results": [], "usage": {}}))
        ) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert result == NO_RESULTS_OBSERVATION

    asyncio.run(scenario())


def test_knowledge_layer_converts_retryable_failures_into_observation() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(429, json={"code": "knowledge_rate_limited", "message": "slow down"})
            )
        ) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert result == TEMPORARY_UNAVAILABLE_OBSERVATION

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "transport_error",
    [
        lambda request: httpx.ReadTimeout("timed out", request=request),
        lambda request: httpx.ConnectError("connection failed", request=request),
    ],
)
def test_knowledge_layer_converts_retryable_transport_failures_into_observation(transport_error) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise transport_error(request)

    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert result == TEMPORARY_UNAVAILABLE_OBSERVATION

    asyncio.run(scenario())


def test_knowledge_layer_raises_non_retryable_client_errors() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(403, json={"code": "dataset_tenant_mismatch", "message": "forbidden"})
            )
        ) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                    await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert exc_info.value.status_code == 403

    asyncio.run(scenario())


def test_knowledge_layer_raises_for_malformed_success_responses() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"bad": []}))
        ) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                    await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert exc_info.value.error_code == "invalid_response"
                assert exc_info.value.retryable is False

    asyncio.run(scenario())


def test_knowledge_layer_sends_execution_context_and_static_config_to_inner_api() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        assert payload["caller"] == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "app_id": "app-1",
            "user_from": "account",
            "invoke_from": "web-app",
        }
        assert payload["dataset_ids"] == ["dataset-1", "dataset-2"]
        assert payload["query"] == "reset"
        assert payload["retrieval"]["top_k"] == 2
        assert payload["metadata_filtering"] == {
            "mode": "manual",
            "conditions": {
                "logical_operator": "and",
                "conditions": [
                    {
                        "name": "category",
                        "comparison_operator": "contains",
                        "value": "auth",
                    }
                ],
            },
        }
        return httpx.Response(200, json={"results": [], "usage": {}})

    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("knowledge", _knowledge_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "knowledge": _knowledge_config(
                        dataset_ids=["dataset-1", "dataset-2"],
                        retrieval={"mode": "multiple", "top_k": 2},
                        metadata_filtering={
                            "mode": "manual",
                            "conditions": {
                                "logical_operator": "and",
                                "conditions": [
                                    {
                                        "name": "category",
                                        "comparison_operator": "contains",
                                        "value": "auth",
                                    }
                                ],
                            },
                        },
                    ),
                }
            ) as run:
                knowledge_layer = run.get_layer("knowledge", DifyKnowledgeBaseLayer)
                tool = (await knowledge_layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({"query": "reset"}, None)  # pyright: ignore[reportArgumentType]
                assert result == NO_RESULTS_OBSERVATION

    asyncio.run(scenario())
