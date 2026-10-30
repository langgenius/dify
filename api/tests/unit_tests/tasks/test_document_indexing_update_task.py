"""SQLite-backed tests for document update indexing and summary generation."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import partial
from typing import override
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Connection, Engine, select
from sqlalchemy.orm import Session

import tasks.document_indexing_update_task as task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from services.knowledge.entities.resource_scope import DocumentRef
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    document_index_lock_name,
)
from tasks.document_indexing_update_task import document_indexing_update_task


class _OwnedLease:
    token = "test-owner"

    @staticmethod
    def assert_owned() -> None:
        return None

    @staticmethod
    def renew() -> bool:
        return True

    @staticmethod
    def release() -> bool:
        return True


class _LostAfterCleanupLease(_OwnedLease):
    def __init__(self) -> None:
        self._checks = 0

    @override
    def assert_owned(self) -> None:
        self._checks += 1
        if self._checks == 2:
            raise KnowledgeIndexingLeaseLostError("ownership changed after cleanup")


class _IndexingLockStub:
    def __init__(self, lease: _OwnedLease) -> None:
        self.lease = lease
        self.calls: list[tuple[str, int, float]] = []
        self.active = False

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        blocking_timeout: float,
    ) -> Generator[_OwnedLease]:
        self.calls.append((name, timeout, blocking_timeout))
        self.active = True
        try:
            yield self.lease
        finally:
            self.active = False


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
    lease = _OwnedLease()
    monkeypatch.setattr(task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: _IndexingLockStub(lease))
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
    owned_leases: Mapping[str, KnowledgeIndexingLease] | None = None,
) -> None:
    assert owned_leases is not None
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = partial(_complete_indexing, bind=sqlite_session.get_bind())
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_called_once_with(dataset.id, document.id, None)
    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id).indexing_status == IndexingStatus.COMPLETED  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("dataset_changes", "document_changes"),
    [
        ({"indexing_technique": IndexTechniqueType.ECONOMY}, {}),
        ({"summary_index_setting": None}, {}),
        ({"summary_index_setting": {"enable": False}}, {}),
        ({"summary_index_setting": {"enable": True}}, {"need_summary": False}),
        (
            {"summary_index_setting": {"enable": True}},
            {"doc_form": IndexStructureType.QA_INDEX},
        ),
    ],
)
def test_skips_summary_when_persisted_eligibility_does_not_match(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
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
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


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
    monkeypatch: pytest.MonkeyPatch,
    error_factory: Callable[[str], Exception],
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = error_factory(document.id)
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


def test_returns_without_opening_external_boundaries_when_document_is_missing(
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness

    document_indexing_update_task(str(uuid.uuid4()), str(uuid.uuid4()))

    runner.run.assert_not_called()
    processor.clean.assert_not_called()


def test_skips_summary_when_dataset_is_removed_after_indexing(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})

    def complete_and_remove(
        refs: list[DocumentRef],
        *,
        owned_leases: Mapping[str, KnowledgeIndexingLease],
    ) -> None:
        _complete_indexing(refs, bind=sqlite_session.get_bind(), owned_leases=owned_leases)
        with Session(sqlite_session.get_bind()) as writer, writer.begin():
            persisted_dataset = writer.get(Dataset, dataset.id)
            assert persisted_dataset is not None
            writer.delete(persisted_dataset)

    runner.run.side_effect = complete_and_remove
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


def test_skips_summary_when_runner_leaves_document_incomplete(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.return_value = None
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


def test_queue_failure_is_swallowed_after_successful_indexing(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = partial(_complete_indexing, bind=sqlite_session.get_bind())
    monkeypatch.setattr(
        task_module.generate_summary_index_task,
        "delay",
        MagicMock(side_effect=RuntimeError("queue unavailable")),
    )

    document_indexing_update_task(dataset.id, document.id)

    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id).indexing_status == IndexingStatus.COMPLETED  # type: ignore[union-attr]


def test_cleans_vectors_and_leaves_persisted_segments_for_indexing_service(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(
        sqlite_session,
        summary_index_setting={"enable": True},
        with_segment=True,
    )
    runner.run.side_effect = partial(_complete_indexing, bind=sqlite_session.get_bind())
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    processor.clean.assert_called_once()
    assert isinstance(processor.clean.call_args.kwargs["session"], Session)
    assert (
        len(sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all())
        == 1
    )
    delay.assert_called_once_with(dataset.id, document.id, None)


def test_reindex_holds_one_document_lease_across_cleanup_and_indexing_service(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)
    lease = _OwnedLease()
    locks = _IndexingLockStub(lease)
    monkeypatch.setattr(task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: locks)

    def clean(*_args: object, **_kwargs: object) -> None:
        assert locks.active

    def run(
        refs: Sequence[DocumentRef],
        *,
        owned_leases: Mapping[str, KnowledgeIndexingLease],
    ) -> None:
        assert locks.active
        assert [ref.document_id for ref in refs] == [document.id]
        assert owned_leases == {document.id: lease}

    processor.clean.side_effect = clean
    runner.run.side_effect = run

    document_indexing_update_task.run(dataset.id, document.id)

    assert locks.calls == [(document_index_lock_name(document.id), 600, 5)]
    assert locks.active is False


def test_lease_loss_after_cleanup_does_not_mark_document_error(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)

    with pytest.raises(KnowledgeIndexingLeaseLostError):
        task_module._run_document_indexing_update_task(
            dataset.id,
            document.id,
            lease=_LostAfterCleanupLease(),
        )

    processor.clean.assert_called_once()
    runner.run.assert_not_called()
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document.id)
    assert persisted.indexing_status == IndexingStatus.PARSING
    assert persisted.error is None


@pytest.mark.parametrize("is_multimodal", [False, True])
def test_reindex_leaves_owner_rows_for_indexing_service_replacement(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    is_multimodal: bool,
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)
    dataset.is_multimodal = is_multimodal
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

    document_indexing_update_task(dataset.id, document.id)

    assert processor.clean.call_count == 1
    assert processor.clean.call_args.args[1] == ["node-1"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    assert (
        len(sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all())
        == 1
    )
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

    document_indexing_update_task(dataset.id, document.id)

    processor.clean.assert_called_once()
    assert processor.clean.call_args.args[1] == ["node-1"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
    assert sqlite_session.get(SegmentAttachmentBinding, shared_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    runner.run.assert_called_once()


def test_reindex_rejects_document_outside_dataset_owner_chain(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(sqlite_session, with_segment=True)
    document.tenant_id = str(uuid.uuid4())
    sqlite_session.commit()

    document_indexing_update_task(dataset.id, document.id)

    processor.clean.assert_not_called()
    runner.run.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id) is not None
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all()
