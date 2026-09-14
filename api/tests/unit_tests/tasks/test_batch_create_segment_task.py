import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import UploadFile
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task


def test_batch_create_segment_sequential_positions(
    sqlite_session: Session,
):
    """Verify that batch segment creation assigns sequential positions starting from max_position + 1."""
    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Test Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=user_id,
        is_multimodal=False,
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    document = Document(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="test.csv",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user_id,
        enabled=True,
        archived=False,
        indexing_status="completed",
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=0,
    )
    # Existing segment with position 5
    existing_segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=5,
        content="existing content",
        word_count=16,
        tokens=3,
        created_by=user_id,
        index_node_id=str(uuid.uuid4()),
        index_node_hash="existing-hash",
        status=SegmentStatus.COMPLETED,
    )
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="test_file.csv",
        name="test.csv",
        size=100,
        extension="csv",
        mime_type="text/csv",
        created_by=user_id,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=naive_utc_now(),
        used=True,
    )
    sqlite_session.add_all([dataset, document, existing_segment, upload_file])
    sqlite_session.commit()

    csv_content = b"content\nfirst row\nsecond row\nthird row\n"

    def mock_download(filename, target_filepath):
        with open(target_filepath, "wb") as f:
            f.write(csv_content)

    with (
        patch("tasks.batch_create_segment_to_index_task.storage.download", side_effect=mock_download),
        patch("tasks.batch_create_segment_to_index_task.redis_client"),
        patch("tasks.batch_create_segment_to_index_task.ModelManager"),
        patch("tasks.batch_create_segment_to_index_task.VectorService"),
    ):
        batch_create_segment_to_index_task.run(
            job_id=str(uuid.uuid4()),
            upload_file_id=upload_file.id,
            dataset_id=dataset.id,
            document_id=document.id,
            tenant_id=tenant_id,
            user_id=user_id,
        )

    sqlite_session.expire_all()
    segments = (
        sqlite_session.scalars(
            select(DocumentSegment)
            .where(DocumentSegment.document_id == document.id)
            .order_by(DocumentSegment.position)
        )
        .all()
    )

    # We expect the existing segment (pos 5) and 3 new segments with positions 6, 7, 8
    positions = [s.position for s in segments]
    assert positions == [5, 6, 7, 8]
