import logging
import time
from collections.abc import Mapping, Sequence
from contextlib import nullcontext

import click
from celery import Task, shared_task
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetAutoDisableLog,
    DatasetMetadataBinding,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.model import UploadFile
from repositories.file.upload_file_repository import UploadFileRepository
from services.dataset_knowledge_fs_upgrade_file_lease import reserve_upgrade_file_cleanup
from services.file_adapters import build_upload_file_reclaimer
from services.file_reference_parser import trusted_upload_file_ids
from services.knowledge.indexing.adapters.cleanup import (
    clean_document_indexes,
    document_cleanup_batches,
    hold_document_cleanup_locks,
)
from services.knowledge.indexing.contracts import pending_upload_cleanup_ids
from services.knowledge.indexing.locks import KnowledgeIndexingLease, KnowledgeIndexingLockBusyError
from tasks.refresh_billing_vector_space_task import schedule_billing_vector_space_refresh

logger = logging.getLogger(__name__)


def _delete_unreferenced_files_in_session(
    session: Session,
    *,
    tenant_id: str,
    file_ids: Sequence[str],
) -> None:
    leased_file_ids = reserve_upgrade_file_cleanup(session, file_ids)
    session_maker = session_factory.get_session_maker()
    files = UploadFileRepository(session_factory=session_maker)
    reclaimer = build_upload_file_reclaimer(session_factory=session_maker, files=files)
    reclaimer.delete_unreferenced_files_in_session(
        session,
        tenant_id=tenant_id,
        file_ids=[file_id for file_id in file_ids if file_id not in leased_file_ids],
        delete_blob=storage.delete,
    )


def _resolve_tenant_id(
    *,
    dataset_id: str,
    document_ids: Sequence[str],
    file_ids: Sequence[str],
) -> str | None:
    """Resolve cleanup ownership without extending the established task message."""

    unique_document_ids = tuple(dict.fromkeys(document_ids))
    unique_file_ids = tuple(dict.fromkeys(file_id for file_id in file_ids if file_id))
    with session_factory.create_session() as session:
        dataset_tenant_id = session.scalar(select(Dataset.tenant_id).where(Dataset.id == dataset_id).limit(1))
        if dataset_tenant_id:
            return dataset_tenant_id

        tenant_ids: set[str] = set()
        if unique_document_ids:
            tenant_ids.update(
                session.scalars(
                    select(Document.tenant_id)
                    .where(
                        Document.dataset_id == dataset_id,
                        Document.id.in_(unique_document_ids),
                    )
                    .distinct()
                ).all()
            )
            scoped_models = (
                DocumentSegment,
                SegmentAttachmentBinding,
                DatasetMetadataBinding,
                ChildChunk,
                DatasetAutoDisableLog,
            )
            for model in scoped_models:
                tenant_ids.update(
                    session.scalars(
                        select(model.tenant_id)
                        .where(
                            model.dataset_id == dataset_id,
                            model.document_id.in_(unique_document_ids),
                        )
                        .distinct()
                    ).all()
                )
        if unique_file_ids:
            tenant_ids.update(
                session.scalars(select(UploadFile.tenant_id).where(UploadFile.id.in_(unique_file_ids)).distinct()).all()
            )

    if len(tenant_ids) > 1:
        raise ValueError("Document cleanup ownership is ambiguous")
    return next(iter(tenant_ids), None)


def _collect_candidate_file_ids(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    explicit_file_ids: Sequence[str],
) -> tuple[str, ...]:
    """Collect knowledge-owned candidates before their references are removed."""

    candidates = list(explicit_file_ids)
    documents = session.scalars(
        select(Document).where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
            Document.id.in_(document_ids),
        )
    ).all()
    for document in documents:
        source_info = document.data_source_info_dict
        candidates.extend(pending_upload_cleanup_ids(source_info))
        file_id = source_info.get("upload_file_id")
        if isinstance(file_id, str):
            candidates.append(file_id)

    segments = session.scalars(
        select(DocumentSegment).where(
            DocumentSegment.tenant_id == tenant_id,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id.in_(document_ids),
        )
    ).all()
    for segment in segments:
        for content in (segment.content, segment.answer):
            if content:
                candidates.extend(sorted(trusted_upload_file_ids(content)))

    child_contents = session.scalars(
        select(ChildChunk.content).where(
            ChildChunk.tenant_id == tenant_id,
            ChildChunk.dataset_id == dataset_id,
            ChildChunk.document_id.in_(document_ids),
        )
    )
    for content in child_contents:
        candidates.extend(sorted(trusted_upload_file_ids(content)))

    candidates.extend(
        session.scalars(
            select(SegmentAttachmentBinding.attachment_id).where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.dataset_id == dataset_id,
                SegmentAttachmentBinding.document_id.in_(document_ids),
            )
        ).all()
    )
    return tuple(dict.fromkeys(file_id for file_id in candidates if file_id))


def _delete_document_rows_and_unreferenced_files(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    file_ids: Sequence[str],
) -> None:
    """Remove SQL references and reclaim only files with no global owner.

    UploadFile rows stay locked until relational deletion commits. Only then
    may blob deletion run, so a database rollback preserves the physical files.
    Storage failures leave unowned blobs for the existing maintenance cleanup.
    """

    with session_factory.create_session() as session, session.begin():
        candidate_file_ids = _collect_candidate_file_ids(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
            explicit_file_ids=file_ids,
        )
        session.execute(
            delete(SegmentAttachmentBinding).where(
                SegmentAttachmentBinding.tenant_id == tenant_id,
                SegmentAttachmentBinding.dataset_id == dataset_id,
                SegmentAttachmentBinding.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(DatasetMetadataBinding).where(
                DatasetMetadataBinding.tenant_id == tenant_id,
                DatasetMetadataBinding.dataset_id == dataset_id,
                DatasetMetadataBinding.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(ChildChunk).where(
                ChildChunk.tenant_id == tenant_id,
                ChildChunk.dataset_id == dataset_id,
                ChildChunk.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(DocumentSegment).where(
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(DocumentPipelineExecutionLog).where(DocumentPipelineExecutionLog.document_id.in_(document_ids))
        )
        session.execute(
            delete(DatasetAutoDisableLog).where(
                DatasetAutoDisableLog.tenant_id == tenant_id,
                DatasetAutoDisableLog.dataset_id == dataset_id,
                DatasetAutoDisableLog.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(Document).where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(document_ids),
            )
        )
        session.flush()

        _delete_unreferenced_files_in_session(
            session,
            tenant_id=tenant_id,
            file_ids=candidate_file_ids,
        )


def _delete_tenant_independent_document_rows(*, dataset_id: str, document_ids: Sequence[str]) -> None:
    """Remove rows safely scoped by globally unique dataset and document IDs."""

    with session_factory.create_session() as session, session.begin():
        session.execute(
            delete(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.document_id.in_(document_ids),
            )
        )
        session.execute(
            delete(DocumentPipelineExecutionLog).where(DocumentPipelineExecutionLog.document_id.in_(document_ids))
        )


def _clean_documents(
    *,
    document_ids: Sequence[str],
    dataset_id: str,
    doc_form: str,
    file_ids: Sequence[str],
    owned_leases: Mapping[str, KnowledgeIndexingLease] | None = None,
) -> None:
    if owned_leases is None:
        for batch in document_cleanup_batches(document_ids):
            with hold_document_cleanup_locks(batch) as leases:
                _clean_documents(
                    document_ids=batch,
                    dataset_id=dataset_id,
                    doc_form=doc_form,
                    file_ids=file_ids,
                    owned_leases=leases,
                )
        return
    ownership = nullcontext(owned_leases)
    with ownership as leases:
        for document_id in document_ids:
            leases[document_id].assert_owned()
        _clean_documents_owned(
            document_ids=document_ids,
            dataset_id=dataset_id,
            doc_form=doc_form,
            file_ids=file_ids,
            owned_leases=leases,
        )
        for lease in leases.values():
            lease.assert_owned()


def _clean_documents_owned(
    *,
    document_ids: Sequence[str],
    dataset_id: str,
    doc_form: str,
    file_ids: Sequence[str],
    owned_leases: Mapping[str, KnowledgeIndexingLease],
) -> None:
    unique_document_ids = tuple(dict.fromkeys(document_ids))
    if not unique_document_ids:
        return
    if not doc_form:
        raise ValueError("doc_form is required")

    resolved_tenant_id = _resolve_tenant_id(
        dataset_id=dataset_id,
        document_ids=unique_document_ids,
        file_ids=file_ids,
    )
    if resolved_tenant_id is None:
        _delete_tenant_independent_document_rows(
            dataset_id=dataset_id,
            document_ids=unique_document_ids,
        )
        return

    index_tenant_id = clean_document_indexes(
        dataset_id=dataset_id,
        document_ids=unique_document_ids,
        doc_form=doc_form,
        new_session=session_factory.create_session,
        owned_leases=owned_leases,
    )
    if index_tenant_id is not None and index_tenant_id != resolved_tenant_id:
        raise ValueError("Document cleanup dataset ownership changed")
    if index_tenant_id is not None:
        # Summary rows may already be removed on retry. Refresh before file
        # cleanup can fail; retained children also keep their file evidence
        # available until the relational cleanup transaction commits.
        schedule_billing_vector_space_refresh(index_tenant_id)

    for lease in owned_leases.values():
        lease.assert_owned()
    _delete_document_rows_and_unreferenced_files(
        tenant_id=resolved_tenant_id,
        dataset_id=dataset_id,
        document_ids=unique_document_ids,
        file_ids=file_ids,
    )


@shared_task(
    bind=True,
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=None,
    dont_autoretry_for=(ValueError,),
    acks_late=True,
    reject_on_worker_lost=True,
)
def clean_document_task(
    self: Task,
    document_id: str,
    dataset_id: str,
    doc_form: str,
    file_id: str | None,
) -> None:
    """Clean one deleted document using the established four-field message."""

    logger.info(click.style(f"Start clean document when document deleted: {document_id}", fg="green"))
    start_at = time.perf_counter()
    try:
        _clean_documents(
            document_ids=(document_id,),
            dataset_id=dataset_id,
            doc_form=doc_form,
            file_ids=(file_id,) if file_id else (),
        )
    except KnowledgeIndexingLockBusyError as error:
        # Healthy long-running index owners must not exhaust deletion retries.
        raise self.retry(exc=error, countdown=60, max_retries=None) from error
    logger.info(
        click.style(
            f"Cleaned document when document deleted: {document_id} latency: {time.perf_counter() - start_at}",
            fg="green",
        )
    )
