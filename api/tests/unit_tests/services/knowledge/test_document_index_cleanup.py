"""Durable index cleanup snapshots do not depend on deleted SQL owners."""

import json
from contextlib import nullcontext
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetKeywordTable,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import KnowledgeUploadFileReference, UploadFile
from services.knowledge.indexing.adapters import cleanup
from services.knowledge.indexing.cleanup import DeletionIndexCleanup


@dataclass
class RecordingVectorBackend:
    deleted_collections: int = 0
    deleted_node_batches: list[list[str]] = field(default_factory=list)
    failure: Exception | None = None

    def delete(self) -> None:
        if self.failure is not None:
            raise self.failure
        self.deleted_collections += 1

    def delete_by_ids(self, node_ids: list[str]) -> None:
        if self.failure is not None:
            raise self.failure
        self.deleted_node_batches.append(node_ids)


@dataclass
class RecordingVectorFactory:
    backend: RecordingVectorBackend
    resolved_datasets: list[str] = field(default_factory=list)
    constructed_datasets: list[str] = field(default_factory=list)

    def resolve_vector_type(self, dataset: Dataset, *, session: Session) -> str:
        del session
        self.resolved_datasets.append(dataset.id)
        return "pgvector"

    def __call__(self, dataset: Dataset, *, session: Session | None, vector_type: str) -> RecordingVectorBackend:
        assert session is None
        assert vector_type == "pgvector"
        self.constructed_datasets.append(dataset.id)
        return self.backend


@pytest.fixture
def graph(sqlite_session: Session) -> tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk]:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Dataset",
        created_by="admin",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        index_struct='{"type":"pgvector"}',
    )
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
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="Text",
        word_count=1,
        tokens=1,
        created_by="admin",
        index_node_id="body-node",
    )
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="Summary",
        summary_index_node_id="summary-node",
    )
    child = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="Child",
        word_count=1,
        index_node_id="child-node",
        created_by="admin",
        index_node_hash="child-hash",
    )
    sqlite_session.add_all([dataset, document, segment, summary, child])
    sqlite_session.commit()
    return dataset, document, segment, summary, child


def test_snapshot_carries_all_vector_nodes_after_owner_rows_are_deleted(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment, summary, child = graph
    backend = RecordingVectorBackend()
    vectors = RecordingVectorFactory(backend)
    monkeypatch.setattr(cleanup, "Vector", vectors)

    index_cleanup = cleanup.build_deletion_index_cleanup(
        sqlite_session,
        dataset=dataset,
        delete_all=False,
        segment_ids=(segment.id,),
        file_node_ids=("file-node",),
        inline_image_node_ids=("inline-image",),
    )
    assert index_cleanup.vector_node_ids == (
        "body-node",
        "child-node",
        "summary-node",
        "file-node",
        "inline-image",
    )
    assert index_cleanup.inline_image_node_ids == ("inline-image",)

    for row in (summary, child, segment, document, dataset):
        sqlite_session.delete(row)
    sqlite_session.commit()

    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    assert backend.deleted_node_batches == [["body-node", "child-node", "summary-node", "file-node", "inline-image"]]
    assert vectors.constructed_datasets == [index_cleanup.dataset_id]


def test_vector_failure_does_not_need_deleted_owner_for_retry(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment, summary, child = graph
    backend = RecordingVectorBackend(failure=RuntimeError("provider unavailable"))
    monkeypatch.setattr(cleanup, "Vector", RecordingVectorFactory(backend))
    index_cleanup = cleanup.build_deletion_index_cleanup(
        sqlite_session,
        dataset=dataset,
        delete_all=False,
        segment_ids=(segment.id,),
    )
    for row in (summary, child, segment, document, dataset):
        sqlite_session.delete(row)
    sqlite_session.commit()

    with pytest.raises(RuntimeError, match="provider unavailable"):
        cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    backend.failure = None
    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)
    assert backend.deleted_node_batches == [["body-node", "child-node", "summary-node"]]


def test_partial_cleanup_rechecks_active_attachment_references_before_vector_delete(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, _document, _segment, _summary, _child = graph
    survivor = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=2,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="survivor-batch",
        name="Survivor",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        indexing_status=IndexingStatus.COMPLETED,
    )
    survivor_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=survivor.id,
        position=1,
        content="Survivor",
        word_count=1,
        tokens=1,
        created_by="admin",
        status=SegmentStatus.COMPLETED,
    )
    shared_binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=survivor.id,
        segment_id=survivor_segment.id,
        attachment_id="shared-attachment",
    )
    sqlite_session.add_all([survivor, survivor_segment, shared_binding])
    sqlite_session.commit()

    backend = RecordingVectorBackend()
    monkeypatch.setattr(cleanup, "Vector", RecordingVectorFactory(backend))
    index_cleanup = DeletionIndexCleanup(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        index_struct=dataset.index_struct,
        collection_binding_id=None,
        embedding_model_provider=None,
        embedding_model=None,
        vector_type="pgvector",
        delete_all=False,
        vector_node_ids=("body-node", "shared-attachment", "orphan-attachment"),
        attachment_node_ids=("shared-attachment", "orphan-attachment"),
    )

    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    assert backend.deleted_node_batches == [["body-node", "orphan-attachment"]]

    dataset.embedding_model_provider = "provider-b"
    sqlite_session.commit()
    cleanup.clean_deletion_index(
        replace(
            index_cleanup,
            vector_node_ids=("shared-attachment",),
            attachment_node_ids=("shared-attachment",),
        ),
        new_session=sqlite_session_factory,
        assert_owned=lambda: None,
    )

    assert backend.deleted_node_batches == [
        ["body-node", "orphan-attachment"],
        ["shared-attachment"],
    ]

    survivor_segment.enabled = False
    sqlite_session.commit()
    cleanup.clean_deletion_index(
        replace(
            index_cleanup,
            embedding_model_provider="provider-b",
            vector_node_ids=("shared-attachment",),
            attachment_node_ids=("shared-attachment",),
        ),
        new_session=sqlite_session_factory,
        assert_owned=lambda: None,
    )

    assert backend.deleted_node_batches == [
        ["body-node", "orphan-attachment"],
        ["shared-attachment"],
        ["shared-attachment"],
    ]


def test_partial_cleanup_rechecks_active_inline_images_on_the_same_vector_target(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, _document, _segment, _summary, _child = graph
    survivor = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=2,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="survivor-batch",
        name="Survivor",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        indexing_status=IndexingStatus.COMPLETED,
    )
    survivor_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=survivor.id,
        position=1,
        content="![shared](/files/shared-inline-image/image-preview)",
        word_count=1,
        tokens=1,
        created_by="admin",
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    image = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="images/shared-inline.png",
        name="shared-inline.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="admin",
        created_at=datetime.now(UTC),
        used=True,
    )
    cross_kind_image = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="images/cross-kind.png",
        name="cross-kind.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="admin",
        created_at=datetime.now(UTC),
        used=True,
    )
    sqlite_session.add_all([survivor, survivor_segment, image, cross_kind_image])
    sqlite_session.flush()
    reference = KnowledgeUploadFileReference(
        tenant_id=dataset.tenant_id,
        upload_file_id=image.id,
        dataset_id=dataset.id,
        document_id=survivor.id,
        kind="segment_image",
        resource_id=survivor_segment.id,
    )
    cross_kind_binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=survivor.id,
        segment_id=survivor_segment.id,
        attachment_id=cross_kind_image.id,
    )
    sqlite_session.add_all([reference, cross_kind_binding])
    sqlite_session.commit()

    backend = RecordingVectorBackend()
    monkeypatch.setattr(cleanup, "Vector", RecordingVectorFactory(backend))
    index_cleanup = DeletionIndexCleanup(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        index_struct=dataset.index_struct,
        collection_binding_id=None,
        embedding_model_provider=None,
        embedding_model=None,
        vector_type="pgvector",
        delete_all=False,
        vector_node_ids=("body-node", image.id, cross_kind_image.id, "orphan-inline-image"),
        inline_image_node_ids=(image.id, cross_kind_image.id, "orphan-inline-image"),
    )

    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    assert backend.deleted_node_batches == [["body-node", "orphan-inline-image"]]

    dataset.embedding_model_provider = "provider-b"
    sqlite_session.commit()
    cleanup.clean_deletion_index(
        replace(
            index_cleanup,
            vector_node_ids=(image.id,),
            inline_image_node_ids=(image.id,),
        ),
        new_session=sqlite_session_factory,
        assert_owned=lambda: None,
    )

    assert backend.deleted_node_batches == [["body-node", "orphan-inline-image"], [image.id]]


def test_full_economy_cleanup_removes_keyword_table_after_dataset_delete(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Economy",
        created_by="admin",
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    keyword_table = DatasetKeywordTable(dataset_id=dataset.id, keyword_table="{}", data_source_type="database")
    sqlite_session.add_all([dataset, keyword_table])
    sqlite_session.commit()
    index_cleanup = cleanup.build_deletion_index_cleanup(sqlite_session, dataset=dataset, delete_all=True)
    keyword_table_id = keyword_table.id
    sqlite_session.delete(dataset)
    sqlite_session.commit()

    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    sqlite_session.expire_all()
    assert sqlite_session.get(DatasetKeywordTable, keyword_table_id) is None


def test_partial_economy_cleanup_updates_the_repository_owned_keyword_table(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Economy",
        created_by="admin",
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    keyword_table = DatasetKeywordTable(
        dataset_id=dataset.id,
        data_source_type="database",
        keyword_table=json.dumps(
            {
                "__type__": "keyword_table",
                "__data__": {
                    "index_id": dataset.id,
                    "summary": None,
                    "table": {"shared": ["deleted-node", "kept-node"]},
                },
            }
        ),
    )
    sqlite_session.add_all([dataset, keyword_table])
    sqlite_session.commit()
    index_cleanup = cleanup.build_deletion_index_cleanup(
        sqlite_session,
        dataset=dataset,
        delete_all=False,
        index_node_ids=("deleted-node",),
    )
    monkeypatch.setattr(cleanup.redis_client, "lock", lambda *_args, **_kwargs: nullcontext())

    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    sqlite_session.expire_all()
    stored = sqlite_session.get(DatasetKeywordTable, keyword_table.id)
    assert stored is not None
    assert json.loads(stored.keyword_table or "{}")["__data__"]["table"] == {"shared": ["kept-node"]}


def test_empty_partial_cleanup_skips_vector_provider(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    backend = RecordingVectorBackend()
    vectors = RecordingVectorFactory(backend)
    monkeypatch.setattr(cleanup, "Vector", vectors)
    index_cleanup = DeletionIndexCleanup(
        tenant_id=str(uuid4()),
        dataset_id=str(uuid4()),
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        index_struct='{"type":"pgvector"}',
        collection_binding_id=None,
        embedding_model_provider=None,
        embedding_model=None,
        vector_type="pgvector",
        delete_all=False,
    )

    cleanup.clean_deletion_index(index_cleanup, new_session=sqlite_session_factory, assert_owned=lambda: None)

    assert vectors.constructed_datasets == []
