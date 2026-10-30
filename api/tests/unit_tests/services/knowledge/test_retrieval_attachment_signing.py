"""Published applications sign admin-uploaded images only through valid knowledge bindings."""

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document as RagDocument
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from models.model import UploadFile
from repositories.knowledge.retrieval_source_repository import expand_attachment_document_filter
from services.knowledge.retrieval import finalization as retrieval_finalization
from services.knowledge.retrieval.finalization import KnowledgeRetrievalFinalizer
from services.knowledge.retrieval.records import RetrievalSegments


@pytest.fixture
def graph(sqlite_session: Session) -> tuple[Dataset, Document, DocumentSegment, dict[str, str]]:
    dataset = Dataset(id=str(uuid4()), tenant_id=str(uuid4()), name="Dataset", created_by="admin")
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        doc_form="text_model",
        doc_metadata={},
        indexing_status="completed",
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="",
        word_count=1,
        tokens=1,
        created_by="admin",
        index_node_id=str(uuid4()),
        index_node_hash="hash",
        status=SegmentStatus.COMPLETED,
    )
    file_ids: dict[str, str] = {}
    for kind in ("valid", "unbound", "tenant", "file_tenant", "dataset", "document", "segment"):
        upload = UploadFile(
            tenant_id=str(uuid4()) if kind == "file_tenant" else dataset.tenant_id,
            storage_type=StorageType.LOCAL,
            key=f"{kind}.png",
            name=f"{kind}.png",
            size=1,
            extension="png",
            mime_type="image/png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="admin",
            created_at=datetime.now(UTC),
            used=True,
        )
        file_ids[kind] = upload.id
        sqlite_session.add(upload)
        if kind != "unbound":
            sqlite_session.add(
                SegmentAttachmentBinding(
                    tenant_id=str(uuid4()) if kind == "tenant" else dataset.tenant_id,
                    dataset_id=str(uuid4()) if kind == "dataset" else dataset.id,
                    document_id=str(uuid4()) if kind == "document" else document.id,
                    segment_id=str(uuid4()) if kind == "segment" else segment.id,
                    attachment_id=upload.id,
                )
            )
    segment.content = "\n".join(
        f"![{kind}](/files/{file_id}/image-preview?sign=old)" for kind, file_id in file_ids.items()
    )
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()
    return dataset, document, segment, file_ids


def test_attachment_filter_expansion_uses_only_complete_current_bindings(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
) -> None:
    dataset, document, _segment, file_ids = graph

    identities = expand_attachment_document_filter(
        session=sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_ids=(document.id,),
    )

    assert identities == (document.id, file_ids["valid"])


def test_finalizer_rejects_non_attachment_candidates_outside_logical_document_filter(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment, _file_ids = graph
    candidate = RagDocument(
        page_content=segment.content,
        provider="dify",
        metadata={
            "doc_id": segment.index_node_id,
            "document_id": document.id,
            "dataset_id": dataset.id,
            "_retrieval_source_dataset_id": dataset.id,
            "_retrieval_allowed_document_ids": (str(uuid4()),),
            "score": 1.0,
        },
    )

    result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
        candidates=[candidate],
        tenant_id=dataset.tenant_id,
        dataset_ids=[dataset.id],
        top_k=0,
        retriever_from="workflow",
    )

    assert result.sources == ()


def test_published_retrieval_grants_bound_images_before_signing(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment, file_ids = graph
    candidates = [
        RagDocument(
            page_content=segment.content,
            provider="dify",
            metadata={
                "doc_id": segment.index_node_id,
                "document_id": document.id,
                "dataset_id": dataset.id,
                "score": 0.8,
            },
        )
    ]
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(scope):
        result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
            candidates=candidates,
            tenant_id=dataset.tenant_id,
            dataset_ids=[dataset.id],
            top_k=0,
            retriever_from="workflow",
        )
        assert len(result.sources) == 1
        assert [attachment.storage_key for attachment in result.attachments] == ["valid.png"]
        content = result.sources[0].content
        current_scope = get_current_file_access_scope()
        assert current_scope is not None
        assert current_scope.granted_upload_file_ids == frozenset([file_ids["valid"]])
        assert segment.id in current_scope.granted_retriever_segment_ids
    assert content is not None
    assert f"/files/{file_ids['valid']}/image-preview?timestamp=" in content
    assert "sign=old" not in content
    for kind, file_id in file_ids.items():
        if kind != "valid":
            assert f"/files/{file_id}/image-preview)" in content


def test_unselected_attachment_candidate_cannot_authorize_selected_segment_content(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, attachment_segment, file_ids = graph
    attachment_id = file_ids["valid"]
    attachment_segment.enabled = False
    selected_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=2,
        content=f"![not-owned](/files/{attachment_id}/image-preview?sign=old)",
        word_count=1,
        tokens=1,
        created_by="admin",
        index_node_id=str(uuid4()),
        index_node_hash="selected-hash",
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add(selected_segment)
    sqlite_session.commit()

    raw_candidates = [
        RagDocument(
            page_content=selected_segment.content,
            provider="dify",
            metadata={
                "doc_id": selected_segment.index_node_id,
                "document_id": document.id,
                "dataset_id": dataset.id,
                "score": 0.9,
            },
        ),
        RagDocument(
            page_content="attachment candidate",
            provider="dify",
            metadata={
                "doc_id": attachment_id,
                "doc_type": "image",
                "document_id": document.id,
                "dataset_id": dataset.id,
                "score": 0.99,
            },
        ),
    ]
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
            candidates=raw_candidates,
            tenant_id=dataset.tenant_id,
            dataset_ids=[dataset.id],
            top_k=1,
            retriever_from="workflow",
        )
        assert len(result.sources) == 1
        content = result.sources[0].content

        current_scope = get_current_file_access_scope()
        assert current_scope is not None
        assert current_scope.granted_upload_file_ids == frozenset()
        assert current_scope.granted_retriever_segment_ids == frozenset({selected_segment.id})

    assert attachment_segment.id not in current_scope.granted_retriever_segment_ids
    assert content is not None
    assert f"/files/{attachment_id}/image-preview)" in content
    assert "timestamp=" not in content


def test_finalizer_recheck_drops_attachment_unbound_after_formatter_read(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment, file_ids = graph
    attachment_id = file_ids["valid"]
    retained_attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="retained.png",
        name="retained.png",
        size=1,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="admin",
        created_at=datetime.now(UTC),
        used=True,
    )
    with sqlite_session_factory.begin() as session:
        session.add(retained_attachment)
        session.add(
            SegmentAttachmentBinding(
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                segment_id=segment.id,
                attachment_id=retained_attachment.id,
            )
        )
    candidates = [
        RagDocument(
            page_content="stale high-score attachment candidate",
            provider="dify",
            metadata={
                "doc_id": attachment_id,
                "doc_type": "image",
                "document_id": document.id,
                "dataset_id": dataset.id,
                "_retrieval_source_dataset_id": dataset.id,
                "score": 0.99,
            },
        ),
        RagDocument(
            page_content="retained low-score attachment candidate",
            provider="dify",
            metadata={
                "doc_id": retained_attachment.id,
                "doc_type": "image",
                "document_id": document.id,
                "dataset_id": dataset.id,
                "_retrieval_source_dataset_id": dataset.id,
                "score": 0.2,
            },
        ),
    ]
    format_documents = RetrievalService.format_retrieval_documents

    def format_then_unbind(session: Session, candidates: list[RagDocument]) -> list[RetrievalSegments]:
        records = format_documents(session, candidates)
        assert records[0].files is not None
        assert {file["id"] for file in records[0].files} == {attachment_id, retained_attachment.id}
        session.commit()
        with sqlite_session_factory.begin() as mutation_session:
            mutation_session.execute(
                delete(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.segment_id == segment.id,
                    SegmentAttachmentBinding.attachment_id == attachment_id,
                )
            )
        return records

    monkeypatch.setattr(
        RetrievalService,
        "format_retrieval_documents",
        staticmethod(format_then_unbind),
    )
    signed_file_ids: list[str] = []

    def sign_attachment(upload_file_id: str, _extension: str) -> str:
        signed_file_ids.append(upload_file_id)
        return f"signed:{upload_file_id}"

    monkeypatch.setattr(retrieval_finalization, "sign_upload_file_preview_url", sign_attachment)
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(scope):
        result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
            candidates=candidates,
            tenant_id=dataset.tenant_id,
            dataset_ids=[dataset.id],
            top_k=1,
            retriever_from="workflow",
        )
        current_scope = get_current_file_access_scope()

    assert result.sources == ()
    assert signed_file_ids == []
    assert current_scope is not None
    assert current_scope.granted_upload_file_ids == frozenset()
    assert current_scope.granted_retriever_segment_ids == frozenset()
    with sqlite_session_factory() as verify_session:
        assert verify_session.get(UploadFile, attachment_id) is not None
        assert (
            verify_session.scalar(
                select(SegmentAttachmentBinding.id).where(
                    SegmentAttachmentBinding.segment_id == segment.id,
                    SegmentAttachmentBinding.attachment_id == attachment_id,
                )
            )
            is None
        )
        assert (
            verify_session.scalar(
                select(SegmentAttachmentBinding.id).where(
                    SegmentAttachmentBinding.segment_id == segment.id,
                    SegmentAttachmentBinding.attachment_id == retained_attachment.id,
                )
            )
            is not None
        )


def test_shared_attachment_hit_expands_only_current_source_dataset_bindings(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, old_document, first_segment, file_ids = graph
    attachment_id = file_ids["valid"]
    current_document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=2,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-current",
        name="Current owner",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        doc_form="text_model",
        indexing_status="completed",
    )
    current_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=current_document.id,
        position=1,
        content="current owner content",
        word_count=3,
        tokens=3,
        created_by="admin",
        index_node_id=str(uuid4()),
        index_node_hash="current-hash",
        status=SegmentStatus.COMPLETED,
    )
    other_dataset = Dataset(id=str(uuid4()), tenant_id=dataset.tenant_id, name="Other", created_by="admin")
    other_document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=other_dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-other",
        name="Other route owner",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        doc_form="text_model",
        indexing_status="completed",
    )
    other_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=other_dataset.id,
        document_id=other_document.id,
        position=1,
        content="other route content",
        word_count=3,
        tokens=3,
        created_by="admin",
        index_node_id=str(uuid4()),
        index_node_hash="other-hash",
        status=SegmentStatus.COMPLETED,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([current_document, current_segment, other_dataset, other_document, other_segment])
        session.add_all(
            [
                SegmentAttachmentBinding(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=current_document.id,
                    segment_id=current_segment.id,
                    attachment_id=attachment_id,
                ),
                # Historical duplicates must not duplicate response files.
                SegmentAttachmentBinding(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=current_document.id,
                    segment_id=current_segment.id,
                    attachment_id=attachment_id,
                ),
                SegmentAttachmentBinding(
                    tenant_id=dataset.tenant_id,
                    dataset_id=other_dataset.id,
                    document_id=other_document.id,
                    segment_id=other_segment.id,
                    attachment_id=attachment_id,
                ),
            ]
        )
        # The vector's old unique metadata owner is deliberately no longer eligible.
        persisted_old_document = session.get_one(Document, old_document.id)
        persisted_old_document.enabled = False

    candidate = RagDocument(
        page_content="shared attachment hit",
        provider="dify",
        metadata={
            "doc_id": attachment_id,
            "doc_type": "image",
            "document_id": old_document.id,
            "dataset_id": other_dataset.id,
            "_retrieval_source_dataset_id": dataset.id,
            "_retrieval_allowed_document_ids": (current_document.id,),
            "score": 0.91,
        },
    )
    result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
        candidates=[candidate],
        tenant_id=dataset.tenant_id,
        dataset_ids=[dataset.id, other_dataset.id],
        top_k=0,
        retriever_from="workflow",
    )

    assert len(result.sources) == 1
    finalized = result.sources[0]
    assert finalized.metadata.segment_id == current_segment.id
    assert finalized.metadata.document_id == current_document.id
    assert [attachment.id for attachment in result.attachments] == [attachment_id]
    assert [file["id"] for file in finalized.files or []] == [attachment_id]
    assert first_segment.id != finalized.metadata.segment_id
    assert other_segment.id != finalized.metadata.segment_id


def test_finalizer_publishes_only_rechecked_attachment_metadata(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, _segment, file_ids = graph
    attachment_id = file_ids["valid"]
    external_content = f"![external](/files/{file_ids['unbound']}/image-preview?sign=external-old)"
    candidates = [
        RagDocument(
            page_content="attachment candidate",
            provider="dify",
            metadata={
                "doc_id": attachment_id,
                "doc_type": "image",
                "document_id": document.id,
                "dataset_id": dataset.id,
                "_retrieval_source_dataset_id": dataset.id,
                "score": 0.9,
            },
        ),
        RagDocument(
            page_content=external_content,
            provider="external",
            metadata={"score": 1.0, "dataset_id": "external-dataset"},
        ),
    ]
    format_documents = RetrievalService.format_retrieval_documents

    def format_then_update(session: Session, internal_candidates: list[RagDocument]) -> list[RetrievalSegments]:
        records = format_documents(session, internal_candidates)
        assert records[0].files == [
            {
                "id": attachment_id,
                "name": "valid.png",
                "extension": ".png",
                "mime_type": "image/png",
                "source_url": "",
                "size": 1,
            }
        ]
        session.commit()
        with sqlite_session_factory.begin() as mutation_session:
            upload = mutation_session.get(UploadFile, attachment_id)
            assert upload is not None
            upload.name = "fresh.webp"
            upload.extension = "webp"
            upload.mime_type = "image/webp"
            upload.size = 42
            upload.key = "fresh-key.webp"
        return records

    monkeypatch.setattr(
        RetrievalService,
        "format_retrieval_documents",
        staticmethod(format_then_update),
    )
    signed_files: list[tuple[str, str]] = []

    def sign_attachment(upload_file_id: str, extension: str) -> str:
        signed_files.append((upload_file_id, extension))
        return f"signed:{upload_file_id}:{extension}"

    monkeypatch.setattr(retrieval_finalization, "sign_upload_file_preview_url", sign_attachment)
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        granted_upload_file_ids=frozenset({file_ids["unbound"]}),
    )
    with bind_file_access_scope(scope):
        result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
            candidates=candidates,
            tenant_id=dataset.tenant_id,
            dataset_ids=[dataset.id],
            top_k=0,
            retriever_from="workflow",
        )
        current_scope = get_current_file_access_scope()

    finalized = next(source for source in result.sources if source.metadata.data_source_type != "external")
    assert result.attachments[0].storage_key == "fresh-key.webp"
    assert finalized.files == [
        {
            "id": attachment_id,
            "name": "fresh.webp",
            "extension": ".webp",
            "mime_type": "image/webp",
            "source_url": f"signed:{attachment_id}:webp",
            "size": 42,
        }
    ]
    assert signed_files == [(attachment_id, "webp")]
    assert f"/files/{attachment_id}/image-preview?timestamp=" in (finalized.content or "")
    assert f"/files/{file_ids['unbound']}/image-preview)" in (finalized.content or "")
    external = next(source for source in result.sources if source.metadata.data_source_type == "external")
    assert external.content == external_content
    assert current_scope is not None
    assert current_scope.granted_upload_file_ids == frozenset({attachment_id, file_ids["unbound"]})


@pytest.mark.parametrize(
    "broken_owner",
    ["tenant", "dataset", "document", "document_status", "segment_status", "disabled", "archived"],
)
def test_invalid_segment_owner_chain_grants_no_access(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    broken_owner: str,
) -> None:
    dataset, document, segment, _ = graph
    if broken_owner == "tenant":
        document.tenant_id = str(uuid4())
    elif broken_owner == "dataset":
        document.dataset_id = str(uuid4())
    elif broken_owner == "document":
        segment.document_id = str(uuid4())
    elif broken_owner == "document_status":
        document.indexing_status = "error"
    elif broken_owner == "segment_status":
        segment.status = SegmentStatus.ERROR
    elif broken_owner == "disabled":
        document.enabled = False
    else:
        document.archived = True
    sqlite_session.commit()
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    candidate = RagDocument(
        page_content=segment.content,
        provider="dify",
        metadata={
            "doc_id": segment.index_node_id,
            "document_id": segment.document_id,
            "dataset_id": segment.dataset_id,
            "_retrieval_source_dataset_id": dataset.id,
            "score": 1.0,
        },
    )
    with bind_file_access_scope(scope):
        result = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
            candidates=[candidate],
            tenant_id=dataset.tenant_id,
            dataset_ids=[dataset.id],
            top_k=0,
            retriever_from="workflow",
        )
        current_scope = get_current_file_access_scope()
        assert result.sources == ()
        assert current_scope is not None
        assert current_scope.granted_upload_file_ids == frozenset()
        assert current_scope.granted_retriever_segment_ids == frozenset()


@pytest.mark.parametrize("with_image", [False, True])
@pytest.mark.parametrize("signing_fails", [False, True])
def test_workflow_retrieval_releases_owned_connections_and_preserves_caller_transaction(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    with_image: bool,
    signing_fails: bool,
) -> None:
    dataset, document, segment, _ = graph
    if not with_image:
        segment.content = "Plain text"
        sqlite_session.commit()
    finalizer = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory)
    candidates = [
        RagDocument(
            page_content=segment.content,
            provider="dify",
            metadata={"doc_id": segment.index_node_id, "document_id": document.id, "dataset_id": dataset.id},
        )
    ]
    if signing_fails:
        monkeypatch.setattr(
            retrieval_finalization,
            "sign_segment_content",
            MagicMock(side_effect=RuntimeError("signing failed")),
        )
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id="visitor",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    engine = sqlite_session.get_bind()
    assert isinstance(engine, Engine)
    sessions: set[Session] = set()
    pool_events: list[str] = []

    def track_transaction(session: Session, *_args: object) -> None:
        # Hold references so garbage collection cannot hide an unclosed session.
        sessions.add(session)

    def track_checkout(*_args: object) -> None:
        pool_events.append("checkout")

    def track_checkin(*_args: object) -> None:
        pool_events.append("checkin")

    event.listen(Session, "after_begin", track_transaction)
    event.listen(engine, "checkout", track_checkout)
    event.listen(engine, "checkin", track_checkin)
    try:
        with bind_file_access_scope(scope), Session(engine) as caller_session, caller_session.begin() as caller_txn:
            if signing_fails:
                with pytest.raises(RuntimeError, match="signing failed"):
                    finalizer.finalize_response(
                        candidates=candidates,
                        tenant_id=dataset.tenant_id,
                        dataset_ids=[dataset.id],
                        top_k=0,
                        retriever_from="workflow",
                    )
            else:
                result = finalizer.finalize_response(
                    candidates=candidates,
                    tenant_id=dataset.tenant_id,
                    dataset_ids=[dataset.id],
                    top_k=0,
                    retriever_from="workflow",
                )
                assert len(result.sources) == 1
                assert result.sources[0].metadata.segment_id == segment.id
            assert caller_session.get_transaction() is caller_txn
            assert caller_txn.is_active
            assert sessions
            assert all(not session.in_transaction() for session in sessions if session is not caller_session)
            assert pool_events.count("checkout") > 0
            assert pool_events.count("checkout") == pool_events.count("checkin")
    finally:
        event.remove(Session, "after_begin", track_transaction)
        event.remove(engine, "checkout", track_checkout)
        event.remove(engine, "checkin", track_checkin)
        for session in sessions:
            session.close()
