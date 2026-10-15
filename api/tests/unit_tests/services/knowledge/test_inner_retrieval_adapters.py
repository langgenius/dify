"""Inner retrieval adapters: scoped persistence, runtime mapping, and owned sessions."""

from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.exc import RateLimitExceededError
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest, Source, SourceMetadata
from graphon.model_runtime.entities.llm_entities import LLMUsage
from machinery.context import RequestContext
from models.dataset import Dataset
from models.model import App, AppMode
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.errors.knowledge_retrieval import (
    ExternalKnowledgeRetrievalError,
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveConfigError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
    InnerKnowledgeRetrieveExternalError,
    InnerKnowledgeRetrieveRateLimitError,
)
from services.knowledge.entities.inner_retrieval import InnerKnowledgeRetrieveRequest, InnerKnowledgeRetrieveWeights
from services.knowledge.retrieval.adapters import WorkflowKnowledgeRetrievalGateway
from services.knowledge.retrieval.application import InnerKnowledgeRetrievalService
from tests.unit_tests.model_factories import make_app, make_dataset

TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "33333333-3333-3333-3333-333333333333"
APP_ID = "44444444-4444-4444-4444-444444444444"
DATASET_1_ID = "55555555-5555-5555-5555-555555555555"
DATASET_2_ID = "66666666-6666-6666-6666-666666666666"


def _app(*, tenant_id: str = TENANT_ID) -> App:
    return make_app(
        app_id=APP_ID,
        tenant_id=tenant_id,
        mode=AppMode.WORKFLOW,
        icon_type=None,
        enable_site=False,
        enable_api=False,
    )


def _dataset(*, dataset_id: str, tenant_id: str = TENANT_ID, enable_api: bool = True) -> Dataset:
    return make_dataset(
        dataset_id=dataset_id,
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


def _context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "", "")


class TestInnerKnowledgeRetrievalAdapters:
    @pytest.fixture(autouse=True)
    def service(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        self.service_instance = InnerKnowledgeRetrievalService(
            scope=SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory),
            retrieval=WorkflowKnowledgeRetrievalGateway(session_factory=sqlite_session_factory),
        )

    @pytest.mark.parametrize(
        ("failure", "expected"),
        [
            (RateLimitExceededError("rate limited"), InnerKnowledgeRetrieveRateLimitError),
            (ExternalKnowledgeRetrievalError("provider failed"), InnerKnowledgeRetrieveExternalError),
            (ValueError("bad configuration"), InnerKnowledgeRetrieveConfigError),
        ],
    )
    def test_runtime_errors_are_translated_and_runtime_session_is_released(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, failure: Exception, expected: type[Exception]
    ) -> None:
        _persist_state(sqlite_session, _app(), _dataset(dataset_id=DATASET_1_ID), _dataset(dataset_id=DATASET_2_ID))
        runtime_sessions: list[Session] = []

        def fail(*, session: Session, request: KnowledgeRetrievalRequest) -> None:
            assert request.tenant_id == TENANT_ID
            session.scalar(select(1))
            runtime_sessions.append(session)
            raise failure

        rag = create_autospec(DatasetRetrieval, instance=True, spec_set=True)
        rag.knowledge_retrieval.side_effect = fail
        monkeypatch.setattr("services.knowledge.retrieval.adapters.DatasetRetrieval", lambda: rag)

        with pytest.raises(expected) as caught:
            self.service_instance.retrieve(_context(), _build_request())

        assert caught.value.__cause__ is failure
        assert len(runtime_sessions) == 1
        assert not runtime_sessions[0].in_transaction()
        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("valid_scope", [False, True])
    def test_validation_keeps_caller_transaction_and_pending_writes(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, valid_scope: bool
    ) -> None:
        if valid_scope:
            _persist_state(sqlite_session, _app(), _dataset(dataset_id=DATASET_1_ID), _dataset(dataset_id=DATASET_2_ID))
        pending = _dataset(dataset_id="pending-dataset")
        sqlite_session.add(pending)
        transaction = sqlite_session.get_transaction()
        rag = create_autospec(DatasetRetrieval, instance=True, spec_set=True)
        rag.knowledge_retrieval.return_value = []
        rag.llm_usage = LLMUsage.empty_usage()
        monkeypatch.setattr("services.knowledge.retrieval.adapters.DatasetRetrieval", lambda: rag)

        if valid_scope:
            self.service_instance.retrieve(_context(), _build_request())
            rag.knowledge_retrieval.assert_called_once()
        else:
            with pytest.raises(InnerKnowledgeRetrieveAppNotFoundError):
                self.service_instance.retrieve(_context(), _build_request())
            rag.knowledge_retrieval.assert_not_called()

        assert pending in sqlite_session.new
        assert sqlite_session.get_transaction() is transaction

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    @patch("services.knowledge.retrieval.adapters.DatasetRetrieval")
    def test_retrieve_maps_multiple_request_and_skips_enable_api_check(
        self,
        mock_rag_cls,
        sqlite_session: Session,
    ):
        request = _build_request()
        weights = {
            "vector_setting": {
                "vector_weight": 0.7,
                "embedding_provider_name": "provider",
                "embedding_model_name": "model",
            },
            "keyword_setting": {"keyword_weight": 0.3},
        }
        request.retrieval.weights = InnerKnowledgeRetrieveWeights.model_validate(weights)
        _persist_state(
            sqlite_session,
            _app(),
            _dataset(dataset_id=DATASET_1_ID, enable_api=False),
            _dataset(dataset_id=DATASET_2_ID, enable_api=True),
        )

        rag = create_autospec(DatasetRetrieval, instance=True, spec_set=True)
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

        response = self.service_instance.retrieve(_context(), request)

        rag_request = rag.knowledge_retrieval.call_args.kwargs["request"]
        rag.set_request_metadata.assert_called_once_with(
            {"app_id": APP_ID, "request_id": "request-1", "trace_id": "trace-1"}
        )
        assert rag_request.tenant_id == TENANT_ID
        assert rag_request.app_id == APP_ID
        assert rag_request.user_id == USER_ID
        assert rag_request.dataset_ids == [DATASET_1_ID, DATASET_2_ID]
        assert rag_request.query == "how to reset password"
        assert rag_request.retrieval_mode == "multiple"
        assert rag_request.weights == weights
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
        assert response.results[0]["title"] == "FAQ.md"
        assert response.usage.currency == "USD"
        assert rag.knowledge_retrieval.call_args.kwargs["session"] is not sqlite_session
        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    @patch("services.knowledge.retrieval.adapters.DatasetRetrieval")
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

        rag = create_autospec(DatasetRetrieval, instance=True, spec_set=True)
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

        self.service_instance.retrieve(_context(), request)

        rag_request = rag.knowledge_retrieval.call_args.kwargs["request"]
        assert rag_request.retrieval_mode == "single"
        assert rag_request.model_provider == "openai"
        assert rag_request.model_name == "gpt-4o-mini"
        assert rag_request.model_mode == "chat"
        assert rag_request.completion_params == {"temperature": 0}
        assert rag_request.metadata_filtering_mode == "automatic"
        assert rag_request.metadata_model_config is not None
        assert rag_request.metadata_model_config.provider == "openai"
        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_app_missing(self, sqlite_session: Session):
        with pytest.raises(InnerKnowledgeRetrieveAppNotFoundError):
            self.service_instance.retrieve(_context(), _build_request())
        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_app_belongs_to_other_tenant(self, sqlite_session: Session):
        _persist_state(sqlite_session, _app(tenant_id=OTHER_TENANT_ID))

        with pytest.raises(InnerKnowledgeRetrieveAppTenantMismatchError):
            self.service_instance.retrieve(_context(), _build_request())
        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_dataset_missing(self, sqlite_session: Session):
        _persist_state(sqlite_session, _app(), _dataset(dataset_id=DATASET_1_ID))

        with pytest.raises(InnerKnowledgeRetrieveDatasetNotFoundError):
            self.service_instance.retrieve(_context(), _build_request())
        assert not sqlite_session.in_transaction()

    @pytest.mark.parametrize("sqlite_session", [(App, Dataset)], indirect=True)
    def test_retrieve_raises_when_dataset_belongs_to_other_tenant(self, sqlite_session: Session):
        _persist_state(
            sqlite_session,
            _app(),
            _dataset(dataset_id=DATASET_1_ID),
            _dataset(dataset_id=DATASET_2_ID, tenant_id=OTHER_TENANT_ID),
        )

        with pytest.raises(InnerKnowledgeRetrieveDatasetTenantMismatchError):
            self.service_instance.retrieve(_context(), _build_request())
        assert not sqlite_session.in_transaction()
