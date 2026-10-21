"""PostgreSQL locking coverage for durable dataset cleanup manifests."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Event, current_thread
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Connection, ExecutionContext
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import AppDatasetJoin, Dataset, DatasetQuery, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DatasetQuerySource, DataSourceType, DocumentCreatedFrom, TagType
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import Tag, TagBinding, UploadFile
from repositories.knowledge.dataset_read_repository import stage_dataset_queries, sync_app_dataset_joins
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository, lock_dataset_for_child_write
from repositories.tag_repository import TagRepository
from services.knowledge.resource_scope import DatasetRef
from services.tag_application_service import TagBindingInput, TagBindingTargetNotFoundError


def test_delete_waits_for_document_writer_and_captures_its_cleanup_inputs(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    owner_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="locked dataset",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=owner_id,
    )
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch=str(uuid4()),
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=owner_id,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    attachment = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/locked.txt",
        name="locked.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=owner_id,
        created_at=datetime.now(UTC),
        used=True,
    )
    db_session_with_containers.add_all([dataset, document, attachment])
    db_session_with_containers.commit()
    dataset_id = dataset.id
    document_id = document.id
    attachment_id = attachment.id
    attachment_key = attachment.key

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    writer = sessions()
    writer.begin()
    writer.scalar(select(Document).where(Document.id == document_id).with_for_update())
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="committed while deletion waits",
        word_count=4,
        tokens=4,
        created_by=owner_id,
        index_node_id=str(uuid4()),
    )
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment.id,
        attachment_id=attachment_id,
    )
    writer.add_all([segment, binding])
    writer.flush()
    segment_id = segment.id
    binding_id = binding.id

    document_lock_started = Event()

    def observe_document_lock(
        _conn: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        if (
            current_thread().name.startswith("dataset-delete")
            and "FROM documents" in statement
            and "FOR UPDATE" in statement
        ):
            document_lock_started.set()

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "before_cursor_execute", observe_document_lock)
    repository = SQLAlchemyDatasetRepository(
        session_factory=sessions,
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=lambda _session, _tokens: None,
    )
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dataset-delete")
    deletion = executor.submit(repository.delete_with_relations, DatasetRef(tenant_id, dataset_id))
    try:
        assert document_lock_started.wait(timeout=10)
        assert not deletion.done()
        writer.commit()
        assert deletion.result(timeout=10) is True
    finally:
        if writer.in_transaction():
            writer.rollback()
        executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_document_lock)
        writer.close()

    db_session_with_containers.expire_all()
    intent = db_session_with_containers.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.resource_id == dataset_id)
    )
    assert intent is not None
    manifest = intent.payload["manifest"]
    assert isinstance(manifest, dict)
    assert manifest["document_ids"] == [document_id]
    assert manifest["segment_ids"] == [segment_id]
    assert manifest["segment_attachments"] == [
        {
            "binding_id": binding_id,
            "attachment_id": attachment_id,
            "key": attachment_key,
        }
    ]


def test_delete_waits_for_child_writer_holding_dataset_lifecycle_lock(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    owner_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="dataset with concurrent child",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=owner_id,
    )
    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    dataset_id = dataset.id
    dataset_ref = DatasetRef(tenant_id, dataset_id)

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    writer = sessions()
    writer.begin()
    assert lock_dataset_for_child_write(writer, dataset_ref) is not None
    late_document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        data_source_info='{"url": "https://example.test"}',
        batch=str(uuid4()),
        name="https://example.test",
        created_from=DocumentCreatedFrom.WEB,
        created_by=owner_id,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    writer.add(late_document)
    writer.flush()
    late_document_id = late_document.id

    dataset_lock_started = Event()

    def observe_dataset_lock(
        _conn: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        if (
            current_thread().name.startswith("dataset-delete-child")
            and "FROM datasets" in statement
            and "FOR UPDATE" in statement
        ):
            dataset_lock_started.set()

    repository = SQLAlchemyDatasetRepository(
        session_factory=sessions,
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=lambda _session, _tokens: None,
    )
    engine = db_session_with_containers.get_bind()
    event.listen(engine, "before_cursor_execute", observe_dataset_lock)
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dataset-delete-child")
    deletion = executor.submit(repository.delete_with_relations, dataset_ref)
    try:
        assert dataset_lock_started.wait(timeout=10)
        assert not deletion.done()
        writer.commit()
        assert deletion.result(timeout=10) is True
    finally:
        if writer.in_transaction():
            writer.rollback()
        executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_dataset_lock)
        writer.close()

    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(Dataset, dataset_id) is None
    intent = db_session_with_containers.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.resource_id == dataset_id)
    )
    assert intent is not None
    manifest = intent.payload["manifest"]
    assert isinstance(manifest, dict)
    assert manifest["document_ids"] == [late_document_id]


def test_child_writer_recheck_observes_dataset_deleted_after_initial_read(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    owner_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="dataset deleted during child preparation",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=owner_id,
    )
    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    dataset_id = dataset.id
    dataset_ref = DatasetRef(tenant_id, dataset_id)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)

    with sessions() as child_writer:
        stale_parent = child_writer.scalar(
            select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id)
        )
        assert stale_parent is not None

        repository = SQLAlchemyDatasetRepository(
            session_factory=sessions,
            wake_after_commit=lambda _session: None,
            revoke_keys_after_commit=lambda _session, _tokens: None,
        )
        assert repository.delete_with_relations(dataset_ref) is True

        assert lock_dataset_for_child_write(child_writer, dataset_ref) is None


def test_deleted_dataset_refuses_all_late_child_writers_from_a_stale_transaction(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    owner_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="dataset deleted before child writes",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=owner_id,
    )
    tag = Tag(
        tenant_id=tenant_id,
        type=TagType.KNOWLEDGE,
        name="Knowledge",
        created_by=owner_id,
    )
    db_session_with_containers.add_all([dataset, tag])
    db_session_with_containers.commit()
    dataset_id = dataset.id
    tag_id = tag.id
    app_id = str(uuid4())
    dataset_ref = DatasetRef(tenant_id, dataset_id)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)

    with sessions.begin() as stale_writer:
        assert (
            stale_writer.scalar(select(Dataset.id).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id))
            == dataset_id
        )

        repository = SQLAlchemyDatasetRepository(
            session_factory=sessions,
            wake_after_commit=lambda _session: None,
            revoke_keys_after_commit=lambda _session, _tokens: None,
        )
        assert repository.delete_with_relations(dataset_ref) is True

        assert (
            stage_dataset_queries(
                stale_writer,
                tenant_id=tenant_id,
                dataset_ids=[dataset_id],
                content="late query",
                source=DatasetQuerySource.APP,
                source_app_id=app_id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=owner_id,
            )
            == 0
        )
        sync_app_dataset_joins(
            stale_writer,
            tenant_id=tenant_id,
            app_id=app_id,
            dataset_ids={dataset_id},
        )

    with pytest.raises(TagBindingTargetNotFoundError):
        TagRepository(sessions).create_bindings(
            tenant_id,
            owner_id,
            TagBindingInput((tag_id,), dataset_id, TagType.KNOWLEDGE.value),
        )

    with sessions() as observer:
        assert observer.scalar(select(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id)) is None
        assert observer.scalar(select(AppDatasetJoin).where(AppDatasetJoin.dataset_id == dataset_id)) is None
        assert observer.scalar(select(TagBinding).where(TagBinding.target_id == dataset_id)) is None
