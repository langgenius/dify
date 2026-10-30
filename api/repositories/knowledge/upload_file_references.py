"""Knowledge-owned references to shared upload files."""

import json
from collections.abc import Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.dataset import (
    ChildChunk,
    Dataset,
    Document,
    DocumentSegment,
    PipelineCustomizedTemplate,
    SegmentAttachmentBinding,
)
from models.knowledge_fs import (
    KnowledgeFSStagedUpload,
    KnowledgeFSUpgradeFileLease,
    KnowledgeFSUpgradeFileLeaseStatus,
    KnowledgeFSUpgradeJob,
)
from repositories.file.reference_queries import candidate_batches, payload_reference_predicate
from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import referenced_candidate_ids
from services.knowledge.indexing.contracts import PENDING_UPLOAD_CLEANUP_IDS_KEY


def _public_document_source(payload: object) -> object:
    source_info: object = payload
    if isinstance(payload, str):
        try:
            source_info = json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            return payload
    if not isinstance(source_info, Mapping):
        return payload
    public_source = dict(source_info)
    public_source.pop(PENDING_UPLOAD_CLEANUP_IDS_KEY, None)
    return public_source


def get_referenced_upload_file_ids(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Return candidates retained by knowledge documents, chunks, and assets."""

    referenced: set[str] = set()
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            session.scalars(
                select(SegmentAttachmentBinding.attachment_id)
                .where(
                    SegmentAttachmentBinding.tenant_id == tenant_id,
                    SegmentAttachmentBinding.attachment_id.in_(batch_ids),
                )
                .with_for_update(read=True, nowait=True)
            )
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        if not remaining:
            continue

        referenced.update(
            session.scalars(
                select(KnowledgeFSStagedUpload.upload_file_id)
                .where(
                    KnowledgeFSStagedUpload.tenant_id == tenant_id,
                    KnowledgeFSStagedUpload.upload_file_id.in_(tuple(candidate.id for candidate in remaining)),
                )
                .with_for_update(read=True, nowait=True)
            )
        )
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        referenced.update(
            session.scalars(
                select(KnowledgeFSUpgradeFileLease.old_upload_file_id)
                .join(KnowledgeFSUpgradeJob, KnowledgeFSUpgradeJob.id == KnowledgeFSUpgradeFileLease.job_id)
                .where(
                    KnowledgeFSUpgradeJob.tenant_id == tenant_id,
                    KnowledgeFSUpgradeFileLease.old_upload_file_id.in_(tuple(candidate.id for candidate in remaining)),
                    KnowledgeFSUpgradeFileLease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                    KnowledgeFSUpgradeFileLease.expires_at > naive_utc_now(),
                )
                .with_for_update(read=True, nowait=True)
            )
        )
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        source_rows = session.scalars(
            select(Document.data_source_info)
            .where(
                Document.tenant_id == tenant_id,
                Document.data_source_info.is_not(None),
                payload_reference_predicate((Document.data_source_info,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(
            referenced_candidate_ids((_public_document_source(payload) for payload in source_rows), remaining)
        )
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        segment_columns = (DocumentSegment.content, DocumentSegment.answer)
        segment_rows = session.execute(
            select(*segment_columns)
            .where(
                DocumentSegment.tenant_id == tenant_id,
                payload_reference_predicate(segment_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in segment_rows for payload in row), remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        child_rows = session.scalars(
            select(ChildChunk.content)
            .where(
                ChildChunk.tenant_id == tenant_id,
                payload_reference_predicate((ChildChunk.content,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        )
        referenced.update(referenced_candidate_ids(child_rows, remaining))
        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue

        for model, column in (
            (Dataset, Dataset.icon_info),
            (PipelineCustomizedTemplate, PipelineCustomizedTemplate.icon),
        ):
            if not remaining:
                break
            rows = session.scalars(
                select(column)
                .where(model.tenant_id == tenant_id, payload_reference_predicate((column,), remaining))
                .with_for_update(read=True, nowait=True)
            )
            referenced.update(referenced_candidate_ids(rows, remaining))
            remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
    return referenced
