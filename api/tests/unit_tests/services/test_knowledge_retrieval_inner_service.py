"""Unit tests for the inner knowledge retrieval service."""

from unittest.mock import MagicMock, patch

import pytest

from core.workflow.nodes.knowledge_retrieval.retrieval import Source, SourceMetadata
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveRequest
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)
from services.knowledge_retrieval_inner_service import InnerKnowledgeRetrievalService


def _build_request(**overrides):
    payload = {
        "caller": {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "app_id": "app-1",
            "user_from": "account",
            "invoke_from": "workflow",
        },
        "dataset_ids": ["dataset-1", "dataset-2"],
        "query": "how to reset password",
        "retrieval": {
            "mode": "multiple",
            "top_k": 4,
            "score_threshold": 0.25,
            "reranking_mode": "reranking_model",
            "reranking_enable": True,
            "reranking_model": {
                "provider": "cohere",
                "model": "rerank-english-v3.0",
            },
        },
        "metadata_filtering": {
            "mode": "manual",
            "conditions": {
                "logical_operator": "and",
                "conditions": [
                    {
                        "name": "category",
                        "comparison_operator": "contains",
                        "value": "pricing",
                    }
                ],
            },
        },
        "attachment_ids": ["attachment-1"],
    }
    payload.update(overrides)
    return InnerKnowledgeRetrieveRequest.model_validate(payload)


def _build_source() -> Source:
    return Source(
        metadata=SourceMetadata(
            dataset_id="dataset-1",
            dataset_name="Docs",
            document_id="document-1",
            document_name="FAQ.md",
            data_source_type="upload_file",
        ),
        title="FAQ.md",
        files=[],
        content="Reset your password from settings.",
        summary=None,
    )


class TestInnerKnowledgeRetrievalService:
    @patch("services.knowledge_retrieval_inner_service.DatasetRetrieval")
    def test_retrieve_maps_multiple_request_and_skips_enable_api_check(self, mock_rag_cls):
        request = _build_request()
        mock_session = MagicMock()
        mock_app = MagicMock(id="app-1", tenant_id="tenant-1")
        dataset_1 = MagicMock(id="dataset-1", tenant_id="tenant-1", enable_api=False)
        dataset_2 = MagicMock(id="dataset-2", tenant_id="tenant-1", enable_api=True)
        mock_session.scalar.return_value = mock_app
        mock_session.scalars.return_value.all.return_value = [dataset_1, dataset_2]

        rag = MagicMock()
        rag.knowledge_retrieval.return_value = [_build_source()]
        rag.llm_usage = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "prompt_unit_price": "0",
            "completion_unit_price": "0",
            "prompt_price_unit": "0.001",
            "completion_price_unit": "0.001",
            "prompt_price": "0",
            "completion_price": "0",
            "total_price": "0",
            "currency": "USD",
            "latency": 0,
            "time_to_first_token": None,
            "time_to_generate": None,
        }
        mock_rag_cls.return_value = rag

        response = InnerKnowledgeRetrievalService().retrieve(request, mock_session)

        rag_request = rag.knowledge_retrieval.call_args.kwargs["request"]
        assert rag_request.tenant_id == "tenant-1"
        assert rag_request.app_id == "app-1"
        assert rag_request.user_id == "user-1"
        assert rag_request.dataset_ids == ["dataset-1", "dataset-2"]
        assert rag_request.query == "how to reset password"
        assert rag_request.retrieval_mode == "multiple"
        assert rag_request.top_k == 4
        assert rag_request.score_threshold == 0.25
        assert rag_request.reranking_model == {
            "reranking_provider_name": "cohere",
            "reranking_model_name": "rerank-english-v3.0",
        }
        assert rag_request.metadata_filtering_mode == "manual"
        assert rag_request.metadata_filtering_conditions is not None
        metadata_conditions = rag_request.metadata_filtering_conditions.model_dump(mode="python")
        assert metadata_conditions["logical_operator"] == "and"
        assert metadata_conditions["conditions"] is not None
        assert metadata_conditions["conditions"][0]["name"] == "category"
        assert rag_request.attachment_ids == ["attachment-1"]
        assert response.results[0].title == "FAQ.md"
        assert response.usage.currency == "USD"

    @patch("services.knowledge_retrieval_inner_service.DatasetRetrieval")
    def test_retrieve_maps_single_request(self, mock_rag_cls):
        request = _build_request(
            dataset_ids=["dataset-1"],
            retrieval={
                "mode": "single",
                "model": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "mode": "chat",
                    "completion_params": {"temperature": 0},
                },
            },
            metadata_filtering={
                "mode": "automatic",
                "model_config": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "mode": "chat",
                    "completion_params": {"temperature": 0},
                },
            },
            attachment_ids=[],
        )
        mock_session = MagicMock()
        mock_session.scalar.return_value = MagicMock(id="app-1", tenant_id="tenant-1")
        mock_session.scalars.return_value.all.return_value = [MagicMock(id="dataset-1", tenant_id="tenant-1")]

        rag = MagicMock()
        rag.knowledge_retrieval.return_value = []
        rag.llm_usage = {
            "prompt_tokens": 1,
            "completion_tokens": 2,
            "total_tokens": 3,
            "prompt_unit_price": "0",
            "completion_unit_price": "0",
            "prompt_price_unit": "0.001",
            "completion_price_unit": "0.001",
            "prompt_price": "0",
            "completion_price": "0",
            "total_price": "0",
            "currency": "USD",
            "latency": 1,
        }
        mock_rag_cls.return_value = rag

        InnerKnowledgeRetrievalService().retrieve(request, mock_session)

        rag_request = rag.knowledge_retrieval.call_args.kwargs["request"]
        assert rag_request.retrieval_mode == "single"
        assert rag_request.model_provider == "openai"
        assert rag_request.model_name == "gpt-4o-mini"
        assert rag_request.model_mode == "chat"
        assert rag_request.completion_params == {"temperature": 0}
        assert rag_request.metadata_filtering_mode == "automatic"
        assert rag_request.metadata_model_config is not None
        assert rag_request.metadata_model_config.provider == "openai"

    def test_retrieve_raises_when_app_missing(self):
        mock_session = MagicMock()
        mock_session.scalar.return_value = None

        with pytest.raises(InnerKnowledgeRetrieveAppNotFoundError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), mock_session)

    def test_retrieve_raises_when_app_belongs_to_other_tenant(self):
        mock_session = MagicMock()
        mock_session.scalar.return_value = MagicMock(id="app-1", tenant_id="tenant-2")

        with pytest.raises(InnerKnowledgeRetrieveAppTenantMismatchError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), mock_session)

    def test_retrieve_raises_when_dataset_missing(self):
        mock_session = MagicMock()
        mock_session.scalar.return_value = MagicMock(id="app-1", tenant_id="tenant-1")
        mock_session.scalars.return_value.all.return_value = [MagicMock(id="dataset-1", tenant_id="tenant-1")]

        with pytest.raises(InnerKnowledgeRetrieveDatasetNotFoundError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), mock_session)

    def test_retrieve_raises_when_dataset_belongs_to_other_tenant(self):
        mock_session = MagicMock()
        mock_session.scalar.return_value = MagicMock(id="app-1", tenant_id="tenant-1")
        mock_session.scalars.return_value.all.return_value = [
            MagicMock(id="dataset-1", tenant_id="tenant-1"),
            MagicMock(id="dataset-2", tenant_id="tenant-2"),
        ]

        with pytest.raises(InnerKnowledgeRetrieveDatasetTenantMismatchError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), mock_session)
