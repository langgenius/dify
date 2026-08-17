import json
from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from fields.document_response_prefetch import DocumentResponsePrefetch
from models import Account, CreatorUserRole, UploadFile
from models.dataset import DatasetMetadata, DatasetMetadataBinding, DatasetProcessRule, Document, DocumentSegment
from models.enums import (
    DatasetMetadataType,
    DataSourceType,
    DocumentCreatedFrom,
    ProcessRuleMode,
    SegmentStatus,
)


def _document(
    *,
    document_id: str,
    dataset_id: str,
    creator_id: str,
    upload_file_id: str,
    process_rule_id: str,
    now: datetime,
) -> Document:
    return Document(
        id=document_id,
        tenant_id="tenant-1",
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": upload_file_id}),
        dataset_process_rule_id=process_rule_id,
        batch="batch-1",
        name=f"{document_id}.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=creator_id,
        created_at=now,
        updated_at=now,
        doc_metadata={"author": f"author-{document_id}"},
    )


def _segment(
    *,
    document_id: str,
    dataset_id: str,
    creator_id: str,
    position: int,
    status: SegmentStatus,
    hit_count: int,
    completed_at: datetime | None,
) -> DocumentSegment:
    return DocumentSegment(
        tenant_id="tenant-1",
        dataset_id=dataset_id,
        document_id=document_id,
        position=position,
        content="segment content",
        word_count=2,
        tokens=2,
        created_by=creator_id,
        status=status,
        hit_count=hit_count,
        completed_at=completed_at,
    )


@pytest.mark.parametrize("document_count", [1, 5])
def test_load_batches_document_response_queries(
    sqlite_session: Session,
    sqlite_engine: Engine,
    document_count: int,
) -> None:
    now = datetime(2026, 1, 1)
    dataset_id = str(uuid4())
    creator_id = str(uuid4())

    account = Account(name="Uploader", email="uploader@example.com")
    account.id = creator_id
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="documents/source.txt",
        name="source.txt",
        size=128,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=creator_id,
        created_at=now,
        used=True,
    )
    process_rule = DatasetProcessRule(
        dataset_id=dataset_id,
        mode=ProcessRuleMode.AUTOMATIC,
        rules=None,
        created_by=creator_id,
    )
    metadata = DatasetMetadata(
        tenant_id="tenant-1",
        dataset_id=dataset_id,
        type=DatasetMetadataType.STRING,
        name="author",
        created_by=creator_id,
    )
    documents = [
        _document(
            document_id=str(uuid4()),
            dataset_id=dataset_id,
            creator_id=creator_id,
            upload_file_id=upload_file.id,
            process_rule_id=process_rule.id,
            now=now,
        )
        for _ in range(document_count)
    ]
    bindings = [
        DatasetMetadataBinding(
            tenant_id="tenant-1",
            dataset_id=dataset_id,
            metadata_id=metadata.id,
            document_id=document.id,
            created_by=creator_id,
        )
        for document in documents
    ]
    segments = [
        segment
        for document in documents
        for segment in (
            _segment(
                document_id=document.id,
                dataset_id=dataset_id,
                creator_id=creator_id,
                position=1,
                status=SegmentStatus.COMPLETED,
                hit_count=3,
                completed_at=now,
            ),
            _segment(
                document_id=document.id,
                dataset_id=dataset_id,
                creator_id=creator_id,
                position=2,
                status=SegmentStatus.RE_SEGMENT,
                hit_count=5,
                completed_at=now,
            ),
        )
    ]
    segments.append(
        _segment(
            document_id=documents[0].id,
            dataset_id=str(uuid4()),
            creator_id=creator_id,
            position=3,
            status=SegmentStatus.COMPLETED,
            hit_count=100,
            completed_at=now,
        )
    )
    segments[-1].tenant_id = "tenant-2"
    sqlite_session.add_all([account, upload_file, process_rule, metadata, *bindings, *segments])
    sqlite_session.commit()

    select_count = 0

    def count_selects(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    event.listen(sqlite_engine, "before_cursor_execute", count_selects)
    try:
        prefetch = DocumentResponsePrefetch.load(documents, session=sqlite_session, include_segment_counts=True)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_selects)

    assert select_count == 5
    for document in documents:
        document_id = str(document.id)
        assert prefetch.hit_counts[document_id] == 8
        assert prefetch.completed_segment_counts[document_id] == 1
        assert prefetch.total_segment_counts[document_id] == 1
        assert prefetch.data_source_details[document_id]["upload_file"]["name"] == "source.txt"
        process_rule_dict = prefetch.process_rule_dicts[document_id]
        assert process_rule_dict is not None
        assert process_rule_dict["id"] == process_rule.id
        metadata_details = prefetch.metadata_details[document_id]
        assert metadata_details is not None
        assert metadata_details[0]["value"] == f"author-{document_id}"


def test_load_preserves_invalid_data_source_info_error() -> None:
    now = datetime(2026, 1, 1)
    document = _document(
        document_id=str(uuid4()),
        dataset_id=str(uuid4()),
        creator_id=str(uuid4()),
        upload_file_id=str(uuid4()),
        process_rule_id=str(uuid4()),
        now=now,
    )
    document.data_source_info = "not-json"
    session = MagicMock()
    empty_rows: list[tuple[object, ...]] = []
    session.execute.return_value.all.return_value = empty_rows

    with pytest.raises(json.JSONDecodeError):
        DocumentResponsePrefetch.load([document], session=session)
