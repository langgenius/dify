from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document as RetrievalDocument
from machinery.context import RequestContext
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import SegmentStatus
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


class UnexpectedExternalRetrieval:
    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, object] | None,
        metadata_filters: dict[str, object] | None,
    ) -> Mapping[str, object]:
        _ = (context, query, retrieval_model, metadata_filters)
        raise AssertionError(f"vendor dataset {ref.dataset_id} reached external retrieval")


@dataclass
class ExternalRetrievalStub:
    response: HitTestingResponse
    checked_out: set[object]
    calls: list[tuple[RequestContext, DatasetRef, str, dict[str, object] | None, dict[str, object] | None]] = field(
        default_factory=list
    )

    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, object] | None,
        metadata_filters: dict[str, object] | None,
    ) -> Mapping[str, object]:
        assert self.checked_out == set()
        self.calls.append((context, ref, query, retrieval_model, metadata_filters))
        return self.response


def _gateway(
    factory: sessionmaker[Session],
    *,
    external_retrieval: UnexpectedExternalRetrieval | ExternalRetrievalStub | None = None,
) -> DatasetHitTestingGateway:
    return DatasetHitTestingGateway(
        datasets=SQLAlchemyDatasetRepository(
            session_factory=factory,
            wake_after_commit=lambda _session: None,
            revoke_keys_after_commit=lambda _session, _keys: None,
        ),
        documents=SQLAlchemyDocumentRepository(session_factory=factory),
        segments=SQLAlchemySegmentRepository(session_factory=factory, wake_after_commit=lambda _session: None),
        external_retrieval=external_retrieval or UnexpectedExternalRetrieval(),
    )


@pytest.fixture
def gateway(sqlite_session_factory: sessionmaker[Session]) -> DatasetHitTestingGateway:
    with sqlite_session_factory.begin() as session:
        session.add(Dataset(id=REF.dataset_id, tenant_id=REF.tenant_id, name="Dataset", created_by="actor"))
    return _gateway(sqlite_session_factory)


def test_retrieval_runs_without_a_checked_out_database_connection(
    gateway: DatasetHitTestingGateway,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked_out: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        checked_out.add(record)

    def checkin(_connection: object, record: object) -> None:
        checked_out.discard(record)

    def retrieve_documents(**_kwargs: object) -> list[RetrievalDocument]:
        assert checked_out == set()
        return []

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    monkeypatch.setattr(RetrievalService, "retrieve", staticmethod(retrieve_documents))
    try:
        result = gateway.retrieve(CONTEXT, REF, HitTestingRequest("query", None, None, ["upload"]))
        assert result.response == {"query": {"content": "query"}, "records": []}
        assert result.record_query
        assert checked_out == set()
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_gateway_rejects_a_dataset_outside_the_owned_reference(gateway: DatasetHitTestingGateway) -> None:
    from services.knowledge.dataset_access import DatasetNotFoundError

    with pytest.raises(DatasetNotFoundError):
        gateway.retrieve(CONTEXT, DatasetRef("other", REF.dataset_id), HitTestingRequest("query", None, None, None))


def test_external_dataset_uses_external_retrieval_without_preparing_an_internal_model(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            Dataset(
                id=REF.dataset_id,
                tenant_id=REF.tenant_id,
                name="External Dataset",
                created_by="actor",
                provider="external",
            )
        )

    checked_out: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        checked_out.add(record)

    def checkin(_connection: object, record: object) -> None:
        checked_out.discard(record)

    def unexpected_internal_retrieval(**_kwargs: object) -> None:
        raise AssertionError("external dataset reached internal retrieval")

    response: HitTestingResponse = {
        "query": {"content": "external query"},
        "records": [
            {
                "content": "answer",
                "title": "External document",
                "score": 0.9,
                "metadata": {"source": "external"},
            }
        ],
    }
    external_retrieval = ExternalRetrievalStub(response=response, checked_out=checked_out)
    routed_gateway = _gateway(sqlite_session_factory, external_retrieval=external_retrieval)
    metadata_filters = {
        "logical_operator": "and",
        "conditions": [{"name": "category", "comparison_operator": "is", "value": "finance"}],
    }
    request = HitTestingRequest(
        query="external query",
        retrieval_model={"metadata_filtering_conditions": metadata_filters},
        external_retrieval_model={"top_k": 3},
        attachment_ids=None,
    )

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    monkeypatch.setattr(RetrievalService, "retrieve", staticmethod(unexpected_internal_retrieval))
    try:
        result = routed_gateway.retrieve(CONTEXT, REF, request)
        assert result.response == response
        assert not result.record_query
        assert checked_out == set()
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)

    assert external_retrieval.calls == [(CONTEXT, REF, "external query", {"top_k": 3}, metadata_filters)]


def test_empty_metadata_match_skips_retrieval_and_query_history(
    gateway: DatasetHitTestingGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_retrieval(**_kwargs: object) -> list[RetrievalDocument]:
        raise AssertionError("empty metadata match reached retrieval")

    monkeypatch.setattr(RetrievalService, "retrieve", staticmethod(unexpected_retrieval))
    model = {
        "search_method": "semantic_search",
        "reranking_enable": False,
        "top_k": 4,
        "score_threshold_enabled": False,
        "metadata_filtering_conditions": {
            "logical_operator": "and",
            "conditions": [{"name": "category", "comparison_operator": "is", "value": "missing"}],
        },
    }

    result = gateway.retrieve(CONTEXT, REF, HitTestingRequest("query", model, None, None))

    assert result.response["records"] == []
    assert not result.record_query


def test_response_formatting_drops_a_foreign_segment_referenced_by_stale_index_metadata(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    allowed_document = Document(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        position=1,
        data_source_type="upload_file",
        batch="batch",
        name="allowed.txt",
        created_from="api",
        created_by="actor",
    )
    foreign_dataset = Dataset(tenant_id="other", name="Foreign", created_by="other-actor")
    foreign_document = Document(
        tenant_id="other",
        dataset_id=foreign_dataset.id,
        position=1,
        data_source_type="upload_file",
        batch="batch",
        name="foreign.txt",
        created_from="api",
        created_by="other-actor",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([allowed_document, foreign_dataset, foreign_document])
        session.flush()
        session.add(
            DocumentSegment(
                tenant_id="other",
                dataset_id=foreign_dataset.id,
                document_id=foreign_document.id,
                position=1,
                content="foreign",
                word_count=1,
                tokens=1,
                created_by="other-actor",
                index_node_id="foreign-node",
                status=SegmentStatus.COMPLETED,
            )
        )
    stale_hit = RetrievalDocument(
        page_content="foreign",
        metadata={"document_id": allowed_document.id, "doc_id": "foreign-node", "score": 0.9},
    )
    monkeypatch.setattr(RetrievalService, "retrieve", lambda **_kwargs: [stale_hit])

    assert gateway.retrieve(CONTEXT, REF, HitTestingRequest("query", None, None, None)).response == {
        "query": {"content": "query"},
        "records": [],
    }
