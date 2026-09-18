"""SQLite-backed resilience tests for ``clean_document_task``.

The task must continue PostgreSQL cleanup when vector cleanup fails. Each test
starts from the production incident shape: the caller has already deleted the
``Document`` row while its segments and metadata bindings remain.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import tasks.clean_document_task as clean_document_task_module
from models.dataset import (
    Dataset,
    DatasetMetadataBinding,
    Document,
    DocumentSegment,
    SegmentAttachmentBinding,
)
from models.enums import DataSourceType, DocumentCreatedFrom
from models.model import UploadFile
from tasks.clean_document_task import clean_document_task

SQLITE_MODELS = (
    Dataset,
    Document,
    DocumentSegment,
    SegmentAttachmentBinding,
    UploadFile,
    DatasetMetadataBinding,
)

pytestmark = pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)


@pytest.fixture
def document_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def tenant_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def bind_task_sessions(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Bind every short-lived task transaction to the isolated SQLite engine."""
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        clean_document_task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )


@pytest.fixture
def mock_storage():
    with patch("tasks.clean_document_task.storage", autospec=True) as mock:
        mock.delete.return_value = None
        yield mock


@pytest.fixture
def mock_index_processor_factory():
    """Mock the vector/index boundary so cleanup behavior is deterministic."""
    with patch("tasks.clean_document_task.IndexProcessorFactory", autospec=True) as factory_cls:
        processor = MagicMock()
        processor.clean.return_value = None
        factory_instance = MagicMock()
        factory_instance.init_index_processor.return_value = processor
        factory_cls.return_value = factory_instance

        yield {
            "factory_cls": factory_cls,
            "factory_instance": factory_instance,
            "processor": processor,
        }


def _document(*, document_id: str, dataset_id: str, tenant_id: str, created_by: str) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name=f"{document_id}.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
    )


def _segment(*, segment_id: str, document_id: str, dataset_id: str, tenant_id: str, created_by: str) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="segment content",
        word_count=2,
        tokens=2,
        created_by=created_by,
        index_node_id=f"node-{segment_id}",
    )
    segment.id = segment_id
    return segment


def _persist_deleted_document_state(
    session: Session,
    *,
    document_id: str,
    dataset_id: str,
    tenant_id: str,
    target_segment_ids: list[str],
) -> tuple[str, str]:
    """Persist target children after deleting their document, plus scoped control rows."""
    created_by = str(uuid.uuid4())
    other_document_id = str(uuid.uuid4())
    survivor_segment_id = str(uuid.uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Cleanup dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    target_document = _document(
        document_id=document_id,
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        created_by=created_by,
    )
    other_document = _document(
        document_id=other_document_id,
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        created_by=created_by,
    )
    segments = [
        _segment(
            segment_id=segment_id,
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            created_by=created_by,
        )
        for segment_id in target_segment_ids
    ]
    segments.append(
        _segment(
            segment_id=survivor_segment_id,
            document_id=other_document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            created_by=created_by,
        )
    )
    metadata_bindings = [
        DatasetMetadataBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            metadata_id=str(uuid.uuid4()),
            document_id=current_document_id,
            created_by=created_by,
        )
        for current_document_id in (document_id, other_document_id)
    ]

    session.add_all([dataset, target_document, other_document, *segments, *metadata_bindings])
    session.commit()
    session.delete(target_document)
    session.commit()
    return other_document_id, survivor_segment_id


def _assert_relational_cleanup(
    session: Session,
    *,
    document_id: str,
    other_document_id: str,
    survivor_segment_id: str,
) -> None:
    session.expire_all()
    assert session.get(Document, document_id) is None
    remaining_segments = session.scalars(select(DocumentSegment)).all()
    assert [(segment.id, segment.document_id) for segment in remaining_segments] == [
        (survivor_segment_id, other_document_id)
    ]
    remaining_binding_document_ids = set(session.scalars(select(DatasetMetadataBinding.document_id)).all())
    assert remaining_binding_document_ids == {other_document_id}


class TestVectorCleanupResilience:
    """Vector/index failures must not abort relational cleanup."""

    def test_billing_failure_during_vector_cleanup_does_not_skip_pg_cleanup(
        self,
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        sqlite_session: Session,
        bind_task_sessions: None,
        mock_storage,
        mock_index_processor_factory,
    ) -> None:
        """A transient billing failure leaves only the unrelated document's rows."""
        other_document_id, survivor_segment_id = _persist_deleted_document_state(
            sqlite_session,
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            target_segment_ids=["seg-1", "seg-2"],
        )
        mock_index_processor_factory["processor"].clean.side_effect = ValueError(
            "Unable to retrieve billing information. Please try again later or contact support."
        )

        # Act — must not raise out of the task even though clean() raises.
        with patch("tasks.clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh:
            clean_document_task(
                document_id=document_id,
                dataset_id=dataset_id,
                doc_form="paragraph",
                file_id=None,
            )

        mock_index_processor_factory["processor"].clean.assert_called_once()
        _assert_relational_cleanup(
            sqlite_session,
            document_id=document_id,
            other_document_id=other_document_id,
            survivor_segment_id=survivor_segment_id,
        )
        schedule_refresh.assert_not_called()

    def test_vector_cleanup_success_path_remains_unaffected(
        self,
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        sqlite_session: Session,
        bind_task_sessions: None,
        mock_storage,
        mock_index_processor_factory,
    ) -> None:
        """The happy path calls the index boundary and completes scoped cleanup."""
        other_document_id, survivor_segment_id = _persist_deleted_document_state(
            sqlite_session,
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            target_segment_ids=["seg-1"],
        )

        with patch("tasks.clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh:
            clean_document_task(
                document_id=document_id,
                dataset_id=dataset_id,
                doc_form="paragraph",
                file_id=None,
            )

        mock_index_processor_factory["processor"].clean.assert_called_once()
        _, kwargs = mock_index_processor_factory["processor"].clean.call_args
        cleanup_session = kwargs.pop("session")
        assert isinstance(cleanup_session, Session)
        assert cleanup_session.get_bind() is sqlite_session.get_bind()
        assert kwargs == {
            "with_keywords": True,
            "delete_child_chunks": True,
            "delete_summaries": True,
        }
        _assert_relational_cleanup(
            sqlite_session,
            document_id=document_id,
            other_document_id=other_document_id,
            survivor_segment_id=survivor_segment_id,
        )
        schedule_refresh.assert_called_once_with(tenant_id)

    def test_no_segments_skips_vector_cleanup(
        self,
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        sqlite_session: Session,
        bind_task_sessions: None,
        mock_storage,
        mock_index_processor_factory,
    ) -> None:
        """A target document without segments skips the vector/index boundary."""
        other_document_id, survivor_segment_id = _persist_deleted_document_state(
            sqlite_session,
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            target_segment_ids=[],
        )

        with patch("tasks.clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh:
            clean_document_task(
                document_id=document_id,
                dataset_id=dataset_id,
                doc_form="paragraph",
                file_id=None,
            )

        mock_index_processor_factory["factory_cls"].assert_not_called()
        _assert_relational_cleanup(
            sqlite_session,
            document_id=document_id,
            other_document_id=other_document_id,
            survivor_segment_id=survivor_segment_id,
        )
        schedule_refresh.assert_not_called()
