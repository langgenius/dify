import json
from dataclasses import dataclass, field
from unittest.mock import create_autospec

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.models.document import Document as RetrievalDocument
from graphon.model_runtime.errors.invoke import InvokeError
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetQuery, Document, DocumentSegment
from models.enums import SegmentStatus
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessSnapshot, DatasetNotFoundError
from services.knowledge.entities.external import ExternalRetrievalCandidate, ExternalRetrievalConfig
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse
from services.knowledge.hit_testing.errors import HitTestingInvocationError, HitTestingUnsupportedInputError

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


class UnexpectedExternalRetrieval:
    def retrieve(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> list[ExternalRetrievalCandidate]:
        _ = (tenant_id, query, retrieval_model, metadata_filters)
        raise AssertionError(f"vendor dataset {dataset_id} reached external retrieval")


@dataclass
class ExternalRetrievalStub:
    response: list[ExternalRetrievalCandidate]
    checked_out: set[object]
    calls: list[tuple[str, str, str, ExternalRetrievalConfig | None, MetadataFilteringCondition | None]] = field(
        default_factory=list
    )

    def retrieve(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> list[ExternalRetrievalCandidate]:
        assert self.checked_out == set()
        self.calls.append((tenant_id, dataset_id, query, retrieval_model, metadata_filters))
        return self.response


class PermissiveDatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        return AccessibleDataset(dataset_id, context.active_workspace_id)

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        return AccessibleDataset(snapshot.dataset.id, context.active_workspace_id)


def _gateway(
    factory: sessionmaker[Session],
    *,
    external_retrieval: UnexpectedExternalRetrieval | ExternalRetrievalStub | None = None,
) -> DatasetHitTestingGateway:
    return DatasetHitTestingGateway(
        datasets=SQLAlchemyDatasetRepository(
            session_factory=factory,
            revoke_keys_after_commit=lambda _session, _keys: None,
        ),
        documents=SQLAlchemyDocumentRepository(session_factory=factory),
        segments=SQLAlchemySegmentRepository(session_factory=factory),
        session_factory=factory,
        external_retrieval=external_retrieval or UnexpectedExternalRetrieval(),
    )


@pytest.fixture
def gateway(sqlite_session_factory: sessionmaker[Session]) -> DatasetHitTestingGateway:
    with sqlite_session_factory.begin() as session:
        session.add(Dataset(id="dataset", tenant_id="tenant", name="Dataset", created_by="actor"))
    return DatasetHitTestingGateway(
        datasets=SQLAlchemyDatasetRepository(
            session_factory=sqlite_session_factory,
            revoke_keys_after_commit=lambda _session, _keys: None,
        ),
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        segments=SQLAlchemySegmentRepository(session_factory=sqlite_session_factory),
        session_factory=sqlite_session_factory,
        external_retrieval=UnexpectedExternalRetrieval(),
    )


@pytest.fixture
def service(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
) -> HitTestingApplicationService:
    return HitTestingApplicationService(
        dataset_access=PermissiveDatasetAccess(),
        retrieval=gateway,
        queries=SQLAlchemyDatasetRepository(
            session_factory=sqlite_session_factory,
            revoke_keys_after_commit=lambda _session, _keys: None,
        ),
    )


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
    external_retrieval = ExternalRetrievalStub(
        response=[
            ExternalRetrievalCandidate(
                content="answer",
                title="External document",
                score=0.9,
                metadata={"source": "external"},
            )
        ],
        checked_out=checked_out,
    )
    routed_gateway = _gateway(sqlite_session_factory, external_retrieval=external_retrieval)
    metadata_filters = {
        "logical_operator": "and",
        "conditions": [{"name": "category", "comparison_operator": "is", "value": "finance"}],
    }
    request = HitTestingRequest(
        query="external query",
        retrieval_model={"metadata_filtering_conditions": metadata_filters},
        external_retrieval_model=ExternalRetrievalConfig(top_k=3),
        attachment_ids=["ignored-for-external-query"],
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

    assert external_retrieval.calls == [
        (
            REF.tenant_id,
            REF.dataset_id,
            "external query",
            ExternalRetrievalConfig(top_k=3),
            MetadataFilteringCondition.model_validate(metadata_filters),
        )
    ]


def test_external_dataset_rejects_attachment_only_input_before_provider_io(
    sqlite_session_factory: sessionmaker[Session],
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
    gateway = _gateway(sqlite_session_factory)

    with pytest.raises(
        HitTestingUnsupportedInputError,
        match="External knowledge bases do not support attachment-only retrieval",
    ):
        gateway.retrieve(CONTEXT, REF, HitTestingRequest("", None, None, ["upload-file-id"]))


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
        allowed_document_filter: list[str] | None,
    ) -> list[Document]:
        assert not checked_out
        assert dataset_id == "dataset"
        assert query == "query"
        assert attachments == ["upload"]
        assert document_filter is None
        assert allowed_document_filter is None
        assert model["top_k"] == 4
        return []

    monkeypatch.setattr(DatasetHitTestingGateway, "_retrieve_documents", staticmethod(retrieve))
    try:
        assert service.retrieve(
            CONTEXT, dataset_id=REF.dataset_id, request=HitTestingRequest("query", None, None, ["upload"])
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
        gateway.retrieve(CONTEXT, DatasetRef("other", "dataset"), HitTestingRequest("query", None, None, None))


def test_invocation_failure_is_neutral_and_does_not_record_history(
    service: HitTestingApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invocation_error = InvokeError("provider unavailable")

    def retrieve(*_args: object) -> list[Document]:
        raise invocation_error

    monkeypatch.setattr(DatasetHitTestingGateway, "_retrieve_documents", staticmethod(retrieve))
    with pytest.raises(HitTestingInvocationError, match="provider unavailable") as failure:
        service.retrieve(
            CONTEXT,
            dataset_id=REF.dataset_id,
            request=HitTestingRequest("query", None, None, None),
        )
    assert failure.value.__cause__ is invocation_error
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
    service.retrieve(
        CONTEXT,
        dataset_id=REF.dataset_id,
        request=HitTestingRequest(
            "query",
            requested_model if configuration == "override" else None,
            None,
            ["upload"],
        ),
    )
    options = retrieval.call_args.kwargs
    assert options["top_k"] == {"default": 4, "stored": 9, "override": 10}[configuration]
    assert options["attachment_ids"] == ["upload"]
    assert options["score_threshold"] == (0.5 if configuration == "override" else 0.0)
    assert options["reranking_model"] == ({"provider": "test"} if configuration == "override" else None)
    if configuration == "override":
        assert options["reranking_mode"] == "weighted_sum"
        assert options["weights"] == {"vector": 0.5, "keyword": 0.5}
