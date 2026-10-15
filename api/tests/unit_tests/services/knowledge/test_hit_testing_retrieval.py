"""Real persistence boundaries before retrieval content, signing, and authorization."""

from collections.abc import Iterable
from datetime import datetime
from unittest.mock import create_autospec

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document as RetrievalDocument
from extensions.storage.storage_type import StorageType
from fields.hit_testing_fields import HitTestingResponse
from machinery.context import RequestContext
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetQuery,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import (
    CreatorUserRole,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SummaryStatus,
)
from models.model import UploadFile
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.entities.hit_testing import HitTestingRequest
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing import adapters
from services.knowledge.hit_testing.adapters import DatasetHitTestingGateway
from services.knowledge.hit_testing.application import HitTestingApplicationService

REF = DatasetRef("tenant", "dataset")


def _document(document_id: str, form: str = IndexStructureType.PARAGRAPH_INDEX) -> Document:
    return Document(
        id=document_id,
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name=document_id,
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        doc_form=form,
        indexing_status=IndexingStatus.COMPLETED,
        doc_metadata={"category": "finance"},
    )


def _segment(segment_id: str, node_id: str, document_id: str = "document") -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        document_id=document_id,
        position=1,
        content=segment_id,
        word_count=1,
        tokens=1,
        created_by="admin",
        index_node_id=node_id,
        status=SegmentStatus.COMPLETED,
    )
    segment.id = segment_id
    return segment


def _child(child_id: str, node_id: str, segment_id: str = "safe-segment") -> ChildChunk:
    child = ChildChunk(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        document_id="document",
        segment_id=segment_id,
        position=1,
        content=child_id,
        word_count=1,
        created_by="admin",
        index_node_id=node_id,
    )
    child.id = child_id
    return child


def _file(file_id: str) -> UploadFile:
    file = UploadFile(
        tenant_id=REF.tenant_id,
        storage_type=StorageType.LOCAL,
        key=file_id,
        name=file_id,
        extension="png",
        mime_type="image/png",
        size=1,
        created_by="admin",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    file.id = file_id
    return file


def _binding(file_id: str, segment_id: str = "safe-segment") -> SegmentAttachmentBinding:
    return SegmentAttachmentBinding(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        document_id="document",
        segment_id=segment_id,
        attachment_id=file_id,
    )


def _hit(node_id: str, *, image: bool = False, summary: bool = False, score: float = 0.8) -> RetrievalDocument:
    return RetrievalDocument(
        page_content="retrieved",
        metadata={
            "document_id": "document",
            "doc_id": node_id,
            "score": score,
            "doc_type": DocType.IMAGE if image else None,
            "is_summary": summary,
            "original_chunk_id": node_id if summary else None,
        },
    )


def _scope() -> FileAccessScope:
    return FileAccessScope(
        tenant_id=REF.tenant_id,
        user_id="viewer",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )


@pytest.fixture
def gateway(sqlite_session_factory: sessionmaker[Session]) -> DatasetHitTestingGateway:
    with sqlite_session_factory.begin() as session:
        session.add(Dataset(id=REF.dataset_id, tenant_id=REF.tenant_id, name="Dataset", created_by="admin"))
    return DatasetHitTestingGateway(
        datasets=SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory),
        documents=SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory),
        segments=SQLAlchemySegmentRepository(session_factory=sqlite_session_factory),
    )


@pytest.mark.parametrize(
    ("entity", "field"),
    [
        ("segment", "tenant_id"),
        ("segment", "dataset_id"),
        ("segment", "document_id"),
        ("child", "tenant_id"),
        ("child", "dataset_id"),
        ("child", "document_id"),
        ("child", "segment_id"),
    ],
)
def test_invalid_segment_and_child_owners_never_reach_response_or_authorization(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    entity: str,
    field: str,
) -> None:
    parent_child = entity == "child"
    poisoned_segment = _segment("poisoned-segment", "poisoned-node")
    poisoned_child = _child("poisoned-child", "poisoned-node")
    target = poisoned_child if parent_child else poisoned_segment
    setattr(target, field, "foreign")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document(
                    "document",
                    IndexStructureType.PARENT_CHILD_INDEX if parent_child else IndexStructureType.PARAGRAPH_INDEX,
                ),
                _document("foreign"),
                _segment("foreign", "foreign-node", "foreign"),
                _segment("safe-segment", "safe-node"),
                _child("safe-child", "safe-node") if parent_child else poisoned_segment,
                _file("safe-file"),
                _file("poisoned-file"),
                _binding("safe-file"),
            ]
        )
        if parent_child:
            session.add(poisoned_child)
        else:
            session.add(_binding("poisoned-file", "poisoned-segment"))
    hits = [_hit("safe-node"), _hit("poisoned-node", score=0.99), _hit("safe-file", image=True)]
    if not parent_child:
        hits.append(_hit("poisoned-file", image=True))
    retrieval = create_autospec(RetrievalService.retrieve, spec_set=True, return_value=hits)
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    signed: list[str] = []
    signer = adapters.sign_upload_file_preview_url

    def sign(file_id: str, extension: str) -> str:
        signed.append(file_id)
        return signer(file_id, extension)

    monkeypatch.setattr(adapters, "sign_upload_file_preview_url", sign)
    with bind_file_access_scope(_scope()):
        response = HitTestingResponse.model_validate(
            gateway.retrieve(REF, HitTestingRequest("query", None, None)).response
        )
        scope = get_current_file_access_scope()
        assert scope is not None
        assert scope.granted_upload_file_ids == frozenset({"safe-file"})
        assert scope.granted_retriever_segment_ids == frozenset({"safe-segment"})
    assert signed == ["safe-file"]
    assert [record.segment.content for record in response.records] == ["safe-segment"]
    assert response.records[0].score == 0.8
    assert [child.content for child in response.records[0].child_chunks] == (["safe-child"] if parent_child else [])


@pytest.mark.parametrize("broken", ["tenant_id", "dataset_id", "document_id", "segment_id", "file_tenant", "unbound"])
def test_attachment_binding_and_file_owners_are_checked_before_signing_and_granting(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    broken: str,
) -> None:
    bad_file = _file("poisoned-file")
    bad_binding = _binding("poisoned-file")
    if broken == "file_tenant":
        bad_file.tenant_id = "foreign"
    elif broken != "unbound":
        setattr(bad_binding, broken, "foreign")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document("document"),
                _document("foreign"),
                _segment("foreign", "foreign-node", "foreign"),
                _segment("safe-segment", "safe-node"),
                _file("safe-file"),
                _binding("safe-file"),
                bad_file,
            ]
        )
        if broken != "unbound":
            session.add(bad_binding)
    retrieval = create_autospec(
        RetrievalService.retrieve,
        spec_set=True,
        return_value=[
            _hit("safe-node"),
            _hit("safe-file", image=True),
            _hit("poisoned-file", image=True, score=0.99),
        ],
    )
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    signer = create_autospec(adapters.sign_upload_file_preview_url, spec_set=True, return_value="signed-url")
    monkeypatch.setattr(adapters, "sign_upload_file_preview_url", signer)
    with bind_file_access_scope(_scope()):
        response = HitTestingResponse.model_validate(
            gateway.retrieve(REF, HitTestingRequest("query", None, None)).response
        )
        scope = get_current_file_access_scope()
        assert scope is not None
        assert scope.granted_upload_file_ids == frozenset({"safe-file"})
    signer.assert_called_once_with("safe-file", "png")
    assert [file.id for file in response.records[0].files] == ["safe-file"]
    assert response.records[0].score == 0.8


@pytest.mark.parametrize("broken", ["dataset_id", "document_id", "disabled", "status"])
def test_summary_owner_and_state_never_leak_content(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    broken: str,
) -> None:
    summary = DocumentSegmentSummary(
        dataset_id=REF.dataset_id,
        document_id="document",
        chunk_id="safe-segment",
        summary_content="poisoned summary",
        status=SummaryStatus.COMPLETED,
    )
    if broken == "disabled":
        summary.enabled = False
    elif broken == "status":
        summary.status = SummaryStatus.ERROR
    else:
        setattr(summary, broken, "foreign")
    with sqlite_session_factory.begin() as session:
        session.add_all([_document("document"), _segment("safe-segment", "safe-node"), summary])
    retrieval = create_autospec(
        RetrievalService.retrieve, spec_set=True, return_value=[_hit("safe-segment", summary=True)]
    )
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    response = HitTestingResponse.model_validate(gateway.retrieve(REF, HitTestingRequest("query", None, None)).response)
    assert len(response.records) == 1
    assert response.records[0].summary is None


@pytest.mark.parametrize("form", [IndexStructureType.PARAGRAPH_INDEX, IndexStructureType.PARENT_CHILD_INDEX])
def test_valid_results_aggregate_scores_and_release_connections_before_signing_and_authorization(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    form: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document("document", form),
                _segment("safe-segment", "safe-node"),
                _child("child-high", "child-high-node"),
                _child("child-low", "child-low-node"),
                _file("safe-file"),
                _binding("safe-file"),
                DocumentSegmentSummary(
                    dataset_id=REF.dataset_id,
                    document_id="document",
                    chunk_id="safe-segment",
                    summary_content="valid summary",
                    status=SummaryStatus.COMPLETED,
                ),
            ]
        )
    hits = [
        _hit("safe-node", score=0.95),
        _hit("child-high-node", score=0.9),
        _hit("child-low-node", score=0.6),
        _hit("safe-file", image=True, score=0.7),
        _hit("safe-segment", summary=True, score=0.8),
        _hit("safe-segment", summary=True, score=0.5),
    ]
    checked_out: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        checked_out.add(record)

    def checkin(_connection: object, record: object) -> None:
        checked_out.discard(record)

    signer = adapters.sign_upload_file_preview_url
    grant = adapters.grant_upload_file_access

    def sign(file_id: str, extension: str) -> str:
        assert not checked_out
        return signer(file_id, extension)

    def authorize(file_ids: Iterable[str]) -> None:
        assert not checked_out
        grant(file_ids)

    def retrieve(*_args: object, **_kwargs: object) -> list[RetrievalDocument]:
        assert not checked_out
        return hits

    monkeypatch.setattr(adapters, "sign_upload_file_preview_url", sign)
    monkeypatch.setattr(adapters, "grant_upload_file_access", authorize)
    monkeypatch.setattr(RetrievalService, "retrieve", retrieve)
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        with bind_file_access_scope(_scope()):
            response = HitTestingResponse.model_validate(
                gateway.retrieve(REF, HitTestingRequest("query", None, None)).response
            )
            scope = get_current_file_access_scope()
            assert scope is not None
            assert scope.granted_upload_file_ids == frozenset({"safe-file"})
        assert not checked_out
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
    record = response.records[0]
    assert record.summary == "valid summary"
    assert record.score == (0.9 if form == IndexStructureType.PARENT_CHILD_INDEX else 0.8)
    assert [child.content for child in record.child_chunks] == (
        ["child-high", "child-low"] if form == IndexStructureType.PARENT_CHILD_INDEX else []
    )
    assert "timestamp=" in record.files[0].source_url


@pytest.mark.parametrize(
    ("form", "node_id"),
    [(IndexStructureType.PARAGRAPH_INDEX, "child-node"), (IndexStructureType.PARENT_CHILD_INDEX, "parent-node")],
)
def test_index_form_only_includes_the_matching_kind_of_node(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    form: str,
    node_id: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document("document", form),
                _segment("safe-segment", "parent-node"),
                _child("safe-child", "child-node"),
            ]
        )
    retrieval = create_autospec(RetrievalService.retrieve, spec_set=True, return_value=[_hit(node_id)])
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    with bind_file_access_scope(_scope()):
        assert gateway.retrieve(REF, HitTestingRequest("query", None, None)).response["records"] == []
        scope = get_current_file_access_scope()
        assert scope is not None
        assert not scope.granted_retriever_segment_ids


@pytest.mark.parametrize("count", [1, 8])
def test_response_batches_do_not_add_per_record_queries_or_keep_connections_open(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    count: int,
) -> None:
    hits: list[RetrievalDocument] = []
    with sqlite_session_factory.begin() as session:
        for i in range(count):
            document = _document(f"document-{i}")
            session.add_all([document, _segment(f"segment-{i}", f"node-{i}", document.id)])
            hit = _hit(f"node-{i}")
            hit.metadata["document_id"] = document.id
            hits.append(hit)
    retrieval = create_autospec(RetrievalService.retrieve, spec_set=True, return_value=hits)
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    queries: list[str] = []
    active_connections = 0
    maximum_connections = 0

    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        nonlocal active_connections, maximum_connections
        active_connections += 1
        maximum_connections = max(maximum_connections, active_connections)

    def checkin(_connection: object, _record: object) -> None:
        nonlocal active_connections
        active_connections -= 1

    def capture(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if statement.startswith("SELECT"):
            queries.append(statement)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    event.listen(sqlite_engine, "before_cursor_execute", capture)
    try:
        result = gateway.retrieve(REF, HitTestingRequest("query", None, None))
        assert maximum_connections == 1
        assert active_connections == 0
        assert len(queries) <= 4
        response = HitTestingResponse.model_validate(result.response)
        assert len(response.records) == count
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
        event.remove(sqlite_engine, "before_cursor_execute", capture)


def test_signing_failure_does_not_grant_file_or_segment_access(
    gateway: DatasetHitTestingGateway,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _document("document"),
                _segment("safe-segment", "safe-node"),
                _file("safe-file"),
                _binding("safe-file"),
            ]
        )
    retrieval = create_autospec(
        RetrievalService.retrieve, spec_set=True, return_value=[_hit("safe-node"), _hit("safe-file", image=True)]
    )
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)

    def fail_signing(_file_id: str, _extension: str) -> str:
        raise RuntimeError("signing failed")

    monkeypatch.setattr(adapters, "sign_upload_file_preview_url", fail_signing)
    with bind_file_access_scope(_scope()):
        with pytest.raises(RuntimeError, match="signing failed"):
            gateway.retrieve(REF, HitTestingRequest("query", None, None))
        scope = get_current_file_access_scope()
        assert scope is not None
        assert not scope.granted_upload_file_ids
        assert not scope.granted_retriever_segment_ids


@pytest.mark.parametrize("matched", [True, False])
def test_real_metadata_filter_preserves_retrieval_and_query_history_behavior(
    gateway: DatasetHitTestingGateway,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    matched: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_document("document"))
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = AccessibleDataset(REF.dataset_id, REF.tenant_id)
    service = HitTestingApplicationService(
        dataset_access=access,
        retrieval=gateway,
        queries=SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory),
    )
    model: dict[str, object] = {
        "search_method": "semantic_search",
        "top_k": 4,
        "reranking_enable": False,
        "score_threshold_enabled": False,
        "metadata_filtering_conditions": {
            "conditions": [
                {"name": "category", "comparison_operator": "is", "value": "finance" if matched else "missing"}
            ],
        },
    }
    retrieval = create_autospec(RetrievalService.retrieve, spec_set=True, return_value=[])
    monkeypatch.setattr(RetrievalService, "retrieve", retrieval)
    with sqlite_session.begin() as caller_transaction:
        pending_document = _document("pending-document")
        sqlite_session.add(pending_document)
        assert service.hit_testing(
            RequestContext("request", None, "viewer", REF.tenant_id),
            dataset_id=REF.dataset_id,
            request=HitTestingRequest("query", model, None),
        ) == {
            "query": {"content": "query"},
            "records": [],
        }
        assert sqlite_session.get_transaction() is caller_transaction
        assert caller_transaction.is_active
        assert pending_document in sqlite_session.new
    if matched:
        retrieval.assert_called_once()
        assert retrieval.call_args.kwargs["document_ids_filter"] == ["document"]
    else:
        retrieval.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetQuery)) == int(matched)
