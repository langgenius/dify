import json
from unittest.mock import AsyncMock

import httpx
import pytest

from dify_agent.layers.knowledge.client import DifyKnowledgeBaseClient, DifyKnowledgeBaseClientError
from dify_agent.layers.knowledge.configs import (
    DifyKnowledgeMetadataFilteringConfig,
    DifyKnowledgeRetrievalConfig,
)


def _retrieval_config() -> DifyKnowledgeRetrievalConfig:
    return DifyKnowledgeRetrievalConfig(mode="multiple", top_k=4, score_threshold=0.2)


def _metadata_filtering() -> DifyKnowledgeMetadataFilteringConfig:
    return DifyKnowledgeMetadataFilteringConfig(mode="disabled")


def test_knowledge_client_posts_inner_api_request_with_static_controls() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://dify-api/inner/api/knowledge/retrieve"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload == {
            "caller": {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "app_id": "app-1",
                "user_from": "account",
                "invoke_from": "agent_app",
            },
            "dataset_ids": ["dataset-1"],
            "query": "reset password",
            "retrieval": {
                "mode": "multiple",
                "top_k": 4,
                "score_threshold": 0.2,
                "reranking_mode": "reranking_model",
                "reranking_enable": True,
                "reranking_model": None,
                "weights": None,
            },
            "metadata_filtering": {"mode": "disabled"},
            "attachment_ids": [],
        }
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "metadata": {
                            "_source": "knowledge",
                            "dataset_name": "Docs",
                            "document_name": "FAQ.md",
                            "score": 0.9,
                        },
                        "title": "FAQ",
                        "files": [],
                        "content": "Use the reset link.",
                        "summary": None,
                    }
                ],
                "usage": {},
            },
        )

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = DifyKnowledgeBaseClient(
                base_url="http://dify-api",
                api_key="inner-secret",
                http_client=http_client,
            )
            response = await client.retrieve(
                tenant_id="tenant-1",
                user_id="user-1",
                app_id="app-1",
                user_from="account",
                invoke_from="agent_app",
                dataset_ids=["dataset-1"],
                query="reset password",
                retrieval=_retrieval_config(),
                metadata_filtering=_metadata_filtering(),
            )
            assert response.results[0].metadata.dataset_name == "Docs"

    import asyncio

    asyncio.run(scenario())


def test_knowledge_client_marks_retryable_http_failures() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    502, json={"code": "external_knowledge_failed", "message": "bad gateway"}
                )
            )
        ) as http_client:
            client = DifyKnowledgeBaseClient(
                base_url="http://dify-api", api_key="inner-secret", http_client=http_client
            )
            with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                _ = await client.retrieve(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    app_id="app-1",
                    user_from="account",
                    invoke_from="agent_app",
                    dataset_ids=["dataset-1"],
                    query="reset password",
                    retrieval=_retrieval_config(),
                    metadata_filtering=_metadata_filtering(),
                )
            assert exc_info.value.status_code == 502
            assert exc_info.value.error_code == "external_knowledge_failed"
            assert exc_info.value.retryable is True

    import asyncio

    asyncio.run(scenario())


def test_knowledge_client_marks_non_retryable_http_failures() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    403,
                    json={"code": "dataset_tenant_mismatch", "message": "forbidden"},
                )
            )
        ) as http_client:
            client = DifyKnowledgeBaseClient(
                base_url="http://dify-api", api_key="inner-secret", http_client=http_client
            )
            with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                _ = await client.retrieve(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    app_id="app-1",
                    user_from="account",
                    invoke_from="agent_app",
                    dataset_ids=["dataset-1"],
                    query="reset password",
                    retrieval=_retrieval_config(),
                    metadata_filtering=_metadata_filtering(),
                )
            assert exc_info.value.status_code == 403
            assert exc_info.value.error_code == "dataset_tenant_mismatch"
            assert exc_info.value.retryable is False

    import asyncio

    asyncio.run(scenario())


def test_knowledge_client_rejects_malformed_success_response() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"bad": []}))
        ) as http_client:
            client = DifyKnowledgeBaseClient(
                base_url="http://dify-api", api_key="inner-secret", http_client=http_client
            )
            with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                _ = await client.retrieve(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    app_id="app-1",
                    user_from="account",
                    invoke_from="agent_app",
                    dataset_ids=["dataset-1"],
                    query="reset password",
                    retrieval=_retrieval_config(),
                    metadata_filtering=_metadata_filtering(),
                )
            assert exc_info.value.error_code == "invalid_response"
            assert exc_info.value.retryable is False

    import asyncio

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "error_factory",
    [
        lambda request: httpx.ReadTimeout("timed out", request=request),
        lambda request: httpx.ConnectError("connection failed", request=request),
    ],
)
def test_knowledge_client_marks_transport_failures_retryable(error_factory) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error_factory(request)

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = DifyKnowledgeBaseClient(
                base_url="http://dify-api", api_key="inner-secret", http_client=http_client
            )
            with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                _ = await client.retrieve(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    app_id="app-1",
                    user_from="account",
                    invoke_from="agent_app",
                    dataset_ids=["dataset-1"],
                    query="reset password",
                    retrieval=_retrieval_config(),
                    metadata_filtering=_metadata_filtering(),
                )
            assert exc_info.value.retryable is True

    import asyncio

    asyncio.run(scenario())


def test_knowledge_client_treats_invalid_url_errors_as_non_retryable_configuration_error() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient() as http_client:
            http_client.post = AsyncMock(side_effect=httpx.UnsupportedProtocol("unsupported protocol"))
            client = DifyKnowledgeBaseClient(
                base_url="http://dify-api", api_key="inner-secret", http_client=http_client
            )
            with pytest.raises(DifyKnowledgeBaseClientError) as exc_info:
                _ = await client.retrieve(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    app_id="app-1",
                    user_from="account",
                    invoke_from="agent_app",
                    dataset_ids=["dataset-1"],
                    query="reset password",
                    retrieval=_retrieval_config(),
                    metadata_filtering=_metadata_filtering(),
                )
            assert exc_info.value.retryable is False

    import asyncio

    asyncio.run(scenario())
