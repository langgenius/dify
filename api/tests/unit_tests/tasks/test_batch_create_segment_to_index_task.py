from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import UploadFile
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task


def test_batch_create_segment_to_index_task_queries_max_position_once_per_batch(
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    tenant_id = str(uuid4())
    user_id = str(uuid4())
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name="Batch import dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=user_id,
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user_id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=0,
    )
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="batch-import.csv",
        name="batch-import.csv",
        size=32,
        extension=".csv",
        mime_type="text/csv",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user_id,
        created_at=datetime.now(UTC),
        used=False,
    )
    existing_segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=7,
        content="existing",
        word_count=1,
        tokens=1,
        created_by=user_id,
        index_node_id="existing-node",
        index_node_hash="existing-hash",
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add_all([dataset, document, upload_file, existing_segment])
    sqlite_session.commit()

    def mock_download(_key: str, file_path: str) -> None:
        Path(file_path).write_text("content\nfirst\nsecond\nthird\n", encoding="utf-8")

    max_position_queries: list[str] = []

    def count_max_position_query(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        normalized_statement = statement.lower()
        if "max(" in normalized_statement and "document_segments.position" in normalized_statement:
            max_position_queries.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", count_max_position_query)
    try:
        with (
            patch("tasks.batch_create_segment_to_index_task.storage.download", side_effect=mock_download),
            patch("tasks.batch_create_segment_to_index_task.VectorService.create_segments_vector"),
        ):
            batch_create_segment_to_index_task(
                job_id=str(uuid4()),
                upload_file_id=upload_file.id,
                dataset_id=dataset.id,
                document_id=document.id,
                tenant_id=tenant_id,
                user_id=user_id,
            )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_max_position_query)

    positions = sqlite_session.scalars(
        select(DocumentSegment.position)
        .where(DocumentSegment.document_id == document.id)
        .order_by(DocumentSegment.position)
    ).all()
    assert positions == [7, 8, 9, 10]
    assert len(max_position_queries) == 1
