"""Unit tests for the inner knowledge retrieval service."""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from core.workflow.nodes.knowledge_retrieval.retrieval import Source, SourceMetadata
from models.dataset import Dataset
from models.enums import AppStatus
from models.model import App, AppMode
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveRequest
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)
from services.knowledge_retrieval_inner_service import InnerKnowledgeRetrievalService

TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "33333333-3333-3333-3333-333333333333"
APP_ID = "44444444-4444-4444-4444-444444444444"
DATASET_1_ID = "55555555-5555-5555-5555-555555555555"
DATASET_2_ID = "66666666-6666-6666-6666-666666666666"


def _app(*, tenant_id: str = TENANT_ID) -> App:
    return App(
        id=APP_ID,
        tenant_id=tenant_id,
        name="Test App",
        description="",
        mode=AppMode.WORKFLOW,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
    )


def _dataset(*, dataset_id: str, tenant_id: str = TENANT_ID, enable_api: bool = True) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"Dataset {dataset_id[-1]}",
        description="",
        created_by=USER_ID,
        enable_api=enable_api,
    )


def _persist_state(sqlite_session: Session, *models: App | Dataset) -> None:
    sqlite_session.add_all(models)
    sqlite_session.commit()
    sqlite_session.expunge_all()


def _build_request(**overrides):
    payload = {
        "caller": {
            "tenant_id": TENANT_ID,
            "user_id": USER_ID,
            "app_id": APP_ID,
            "user_from": "account",
            "invoke_from": "workflow",
        },
        "dataset_ids": [DATASET_1_ID, DATASET_2_ID],
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
    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    @patch("services.knowledge_retrieval_inner_service.DatasetRetrieval")
    def test_retrieve_maps_multiple_request_and_skips_enable_api_check(
        self,
        mock_rag_cls,
        sqlite_session: Session,
    ):
        request = _build_request()
        _persist_state(
            sqlite_session,
            _app(),
            _dataset(dataset_id=DATASET_1_ID, enable_api=False),
            _dataset(dataset_id=DATASET_2_ID, enable_api=True),
        )

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

        response = InnerKnowledgeRetrievalService().retrieve(request, sqlite_session)

        rag_request = rag.knowledge_retrieval.call_args.kwargs["request"]
        assert rag_request.tenant_id == TENANT_ID
        assert rag_request.app_id == APP_ID
        assert rag_request.user_id == USER_ID
        assert rag_request.dataset_ids == [DATASET_1_ID, DATASET_2_ID]
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
        assert rag.knowledge_retrieval.call_args.kwargs["session"] is sqlite_session
        assert sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    @patch("services.knowledge_retrieval_inner_service.DatasetRetrieval")
    def test_retrieve_maps_single_request(self, mock_rag_cls, sqlite_session: Session):
        request = _build_request(
            dataset_ids=[DATASET_1_ID],
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
        _persist_state(sqlite_session, _app(), _dataset(dataset_id=DATASET_1_ID))

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

        InnerKnowledgeRetrievalService().retrieve(request, sqlite_session)

        rag_request = rag.knowledge_retrieval.call_args.kwargs["request"]
        assert rag_request.retrieval_mode == "single"
        assert rag_request.model_provider == "openai"
        assert rag_request.model_name == "gpt-4o-mini"
        assert rag_request.model_mode == "chat"
        assert rag_request.completion_params == {"temperature": 0}
        assert rag_request.metadata_filtering_mode == "automatic"
        assert rag_request.metadata_model_config is not None
        assert rag_request.metadata_model_config.provider == "openai"
        assert sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_app_missing(self, sqlite_session: Session):
        with pytest.raises(InnerKnowledgeRetrieveAppNotFoundError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), sqlite_session)
        assert sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_app_belongs_to_other_tenant(self, sqlite_session: Session):
        _persist_state(sqlite_session, _app(tenant_id=OTHER_TENANT_ID))

        with pytest.raises(InnerKnowledgeRetrieveAppTenantMismatchError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), sqlite_session)
        assert sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_dataset_missing(self, sqlite_session: Session):
        _persist_state(sqlite_session, _app(), _dataset(dataset_id=DATASET_1_ID))

        with pytest.raises(InnerKnowledgeRetrieveDatasetNotFoundError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), sqlite_session)
        assert sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_dataset_belongs_to_other_tenant(self, sqlite_session: Session):
        _persist_state(
            sqlite_session,
            _app(),
            _dataset(dataset_id=DATASET_1_ID),
            _dataset(dataset_id=DATASET_2_ID, tenant_id=OTHER_TENANT_ID),
        )

        with pytest.raises(InnerKnowledgeRetrieveDatasetTenantMismatchError):
            InnerKnowledgeRetrievalService().retrieve(_build_request(), sqlite_session)
        assert sqlite_session.in_transaction()
