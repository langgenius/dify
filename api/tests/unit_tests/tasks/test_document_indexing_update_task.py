"""SQLite-backed tests for document update indexing and summary generation."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from functools import partial
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

import tasks.document_indexing_update_task as task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import UploadFile
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskExecutionLeaseLostError
from tasks.document_indexing_update_task import document_indexing_update_task


@pytest.fixture
def task_harness(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[MagicMock, MagicMock]:
    """Bind task-owned sessions to SQLite and keep only external boundaries mocked."""
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    runner = MagicMock()
    processor = MagicMock()
    monkeypatch.setattr(task_module, "build_document_indexing_service", MagicMock(return_value=runner))
    monkeypatch.setattr(
        task_module,
        "IndexProcessorFactory",
        MagicMock(return_value=MagicMock(init_index_processor=MagicMock(return_value=processor))),
    )
    return runner, processor


def _persist_rows(
    session: Session,
    *,
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
    summary_index_setting: dict[str, object] | None = None,
    doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX,
    need_summary: bool = True,
    with_segment: bool = False,
    generation: str | None = None,
) -> tuple[Dataset, Document]:
    tenant_id = str(uuid.uuid4())
    dataset_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Update dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        indexing_technique=indexing_technique,
        summary_index_setting=summary_index_setting,
    )
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
        indexing_status=IndexingStatus.WAITING,
        doc_form=doc_form,
        need_summary=need_summary,
        indexing_generation=generation or str(uuid.uuid4()),
    )
    rows: list[object] = [dataset, document]
    if with_segment:
        rows.append(
            DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                position=1,
                content="segment",
                word_count=1,
                tokens=1,
                created_by=created_by,
                index_node_id="node-1",
            )
        )
    session.add_all(rows)
    session.commit()
    return dataset, document


def _complete_indexing(
    refs: Sequence[DocumentRef],
    *,
    bind: Engine | Connection,
    **_kwargs: object,
) -> None:
    with Session(bind) as writer, writer.begin():
        for ref in refs:
            document = writer.get(Document, ref.document_id)
            assert document is not None
            document.indexing_status = IndexingStatus.COMPLETED


def _persist_attachment(
    session: Session,
    *,
    dataset: Dataset,
    document: Document,
    segment: DocumentSegment,
    key: str,
) -> tuple[UploadFile, SegmentAttachmentBinding]:
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name="image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=document.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    session.add_all([attachment, binding])
    session.commit()
    return attachment, binding


def test_queues_summary_when_all_persisted_conditions_match(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, _processor = task_harness
    generation = str(uuid.uuid4())
    dataset, document = _persist_rows(
        sqlite_session,
        summary_index_setting={"enable": True},
        generation=generation,
    )
    runner.run.side_effect = partial(_complete_indexing, bind=sqlite_session.get_bind())

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id).indexing_status == IndexingStatus.COMPLETED  # type: ignore[union-attr]
    intent = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
    )
    assert intent is not None
    assert intent.payload["expected_generation"] == generation


@pytest.mark.parametrize(
    ("dataset_changes", "document_changes"),
    [
        ({"indexing_technique": IndexTechniqueType.ECONOMY}, {}),
        ({"summary_index_setting": None}, {}),
        ({"summary_index_setting": {"enable": False}}, {}),
        ({"summary_index_setting": {"enable": True}}, {"need_summary": False}),
        ({"summary_index_setting": {"enable": True}}, {"enabled": False}),
        ({"summary_index_setting": {"enable": True}}, {"archived": True}),
        ({"summary_index_setting": {"enable": True}}, {"is_paused": True}),
        (
            {"summary_index_setting": {"enable": True}},
            {"doc_form": IndexStructureType.QA_INDEX},
        ),
    ],
)
def test_skips_summary_when_persisted_eligibility_does_not_match(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    dataset_changes: dict[str, object],
    document_changes: dict[str, object],
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(
        sqlite_session,
        summary_index_setting={"enable": True},
    )
    for key, value in dataset_changes.items():
        setattr(dataset, key, value)
    for key, value in document_changes.items():
        setattr(document, key, value)
    sqlite_session.commit()
    runner.run.side_effect = partial(_complete_indexing, bind=sqlite_session.get_bind())

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    assert (
        sqlite_session.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        )
        is None
    )


@pytest.mark.parametrize(
    "error_factory",
    [
        lambda _document_id: RuntimeError("indexing failed"),
        lambda document_id: DocumentIsPausedError(f"{document_id} is paused"),
    ],
)
def test_skips_summary_when_indexing_fails_or_is_paused(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    error_factory: Callable[[str], Exception],
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = error_factory(document.id)

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    assert (
        sqlite_session.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        )
        is None
    )


def test_returns_without_opening_external_boundaries_when_document_is_missing(
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness

    document_indexing_update_task(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()))

    runner.run.assert_not_called()
    processor.clean.assert_not_called()


def test_skips_summary_when_dataset_is_removed_after_indexing(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})

    def complete_and_remove(
        refs: Sequence[DocumentRef],
        *,
        executions: Mapping[str, DocumentIndexingExecution],
    ) -> None:
        assert document.id in executions
        with Session(sqlite_session.get_bind()) as writer, writer.begin():
            for ref in refs:
                persisted_document = writer.get(Document, ref.document_id)
                assert persisted_document is not None
                persisted_document.indexing_status = IndexingStatus.COMPLETED
            persisted_dataset = writer.get(Dataset, dataset.id)
            assert persisted_dataset is not None
            writer.delete(persisted_dataset)

    runner.run.side_effect = complete_and_remove
    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    assert (
        sqlite_session.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        )
        is None
    )


def test_skips_summary_when_runner_leaves_document_incomplete(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.return_value = None

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    assert (
        sqlite_session.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        )
        is None
    )


def test_cleans_and_deletes_persisted_segments_with_real_session(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(
        sqlite_session,
        summary_index_setting={"enable": True},
        with_segment=True,
    )
    runner.run.side_effect = partial(_complete_indexing, bind=sqlite_session.get_bind())

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    processor.clean.assert_called_once()
    assert isinstance(processor.clean.call_args.kwargs["session"], Session)
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all() == []
    assert (
        sqlite_session.scalar(
            select(KnowledgeTaskOutbox.id).where(KnowledgeTaskOutbox.task_kind == "document_summary_index")
        )
        is not None
    )


def test_generation_change_after_external_cleanup_preserves_successor_segments(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    old_generation = str(uuid.uuid4())
    successor_generation = str(uuid.uuid4())
    dataset, document = _persist_rows(
        sqlite_session,
        with_segment=True,
        generation=old_generation,
    )

    def advance_generation(*_args: object, **_kwargs: object) -> None:
        with Session(sqlite_session.get_bind()) as writer, writer.begin():
            persisted = writer.get(Document, document.id)
            assert persisted is not None
            persisted.indexing_generation = successor_generation
            persisted.indexing_status = IndexingStatus.WAITING

    processor.clean.side_effect = advance_generation
    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_generation == successor_generation
    assert persisted.indexing_status == IndexingStatus.WAITING
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all()
    runner.run.assert_not_called()
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_retry")
    )
    assert repair is not None
    assert repair.payload["document_ids"] == [document.id]
    assert repair.payload["generations"] == {document.id: successor_generation}
    assert repair.payload["repair"] is True


def test_generation_change_before_initial_row_lock_does_not_overwrite_successor(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, processor = task_harness
    old_generation = str(uuid.uuid4())
    successor_generation = str(uuid.uuid4())
    dataset, document = _persist_rows(sqlite_session, generation=old_generation)
    lock_dataset = task_module.lock_dataset_for_child_write
    advanced = False

    def advance_generation_before_dataset_lock(session: Session, dataset_ref: DatasetRef) -> Dataset | None:
        nonlocal advanced
        if not advanced:
            advanced = True
            with Session(sqlite_session.get_bind()) as writer, writer.begin():
                persisted = writer.get(Document, document.id)
                assert persisted is not None
                persisted.indexing_generation = successor_generation
                persisted.indexing_status = IndexingStatus.WAITING
        return lock_dataset(session, dataset_ref)

    monkeypatch.setattr(task_module, "lock_dataset_for_child_write", advance_generation_before_dataset_lock)

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_generation == successor_generation
    assert persisted.indexing_status == IndexingStatus.WAITING
    processor.clean.assert_not_called()
    runner.run.assert_not_called()
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_retry")
    )
    assert repair is not None
    assert repair.payload["generations"] == {document.id: successor_generation}


def test_lease_loss_during_external_cleanup_persists_current_generation_repair(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    generation = str(uuid.uuid4())
    dataset, document = _persist_rows(sqlite_session, with_segment=True, generation=generation)

    def lose_lease_after_external_side_effect(*_args: object, **_kwargs: object) -> None:
        raise KnowledgeTaskExecutionLeaseLostError("execution lease lost after cleanup")

    processor.clean.side_effect = lose_lease_after_external_side_effect

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError):
        document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_generation == generation
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all()
    runner.run.assert_not_called()
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_retry")
    )
    assert repair is not None
    assert repair.payload["generations"] == {document.id: generation}


def test_versioned_delivery_binds_runner_to_expected_generation(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, _processor = task_harness
    generation = str(uuid.uuid4())
    dataset, document = _persist_rows(sqlite_session, generation=generation)

    def assert_generation_and_complete(
        refs: Sequence[DocumentRef],
        *,
        executions: Mapping[str, DocumentIndexingExecution],
    ) -> None:
        execution = executions[document.id]
        assert execution.expected_generation == generation
        _complete_indexing(refs, bind=sqlite_session.get_bind())

    runner.run.side_effect = assert_generation_and_complete

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    runner.run.assert_called_once()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document.id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.COMPLETED


def test_removes_orphaned_multimodal_attachments_during_reindex(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)
    dataset.is_multimodal = True
    segment = sqlite_session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == document.id))
    assert segment is not None
    attachment, binding = _persist_attachment(
        sqlite_session,
        dataset=dataset,
        document=document,
        segment=segment,
        key="attachments/orphaned-image.png",
    )
    attachment_id = attachment.id
    binding_id = binding.id
    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    assert processor.clean.call_count == 2
    assert processor.clean.call_args_list[0].args[1] == ["node-1"]
    assert processor.clean.call_args_list[1].kwargs["node_ids"] == [attachment_id]
    assert processor.clean.call_args_list[1].kwargs["with_keywords"] is False
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    cleanup_intent = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
    )
    assert cleanup_intent is not None
    assert cleanup_intent.payload == {"file_ids": [attachment_id]}
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all() == []
    runner.run.assert_called_once()


def test_preserves_multimodal_attachment_referenced_by_another_document_during_reindex(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)
    dataset.is_multimodal = True
    segment = sqlite_session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == document.id))
    assert segment is not None
    attachment, binding = _persist_attachment(
        sqlite_session,
        dataset=dataset,
        document=document,
        segment=segment,
        key="attachments/shared-image.png",
    )

    other_document = Document(
        id=str(uuid.uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=2,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-2",
        name="other-document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=document.created_by,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add(other_document)
    sqlite_session.flush()
    other_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=other_document.id,
        position=1,
        content="other segment",
        word_count=2,
        tokens=2,
        created_by=document.created_by,
        index_node_id="node-2",
    )
    sqlite_session.add(other_segment)
    sqlite_session.flush()
    shared_binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=other_document.id,
        segment_id=other_segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add(shared_binding)
    sqlite_session.commit()
    attachment_id = attachment.id
    binding_id = binding.id
    shared_binding_id = shared_binding.id
    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    processor.clean.assert_called_once()
    assert processor.clean.call_args.args[1] == ["node-1"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, shared_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    cleanup_intent = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
    )
    assert cleanup_intent is not None
    assert cleanup_intent.payload == {"file_ids": [attachment_id]}
    runner.run.assert_called_once()


def test_persists_file_cleanup_when_attachment_vector_cleanup_fails(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)
    dataset.is_multimodal = True
    segment = sqlite_session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == document.id))
    assert segment is not None
    attachment, binding = _persist_attachment(
        sqlite_session,
        dataset=dataset,
        document=document,
        segment=segment,
        key="attachments/failing-image.png",
    )
    attachment_id = attachment.id
    binding_id = binding.id
    processor.clean.side_effect = [None, RuntimeError("vector unavailable")]

    document_indexing_update_task(dataset.id, document.id, document.indexing_generation)

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    pending_upload = sqlite_session.get(UploadFile, attachment_id)
    assert pending_upload is not None
    cleanup_intent = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "file_cleanup")
    )
    assert cleanup_intent is not None
    assert cleanup_intent.payload == {"file_ids": [attachment_id]}
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all() == []
    runner.run.assert_not_called()
