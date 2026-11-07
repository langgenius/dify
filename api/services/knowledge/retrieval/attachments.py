"""Pure owner-chain reads used by canonical retrieval finalization."""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from core.app.file_access import get_current_file_access_scope
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import Document as RetrievalDocument
from models.dataset import Dataset, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from models.model import UploadFile
from services.knowledge.retrieval.records import RetrievalSegments

_SOURCE_DATASET_METADATA_KEY = "_retrieval_source_dataset_id"
_ALLOWED_DOCUMENTS_METADATA_KEY = "_retrieval_allowed_document_ids"


@dataclass(frozen=True, slots=True)
class ExpandedAttachmentCandidates:
    candidates: tuple[RetrievalDocument, ...]
    matched_attachment_ids: dict[str, frozenset[str]]


def expand_retrieval_attachment_candidates(
    candidates: Sequence[RetrievalDocument],
    *,
    tenant_id: str,
    dataset_ids: Sequence[str],
    session: Session,
) -> ExpandedAttachmentCandidates:
    """Replace untrusted vector owners with each current eligible binding owner."""
    requested_dataset_ids = frozenset(dataset_ids)
    attachment_candidates: list[tuple[RetrievalDocument, str, str]] = []
    expanded: list[RetrievalDocument] = []
    for candidate in candidates:
        source_dataset_id = candidate.metadata.get(_SOURCE_DATASET_METADATA_KEY)
        attachment_id = candidate.metadata.get("doc_id")
        raw_allowed_ids = candidate.metadata.get(_ALLOWED_DOCUMENTS_METADATA_KEY)
        allowed_document_ids = (
            frozenset(str(document_id) for document_id in raw_allowed_ids)
            if isinstance(raw_allowed_ids, list | tuple)
            else None
        )
        if (
            candidate.provider == "dify"
            and candidate.metadata.get("doc_type") == DocType.IMAGE
            and source_dataset_id in requested_dataset_ids
            and attachment_id
        ):
            attachment_candidates.append((candidate, str(source_dataset_id), str(attachment_id)))
        elif candidate.provider != "dify" or candidate.metadata.get("doc_type") != DocType.IMAGE:
            if (
                candidate.provider == "dify"
                and allowed_document_ids is not None
                and str(candidate.metadata.get("document_id") or "") not in allowed_document_ids
            ):
                continue
            expanded.append(candidate)

    if not attachment_candidates:
        return ExpandedAttachmentCandidates(tuple(expanded), {})

    candidate_pairs = {(dataset_id, attachment_id) for _, dataset_id, attachment_id in attachment_candidates}
    owner_rows = session.execute(
        select(
            SegmentAttachmentBinding.dataset_id,
            SegmentAttachmentBinding.attachment_id,
            SegmentAttachmentBinding.document_id,
            SegmentAttachmentBinding.segment_id,
        )
        .join(
            DocumentSegment,
            (DocumentSegment.id == SegmentAttachmentBinding.segment_id)
            & (DocumentSegment.tenant_id == SegmentAttachmentBinding.tenant_id)
            & (DocumentSegment.dataset_id == SegmentAttachmentBinding.dataset_id)
            & (DocumentSegment.document_id == SegmentAttachmentBinding.document_id),
        )
        .join(
            DatasetDocument,
            (DatasetDocument.id == SegmentAttachmentBinding.document_id)
            & (DatasetDocument.tenant_id == SegmentAttachmentBinding.tenant_id)
            & (DatasetDocument.dataset_id == SegmentAttachmentBinding.dataset_id),
        )
        .join(
            Dataset,
            (Dataset.id == SegmentAttachmentBinding.dataset_id)
            & (Dataset.tenant_id == SegmentAttachmentBinding.tenant_id),
        )
        .join(
            UploadFile,
            (UploadFile.id == SegmentAttachmentBinding.attachment_id)
            & (UploadFile.tenant_id == SegmentAttachmentBinding.tenant_id),
        )
        .where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            tuple_(SegmentAttachmentBinding.dataset_id, SegmentAttachmentBinding.attachment_id).in_(candidate_pairs),
            DatasetDocument.indexing_status == "completed",
            DatasetDocument.enabled.is_(True),
            DatasetDocument.archived.is_(False),
            DocumentSegment.status == "completed",
            DocumentSegment.enabled.is_(True),
        )
        .order_by(
            SegmentAttachmentBinding.dataset_id,
            SegmentAttachmentBinding.document_id,
            SegmentAttachmentBinding.segment_id,
            SegmentAttachmentBinding.attachment_id,
        )
    ).tuples()
    owners_by_candidate: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for dataset_id, attachment_id, document_id, segment_id in owner_rows:
        owners_by_candidate.setdefault((dataset_id, attachment_id), []).append((document_id, segment_id))

    matched: dict[str, set[str]] = {}
    for candidate, dataset_id, attachment_id in attachment_candidates:
        raw_allowed_ids = candidate.metadata.get(_ALLOWED_DOCUMENTS_METADATA_KEY)
        allowed_document_ids = (
            frozenset(str(document_id) for document_id in raw_allowed_ids)
            if isinstance(raw_allowed_ids, list | tuple)
            else None
        )
        emitted_documents: set[str] = set()
        for document_id, segment_id in owners_by_candidate.get((dataset_id, attachment_id), ()):
            if allowed_document_ids is not None and document_id not in allowed_document_ids:
                continue
            matched.setdefault(segment_id, set()).add(attachment_id)
            if document_id in emitted_documents:
                continue
            emitted_documents.add(document_id)
            expanded.append(
                candidate.model_copy(update={"metadata": {**candidate.metadata, "document_id": document_id}})
            )

    return ExpandedAttachmentCandidates(
        candidates=tuple(expanded),
        matched_attachment_ids={segment_id: frozenset(ids) for segment_id, ids in matched.items()},
    )


def authorize_retrieval_records(
    records: Sequence[RetrievalSegments],
    *,
    matched_attachment_ids: dict[str, frozenset[str]],
    tenant_id: str,
    dataset_ids: Sequence[str],
    session: Session,
) -> list[tuple[RetrievalSegments, tuple[UploadFile, ...]]]:
    """Lock complete owners in writer order and validate attachment-hit provenance."""
    scope = get_current_file_access_scope()
    if scope is not None and scope.tenant_id != tenant_id:
        return []
    requested_dataset_ids = frozenset(dataset_ids)
    candidate_segments = {
        record.segment.id: record.segment
        for record in records
        if record.segment.tenant_id == tenant_id and record.segment.dataset_id in requested_dataset_ids
    }
    if not candidate_segments:
        return []

    segment_ids = tuple(sorted(candidate_segments))
    binding_snapshot = session.execute(
        select(SegmentAttachmentBinding.segment_id, SegmentAttachmentBinding.attachment_id).where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.segment_id.in_(segment_ids),
        )
    ).tuples()
    upload_ids = {attachment_id for _, attachment_id in binding_snapshot}
    upload_ids.update(
        attachment_id
        for segment_id, attachment_ids in matched_attachment_ids.items()
        if segment_id in candidate_segments
        for attachment_id in attachment_ids
    )
    dataset_owner_ids = tuple(sorted({segment.dataset_id for segment in candidate_segments.values()}))
    valid_dataset_ids = set(
        session.scalars(
            select(Dataset.id)
            .where(Dataset.tenant_id == tenant_id, Dataset.id.in_(dataset_owner_ids))
            .order_by(Dataset.tenant_id, Dataset.id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
    )
    document_owners = tuple(
        sorted(
            {
                (segment.dataset_id, segment.document_id)
                for segment in candidate_segments.values()
                if segment.dataset_id in valid_dataset_ids
            }
        )
    )
    valid_documents = dict(
        session.execute(
            select(DatasetDocument.id, DatasetDocument.dataset_id)
            .where(
                DatasetDocument.tenant_id == tenant_id,
                tuple_(DatasetDocument.dataset_id, DatasetDocument.id).in_(document_owners),
                DatasetDocument.indexing_status == "completed",
                DatasetDocument.enabled.is_(True),
                DatasetDocument.archived.is_(False),
            )
            .order_by(DatasetDocument.tenant_id, DatasetDocument.dataset_id, DatasetDocument.id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        .tuples()
        .all()
        if document_owners
        else []
    )
    valid_segments = {
        segment_id: (dataset_id, document_id)
        for segment_id, dataset_id, document_id in (
            session.execute(
                select(DocumentSegment.id, DocumentSegment.dataset_id, DocumentSegment.document_id)
                .where(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.status == "completed",
                    DocumentSegment.enabled.is_(True),
                )
                .order_by(
                    DocumentSegment.tenant_id,
                    DocumentSegment.dataset_id,
                    DocumentSegment.document_id,
                    DocumentSegment.id,
                )
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            ).tuples()
            if valid_documents
            else []
        )
        if dataset_id in valid_dataset_ids
        and document_id in valid_documents
        and valid_documents[document_id] == dataset_id
    }
    uploads = (
        session.scalars(
            select(UploadFile)
            .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(upload_ids))
            .order_by(UploadFile.tenant_id, UploadFile.id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        ).all()
        if upload_ids
        else []
    )
    upload_by_id = {upload.id: upload for upload in uploads}
    current_bindings = (
        session.scalars(
            select(SegmentAttachmentBinding)
            .where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.segment_id.in_(valid_segments),
            )
            .order_by(
                SegmentAttachmentBinding.tenant_id,
                SegmentAttachmentBinding.dataset_id,
                SegmentAttachmentBinding.document_id,
                SegmentAttachmentBinding.segment_id,
                SegmentAttachmentBinding.attachment_id,
            )
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        ).all()
        if valid_segments
        else []
    )
    attachments_by_segment: dict[str, dict[str, UploadFile]] = {}
    for binding in current_bindings:
        segment_owner = valid_segments.get(binding.segment_id)
        upload = upload_by_id.get(binding.attachment_id)
        if (
            segment_owner is None
            or upload is None
            or binding.dataset_id != segment_owner[0]
            or binding.document_id != segment_owner[1]
        ):
            continue
        attachments_by_segment.setdefault(binding.segment_id, {})[upload.id] = upload

    authorized: list[tuple[RetrievalSegments, tuple[UploadFile, ...]]] = []
    for record in records:
        if record.segment.id not in valid_segments:
            continue
        attachments = attachments_by_segment.get(record.segment.id, {})
        matched_ids = matched_attachment_ids.get(record.segment.id)
        if matched_ids and not matched_ids.issubset(attachments):
            continue
        authorized.append((record, tuple(attachments.values())))
    return authorized
