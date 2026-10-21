"""Behavior tests for segment read-query helpers."""

from datetime import UTC, datetime
from typing import cast

from sqlalchemy import Table, insert
from sqlalchemy.orm import Session

from core.rag.entities import ParentMode
from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.dataset import ChildChunk, Dataset, DatasetProcessRule, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import (
    CreatorUserRole,
    DataSourceType,
    DocumentCreatedFrom,
    ProcessRuleMode,
    SegmentStatus,
)
from models.model import UploadFile
from models.tools import ToolFile
from repositories.knowledge.segment_query_repository import (
    get_segment_attachment_files,
    get_segment_child_chunks,
    get_segment_content_file_ids,
    get_segment_dataset,
    get_segment_document,
    get_segments_for_document,
    is_retrieved_segment_owned,
    segment_content_file_ids,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000002"
_DATASET_ID = "00000000-0000-0000-0000-000000000011"
_OTHER_DATASET_ID = "00000000-0000-0000-0000-000000000012"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000021"


def _dataset(*, dataset_id: str = _DATASET_ID, tenant_id: str = _TENANT_ID) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"dataset-{dataset_id}",
        provider="vendor",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=_ACCOUNT_ID,
        built_in_field_enabled=False,
    )


def _document(
    *,
    document_id: str,
    dataset_id: str = _DATASET_ID,
    tenant_id: str = _TENANT_ID,
    position: int = 1,
    enabled: bool = True,
    archived: bool = False,
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=position,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="batch",
        name=f"document-{document_id}.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=_ACCOUNT_ID,
        enabled=enabled,
        archived=archived,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )


def _segment(
    document: Document,
    *,
    segment_id: str,
    position: int = 1,
    status: SegmentStatus = SegmentStatus.COMPLETED,
    enabled: bool = True,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=position,
        content=f"segment-{position}",
        word_count=1,
        tokens=1,
        created_by=_ACCOUNT_ID,
        enabled=enabled,
        status=status,
    )
    segment.id = segment_id
    return segment


def _upload(*, file_id: str, tenant_id: str = _TENANT_ID) -> UploadFile:
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"knowledge/{file_id}",
        name=f"{file_id}.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=_ACCOUNT_ID,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )
    upload.id = file_id
    return upload


def _tool_file(*, file_id: str, tenant_id: str = _TENANT_ID) -> ToolFile:
    tool_file = ToolFile(
        user_id=_ACCOUNT_ID,
        tenant_id=tenant_id,
        conversation_id=None,
        file_key=f"tools/{file_id}",
        mimetype="text/plain",
        name=f"{file_id}.txt",
        size=10,
    )
    tool_file.id = file_id
    return tool_file


def test_segment_content_file_ids_extracts_normalized_persisted_references() -> None:
    upload_id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"
    tool_id = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"
    content = (
        f"![upload](/files/{upload_id}/image-preview?timestamp=1) "
        f"[tool](/files/tools/{tool_id}.txt?sign=signature) "
        "/files/not-a-uuid/file-preview"
    )

    uploads, tools = segment_content_file_ids(content)

    assert uploads == {upload_id.lower()}
    assert tools == {tool_id.lower()}


def test_get_segments_for_document_enforces_owner_status_and_enabled_scope(sqlite_session: Session) -> None:
    dataset = _dataset()
    other_dataset = _dataset(dataset_id=_OTHER_DATASET_ID)
    sqlite_session.add_all([dataset, other_dataset])
    sqlite_session.flush()
    document = _document(document_id="00000000-0000-0000-0000-000000000101")
    other_document = _document(
        document_id="00000000-0000-0000-0000-000000000102",
        dataset_id=_OTHER_DATASET_ID,
    )
    sqlite_session.add_all([document, other_document])
    sqlite_session.flush()
    completed = _segment(
        document,
        segment_id="00000000-0000-0000-0000-000000000111",
        status=SegmentStatus.COMPLETED,
    )
    disabled = _segment(
        document,
        segment_id="00000000-0000-0000-0000-000000000112",
        position=2,
        enabled=False,
    )
    decoy = _segment(
        other_document,
        segment_id="00000000-0000-0000-0000-000000000113",
    )
    sqlite_session.add_all([completed, disabled, decoy])
    sqlite_session.flush()

    assert get_segments_for_document(
        sqlite_session,
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        document_id=document.id,
        status=SegmentStatus.COMPLETED,
        enabled=True,
    ) == [completed]
    assert get_segments_for_document(
        sqlite_session,
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        document_id=document.id,
        enabled=False,
    ) == [disabled]
    assert (
        get_segments_for_document(
            sqlite_session,
            tenant_id=_OTHER_TENANT_ID,
            dataset_id=_DATASET_ID,
            document_id=document.id,
        )
        == []
    )


def test_segment_files_require_matching_tenant_and_attachment_owner_chain(sqlite_session: Session) -> None:
    upload = _upload(file_id="00000000-0000-0000-0000-000000000121")
    foreign_upload = _upload(
        file_id="00000000-0000-0000-0000-000000000122",
        tenant_id=_OTHER_TENANT_ID,
    )
    tool_file = _tool_file(file_id="00000000-0000-0000-0000-000000000123")
    foreign_tool_file = _tool_file(
        file_id="00000000-0000-0000-0000-000000000124",
        tenant_id=_OTHER_TENANT_ID,
    )
    dataset = _dataset()
    sqlite_session.add_all([upload, foreign_upload, tool_file, foreign_tool_file, dataset])
    sqlite_session.flush()
    document = _document(document_id="00000000-0000-0000-0000-000000000125")
    sqlite_session.add(document)
    sqlite_session.flush()
    segment = _segment(document, segment_id="00000000-0000-0000-0000-000000000126")
    sqlite_session.add(segment)
    sqlite_session.flush()
    binding = SegmentAttachmentBinding(
        tenant_id=segment.tenant_id,
        dataset_id=segment.dataset_id,
        document_id=segment.document_id,
        segment_id=segment.id,
        attachment_id=upload.id,
    )
    sqlite_session.add(binding)
    sqlite_session.flush()
    sqlite_session.execute(
        insert(cast(Table, SegmentAttachmentBinding.__table__)).values(
            id="00000000-0000-0000-0000-000000000127",
            tenant_id=segment.tenant_id,
            dataset_id=segment.dataset_id,
            document_id=segment.document_id,
            segment_id=segment.id,
            attachment_id=foreign_upload.id,
        )
    )
    sqlite_session.flush()

    uploads, tools = get_segment_content_file_ids(
        segment,
        upload_ids={upload.id, foreign_upload.id},
        tool_ids={tool_file.id, foreign_tool_file.id},
        session=sqlite_session,
    )

    assert uploads == {upload.id}
    assert tools == {tool_file.id}
    assert get_segment_attachment_files(segment, session=sqlite_session) == [upload]


def test_retrieved_segment_requires_the_complete_enabled_owner_chain(sqlite_session: Session) -> None:
    dataset = _dataset()
    other_dataset = _dataset(dataset_id=_OTHER_DATASET_ID)
    sqlite_session.add_all([dataset, other_dataset])
    sqlite_session.flush()
    active_document = _document(document_id="00000000-0000-0000-0000-000000000131")
    disabled_document = _document(
        document_id="00000000-0000-0000-0000-000000000132",
        position=2,
        enabled=False,
    )
    archived_document = _document(
        document_id="00000000-0000-0000-0000-000000000133",
        position=3,
        archived=True,
    )
    sqlite_session.add_all([active_document, disabled_document, archived_document])
    sqlite_session.flush()
    active = _segment(active_document, segment_id="00000000-0000-0000-0000-000000000141")
    disabled_segment = _segment(
        active_document,
        segment_id="00000000-0000-0000-0000-000000000142",
        position=2,
        enabled=False,
    )
    disabled_parent = _segment(
        disabled_document,
        segment_id="00000000-0000-0000-0000-000000000143",
    )
    archived_parent = _segment(
        archived_document,
        segment_id="00000000-0000-0000-0000-000000000144",
    )
    sqlite_session.add_all([active, disabled_segment, disabled_parent, archived_parent])
    sqlite_session.flush()

    assert is_retrieved_segment_owned(
        active,
        tenant_id=_TENANT_ID,
        dataset_ids=[_DATASET_ID, _OTHER_DATASET_ID],
        session=sqlite_session,
    )
    assert not is_retrieved_segment_owned(
        active,
        tenant_id=_OTHER_TENANT_ID,
        dataset_ids=[_DATASET_ID],
        session=sqlite_session,
    )
    assert not is_retrieved_segment_owned(
        active,
        tenant_id=_TENANT_ID,
        dataset_ids=[_OTHER_DATASET_ID],
        session=sqlite_session,
    )
    for inaccessible in (disabled_segment, disabled_parent, archived_parent):
        assert not is_retrieved_segment_owned(
            inaccessible,
            tenant_id=_TENANT_ID,
            dataset_ids=[_DATASET_ID],
            session=sqlite_session,
        )

    assert get_segment_dataset(active, session=sqlite_session) is dataset
    assert get_segment_document(active, session=sqlite_session) is active_document
    forged = _segment(
        active_document,
        segment_id=active.id,
    )
    forged.tenant_id = _OTHER_TENANT_ID
    assert get_segment_dataset(forged, session=sqlite_session) is None
    assert get_segment_document(forged, session=sqlite_session) is None


def test_child_chunks_follow_hierarchical_rule_and_complete_owner_chain(sqlite_session: Session) -> None:
    dataset = _dataset()
    sqlite_session.add(dataset)
    sqlite_session.flush()
    process_rule = DatasetProcessRule(
        dataset_id=dataset.id,
        mode=ProcessRuleMode.HIERARCHICAL,
        rules=f'{{"parent_mode": "{ParentMode.FULL_DOC}"}}',
        created_by=_ACCOUNT_ID,
    )
    sqlite_session.add(process_rule)
    sqlite_session.flush()
    document = _document(document_id="00000000-0000-0000-0000-000000000151")
    document.dataset_process_rule_id = process_rule.id
    sqlite_session.add(document)
    sqlite_session.flush()
    segment = _segment(document, segment_id="00000000-0000-0000-0000-000000000152")
    sqlite_session.add(segment)
    sqlite_session.flush()
    later = ChildChunk(
        tenant_id=segment.tenant_id,
        dataset_id=segment.dataset_id,
        document_id=segment.document_id,
        segment_id=segment.id,
        position=2,
        content="later",
        word_count=1,
        created_by=_ACCOUNT_ID,
    )
    earlier = ChildChunk(
        tenant_id=segment.tenant_id,
        dataset_id=segment.dataset_id,
        document_id=segment.document_id,
        segment_id=segment.id,
        position=1,
        content="earlier",
        word_count=1,
        created_by=_ACCOUNT_ID,
    )
    sqlite_session.add_all([later, earlier])
    sqlite_session.flush()
    sqlite_session.execute(
        insert(cast(Table, ChildChunk.__table__)).values(
            id="00000000-0000-0000-0000-000000000153",
            tenant_id=_OTHER_TENANT_ID,
            dataset_id=segment.dataset_id,
            document_id=segment.document_id,
            segment_id=segment.id,
            position=3,
            content="legacy-cross-tenant-child",
            word_count=1,
            created_by=_ACCOUNT_ID,
        )
    )
    sqlite_session.flush()

    assert get_segment_child_chunks(segment, session=sqlite_session) == [earlier, later]
    assert get_segment_child_chunks(segment, session=sqlite_session, include_full_doc=False) == []
