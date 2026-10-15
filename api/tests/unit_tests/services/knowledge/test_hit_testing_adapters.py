import json
from unittest.mock import create_autospec

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.models.document import Document
from graphon.model_runtime.errors.invoke import InvokeError
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetQuery
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.errors.dataset import DatasetNotFoundError
from services.errors.knowledge_retrieval import HitTestingInvocationError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.entities.hit_testing import HitTestingRequest
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.application import HitTestingApplicationService

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


@pytest.fixture
def gateway(sqlite_session_factory: sessionmaker[Session]) -> DatasetHitTestingGateway:
    with sqlite_session_factory.begin() as session:
        session.add(Dataset(id="dataset", tenant_id="tenant", name="Dataset", created_by="actor"))
    return DatasetHitTestingGateway(
        datasets=SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory),
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        segments=SQLAlchemySegmentRepository(session_factory=sqlite_session_factory),
    )


@pytest.fixture
def service(
    gateway: DatasetHitTestingGateway, sqlite_session_factory: sessionmaker[Session]
) -> HitTestingApplicationService:
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return HitTestingApplicationService(
        dataset_access=access,
        retrieval=gateway,
        queries=SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory),
    )


def test_network_releases_read_connection_and_records_text_and_attachments(
    service: HitTestingApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked_out: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        checked_out.add(record)

    def checkin(_connection: object, record: object) -> None:
        checked_out.discard(record)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)

    def retrieve(
        dataset_id: str,
        query: str,
        model: DefaultRetrievalModelDict,
        attachments: list[str] | None,
        document_filter: list[str] | None,
    ) -> list[Document]:
        assert not checked_out
        assert dataset_id == "dataset"
        assert query == "query"
        assert attachments == ["upload"]
        assert document_filter is None
        assert model["top_k"] == 4
        return []

    monkeypatch.setattr(DatasetHitTestingGateway, "_retrieve_documents", staticmethod(retrieve))
    try:
        assert service.hit_testing(
            CONTEXT, dataset_id=REF.dataset_id, request=HitTestingRequest("query", None, ["upload"])
        ) == {
            "query": {"content": "query"},
            "records": [],
        }
        assert not checked_out
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
    with sqlite_session_factory() as session:
        saved = session.scalar(select(DatasetQuery))
        assert saved is not None
        assert saved.dataset_id == "dataset"
        assert saved.created_by == "actor"
        assert json.loads(saved.content) == [
            {"content_type": "text_query", "content": "query"},
            {"content_type": "image_query", "content": "upload"},
        ]


def test_foreign_dataset_is_rejected_before_retrieval(
    gateway: DatasetHitTestingGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    def retrieve(*_args: object) -> list[Document]:
        pytest.fail("foreign dataset reached retrieval")

    monkeypatch.setattr(DatasetHitTestingGateway, "_retrieve_documents", staticmethod(retrieve))
    with pytest.raises(DatasetNotFoundError):
        gateway.retrieve(DatasetRef("other", "dataset"), HitTestingRequest("query", None, None))


def test_invocation_failure_is_neutral_and_does_not_record_history(
    service: HitTestingApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def retrieve(*_args: object) -> list[Document]:
        raise InvokeError("provider unavailable")

    monkeypatch.setattr(DatasetHitTestingGateway, "_retrieve_documents", staticmethod(retrieve))
    with pytest.raises(HitTestingInvocationError, match="provider unavailable"):
        service.hit_testing(CONTEXT, dataset_id=REF.dataset_id, request=HitTestingRequest("query", None, None))
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetQuery)) == 0


@pytest.mark.parametrize("configuration", ["default", "stored", "override"])
def test_retrieval_configuration_precedence(
    service: HitTestingApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    configuration: str,
) -> None:
    stored_model: dict[str, object] = {
        "search_method": "semantic_search",
        "top_k": 9,
        "reranking_enable": False,
        "score_threshold_enabled": False,
    }
    requested_model: dict[str, object] = {
        "search_method": "hybrid_search",
        "top_k": 10,
        "reranking_enable": True,
        "reranking_model": {"provider": "test"},
        "reranking_mode": "weighted_sum",
        "score_threshold_enabled": True,
        "score_threshold": 0.5,
        "weights": {"vector": 0.5, "keyword": 0.5},
    }
    if configuration != "default":
        with sqlite_session_factory.begin() as session:
            dataset = session.get(Dataset, REF.dataset_id)
            assert dataset is not None
            dataset.retrieval_model = stored_model
    retrieval = create_autospec(RetrievalService.retrieve, spec_set=True, return_value=[])
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    service.hit_testing(
        CONTEXT,
        dataset_id=REF.dataset_id,
        request=HitTestingRequest("query", requested_model if configuration == "override" else None, ["upload"]),
    )
    options = retrieval.call_args.kwargs
    assert options["top_k"] == {"default": 4, "stored": 9, "override": 10}[configuration]
    assert options["attachment_ids"] == ["upload"]
    assert options["score_threshold"] == (0.5 if configuration == "override" else 0.0)
    assert options["reranking_model"] == ({"provider": "test"} if configuration == "override" else None)
    if configuration == "override":
        assert options["reranking_mode"] == "weighted_sum"
        assert options["weights"] == {"vector": 0.5, "keyword": 0.5}
