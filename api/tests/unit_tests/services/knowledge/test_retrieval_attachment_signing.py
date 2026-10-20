"""Published applications sign admin-uploaded images only through valid knowledge bindings."""

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetEntity, DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from core.rag.models.document import Document as RagDocument
from core.rag.retrieval import dataset_retrieval as retrieval_module
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, SegmentStatus
from models.model import UploadFile
from services.knowledge.retrieval.attachments import authorize_retrieved_segment


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


@pytest.mark.parametrize("entry", ["chat", "workflow"])
@pytest.mark.parametrize("vision_enabled", [False, True])
def test_published_retrieval_grants_bound_images_before_signing(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    entry: str,
    vision_enabled: bool,
) -> None:
    dataset, document, segment, file_ids = graph
    retrieval = DatasetRetrieval()
    monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
    monkeypatch.setattr(retrieval, "_get_available_datasets", MagicMock(return_value=[dataset]))
    monkeypatch.setattr(retrieval, "get_metadata_filter_condition", MagicMock(return_value=(None, None)))
    monkeypatch.setattr(
        retrieval,
        "multiple_retrieve",
        MagicMock(
            return_value=[
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
        ),
    )
    model = MagicMock()
    model.model_type_instance.get_model_schema.return_value.features = None
    monkeypatch.setattr(
        retrieval_module.ModelManager,
        "for_tenant",
        MagicMock(
            return_value=MagicMock(
                get_model_instance=MagicMock(return_value=model),
            )
        ),
    )
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(scope):
        if entry == "chat":
            content, files = retrieval.retrieve(
                sqlite_session,
                app_id=str(uuid4()),
                user_id=scope.user_id,
                tenant_id=dataset.tenant_id,
                model_config=MagicMock(),
                config=DatasetEntity(
                    dataset_ids=[dataset.id],
                    retrieve_config=DatasetRetrieveConfigEntity(retrieve_strategy="multiple"),
                ),
                query="picture",
                invoke_from=InvokeFrom.WEB_APP,
                show_retrieve_source=False,
                hit_callback=MagicMock(),
                message_id=str(uuid4()),
                vision_enabled=vision_enabled,
            )
            assert files is not None
            assert [file.storage_key for file in files] == (["valid.png"] if vision_enabled else [])
        else:
            sources = retrieval.knowledge_retrieval(
                sqlite_session,
                KnowledgeRetrievalRequest(
                    tenant_id=dataset.tenant_id,
                    user_id=scope.user_id,
                    app_id=str(uuid4()),
                    user_from=UserFrom.END_USER.value,
                    dataset_ids=[dataset.id],
                    query="picture",
                    retrieval_mode="multiple",
                ),
            )
            assert len(sources) == 1
            content = sources[0].content
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


@pytest.mark.parametrize("broken_owner", ["tenant", "dataset", "document"])
def test_invalid_segment_owner_chain_grants_no_access(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
    broken_owner: str,
) -> None:
    dataset, document, segment, _ = graph
    if broken_owner == "tenant":
        document.tenant_id = str(uuid4())
    elif broken_owner == "dataset":
        document.dataset_id = str(uuid4())
    else:
        segment.document_id = str(uuid4())
    sqlite_session.commit()
    scope = FileAccessScope(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(scope):
        assert (
            authorize_retrieved_segment(
                segment, tenant_id=dataset.tenant_id, dataset_ids=[dataset.id], session=sqlite_session
            )
            is None
        )
        current_scope = get_current_file_access_scope()
        assert current_scope is not None
        assert current_scope.granted_upload_file_ids == frozenset()
        assert current_scope.granted_retriever_segment_ids == frozenset()


@pytest.mark.parametrize("with_image", [False, True])
@pytest.mark.parametrize("signing_fails", [False, True])
def test_workflow_retrieval_releases_owned_connections_and_preserves_caller_transaction(
    graph: tuple[Dataset, Document, DocumentSegment, dict[str, str]],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    with_image: bool,
    signing_fails: bool,
) -> None:
    dataset, document, segment, _ = graph
    if not with_image:
        segment.content = "Plain text"
        sqlite_session.commit()
    retrieval = DatasetRetrieval()
    monkeypatch.setattr(retrieval, "_check_knowledge_rate_limit", MagicMock())
    monkeypatch.setattr(retrieval, "_get_available_datasets", MagicMock(return_value=[dataset]))
    monkeypatch.setattr(
        retrieval,
        "multiple_retrieve",
        MagicMock(
            return_value=[
                RagDocument(
                    page_content=segment.content,
                    provider="dify",
                    metadata={"doc_id": segment.index_node_id, "document_id": document.id, "dataset_id": dataset.id},
                )
            ]
        ),
    )
    if signing_fails:
        monkeypatch.setattr(
            retrieval_module, "sign_segment_content", MagicMock(side_effect=RuntimeError("signing failed"))
        )
    request = KnowledgeRetrievalRequest(
        tenant_id=dataset.tenant_id,
        user_id="visitor",
        app_id=str(uuid4()),
        user_from=UserFrom.END_USER.value,
        dataset_ids=[dataset.id],
        query="picture",
        retrieval_mode="multiple",
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
                    retrieval.knowledge_retrieval(caller_session, request)
            else:
                sources = retrieval.knowledge_retrieval(caller_session, request)
                assert len(sources) == 1
                assert sources[0].metadata.segment_id == segment.id
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
