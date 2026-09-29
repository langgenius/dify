"""SQLite-backed resilience tests for ``clean_document_task``.

The task must continue PostgreSQL cleanup when vector cleanup fails. Each test
starts from the production incident shape: the caller has already deleted the
``Document`` row while its segments and metadata bindings remain.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import tasks.clean_document_task as clean_document_task_module
from extensions.storage.storage_type import StorageType
from models.dataset import (
    Dataset,
    DatasetMetadataBinding,
    Document,
    DocumentSegment,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DataSourceType
from models.model import UploadFile
from tasks.clean_document_task import clean_document_task
from tests.unit_tests.model_factories import make_document

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
def mock_index_cleanup(tenant_id: str):
    """Keep task resilience tests independent of the external index backend."""
    with patch("tasks.clean_document_task.clean_document_indexes", return_value=tenant_id) as cleanup:
        yield cleanup


def _document(*, document_id: str, dataset_id: str, tenant_id: str, created_by: str) -> Document:
    return make_document(
        document_id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        name=f"{document_id}.txt",
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
        mock_index_cleanup,
    ) -> None:
        """A transient billing failure leaves only the unrelated document's rows."""
        other_document_id, survivor_segment_id = _persist_deleted_document_state(
            sqlite_session,
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            target_segment_ids=["seg-1", "seg-2"],
        )
        mock_index_cleanup.side_effect = ValueError(
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

        mock_index_cleanup.assert_called_once()
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
        mock_index_cleanup,
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

        mock_index_cleanup.assert_called_once()
        _, kwargs = mock_index_cleanup.call_args
        new_session = kwargs.pop("new_session")
        with new_session() as cleanup_session:
            assert cleanup_session.get_bind() is sqlite_session.get_bind()
        assert kwargs == {
            "dataset_id": dataset_id,
            "document_ids": [document_id],
            "doc_form": "paragraph",
            "extra_node_ids": [],
        }
        _assert_relational_cleanup(
            sqlite_session,
            document_id=document_id,
            other_document_id=other_document_id,
            survivor_segment_id=survivor_segment_id,
        )
        schedule_refresh.assert_called_once_with(tenant_id)

    def test_no_index_state_does_not_refresh_billing(
        self,
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        sqlite_session: Session,
        bind_task_sessions: None,
        mock_storage,
        mock_index_cleanup,
    ) -> None:
        """Cleanup checks for orphan summaries even when no segments remain."""
        mock_index_cleanup.return_value = None
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

        mock_index_cleanup.assert_called_once()
        _assert_relational_cleanup(
            sqlite_session,
            document_id=document_id,
            other_document_id=other_document_id,
            survivor_segment_id=survivor_segment_id,
        )
        schedule_refresh.assert_not_called()


def _attachment(*, tenant_id: str, created_by: str, key: str) -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name=key.rsplit("/", maxsplit=1)[-1],
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=datetime.now(UTC),
        used=True,
    )


class TestSegmentAttachmentCleanup:
    """附件向量与附件行必须按「是否还有别的文档引用」区别对待。"""

    def test_orphan_attachment_vectors_and_rows_are_cleaned(
        self,
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        sqlite_session: Session,
        bind_task_sessions: None,
        mock_storage: MagicMock,
        mock_index_cleanup: MagicMock,
    ) -> None:
        """只被本文档引用的附件：向量、数据行、blob 三者都要清掉。"""
        created_by = str(uuid.uuid4())
        segment = _segment(
            segment_id=str(uuid.uuid4()),
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            created_by=created_by,
        )
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="attachment dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
        )
        attachment = _attachment(tenant_id=tenant_id, created_by=created_by, key="attachments/orphan.png")
        sqlite_session.add_all([dataset, segment, attachment])
        sqlite_session.flush()
        binding = SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment.id,
            attachment_id=attachment.id,
        )
        sqlite_session.add(binding)
        sqlite_session.commit()
        attachment_id = attachment.id
        binding_id = binding.id

        clean_document_task(
            document_id=document_id,
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_id=None,
        )

        # 附件向量写在 doc_id == UploadFile.id 下，只能靠 extra_node_ids 送进清理。
        _, kwargs = mock_index_cleanup.call_args
        assert kwargs["extra_node_ids"] == [attachment_id]

        sqlite_session.expire_all()
        assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
        assert sqlite_session.get(UploadFile, attachment_id) is None
        mock_storage.delete.assert_any_call("attachments/orphan.png")

    def test_attachment_bound_to_another_document_survives(
        self,
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        sqlite_session: Session,
        bind_task_sessions: None,
        mock_storage: MagicMock,
        mock_index_cleanup: MagicMock,
    ) -> None:
        """同一个附件还被别的文档绑定时，它的行、blob 和向量都必须留下。"""
        created_by = str(uuid.uuid4())
        other_document_id = str(uuid.uuid4())
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="attachment dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
        )
        segment = _segment(
            segment_id=str(uuid.uuid4()),
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            created_by=created_by,
        )
        other_segment = _segment(
            segment_id=str(uuid.uuid4()),
            document_id=other_document_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            created_by=created_by,
        )
        attachment = _attachment(tenant_id=tenant_id, created_by=created_by, key="attachments/shared.png")
        sqlite_session.add_all([dataset, segment, other_segment, attachment])
        sqlite_session.flush()
        binding = SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment.id,
            attachment_id=attachment.id,
        )
        other_binding = SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=other_document_id,
            segment_id=other_segment.id,
            attachment_id=attachment.id,
        )
        sqlite_session.add_all([binding, other_binding])
        sqlite_session.commit()
        attachment_id = attachment.id
        binding_id = binding.id
        other_binding_id = other_binding.id

        clean_document_task(
            document_id=document_id,
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_id=None,
        )

        _, kwargs = mock_index_cleanup.call_args
        assert kwargs["extra_node_ids"] == []

        sqlite_session.expire_all()
        # 本文档自己的绑定要删掉，但附件行、另一个文档的绑定、以及 blob 都必须还在。
        assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
        assert sqlite_session.get(SegmentAttachmentBinding, other_binding_id) is not None
        assert sqlite_session.get(UploadFile, attachment_id) is not None
        for call in mock_storage.delete.call_args_list:
            assert call.args[0] != "attachments/shared.png"
