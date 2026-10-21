"""SQLAlchemy query helpers for segment-owned read projections."""

import re
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.file_access import DatabaseFileAccessController
from core.rag.entities import ParentMode, Rule
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.model import UploadFile
from models.tools import ToolFile
from repositories.knowledge.document_query_repository import get_document_process_rule

_FILE_ID = r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
_FILE_LINK = re.compile(
    rf"/files/(?:(?P<upload>{_FILE_ID})/(?P<preview>image-preview|file-preview)"
    rf"|tools/(?P<tool>{_FILE_ID})\.(?P<extension>[a-zA-Z0-9]+))"
    r"(?:\?[^\s)\"'<>]*)?"
)


def segment_content_file_ids(content: str) -> tuple[set[str], set[str]]:
    """Return normalized persisted file identifiers without presenting their links."""

    matches = list(_FILE_LINK.finditer(content))
    return (
        {match["upload"].lower() for match in matches if match["upload"]},
        {match["tool"].lower() for match in matches if match["tool"]},
    )


def get_segments_for_document(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    status: str | None = None,
    enabled: bool | None = None,
) -> Sequence[DocumentSegment]:
    statement = select(DocumentSegment).where(
        DocumentSegment.tenant_id == tenant_id,
        DocumentSegment.dataset_id == dataset_id,
        DocumentSegment.document_id == document_id,
    )
    if status is not None:
        statement = statement.where(DocumentSegment.status == status)
    if enabled is not None:
        statement = statement.where(DocumentSegment.enabled == enabled)
    return session.scalars(statement).all()


def get_segment_content_file_ids(
    segment: DocumentSegment, *, upload_ids: set[str], tool_ids: set[str], session: Session
) -> tuple[set[str], set[str]]:
    access = DatabaseFileAccessController()
    uploads = (
        session.scalars(
            access.apply_upload_file_filters(
                select(UploadFile).where(UploadFile.id.in_(upload_ids), UploadFile.tenant_id == segment.tenant_id)
            )
        ).all()
        if upload_ids
        else []
    )
    tools = (
        session.scalars(
            access.apply_tool_file_filters(
                select(ToolFile).where(ToolFile.id.in_(tool_ids), ToolFile.tenant_id == segment.tenant_id)
            )
        ).all()
        if tool_ids
        else []
    )
    return {file.id for file in uploads}, {file.id for file in tools}


def get_segment_attachment_files(segment: DocumentSegment, *, session: Session) -> Sequence[UploadFile]:
    return session.scalars(
        select(UploadFile)
        .join(SegmentAttachmentBinding, UploadFile.id == SegmentAttachmentBinding.attachment_id)
        .where(
            SegmentAttachmentBinding.tenant_id == segment.tenant_id,
            SegmentAttachmentBinding.dataset_id == segment.dataset_id,
            SegmentAttachmentBinding.document_id == segment.document_id,
            SegmentAttachmentBinding.segment_id == segment.id,
            UploadFile.tenant_id == segment.tenant_id,
        )
    ).all()


def is_retrieved_segment_owned(
    segment: DocumentSegment, *, tenant_id: str, dataset_ids: Sequence[str], session: Session
) -> bool:
    """Validate retrieved identifiers against the complete persisted owner chain."""
    if segment.tenant_id != tenant_id or segment.dataset_id not in dataset_ids:
        return False
    return (
        session.scalar(
            select(DocumentSegment.id)
            .join(Document, Document.id == DocumentSegment.document_id)
            .join(Dataset, Dataset.id == Document.dataset_id)
            .where(
                Dataset.tenant_id == tenant_id,
                Dataset.id == segment.dataset_id,
                Document.tenant_id == tenant_id,
                Document.dataset_id == segment.dataset_id,
                Document.id == segment.document_id,
                Document.enabled.is_(True),
                Document.archived.is_(False),
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == segment.dataset_id,
                DocumentSegment.id == segment.id,
                DocumentSegment.enabled.is_(True),
            )
        )
        is not None
    )


def get_segment_dataset(segment: DocumentSegment, *, session: Session) -> Dataset | None:
    """Load the owning dataset with the caller-owned database session."""
    return session.scalar(
        select(Dataset).where(Dataset.id == segment.dataset_id, Dataset.tenant_id == segment.tenant_id)
    )


def get_segment_document(segment: DocumentSegment, *, session: Session) -> Document | None:
    """Load the owning document with the caller-owned database session."""
    return session.scalar(
        select(Document).where(
            Document.id == segment.document_id,
            Document.dataset_id == segment.dataset_id,
            Document.tenant_id == segment.tenant_id,
        )
    )


def get_segment_child_chunks(
    segment: DocumentSegment, *, session: Session, include_full_doc: bool = True
) -> Sequence[ChildChunk]:
    """Load hierarchical child chunks with the caller-owned database session."""
    document = get_segment_document(segment, session=session)
    if not document:
        return []
    process_rule = get_document_process_rule(document, session=session)
    if process_rule and process_rule.mode == "hierarchical":
        rules_dict = process_rule.rules_dict
        if rules_dict:
            rules = Rule.model_validate(rules_dict)
            if rules.parent_mode and (include_full_doc or rules.parent_mode != ParentMode.FULL_DOC):
                child_chunks = session.scalars(
                    select(ChildChunk)
                    .where(
                        ChildChunk.segment_id == segment.id,
                        ChildChunk.tenant_id == segment.tenant_id,
                        ChildChunk.dataset_id == segment.dataset_id,
                        ChildChunk.document_id == segment.document_id,
                    )
                    .order_by(ChildChunk.position.asc())
                ).all()
                return child_chunks or []
    return []
