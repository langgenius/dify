"""SQLAlchemy repository for tenant-owned document state."""

import datetime
import json
import logging
import secrets
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal

import sqlalchemy as sa
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import delete, exists, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql import ColumnElement

from core.rag.entities import MetadataFilteringCondition
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums.knowledge import DocumentIndexRetryAction
from libs.datetime_utils import naive_utc_now
from libs.pagination import paginate_query
from models import Account
from models.dataset import (
    Dataset,
    DatasetAutoDisableLog,
    DatasetProcessRule,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    DocumentSegmentSummary,
    Pipeline,
    SegmentAttachmentBinding,
    build_built_in_field_values,
)
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, ProcessRuleMode, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import KnowledgeUploadFileReference, UploadFile
from models.source import DataSourceOauthBinding
from repositories.knowledge.dataset_read_repository import (
    get_dataset_doc_form,
    get_latest_dataset_process_rule,
    get_or_create_dataset_collection_binding,
)
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_query_repository import (
    apply_document_display_status_filter,
    get_document_segment_counts,
    get_documents_position,
    get_effective_document_indexing_states,
    load_document_details,
    project_current_document_index_states,
)
from repositories.knowledge.metadata_filter import process_metadata_filter_func
from repositories.knowledge.pipeline_query_repository import get_pipeline_dataset
from repositories.knowledge.rag_pipeline_repository import SQLAlchemyRagPipelineRepository
from repositories.knowledge.summary_checkpoints import (
    CurrentSummaryMaterialization,
    inherit_summary_checkpoints,
    summary_checkpoint_segment_ids,
    summary_content_fingerprint,
)
from repositories.knowledge.summary_repository import get_documents_summary_index_status
from repositories.knowledge.task_outbox_repository import (
    enqueue_knowledge_task,
    get_latest_document_index_state_tasks,
    guard_task_execution,
)
from repositories.knowledge.upload_file_repository import (
    SEGMENT_IMAGE_REFERENCE,
    build_document_cleanup_manifest,
    extract_document_source_file_ids,
    lock_upload_files_for_knowledge_reference,
    remove_document_upload_file_references,
    replace_document_upload_file_references,
)
from services.knowledge.document_sync import SyncDocumentRecord
from services.knowledge.documents.contracts import (
    DocumentCreationDataset,
    DocumentIndexingExecutionClaimLostError,
    DocumentListFilter,
    DocumentPersistenceArchivedError,
    DocumentPersistenceDatasetNotFoundError,
    DocumentPersistenceInvalidStateError,
    DocumentPersistenceNotFoundError,
    DocumentSourceFileNotFoundError,
    DocumentState,
    DocumentStatusAction,
    DocumentStatusMutation,
    DocumentSummaryConfiguration,
    DocumentWriteConfig,
    build_initial_retrieval_model,
    build_initialized_dataset_identity,
    build_notion_document_source,
    build_upload_document_source,
    build_website_document_source,
)
from services.knowledge.hit_testing.entities import RetrievalDocumentRecord
from services.knowledge.indexing.contracts import (
    DocumentIndexingExecution,
    EstimateDocumentRecord,
    IndexingDocument,
    StoredSource,
)
from services.knowledge.indexing.errors import (
    DocumentIndexingGenerationChangedError,
    DocumentIsDeletedPausedError,
    DocumentIsPausedError,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import (
    DocumentIndexStateAction,
    KnowledgeTaskKind,
    KnowledgeTaskStatus,
)

logger = logging.getLogger(__name__)

_MAPPING_ADAPTER = TypeAdapter(dict[str, object])

_DOCUMENT_INDEXING_TASK_KINDS = tuple(
    kind.value
    for kind in (
        KnowledgeTaskKind.DOCUMENT_INDEX_CREATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
        KnowledgeTaskKind.DOCUMENT_INDEX_UPDATE,
        KnowledgeTaskKind.DOCUMENT_INDEX_RECOVER,
        KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
    )
)
_BATCH_DOCUMENT_INDEXING_TASK_KINDS = frozenset(
    {
        KnowledgeTaskKind.DOCUMENT_INDEX_CREATE.value,
        KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE.value,
        KnowledgeTaskKind.DOCUMENT_INDEX_RETRY.value,
    }
)
_ACTIVE_KNOWLEDGE_TASK_STATUSES = frozenset(
    {
        KnowledgeTaskStatus.PENDING.value,
        KnowledgeTaskStatus.PROCESSING.value,
        KnowledgeTaskStatus.DISPATCHED.value,
        KnowledgeTaskStatus.EXECUTING.value,
    }
)


def _mapping(value: object) -> Mapping[str, object] | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            return _MAPPING_ADAPTER.validate_json(value)
        return _MAPPING_ADAPTER.validate_python(value)
    except (TypeError, ValueError, ValidationError):
        return {}


def _indexing_intent_matches_document_generation(
    *,
    kind: str,
    intent_document_id: str | None,
    payload: object,
    document_id: str,
    generation: str | None,
) -> bool:
    if not isinstance(payload, Mapping):
        return False
    if kind in _BATCH_DOCUMENT_INDEXING_TASK_KINDS:
        generations = payload.get("generations")
        return isinstance(generations, Mapping) and generations.get(document_id) == generation
    return (intent_document_id == document_id or payload.get("document_id") == document_id) and (
        payload.get("generation") == generation
    )


def _estimate_document_record(document: Document) -> EstimateDocumentRecord:
    return EstimateDocumentRecord(
        id=document.id,
        workspace_id=document.tenant_id,
        dataset_id=document.dataset_id,
        data_source_type=str(document.data_source_type),
        data_source_info=_mapping(document.data_source_info),
        indexing_status=str(document.indexing_status),
        doc_form=str(document.doc_form),
        doc_language=document.doc_language,
        dataset_process_rule_id=document.dataset_process_rule_id,
    )


def _document_state(
    document: Document, *, indexing_retry_action: DocumentIndexRetryAction | None = None
) -> DocumentState:
    return DocumentState(
        id=document.id,
        archived=bool(document.archived),
        indexing_status=str(document.indexing_status),
        is_paused=bool(document.is_paused),
        data_source_type=str(document.data_source_type),
        doc_form=str(document.doc_form),
        need_summary=bool(document.need_summary),
        enabled=bool(document.enabled),
        indexing_retry_action=indexing_retry_action,
    )


def _get_document(session: Session, document_ref: DocumentRef) -> Document | None:
    """Shared SQL for implementation adapters that already own a transaction."""
    return session.scalar(
        select(Document)
        .where(
            Document.id == document_ref.document_id,
            Document.dataset_id == document_ref.dataset.dataset_id,
            Document.tenant_id == document_ref.dataset.tenant_id,
        )
        .limit(1)
    )


def _lock_document(session: Session, ref: DocumentRef) -> Document | None:
    if lock_dataset_for_child_write(session, ref.dataset) is None:
        return None
    return session.scalar(
        select(Document)
        .where(
            Document.id == ref.document_id,
            Document.dataset_id == ref.dataset.dataset_id,
            Document.tenant_id == ref.dataset.tenant_id,
        )
        .order_by(Document.id.asc())
        .with_for_update(of=Document)
        .execution_options(populate_existing=True)
    )


def _lock_documents(session: Session, ref: DatasetRef, document_ids: Sequence[str]) -> list[Document]:
    if lock_dataset_for_child_write(session, ref) is None:
        return []
    unique_ids = tuple(sorted(set(document_ids)))
    if not unique_ids:
        return []
    return list(
        session.scalars(
            select(Document)
            .where(
                Document.id.in_(unique_ids),
                Document.dataset_id == ref.dataset_id,
                Document.tenant_id == ref.tenant_id,
            )
            .order_by(Document.id.asc())
            .with_for_update(of=Document)
            .execution_options(populate_existing=True)
        ).all()
    )


def _guard_pipeline_execution(
    session: Session,
    ref: DocumentRef,
    document: Document,
    execution: DocumentIndexingExecution,
) -> None:
    """Fence a pipeline write with its durable claim while the row is locked."""

    if not session.in_transaction():
        raise RuntimeError("Pipeline execution guard requires an active transaction")
    execution_id = execution.execution_id
    if execution_id is None:
        raise DocumentIndexingExecutionClaimLostError(
            f"Document {ref.document_id} has no durable indexing execution claim"
        )
    if document.indexing_generation != execution.expected_generation or document.indexing_execution_id != execution_id:
        raise DocumentIndexingExecutionClaimLostError(
            f"Document indexing execution claim is no longer owned: {ref.document_id}"
        )


def _summary_task_payload(dataset: Dataset, document: Document) -> dict[str, object]:
    return {
        "tenant_id": dataset.tenant_id,
        "dataset_id": dataset.id,
        "document_id": document.id,
        "expected_generation": document.indexing_generation,
        "segment_ids": None,
        "expected_indexing_technique": str(dataset.indexing_technique),
        "expected_embedding_model_provider": dataset.embedding_model_provider,
        "expected_embedding_model": dataset.embedding_model,
        "expected_summary_index_setting": (
            dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None
        ),
    }


def _enqueue_document_summary_index(
    session: Session,
    dataset: Dataset,
    document: Document,
    *,
    inherited_checkpoints: Mapping[str, object] | None = None,
    recovery_source_intent_id: str | None = None,
) -> None:
    payload = _summary_task_payload(dataset, document)
    if inherited_checkpoints:
        payload.update(inherited_checkpoints)
    if recovery_source_intent_id is not None:
        payload["recovery_source_intent_id"] = recovery_source_intent_id
    enqueue_knowledge_task(
        session,
        kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        payload=payload,
    )


def _ensure_document_summary_index(session: Session, dataset: Dataset, document: Document) -> bool:
    generation_expression = KnowledgeTaskOutbox.payload["expected_generation"].as_string()
    generation_condition = (
        generation_expression.is_(None)
        if document.indexing_generation is None
        else generation_expression == document.indexing_generation
    )
    existing = session.scalar(
        select(KnowledgeTaskOutbox.id)
        .where(
            KnowledgeTaskOutbox.tenant_id == dataset.tenant_id,
            KnowledgeTaskOutbox.dataset_id == dataset.id,
            KnowledgeTaskOutbox.document_id == document.id,
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX.value,
            generation_condition,
        )
        .limit(1)
    )
    if existing is not None:
        return False
    _enqueue_document_summary_index(session, dataset, document)
    return True


def _latest_document_summary_intent(
    session: Session,
    *,
    dataset: Dataset,
    document: Document,
    expected_generation: str | None,
) -> KnowledgeTaskOutbox | None:
    generation_expression = KnowledgeTaskOutbox.payload["expected_generation"].as_string()
    generation_condition = (
        generation_expression.is_(None) if expected_generation is None else generation_expression == expected_generation
    )
    return session.scalar(
        select(KnowledgeTaskOutbox)
        .where(
            KnowledgeTaskOutbox.tenant_id == dataset.tenant_id,
            KnowledgeTaskOutbox.dataset_id == dataset.id,
            KnowledgeTaskOutbox.document_id == document.id,
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX.value,
            generation_condition,
        )
        .order_by(KnowledgeTaskOutbox.created_at.desc(), KnowledgeTaskOutbox.id.desc())
        .limit(1)
    )


def _lock_summary_checkpoint_resources(
    session: Session,
    *,
    dataset: Dataset,
    document: Document,
    source_payload: Mapping[str, object],
) -> dict[str, CurrentSummaryMaterialization]:
    segment_ids = summary_checkpoint_segment_ids(source_payload)
    if not segment_ids:
        return {}
    segments = session.scalars(
        select(DocumentSegment)
        .where(
            DocumentSegment.tenant_id == dataset.tenant_id,
            DocumentSegment.dataset_id == dataset.id,
            DocumentSegment.document_id == document.id,
            DocumentSegment.id.in_(segment_ids),
            DocumentSegment.status == SegmentStatus.COMPLETED,
            DocumentSegment.enabled.is_(True),
        )
        .order_by(DocumentSegment.id)
        .with_for_update(of=DocumentSegment)
    ).all()
    summaries = {
        summary.chunk_id: summary
        for summary in session.scalars(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.dataset_id == dataset.id,
                DocumentSegmentSummary.document_id == document.id,
                DocumentSegmentSummary.chunk_id.in_(segment_ids),
            )
            .order_by(DocumentSegmentSummary.chunk_id)
            .with_for_update(of=DocumentSegmentSummary)
        ).all()
    }
    return {
        segment.id: CurrentSummaryMaterialization(
            document_id=document.id,
            document_generation=document.indexing_generation,
            segment_generation=segment.indexing_generation,
            summary_id=summaries[segment.id].id,
            summary_content_fingerprint=summary_content_fingerprint(summaries[segment.id].summary_content or ""),
            vector_node_id=summaries[segment.id].summary_index_node_id,
            vector_content_hash=summaries[segment.id].summary_index_node_hash,
            summary_status=str(summaries[segment.id].status),
            summary_enabled=summaries[segment.id].enabled,
        )
        for segment in segments
        if segment.id in summaries
    }


def _summary_required(dataset: Dataset, document: Document) -> bool:
    return bool(
        dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        and dataset.summary_index_setting
        and dataset.summary_index_setting.get("enable") is True
        and document.need_summary is True
        and document.enabled
        and not document.archived
        and not document.is_paused
        and document.doc_form != IndexStructureType.QA_INDEX
    )


def _guard_document_task_execution(session: Session, execution: DocumentIndexingExecution | None) -> None:
    if execution is None or (execution.task_intent_id is None and execution.task_execution_id is None):
        return
    if execution.task_intent_id is None or execution.task_execution_id is None:
        raise ValueError("Document indexing task execution claim is incomplete")
    guard_task_execution(
        session,
        intent_id=execution.task_intent_id,
        execution_id=execution.task_execution_id,
        now=naive_utc_now(),
    )


def _document_index_state_action(document: Document) -> DocumentIndexStateAction:
    if document.enabled and not document.archived:
        return DocumentIndexStateAction.ADD
    return DocumentIndexStateAction.REMOVE


def _assign_indexing_generation(document: Document, generation: str) -> None:
    document.indexing_generation = generation
    document.indexing_execution_id = None
    document.error = None


def _rotate_indexing_generation_preserving_pipeline_input(
    session: Session,
    document: Document,
    generation: str,
) -> None:
    """Rotate a command generation while carrying its exact pipeline input binding."""

    SQLAlchemyRagPipelineRepository.copy_document_pipeline_execution_binding(
        session,
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        source_generation=document.indexing_generation,
        target_generation=generation,
    )
    _assign_indexing_generation(document, generation)


def _failed_locked_document_index_state_requires_retry(
    session: Session,
    ref: DocumentRef,
    document: Document,
    *,
    expected_action: DocumentIndexStateAction,
) -> bool:
    generation = document.indexing_generation
    if generation is None or _document_index_state_action(document) != expected_action:
        return False
    latest_intent = get_latest_document_index_state_tasks(
        session,
        tenant_id=ref.dataset.tenant_id,
        dataset_id=ref.dataset.dataset_id,
        document_generations={ref.document_id: generation},
    ).get(ref.document_id)
    return bool(
        latest_intent is not None
        and latest_intent.status == KnowledgeTaskStatus.FAILED
        and latest_intent.action == expected_action
    )


def _indexing_status_values(document: Document, counts: tuple[int, int]) -> dict[str, Any]:
    return {
        "id": document.id,
        "processing_started_at": document.processing_started_at,
        "parsing_completed_at": document.parsing_completed_at,
        "cleaning_completed_at": document.cleaning_completed_at,
        "splitting_completed_at": document.splitting_completed_at,
        "completed_at": document.completed_at,
        "paused_at": document.paused_at,
        "error": document.error,
        "_processing_error": document.error,
        "stopped_at": document.stopped_at,
        "indexing_status": IndexingStatus.PAUSED if document.is_paused else document.indexing_status,
        "completed_segments": counts[0],
        "total_segments": counts[1],
    }


def require_indexing_document(session: Session, ref: DocumentRef, *, lock: bool = False) -> Document:
    """Validate the persisted owner chain before each indexing phase."""
    statement = (
        select(Document)
        .join(Dataset, Dataset.id == Document.dataset_id)
        .where(
            Document.id == ref.document_id,
            Document.dataset_id == ref.dataset.dataset_id,
            Document.tenant_id == ref.dataset.tenant_id,
            Dataset.tenant_id == ref.dataset.tenant_id,
        )
    )
    if lock:
        statement = statement.with_for_update(of=Document)
    document = session.scalar(statement)
    if document is None:
        raise DocumentIsDeletedPausedError()
    if document.is_paused:
        raise DocumentIsPausedError()
    return document


def require_owned_indexing_document(
    session: Session,
    ref: DocumentRef,
    *,
    execution: DocumentIndexingExecution | None,
    lock: bool = False,
) -> Document:
    """Load a document only while this delivery still owns its exact generation."""
    if execution is not None:
        execution.assert_owned()
    document = require_indexing_document(session, ref, lock=lock)
    if execution is not None and document.indexing_generation != execution.expected_generation:
        raise DocumentIndexingGenerationChangedError(ref.document_id)
    return document


def _complete_pipeline_indexing(
    session: Session,
    ref: DocumentRef,
    *,
    latency: float,
    need_summary: bool,
    execution: DocumentIndexingExecution,
) -> tuple[int, bool, Document]:
    """Stage one pipeline completion and its required summary intent atomically."""
    dataset = lock_dataset_for_child_write(session, ref.dataset)
    if dataset is None:
        raise DocumentIsDeletedPausedError()
    document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
    _guard_pipeline_execution(session, ref, document, execution)
    now = naive_utc_now()
    word_count = (
        session.scalar(
            select(sa.func.sum(DocumentSegment.word_count)).where(
                DocumentSegment.document_id == ref.document_id,
                DocumentSegment.dataset_id == ref.dataset.dataset_id,
                DocumentSegment.tenant_id == ref.dataset.tenant_id,
            )
        )
        or 0
    )
    document.indexing_latency = latency
    document.indexing_status = IndexingStatus.COMPLETED
    document.completed_at = now
    document.word_count = word_count
    document.need_summary = need_summary
    document.error = None
    session.execute(
        update(DocumentSegment)
        .where(
            DocumentSegment.document_id == ref.document_id,
            DocumentSegment.dataset_id == ref.dataset.dataset_id,
            DocumentSegment.tenant_id == ref.dataset.tenant_id,
        )
        .values(status=SegmentStatus.COMPLETED, enabled=True, completed_at=now)
    )
    summary_enqueued = bool(need_summary and _summary_required(dataset, document))
    if summary_enqueued:
        summary_enqueued = _ensure_document_summary_index(session, dataset, document)
    execution.assert_owned()
    session.flush()
    return word_count, summary_enqueued, document


def complete_document_index_add(
    session: Session,
    ref: DocumentRef,
    *,
    execution: DocumentIndexingExecution,
) -> None:
    """Commit the active generation's segment enablement in the caller's transaction."""
    if lock_dataset_for_child_write(session, ref.dataset) is None:
        raise DocumentIndexingGenerationChangedError(ref.document_id)
    document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
    if not document.enabled or document.archived or document.indexing_status != IndexingStatus.COMPLETED:
        raise DocumentIndexingGenerationChangedError(ref.document_id)
    session.execute(delete(DatasetAutoDisableLog).where(DatasetAutoDisableLog.document_id == ref.document_id))
    session.execute(
        update(DocumentSegment)
        .where(
            DocumentSegment.tenant_id == ref.dataset.tenant_id,
            DocumentSegment.dataset_id == ref.dataset.dataset_id,
            DocumentSegment.document_id == ref.document_id,
        )
        .values(enabled=True, disabled_at=None, disabled_by=None, updated_at=naive_utc_now())
    )
    execution.assert_owned()
    _guard_document_task_execution(session, execution)
    session.flush()


def complete_document_index_remove(
    session: Session,
    ref: DocumentRef,
    *,
    execution: DocumentIndexingExecution,
) -> None:
    """Commit the inactive generation's segment disablement in the caller's transaction."""
    if lock_dataset_for_child_write(session, ref.dataset) is None:
        raise DocumentIndexingGenerationChangedError(ref.document_id)
    document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
    if document.enabled and not document.archived:
        raise DocumentIndexingGenerationChangedError(ref.document_id)
    session.execute(
        update(DocumentSegment)
        .where(
            DocumentSegment.tenant_id == ref.dataset.tenant_id,
            DocumentSegment.dataset_id == ref.dataset.dataset_id,
            DocumentSegment.document_id == ref.document_id,
        )
        .values(
            enabled=False,
            disabled_at=naive_utc_now(),
            disabled_by=document.disabled_by,
            updated_at=naive_utc_now(),
        )
    )
    execution.assert_owned()
    _guard_document_task_execution(session, execution)
    session.flush()


def _check_doc_form(dataset: Dataset, doc_form: str, *, session: Session) -> None:
    current = get_dataset_doc_form(dataset, session=session)
    if current and current != doc_form:
        raise ValueError("doc_form is different from the dataset doc_form.")


def prepare_document_batch_cleanup(
    dataset_ref: DatasetRef,
    documents: Sequence[Document],
    doc_form: str | None,
    session: Session,
    *,
    wake_after_commit: Callable[[Session], None],
) -> bool:
    """Delete locked documents and persist their complete cleanup intent in one transaction."""
    deleted_document_ids = [document.id for document in documents]
    if not deleted_document_ids:
        return False
    file_ids = [
        file_id
        for document in documents
        for file_id in extract_document_source_file_ids(
            document.data_source_type,
            document.data_source_info_dict,
        )
    ]
    cleanup_manifest = build_document_cleanup_manifest(
        session,
        tenant_id=dataset_ref.tenant_id,
        dataset_id=dataset_ref.dataset_id,
        document_ids=deleted_document_ids,
        document_file_ids=file_ids,
    )
    cleanup_doc_form = doc_form or (str(documents[0].doc_form) if documents else None)

    # The document deletion and cleanup intent commit atomically. The worker
    # starts only from the post-commit outbox wakeup.
    remove_document_upload_file_references(
        session,
        tenant_id=dataset_ref.tenant_id,
        dataset_id=dataset_ref.dataset_id,
        document_ids=deleted_document_ids,
    )
    for document in documents:
        session.delete(document)
    if deleted_document_ids and cleanup_doc_form:
        enqueue_knowledge_task(
            session,
            kind="document_batch_cleanup",
            tenant_id=dataset_ref.tenant_id,
            dataset_id=dataset_ref.dataset_id,
            resource_id=dataset_ref.dataset_id,
            payload={
                "tenant_id": dataset_ref.tenant_id,
                "document_ids": deleted_document_ids,
                "dataset_id": dataset_ref.dataset_id,
                "doc_form": cleanup_doc_form,
                "file_ids": file_ids,
                "cleanup_manifest": cleanup_manifest.to_payload(),
            },
        )
        wake_after_commit(session)
        return True
    return False


def generate_document_batch() -> str:
    return time.strftime("%Y%m%d%H%M%S") + str(100000 + secrets.randbelow(exclusive_upper_bound=900000))


def build_document(
    dataset: Dataset,
    process_rule_id: str | None,
    data_source_type: str,
    document_form: str,
    document_language: str,
    data_source_info: dict[str, object],
    created_from: str,
    position: int,
    account: Account,
    name: str,
    batch: str,
):
    # Set need_summary based on dataset's summary_index_setting
    need_summary = False
    if dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True:
        need_summary = True

    document = Document(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=position,
        data_source_type=data_source_type,
        data_source_info=json.dumps(data_source_info),
        dataset_process_rule_id=process_rule_id,
        batch=batch,
        name=name,
        created_from=created_from,
        created_by=account.id,
        doc_form=document_form,
        doc_language=document_language,
        need_summary=need_summary,
        indexing_generation=str(uuid.uuid4()),
    )
    if dataset.built_in_field_enabled:
        now = naive_utc_now()
        document.doc_metadata = build_built_in_field_values(
            document_name=name,
            uploader=account.name,
            upload_date=now,
            last_update_date=now,
            data_source_type=data_source_type,
        )
    return document


def update_prepared_document(
    dataset: Dataset,
    document_data: DocumentWriteConfig,
    account: Account,
    dataset_process_rule: DatasetProcessRule | None = None,
    created_from: str = DocumentCreatedFrom.WEB,
    *,
    session: Session,
    wake_after_commit: Callable[[Session], None],
):
    assert isinstance(account, Account)

    locked_dataset = lock_dataset_for_child_write(session, DatasetRef(dataset.tenant_id, dataset.id))
    if locked_dataset is None:
        raise DocumentPersistenceDatasetNotFoundError()
    dataset = locked_dataset
    document = _get_document(
        session, DatasetRef(dataset.tenant_id, dataset.id).document(str(document_data.original_document_id))
    )
    if document is None:
        raise DocumentPersistenceNotFoundError("Document not found")
    if document.display_status != "available":
        raise ValueError("Document is not available")
    attachment_ids = sorted(
        set(
            session.scalars(
                select(SegmentAttachmentBinding.attachment_id).where(
                    SegmentAttachmentBinding.tenant_id == document.tenant_id,
                    SegmentAttachmentBinding.dataset_id == document.dataset_id,
                    SegmentAttachmentBinding.document_id == document.id,
                )
            ).all()
        )
        | set(
            session.scalars(
                select(KnowledgeUploadFileReference.upload_file_id).where(
                    KnowledgeUploadFileReference.tenant_id == document.tenant_id,
                    KnowledgeUploadFileReference.dataset_id == document.dataset_id,
                    KnowledgeUploadFileReference.document_id == document.id,
                    KnowledgeUploadFileReference.kind == SEGMENT_IMAGE_REFERENCE,
                )
            ).all()
        )
    )
    # save process rule
    if document_data.process_rule:
        process_rule = document_data.process_rule
        if process_rule.mode in {ProcessRuleMode.CUSTOM, ProcessRuleMode.HIERARCHICAL}:
            dataset_process_rule = DatasetProcessRule(
                dataset_id=dataset.id,
                mode=ProcessRuleMode(process_rule.mode),
                rules=process_rule.rules_json,
                created_by=account.id,
            )
        elif process_rule.mode == ProcessRuleMode.AUTOMATIC:
            dataset_process_rule = DatasetProcessRule(
                dataset_id=dataset.id,
                mode=ProcessRuleMode.AUTOMATIC,
                rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
                created_by=account.id,
            )
        if dataset_process_rule is not None:
            session.add(dataset_process_rule)
            session.flush()
            document.dataset_process_rule_id = dataset_process_rule.id
    # update document data source
    if document_data.data_source:
        source = document_data.data_source
        source_projection = None
        if source.data_source_type == "upload_file":
            if not source.file_ids:
                raise ValueError("No file info list found.")
            for file_id in source.file_ids:
                try:
                    file = lock_upload_files_for_knowledge_reference(
                        session,
                        tenant_id=dataset.tenant_id,
                        file_ids=(file_id,),
                    )[0]
                except ValueError as error:
                    if error.__class__.__name__ == "UploadFilePendingDeletionError":
                        raise
                    raise DocumentSourceFileNotFoundError() from error
                source_projection = build_upload_document_source(file_id=file_id, filename=file.name)
        elif source.data_source_type == "notion_import":
            if not source.notion_sources:
                raise ValueError("No notion info list found.")
            for notion_info in source.notion_sources:
                workspace_id = notion_info.workspace_id
                data_source_binding = session.scalar(
                    select(DataSourceOauthBinding)
                    .where(
                        sa.and_(
                            DataSourceOauthBinding.tenant_id == account.current_tenant_id,
                            DataSourceOauthBinding.provider == "notion",
                            DataSourceOauthBinding.disabled.is_(False),
                            DataSourceOauthBinding.source_info["workspace_id"] == f'"{workspace_id}"',
                        )
                    )
                    .limit(1)
                )
                if not data_source_binding:
                    raise ValueError("Data source binding not found.")
                for page in notion_info.pages:
                    source_projection = build_notion_document_source(notion_info, page)
        elif source.data_source_type == "website_crawl":
            website_info = source.website_source
            if website_info:
                for url in website_info.urls:
                    source_projection = build_website_document_source(website_info, url)
        if source_projection is not None:
            document.data_source_type = source_projection.data_source_type
            document.data_source_info = json.dumps(source_projection.data_source_info)
            document.name = source_projection.name

    # update document name
    if document_data.name:
        document.name = document_data.name
    # update document to be waiting
    document.indexing_status = IndexingStatus.WAITING
    _assign_indexing_generation(document, str(uuid.uuid4()))
    document.completed_at = None
    document.processing_started_at = None
    document.parsing_completed_at = None
    document.cleaning_completed_at = None
    document.splitting_completed_at = None
    document.updated_at = naive_utc_now()
    document.created_from = created_from
    document.doc_form = IndexStructureType(document_data.doc_form)
    session.add(document)
    session.flush()
    removed_source_files = replace_document_upload_file_references(
        session,
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        data_source_type=document.data_source_type,
        data_source_info=document.data_source_info_dict,
    )
    if removed_source_files:
        enqueue_knowledge_task(
            session,
            kind="file_cleanup",
            tenant_id=document.tenant_id,
            dataset_id=document.dataset_id,
            document_id=document.id,
            resource_id=document.id,
            payload={"file_ids": [file.id for file in removed_source_files]},
        )
    enqueue_knowledge_task(
        session,
        kind="document_index_update",
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        resource_id=document.id,
        payload={
            "dataset_id": document.dataset_id,
            "document_id": document.id,
            "generation": document.indexing_generation,
            "attachment_ids": attachment_ids,
        },
    )
    wake_after_commit(session)
    session.flush()
    # update document segment

    session.execute(
        update(DocumentSegment)
        .where(
            DocumentSegment.tenant_id == document.tenant_id,
            DocumentSegment.dataset_id == document.dataset_id,
            DocumentSegment.document_id == document.id,
        )
        .values(status=SegmentStatus.RE_SEGMENT)
    )
    session.flush()
    return document


def save_prepared_documents(
    dataset: Dataset,
    knowledge_config: DocumentWriteConfig,
    account: Account,
    dataset_process_rule: DatasetProcessRule | None = None,
    created_from: str = DocumentCreatedFrom.WEB,
    *,
    session: Session,
    priority: bool = True,
    wake_after_commit: Callable[[Session], None],
) -> tuple[list[Document], str]:
    """Persist prepared input without remote calls, Redis locks, or task dispatch.

    The caller must resolve quotas/models with prepare_document_creation and
    hold the dataset's creation lock for new documents. ORM values stay within
    this persistence adapter; durable task intents commit with the document rows.
    """
    if not knowledge_config.original_document_id and not knowledge_config.data_source:
        raise ValueError("Data source is required when creating new documents")
    locked_dataset = lock_dataset_for_child_write(session, DatasetRef(dataset.tenant_id, dataset.id))
    if locked_dataset is None:
        raise DocumentPersistenceDatasetNotFoundError()
    dataset = locked_dataset
    _check_doc_form(dataset, knowledge_config.doc_form, session=session)
    # if dataset is empty, update dataset data_source_type
    if not dataset.data_source_type and knowledge_config.data_source:
        dataset.data_source_type = knowledge_config.data_source.data_source_type

    if not dataset.indexing_technique:
        if knowledge_config.indexing_technique not in Dataset.INDEXING_TECHNIQUE_LIST:
            raise ValueError("Indexing technique is invalid")

        dataset.indexing_technique = IndexTechniqueType(knowledge_config.indexing_technique)
        if knowledge_config.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            assert knowledge_config.embedding_model
            assert knowledge_config.embedding_model_provider
            dataset_embedding_model = knowledge_config.embedding_model
            dataset_embedding_model_provider = knowledge_config.embedding_model_provider
            dataset.embedding_model = dataset_embedding_model
            dataset.embedding_model_provider = dataset_embedding_model_provider
            dataset_collection_binding = get_or_create_dataset_collection_binding(
                session,
                provider_name=dataset_embedding_model_provider,
                model_name=dataset_embedding_model,
            )
            dataset.collection_binding_id = dataset_collection_binding.id
            if not dataset.retrieval_model:
                dataset.retrieval_model = build_initial_retrieval_model(knowledge_config)

    documents: list[Document] = []
    file_cleanup_enqueued = False
    if knowledge_config.original_document_id:
        document = update_prepared_document(
            dataset,
            knowledge_config,
            account,
            session=session,
            wake_after_commit=wake_after_commit,
        )
        documents.append(document)
        batch = document.batch
    else:
        assert knowledge_config.data_source

        batch = generate_document_batch()
        # save process rule
        if not dataset_process_rule:
            process_rule = knowledge_config.process_rule
            if process_rule:
                if process_rule.mode in (ProcessRuleMode.CUSTOM, ProcessRuleMode.HIERARCHICAL):
                    if process_rule.rules_json:
                        dataset_process_rule = DatasetProcessRule(
                            dataset_id=dataset.id,
                            mode=ProcessRuleMode(process_rule.mode),
                            rules=process_rule.rules_json,
                            created_by=account.id,
                        )
                    else:
                        dataset_process_rule = get_latest_dataset_process_rule(dataset, session=session)
                        if not dataset_process_rule:
                            raise ValueError("No process rule found.")
                elif process_rule.mode == ProcessRuleMode.AUTOMATIC:
                    dataset_process_rule = DatasetProcessRule(
                        dataset_id=dataset.id,
                        mode=ProcessRuleMode.AUTOMATIC,
                        rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
                        created_by=account.id,
                    )
                else:
                    logger.warning(
                        "Invalid process rule mode: %s, can not find dataset process rule",
                        process_rule.mode,
                    )
                    return [], ""
                session.add(dataset_process_rule)
                session.flush()
            else:
                # Fallback when no process_rule provided in knowledge_config:
                # 1) reuse the dataset's latest process rule if present
                # 2) otherwise create an automatic rule
                dataset_process_rule = get_latest_dataset_process_rule(dataset, session=session)
                if not dataset_process_rule:
                    dataset_process_rule = DatasetProcessRule(
                        dataset_id=dataset.id,
                        mode=ProcessRuleMode.AUTOMATIC,
                        rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
                        created_by=account.id,
                    )
                    session.add(dataset_process_rule)
                    session.flush()
        assert dataset_process_rule
        position = get_documents_position(
            session,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
        )
        document_ids = []
        duplicate_document_ids = []
        if knowledge_config.data_source.data_source_type == "upload_file":
            if not knowledge_config.data_source.file_ids:
                raise ValueError("File source info is required")
            upload_file_list = knowledge_config.data_source.file_ids
            # Use a locking current read so MySQL REPEATABLE READ can see
            # uploads committed after an earlier consistent read. Keep the
            # dataset lifecycle lock until documents and references commit.
            try:
                files = list(
                    lock_upload_files_for_knowledge_reference(
                        session,
                        tenant_id=dataset.tenant_id,
                        file_ids=upload_file_list,
                    )
                )
            except ValueError as error:
                if error.__class__.__name__ == "UploadFilePendingDeletionError":
                    raise
                raise DocumentSourceFileNotFoundError("One or more files not found.") from error

            file_names = [file.name for file in files]
            db_documents = list(
                session.scalars(
                    select(Document).where(
                        Document.dataset_id == dataset.id,
                        Document.tenant_id == account.current_tenant_id,
                        Document.data_source_type == DataSourceType.UPLOAD_FILE,
                        Document.enabled.is_(True),
                        Document.name.in_(file_names),
                    )
                ).all()
            )
            documents_map = {document.name: document for document in db_documents}
            for file in files:
                source = build_upload_document_source(file_id=file.id, filename=file.name)
                document = documents_map.get(file.name)
                if knowledge_config.duplicate and document:
                    document.dataset_process_rule_id = dataset_process_rule.id
                    document.updated_at = naive_utc_now()
                    document.created_from = created_from
                    document.doc_form = IndexStructureType(knowledge_config.doc_form)
                    document.doc_language = knowledge_config.doc_language
                    document.data_source_info = json.dumps(source.data_source_info)
                    document.batch = batch
                    document.indexing_status = IndexingStatus.WAITING
                    _assign_indexing_generation(document, str(uuid.uuid4()))
                    session.add(document)
                    documents.append(document)
                    duplicate_document_ids.append(document.id)
                    continue
                else:
                    document = build_document(
                        dataset,
                        dataset_process_rule.id,
                        source.data_source_type,
                        knowledge_config.doc_form,
                        knowledge_config.doc_language,
                        source.data_source_info,
                        created_from,
                        position,
                        account,
                        source.name,
                        batch,
                    )
                    session.add(document)
                    session.flush()
                    document_ids.append(document.id)
                    documents.append(document)
                    position += 1
        elif knowledge_config.data_source.data_source_type == "notion_import":
            notion_info_list = knowledge_config.data_source.notion_sources
            if not notion_info_list:
                raise ValueError("No notion info list found.")
            exist_page_ids = []
            exist_document = {}
            documents = list(
                session.scalars(
                    select(Document)
                    .where(
                        Document.dataset_id == dataset.id,
                        Document.tenant_id == account.current_tenant_id,
                        Document.data_source_type == DataSourceType.NOTION_IMPORT,
                        Document.enabled.is_(True),
                    )
                    .order_by(Document.id.asc())
                    .with_for_update(of=Document)
                    .execution_options(populate_existing=True)
                ).all()
            )
            if documents:
                for document in documents:
                    data_source_info = json.loads(document.data_source_info)
                    exist_page_ids.append(data_source_info["notion_page_id"])
                    exist_document[data_source_info["notion_page_id"]] = document.id
            for notion_info in notion_info_list:
                for page in notion_info.pages:
                    if page.page_id not in exist_page_ids:
                        source = build_notion_document_source(notion_info, page)
                        document = build_document(
                            dataset,
                            dataset_process_rule.id,
                            source.data_source_type,
                            knowledge_config.doc_form,
                            knowledge_config.doc_language,
                            source.data_source_info,
                            created_from,
                            position,
                            account,
                            source.name,
                            batch,
                        )
                        document.id = str(uuid.uuid4())
                        session.add(document)
                        document_ids.append(document.id)
                        documents.append(document)
                        position += 1
                    else:
                        exist_document.pop(page.page_id)
            session.flush()
            # delete not selected documents
            if len(exist_document) > 0:
                removed_notion_id_set = set(exist_document.values())
                removed_documents = [document for document in documents if document.id in removed_notion_id_set]
                prepare_document_batch_cleanup(
                    DatasetRef(dataset.tenant_id, dataset.id),
                    removed_documents,
                    knowledge_config.doc_form,
                    session,
                    wake_after_commit=wake_after_commit,
                )
                documents = [document for document in documents if document.id not in removed_notion_id_set]
        elif knowledge_config.data_source.data_source_type == "website_crawl":
            website_info = knowledge_config.data_source.website_source
            if not website_info:
                raise ValueError("No website info list found.")
            urls = website_info.urls
            for url in urls:
                source = build_website_document_source(website_info, url)
                document = build_document(
                    dataset,
                    dataset_process_rule.id,
                    source.data_source_type,
                    knowledge_config.doc_form,
                    knowledge_config.doc_language,
                    source.data_source_info,
                    created_from,
                    position,
                    account,
                    source.name,
                    batch,
                )
                session.add(document)
                session.flush()
                document_ids.append(document.id)
                documents.append(document)
                position += 1
        session.flush()
        for document in documents:
            removed_files = replace_document_upload_file_references(
                session,
                tenant_id=document.tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                data_source_type=document.data_source_type,
                data_source_info=document.data_source_info_dict,
            )
            if removed_files:
                enqueue_knowledge_task(
                    session,
                    kind="file_cleanup",
                    tenant_id=document.tenant_id,
                    dataset_id=document.dataset_id,
                    document_id=document.id,
                    resource_id=document.id,
                    payload={"file_ids": [file.id for file in removed_files]},
                )
                file_cleanup_enqueued = True
        session.flush()

        if document_ids:
            created_generations = {
                document.id: document.indexing_generation
                for document in documents
                if document.id in document_ids and document.indexing_generation is not None
            }
            enqueue_knowledge_task(
                session,
                kind="document_index_create",
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                resource_id=dataset.id,
                payload={
                    "dataset_id": dataset.id,
                    "document_ids": document_ids,
                    "generations": created_generations,
                    "priority": priority,
                },
            )
        if duplicate_document_ids:
            duplicated_generations = {
                document.id: document.indexing_generation
                for document in documents
                if document.id in duplicate_document_ids and document.indexing_generation is not None
            }
            enqueue_knowledge_task(
                session,
                kind="document_index_duplicate",
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                resource_id=dataset.id,
                payload={
                    "dataset_id": dataset.id,
                    "document_ids": duplicate_document_ids,
                    "generations": duplicated_generations,
                    "priority": priority,
                },
            )
        if document_ids or duplicate_document_ids or file_cleanup_enqueued:
            wake_after_commit(session)
    return documents, batch


def build_dataset_for_documents(
    ref: DatasetRef, knowledge_config: DocumentWriteConfig, account: Account, session: Session
) -> Dataset:
    """Create a dataset inside the caller's SQL-only persistence phase."""
    assert knowledge_config.data_source
    dataset_collection_binding_id = None
    retrieval_model = None
    if knowledge_config.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
        assert knowledge_config.embedding_model_provider
        assert knowledge_config.embedding_model
        dataset_collection_binding = get_or_create_dataset_collection_binding(
            session,
            provider_name=knowledge_config.embedding_model_provider,
            model_name=knowledge_config.embedding_model,
        )
        dataset_collection_binding_id = dataset_collection_binding.id
    retrieval_model = build_initial_retrieval_model(knowledge_config)
    # save dataset
    dataset = Dataset(
        id=ref.dataset_id,
        tenant_id=ref.tenant_id,
        name="",
        data_source_type=knowledge_config.data_source.data_source_type,
        indexing_technique=IndexTechniqueType(knowledge_config.indexing_technique),
        created_by=account.id,
        maintainer=account.id,
        embedding_model=knowledge_config.embedding_model,
        embedding_model_provider=knowledge_config.embedding_model_provider,
        collection_binding_id=dataset_collection_binding_id,
        retrieval_model=retrieval_model,
        summary_index_setting=knowledge_config.summary_index_setting,
        is_multimodal=knowledge_config.is_multimodal,
    )

    session.add(dataset)
    session.flush()

    return dataset


def _require_dataset(session: Session, ref: DatasetRef) -> Dataset:
    dataset = session.scalar(
        select(Dataset).where(Dataset.id == ref.dataset_id, Dataset.tenant_id == ref.tenant_id).limit(1)
    )
    if dataset is None:
        raise DocumentPersistenceDatasetNotFoundError()
    return dataset


def _require_actor(session: Session, *, tenant_id: str, actor_id: str) -> Account:
    account = session.get(Account, actor_id)
    if account is None:
        raise DocumentPersistenceDatasetNotFoundError()
    account.set_tenant_id_with_session(tenant_id, session=session)
    return account


def _created_response(
    dataset: Dataset,
    documents: Sequence[Document],
    batch: str,
    session: Session,
) -> dict[str, Any]:
    return {
        "dataset": {
            "id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "permission": dataset.permission,
            "data_source_type": dataset.data_source_type,
            "indexing_technique": dataset.indexing_technique,
            "created_by": dataset.created_by,
            "created_at": dataset.created_at,
        },
        "documents": load_document_details(documents, session=session),
        "batch": batch,
    }


class SQLAlchemyDocumentRepository:
    """Own SQL access to documents through their complete owner chain."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        wake_after_commit: Callable[[Session], None] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._wake_after_commit = wake_after_commit or (lambda _session: None)

    def get_hit_testing_document_filter(self, ref: DatasetRef, conditions: dict[str, object]) -> list[str]:
        """Resolve manual metadata filters only within the active owned document set."""

        model = MetadataFilteringCondition.model_validate(conditions)
        filters: list[ColumnElement[bool]] = []
        for sequence, condition in enumerate(model.conditions or []):
            process_metadata_filter_func(
                sequence,
                condition.comparison_operator,
                condition.name,
                condition.value,
                filters,
            )
        statement = (
            select(Document.id)
            .join(Dataset, Dataset.id == Document.dataset_id)
            .where(
                Document.tenant_id == ref.tenant_id,
                Document.dataset_id == ref.dataset_id,
                Dataset.tenant_id == ref.tenant_id,
                Document.enabled.is_(True),
                Document.archived.is_(False),
                Document.indexing_status == IndexingStatus.COMPLETED,
            )
        )
        if filters:
            statement = statement.where(sa.and_(*filters) if model.logical_operator == "and" else sa.or_(*filters))
        with self._session_factory() as session:
            return list(session.scalars(statement))

    def get_retrieval_documents(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
    ) -> dict[str, RetrievalDocumentRecord]:
        """Load detached presentation values for current, enabled documents in one owned batch."""

        if not document_ids:
            return {}
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document)
                .join(Dataset, Dataset.id == Document.dataset_id)
                .where(
                    Document.id.in_(document_ids),
                    Document.dataset_id == ref.dataset_id,
                    Document.tenant_id == ref.tenant_id,
                    Dataset.tenant_id == ref.tenant_id,
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                    Document.indexing_status == IndexingStatus.COMPLETED,
                )
            )
            return {
                document.id: RetrievalDocumentRecord(
                    id=document.id,
                    doc_form=str(document.doc_form),
                    values={
                        "id": document.id,
                        "data_source_type": document.data_source_type,
                        "name": document.name,
                        "doc_type": document.doc_type,
                        "doc_metadata": document.doc_metadata,
                    },
                )
                for document in documents
            }

    def get_creation_dataset(
        self,
        ref: DatasetRef,
        *,
        actor_id: str,
        doc_form: str,
        indexing_technique: str | None,
    ) -> DocumentCreationDataset:
        with self._session_factory() as session:
            dataset = _require_dataset(session, ref)
            if not dataset.indexing_technique and not indexing_technique:
                raise ValueError("indexing_technique is required.")
            _require_actor(session, tenant_id=ref.tenant_id, actor_id=actor_id)
            _check_doc_form(dataset, doc_form, session=session)
            return DocumentCreationDataset(
                dataset.tenant_id,
                dataset.indexing_technique,
                dataset.embedding_model,
                dataset.embedding_model_provider,
            )

    def persist_creation(
        self,
        ref: DatasetRef,
        config: DocumentWriteConfig,
        *,
        actor_id: str,
        initialize: bool,
        created_from: DocumentCreatedFrom,
        priority: bool,
        initial_permission: str | None = None,
    ) -> dict[str, Any]:
        """Atomically persist document rows, source references, and durable task intents."""
        with self._session_factory() as session:
            account = _require_actor(session, tenant_id=ref.tenant_id, actor_id=actor_id)
            dataset = (
                build_dataset_for_documents(ref, config, account, session)
                if initialize
                else _require_dataset(session, ref)
            )
            documents, batch = save_prepared_documents(
                dataset,
                config,
                account,
                created_from=created_from,
                session=session,
                priority=priority,
                wake_after_commit=self._wake_after_commit,
            )
            if initialize:
                identity = build_initialized_dataset_identity(documents[0].name)
                dataset.name = identity.name
                dataset.description = identity.description
                if initial_permission is not None:
                    dataset.permission = initial_permission
                session.flush()
            result = _created_response(dataset, documents, batch, session)
            session.commit()
            return result

    def delete_document(self, ref: DocumentRef) -> bool:
        """Delete one document with its durable cleanup manifest in one transaction."""
        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                return False
            if document.archived:
                raise DocumentPersistenceArchivedError("Document is archived.")
            source_file_ids = extract_document_source_file_ids(
                document.data_source_type,
                document.data_source_info_dict,
            )
            cleanup_manifest = build_document_cleanup_manifest(
                session,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_ids=(ref.document_id,),
                document_file_ids=source_file_ids,
            )
            remove_document_upload_file_references(
                session,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_ids=(ref.document_id,),
            )
            session.delete(document)
            enqueue_knowledge_task(
                session,
                kind="document_cleanup",
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=ref.document_id,
                resource_id=ref.document_id,
                payload={
                    "tenant_id": ref.dataset.tenant_id,
                    "document_id": ref.document_id,
                    "dataset_id": ref.dataset.dataset_id,
                    "doc_form": str(document.doc_form),
                    "file_id": source_file_ids[0] if source_file_ids else None,
                    "cleanup_manifest": cleanup_manifest.to_payload(),
                },
            )
            self._wake_after_commit(session)
            session.commit()
            return True

    def delete_documents(self, ref: DatasetRef, document_ids: Sequence[str]) -> int:
        """Delete the requested owned documents and publish one durable batch cleanup."""
        with self._session_factory() as session:
            documents = _lock_documents(session, ref, document_ids)
            if not documents:
                return 0
            if any(document.archived for document in documents):
                raise DocumentPersistenceArchivedError("Archived documents cannot be deleted.")
            prepare_document_batch_cleanup(
                ref,
                documents,
                get_dataset_doc_form(_require_dataset(session, ref), session=session),
                session,
                wake_after_commit=self._wake_after_commit,
            )
            session.commit()
            return len(documents)

    def update_metadata(
        self,
        ref: DocumentRef,
        *,
        doc_type: str,
        doc_metadata: Mapping[str, object],
        updated_at: datetime.datetime,
    ) -> None:
        with self._session_factory.begin() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            document.doc_type = doc_type
            document.doc_metadata = dict(doc_metadata)
            document.updated_at = updated_at

    def rename_document(self, ref: DocumentRef, name: str) -> dict[str, Any]:
        with self._session_factory.begin() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            dataset = _require_dataset(session, ref.dataset)
            if dataset.built_in_field_enabled and document.doc_metadata:
                document.doc_metadata = {**document.doc_metadata, BuiltInField.document_name: name}
            document.name = name
            file_id = document.data_source_info_dict.get("upload_file_id")
            if isinstance(file_id, str):
                session.execute(
                    update(UploadFile)
                    .where(UploadFile.id == file_id, UploadFile.tenant_id == ref.dataset.tenant_id)
                    .values(name=name)
                )
            session.flush()
            return load_document_details((document,), session=session)[0]

    def pause_document(self, ref: DocumentRef, *, actor_id: str) -> None:
        with self._session_factory.begin() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if document.indexing_status not in {
                IndexingStatus.WAITING,
                IndexingStatus.PARSING,
                IndexingStatus.CLEANING,
                IndexingStatus.SPLITTING,
                IndexingStatus.INDEXING,
            }:
                raise DocumentPersistenceInvalidStateError("Cannot pause completed document.")
            document.is_paused = True
            document.paused_by = actor_id
            document.paused_at = naive_utc_now()

    def recover_document(self, ref: DocumentRef, *, generation: str) -> None:
        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if not document.is_paused:
                raise DocumentPersistenceInvalidStateError("Document is not in paused status.")
            document.is_paused = False
            document.paused_by = None
            document.paused_at = None
            _rotate_indexing_generation_preserving_pipeline_input(session, document, generation)
            enqueue_knowledge_task(
                session,
                kind="document_index_recover",
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=ref.document_id,
                resource_id=ref.document_id,
                payload={
                    "dataset_id": ref.dataset.dataset_id,
                    "document_id": ref.document_id,
                    "generation": generation,
                },
            )
            self._wake_after_commit(session)
            session.commit()

    def retry_documents(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        actor_id: str,
        generation: str,
        lock_tokens: Mapping[str, str],
    ) -> tuple[str, ...]:
        """Retry locked body-index failures and return only the documents actually enqueued."""

        with self._session_factory() as session:
            documents = _lock_documents(session, ref, document_ids)
            if not documents:
                return ()
            documents = [
                document
                for document in documents
                if document.enabled and not document.archived and document.indexing_status == IndexingStatus.ERROR
            ]
            if not documents:
                return ()
            retry_started_at = naive_utc_now()
            for document in documents:
                document.indexing_status = IndexingStatus.WAITING
                document.processing_started_at = retry_started_at
                _rotate_indexing_generation_preserving_pipeline_input(session, document, generation)
            ids = tuple(document.id for document in documents)
            enqueue_knowledge_task(
                session,
                kind="document_index_retry",
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                resource_id=ref.dataset_id,
                payload={
                    "tenant_id": ref.tenant_id,
                    "dataset_id": ref.dataset_id,
                    "document_ids": list(ids),
                    "actor_id": actor_id,
                    "lock_tokens": {document_id: lock_tokens[document_id] for document_id in ids},
                    "generations": dict.fromkeys(ids, generation),
                    "repair": False,
                },
            )
            self._wake_after_commit(session)
            session.commit()
            return ids

    def change_status(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        action: DocumentStatusAction,
        actor_id: str,
        generations: Mapping[str, str],
    ) -> DocumentStatusMutation:
        with self._session_factory() as session:
            documents = _lock_documents(session, ref, document_ids)
            now = naive_utc_now()
            indexing_ids: list[str] = []
            for document in documents:
                previous_index_action = _document_index_state_action(document)
                if action == "enable":
                    if not document.enabled:
                        document.enabled = True
                        document.disabled_at = None
                        document.disabled_by = None
                        document.updated_at = now
                elif action == "disable":
                    if not document.completed_at or document.indexing_status != IndexingStatus.COMPLETED:
                        raise DocumentPersistenceInvalidStateError(f"Document: {document.name} is not completed.")
                    if document.enabled:
                        document.enabled = False
                        document.disabled_at = now
                        document.disabled_by = actor_id
                        document.updated_at = now
                elif action == "archive":
                    if not document.archived:
                        document.archived = True
                        document.archived_at = now
                        document.archived_by = actor_id
                        document.updated_at = now
                elif action == "un_archive":
                    if document.archived:
                        document.archived = False
                        document.archived_at = None
                        document.archived_by = None
                        document.updated_at = now
                else:
                    raise DocumentPersistenceInvalidStateError(f"Invalid action: {action}")

                index_action = _document_index_state_action(document)
                desired_index_changed = index_action != previous_index_action
                retry_failed_intent = _failed_locked_document_index_state_requires_retry(
                    session,
                    ref.document(document.id),
                    document,
                    expected_action=index_action,
                )
                if not desired_index_changed and not retry_failed_intent:
                    continue
                generation = generations[document.id]
                _rotate_indexing_generation_preserving_pipeline_input(session, document, generation)
                enqueue_knowledge_task(
                    session,
                    kind="document_index_state",
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                    document_id=document.id,
                    resource_id=document.id,
                    payload={"document_id": document.id, "generation": generation, "action": index_action.value},
                )
                indexing_ids.append(document.id)
            if indexing_ids:
                self._wake_after_commit(session)
            session.commit()
            return DocumentStatusMutation(indexing_document_ids=tuple(indexing_ids))

    def prepare_pipeline_reindexing(self, session: Session, ref: DocumentRef) -> str:
        """Stage a new pipeline indexing generation under the document owner locks.

        The pipeline adapter owns the surrounding transaction because it also
        persists the workflow invocation. This repository still owns the
        Dataset -> Document lock order and the document state transition.
        """

        document = _lock_document(session, ref)
        if document is None:
            raise DocumentPersistenceNotFoundError("Pipeline document not found.")
        generation = str(uuid.uuid4())
        document.indexing_status = IndexingStatus.WAITING
        _assign_indexing_generation(document, generation)
        document.error = None
        return generation

    def claim_pipeline_indexing_execution(
        self,
        ref: DocumentRef,
        *,
        execution_id: str,
        expected_generation: str | None,
    ) -> bool:
        """Fence one live generation with the current acknowledged-queue receipt."""

        with self._session_factory() as session, session.begin():
            document = _lock_document(session, ref)
            if (
                document is None
                or document.indexing_generation != expected_generation
                or document.indexing_status == IndexingStatus.COMPLETED
                or not document.enabled
                or document.archived
                or document.is_paused
            ):
                return False
            document.indexing_execution_id = execution_id
            return True

    def assert_pipeline_indexing_execution(
        self,
        ref: DocumentRef,
        *,
        execution_id: str,
        expected_generation: str | None,
    ) -> None:
        """Current-read a durable pipeline claim outside a write phase."""

        with self._session_factory() as session:
            owned = session.scalar(
                select(Document.id)
                .where(
                    Document.id == ref.document_id,
                    Document.dataset_id == ref.dataset.dataset_id,
                    Document.tenant_id == ref.dataset.tenant_id,
                    Document.indexing_generation == expected_generation,
                    Document.indexing_execution_id == execution_id,
                    Document.indexing_status != IndexingStatus.COMPLETED,
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                    Document.is_paused.is_(False),
                )
                .limit(1)
            )
            if owned is None:
                raise DocumentIndexingExecutionClaimLostError(
                    f"Document indexing execution claim is no longer owned: {ref.document_id}"
                )

    def sync_website(self, ref: DocumentRef, *, generation: str) -> None:
        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if document.archived:
                raise DocumentPersistenceArchivedError("Document is archived.")
            if document.data_source_type != DataSourceType.WEBSITE_CRAWL:
                raise DocumentPersistenceInvalidStateError("Document is not a website document.")
            document.indexing_status = IndexingStatus.WAITING
            _assign_indexing_generation(document, generation)
            data_source_info = document.data_source_info_dict
            data_source_info["mode"] = "scrape"
            document.data_source_info = json.dumps(data_source_info, ensure_ascii=False)
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=ref.document_id,
                resource_id=ref.document_id,
                payload={
                    "dataset_id": ref.dataset.dataset_id,
                    "document_id": ref.document_id,
                    "generation": generation,
                    "source": "website",
                },
            )
            self._wake_after_commit(session)
            session.commit()

    def sync_notion(self, ref: DocumentRef, *, generation: str) -> None:
        """Persist one versioned Notion source refresh after locking its current state."""

        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if document.archived:
                raise DocumentPersistenceArchivedError("Document is archived.")
            if document.data_source_type != DataSourceType.NOTION_IMPORT:
                raise DocumentPersistenceInvalidStateError("Document is not a Notion document.")
            document.indexing_status = IndexingStatus.WAITING
            _assign_indexing_generation(document, generation)
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=ref.document_id,
                resource_id=ref.document_id,
                payload={
                    "dataset_id": ref.dataset.dataset_id,
                    "document_id": ref.document_id,
                    "generation": generation,
                    "source": "notion",
                },
            )
            self._wake_after_commit(session)
            session.commit()

    def convert_legacy_notion_sync_delivery(self, dataset_id: str, document_id: str) -> bool:
        """Replace one unversioned Notion sync unless current indexing already owns the generation."""

        with self._session_factory() as session, session.begin():
            owner = session.execute(
                select(Document.tenant_id, Document.dataset_id)
                .where(Document.id == document_id, Document.dataset_id == dataset_id)
                .limit(1)
            ).one_or_none()
            if owner is None:
                return False
            ref = DatasetRef(owner.tenant_id, owner.dataset_id).document(document_id)
            document = _lock_document(session, ref)
            if (
                document is None
                or document.archived
                or not document.enabled
                or document.is_paused
                or document.data_source_type != DataSourceType.NOTION_IMPORT
            ):
                return False
            generation = document.indexing_generation
            current_intents = session.execute(
                select(
                    KnowledgeTaskOutbox.task_kind,
                    KnowledgeTaskOutbox.document_id,
                    KnowledgeTaskOutbox.payload,
                ).where(
                    KnowledgeTaskOutbox.tenant_id == ref.dataset.tenant_id,
                    KnowledgeTaskOutbox.dataset_id == ref.dataset.dataset_id,
                    KnowledgeTaskOutbox.task_kind.in_(_DOCUMENT_INDEXING_TASK_KINDS),
                    KnowledgeTaskOutbox.status.in_(_ACTIVE_KNOWLEDGE_TASK_STATUSES),
                )
            ).all()
            if any(
                _indexing_intent_matches_document_generation(
                    kind=kind,
                    intent_document_id=intent_document_id,
                    payload=payload,
                    document_id=document.id,
                    generation=generation,
                )
                for kind, intent_document_id, payload in current_intents
            ):
                return False
            replacement_generation = str(uuid.uuid4())
            document.indexing_status = IndexingStatus.WAITING
            _assign_indexing_generation(document, replacement_generation)
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DOCUMENT_INDEX_SYNC,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=document.id,
                resource_id=document.id,
                payload={
                    "dataset_id": ref.dataset.dataset_id,
                    "document_id": document.id,
                    "generation": replacement_generation,
                    "source": "notion",
                },
            )
            self._wake_after_commit(session)
            return True

    def complete_unchanged_notion_sync(
        self,
        ref: DocumentRef,
        *,
        execution: DocumentIndexingExecution,
    ) -> None:
        """Complete an unchanged Notion generation without replacing indexed material."""

        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, ref.dataset)
            if dataset is None:
                raise DocumentIndexingGenerationChangedError(ref.document_id)
            document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
            if (
                document.data_source_type != DataSourceType.NOTION_IMPORT
                or document.archived
                or not document.enabled
                or document.is_paused
            ):
                raise DocumentIndexingGenerationChangedError(ref.document_id)
            document.indexing_status = IndexingStatus.COMPLETED
            document.completed_at = naive_utc_now()
            document.error = None
            execution.assert_owned()
            _guard_document_task_execution(session, execution)
            if _summary_required(dataset, document) and _ensure_document_summary_index(session, dataset, document):
                self._wake_after_commit(session)

    def enable_summary(self, ref: DatasetRef, document_ids: Sequence[str]) -> int:
        unique_ids = tuple(dict.fromkeys(document_ids))
        if not unique_ids:
            return 0
        with self._session_factory() as session:
            documents = [
                document
                for document in _lock_documents(session, ref, unique_ids)
                if document.doc_form != IndexStructureType.QA_INDEX
            ]
            dataset = session.scalar(
                select(Dataset)
                .where(Dataset.id == ref.dataset_id, Dataset.tenant_id == ref.tenant_id)
                .execution_options(populate_existing=True)
                .limit(1)
            )
            if dataset is None:
                return 0
            for document in documents:
                document.need_summary = True
                _enqueue_document_summary_index(session, dataset, document)
            if documents:
                self._wake_after_commit(session)
            session.commit()
            return len(documents)

    def enqueue_summary_indexes(
        self,
        ref: DatasetRef,
        expected_generations: Mapping[str, str | None],
        *,
        assert_owned: Callable[[], None] | None = None,
    ) -> int:
        """Persist eligible summary work for the exact completed document generations."""

        if not expected_generations:
            return 0
        with self._session_factory() as session:
            documents = _lock_documents(session, ref, tuple(expected_generations))
            dataset = session.scalar(
                select(Dataset)
                .where(Dataset.id == ref.dataset_id, Dataset.tenant_id == ref.tenant_id)
                .limit(1)
                .execution_options(populate_existing=True)
            )
            if (
                dataset is None
                or dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY
                or not dataset.summary_index_setting
                or not dataset.summary_index_setting.get("enable")
            ):
                return 0
            eligible_documents = [
                document
                for document in documents
                if document.indexing_generation == expected_generations[document.id]
                and document.indexing_status == IndexingStatus.COMPLETED
                and document.enabled
                and not document.archived
                and not document.is_paused
                and document.doc_form != IndexStructureType.QA_INDEX
                and document.need_summary is True
            ]
            if not eligible_documents:
                return 0
            if assert_owned is not None:
                assert_owned()
            enqueued = sum(
                _ensure_document_summary_index(session, dataset, document) for document in eligible_documents
            )
            if not enqueued:
                return 0
            self._wake_after_commit(session)
            if assert_owned is not None:
                assert_owned()
            session.commit()
            return enqueued

    def get_summary_configuration(self, ref: DatasetRef) -> DocumentSummaryConfiguration | None:
        with self._session_factory() as session:
            dataset = session.scalar(
                select(Dataset).where(Dataset.id == ref.dataset_id, Dataset.tenant_id == ref.tenant_id).limit(1)
            )
            if dataset is None:
                return None
            return DocumentSummaryConfiguration(
                indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique else None,
                enabled=bool(dataset.summary_index_setting and dataset.summary_index_setting.get("enable")),
            )

    def get_pipeline_dataset(self, pipeline: Pipeline, *, session: Session) -> Dataset | None:
        """Read within the pipeline caller's transaction, including uncommitted changes."""
        return get_pipeline_dataset(pipeline, session=session)

    def find_ref(self, *, workspace_id: str, document_id: str) -> DocumentRef | None:
        """Resolve a document to its complete tenant-owned reference."""
        with self._session_factory() as session:
            document = session.scalar(
                select(Document).where(Document.id == document_id, Document.tenant_id == workspace_id)
            )
            if document is None:
                return None
            return DatasetRef(workspace_id, document.dataset_id).document(document.id)

    def get_state(self, ref: DocumentRef) -> DocumentState | None:
        with self._session_factory() as session:
            document = _get_document(session, ref)
            if document is None:
                return None
            state = get_effective_document_indexing_states(
                session, tenant_id=ref.dataset.tenant_id, dataset_id=ref.dataset.dataset_id, documents=[document]
            )[document.id]
            return _document_state(document, indexing_retry_action=state.indexing_retry_action)

    def get_states(self, ref: DatasetRef, document_ids: Sequence[str]) -> tuple[DocumentState, ...]:
        unique_ids = tuple(dict.fromkeys(document_ids))
        if not unique_ids:
            return ()
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.id.in_(unique_ids),
                    Document.dataset_id == ref.dataset_id,
                    Document.tenant_id == ref.tenant_id,
                )
            ).all()
            states = get_effective_document_indexing_states(
                session, tenant_id=ref.tenant_id, dataset_id=ref.dataset_id, documents=documents
            )
            return tuple(
                _document_state(document, indexing_retry_action=states[document.id].indexing_retry_action)
                for document in documents
            )

    def list_documents(self, ref: DatasetRef, query: DocumentListFilter) -> dict[str, Any]:
        """Return a detached page with all document-owned read projections."""

        with self._session_factory() as session:
            dataset = _require_dataset(session, ref)
            statement = select(Document).where(
                Document.dataset_id == ref.dataset_id,
                Document.tenant_id == ref.tenant_id,
            )
            statement = apply_document_display_status_filter(statement, query.status)
            if query.search:
                statement = statement.where(Document.name.like(f"%{query.search}%"))
            direction = sa.desc if query.sort.startswith("-") else sa.asc
            sort = query.sort.removeprefix("-")
            if sort == "hit_count":
                hits = (
                    select(DocumentSegment.document_id, sa.func.sum(DocumentSegment.hit_count).label("total_hit_count"))
                    .where(
                        DocumentSegment.dataset_id == ref.dataset_id,
                        DocumentSegment.tenant_id == ref.tenant_id,
                    )
                    .group_by(DocumentSegment.document_id)
                    .subquery()
                )
                statement = statement.outerjoin(hits, hits.c.document_id == Document.id).order_by(
                    direction(sa.func.coalesce(hits.c.total_hit_count, 0)),
                    direction(Document.position),
                )
            elif sort == "created_at":
                statement = statement.order_by(direction(Document.created_at), direction(Document.position))
            else:
                statement = statement.order_by(sa.desc(Document.created_at), sa.desc(Document.position))
            page = paginate_query(statement, session=session, page=query.page, per_page=query.limit, max_per_page=100)
            documents = list(page.items)
            if query.fetch:
                counts = get_document_segment_counts(session, documents)
                for document in documents:
                    document.completed_segments, document.total_segments = counts.get(document.id, (0, 0))
            values = load_document_details(documents, session=session)
            summary_enabled = bool(
                dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True
            )
            summary_document_ids = [document.id for document in documents if document.need_summary is True]
            summary_statuses = (
                get_documents_summary_index_status(
                    session,
                    document_ids=summary_document_ids,
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                )
                if summary_enabled and summary_document_ids
                else {}
            )
            for value in values:
                document_id = str(value["id"])
                value["summary_index_status"] = (
                    summary_statuses.get(document_id) if summary_enabled and value.get("need_summary") is True else None
                )
            return {
                "data": values,
                "has_more": page.has_next,
                "limit": page.per_page,
                "total": page.total,
                "page": page.page,
            }

    def get_indexing_status(self, ref: DocumentRef) -> dict[str, Any]:
        with self._session_factory() as session:
            document = _get_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            counts = get_document_segment_counts(session, [document])
            value = _indexing_status_values(document, counts.get(document.id, (0, 0)))
            project_current_document_index_states(
                session,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                documents=[document],
                values=[value],
            )
            return value

    def get_batch_indexing_status(self, ref: DatasetRef, batch: str) -> dict[str, Any]:
        with self._session_factory() as session:
            documents = list(
                session.scalars(
                    select(Document).where(
                        Document.tenant_id == ref.tenant_id,
                        Document.dataset_id == ref.dataset_id,
                        Document.batch == batch,
                    )
                ).all()
            )
            if not documents:
                raise DocumentPersistenceNotFoundError("Documents not found.")
            counts = get_document_segment_counts(session, documents)
            values = [_indexing_status_values(document, counts.get(document.id, (0, 0))) for document in documents]
            project_current_document_index_states(
                session, tenant_id=ref.tenant_id, dataset_id=ref.dataset_id, documents=documents, values=values
            )
            return {"data": values}

    def get_execution_log(self, ref: DocumentRef) -> dict[str, Any]:
        with self._session_factory() as session:
            if _get_document(session, ref) is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            log = session.scalar(
                select(DocumentPipelineExecutionLog)
                .where(DocumentPipelineExecutionLog.document_id == ref.document_id)
                .order_by(DocumentPipelineExecutionLog.created_at.desc())
                .limit(1)
            )
            if log is None:
                return {}
            return {
                "datasource_info": json.loads(log.datasource_info),
                "datasource_type": log.datasource_type,
                "input_data": log.input_data,
                "datasource_node_id": log.datasource_node_id,
            }

    def get_upload_file_ids(self, dataset_ref: DatasetRef, document_ids: Sequence[str]) -> dict[str, str] | None:
        """Return upload ownership for a complete set of uploaded-file documents.

        ``None`` means at least one requested document is missing, belongs to a
        different owner, or is not backed by an upload file.
        """
        unique_ids = tuple(dict.fromkeys(document_ids))
        if not unique_ids:
            return {}
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.id.in_(unique_ids),
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.tenant_id == dataset_ref.tenant_id,
                )
            ).all()
        if len(documents) != len(unique_ids):
            return None
        result: dict[str, str] = {}
        for document in documents:
            if str(document.data_source_type) != "upload_file":
                return None
            upload_file_id = document.data_source_info_dict.get("upload_file_id")
            if not upload_file_id:
                return None
            result[document.id] = str(upload_file_id)
        return result

    def get_indexing_document(
        self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None
    ) -> IndexingDocument:
        with self._session_factory() as session:
            document = require_owned_indexing_document(session, ref, execution=execution)
            rule = session.scalar(
                select(DatasetProcessRule).where(
                    DatasetProcessRule.id == document.dataset_process_rule_id,
                    DatasetProcessRule.dataset_id == ref.dataset.dataset_id,
                )
            )
            return IndexingDocument(
                source=StoredSource.from_document(_estimate_document_record(document)),
                processing_rule=rule.to_dict() if rule else {},
                doc_language=document.doc_language or "English",
                need_summary=bool(document.need_summary),
                execution=execution,
            )

    def _assert_indexing_generation(
        self,
        ref: DocumentRef,
        expected_generation: str | None,
        *,
        desired_state: Literal["indexing", "add", "remove"],
    ) -> None:
        """Current-read one generation and its desired index state between external operations."""
        conditions = [
            Document.id == ref.document_id,
            Document.dataset_id == ref.dataset.dataset_id,
            Document.tenant_id == ref.dataset.tenant_id,
            Dataset.tenant_id == ref.dataset.tenant_id,
            Document.indexing_generation == expected_generation,
            Document.is_paused.is_(False),
        ]
        if desired_state == "remove":
            conditions.append(sa.or_(Document.enabled.is_(False), Document.archived.is_(True)))
        else:
            conditions.extend((Document.enabled.is_(True), Document.archived.is_(False)))
            if desired_state == "add":
                conditions.append(Document.indexing_status == IndexingStatus.COMPLETED)
        with self._session_factory() as session:
            current_id = session.scalar(
                select(Document.id).join(Dataset, Dataset.id == Document.dataset_id).where(*conditions).limit(1)
            )
        if current_id is None:
            raise DocumentIndexingGenerationChangedError(ref.document_id)

    def assert_indexing_generation(self, ref: DocumentRef, expected_generation: str | None) -> None:
        """Current-read the executable generation without retaining a session across external work."""
        self._assert_indexing_generation(ref, expected_generation, desired_state="indexing")

    def assert_document_index_state_generation(
        self,
        ref: DocumentRef,
        expected_generation: str | None,
        *,
        action: Literal["add", "remove"],
    ) -> None:
        """Require the exact generation and desired state for an index add/remove task."""
        self._assert_indexing_generation(ref, expected_generation, desired_state=action)

    def enqueue_current_indexing_repairs(
        self, ref: DatasetRef, document_ids: Sequence[str], *, actor_id: str | None = None
    ) -> bool:
        """Persist repairs after a stale worker touched an index.

        Incomplete indexing repairs retain the current generation so a recovered
        execution resumes the same user intent and keeps already persisted work.
        Completed add/remove repairs rotate the generation because they create a
        new corrective index-state intent.
        """
        unique_ids = tuple(dict.fromkeys(document_ids))
        if not unique_ids:
            return False
        with self._session_factory() as session, session.begin():
            dataset = lock_dataset_for_child_write(session, ref)
            if dataset is None:
                return False
            documents = tuple(
                session.scalars(
                    select(Document)
                    .where(
                        Document.tenant_id == ref.tenant_id,
                        Document.dataset_id == ref.dataset_id,
                        Document.id.in_(unique_ids),
                    )
                    .order_by(Document.id)
                    .with_for_update(of=Document)
                ).all()
            )
            for document in documents:
                if document.indexing_generation is None and not document.is_paused:
                    _rotate_indexing_generation_preserving_pipeline_input(session, document, str(uuid.uuid4()))
            retry_documents = tuple(
                document
                for document in documents
                if document.indexing_generation is not None
                and document.enabled
                and not document.archived
                and not document.is_paused
                and document.indexing_status != IndexingStatus.COMPLETED
            )
            generations = {document.id: document.indexing_generation for document in retry_documents}
            repair_ids = sorted(generations)
            enqueued = False
            if repair_ids:
                enqueue_knowledge_task(
                    session,
                    kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                    resource_id=ref.dataset_id,
                    payload={
                        "tenant_id": ref.tenant_id,
                        "dataset_id": ref.dataset_id,
                        "document_ids": repair_ids,
                        "actor_id": actor_id or retry_documents[0].created_by,
                        "lock_tokens": {},
                        "generations": generations,
                        "repair": True,
                    },
                )
                enqueued = True

            for document in documents:
                previous_generation = document.indexing_generation
                if previous_generation is None or document.is_paused:
                    continue
                if not document.enabled or document.archived:
                    action = "remove"
                elif document.indexing_status == IndexingStatus.COMPLETED:
                    action = "add"
                else:
                    continue
                checkpoint_source = (
                    _latest_document_summary_intent(
                        session,
                        dataset=dataset,
                        document=document,
                        expected_generation=previous_generation,
                    )
                    if action == "add" and _summary_required(dataset, document)
                    else None
                )
                successor_generation = str(uuid.uuid4())
                _rotate_indexing_generation_preserving_pipeline_input(session, document, successor_generation)
                enqueue_knowledge_task(
                    session,
                    kind=KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                    document_id=document.id,
                    resource_id=document.id,
                    payload={"document_id": document.id, "generation": successor_generation, "action": action},
                )
                if action == "add" and _summary_required(dataset, document):
                    checkpoint_source_payload = checkpoint_source.payload if checkpoint_source is not None else {}
                    current_materializations = _lock_summary_checkpoint_resources(
                        session,
                        dataset=dataset,
                        document=document,
                        source_payload=checkpoint_source_payload,
                    )
                    if checkpoint_source is not None:
                        locked_checkpoint_source = session.scalar(
                            select(KnowledgeTaskOutbox)
                            .where(KnowledgeTaskOutbox.id == checkpoint_source.id)
                            .with_for_update()
                            .limit(1)
                        )
                        checkpoint_source_payload = (
                            locked_checkpoint_source.payload if locked_checkpoint_source is not None else {}
                        )
                    inherited_checkpoints = inherit_summary_checkpoints(
                        checkpoint_source_payload,
                        expected_indexing_technique=str(dataset.indexing_technique),
                        expected_embedding_model_provider=dataset.embedding_model_provider,
                        expected_embedding_model=dataset.embedding_model,
                        expected_summary_index_setting=dataset.summary_index_setting,
                        document_generation_replacements={
                            document.id: (previous_generation, successor_generation),
                        },
                        current_materializations=current_materializations,
                    )
                    _enqueue_document_summary_index(
                        session,
                        dataset,
                        document,
                        inherited_checkpoints=inherited_checkpoints,
                    )
                enqueued = True

            if enqueued:
                self._wake_after_commit(session)
            return enqueued

    def enqueue_pipeline_payload_recovery(
        self,
        ref: DocumentRef,
        *,
        expected_generation: str,
        actor_id: str | None = None,
    ) -> bool:
        """Ensure durable retry work before an exhausted pipeline payload is discarded.

        A false result is a safe no-op: the manifest target is gone, has advanced,
        is no longer active and incomplete, or already has exact-generation repair
        work. Database failures still propagate so the caller retains its payload.
        """

        with self._session_factory() as session, session.begin():
            if lock_dataset_for_child_write(session, ref.dataset) is None:
                return False
            document = session.scalar(
                select(Document)
                .where(
                    Document.tenant_id == ref.dataset.tenant_id,
                    Document.dataset_id == ref.dataset.dataset_id,
                    Document.id == ref.document_id,
                )
                .with_for_update(of=Document)
                .execution_options(populate_existing=True)
                .limit(1)
            )
            if (
                document is None
                or document.indexing_generation != expected_generation
                or not document.enabled
                or document.archived
                or document.is_paused
                or document.indexing_status == IndexingStatus.COMPLETED
            ):
                return False

            covered_statuses = _ACTIVE_KNOWLEDGE_TASK_STATUSES | {KnowledgeTaskStatus.COMPLETED.value}
            existing_repairs = session.execute(
                select(KnowledgeTaskOutbox.document_id, KnowledgeTaskOutbox.payload).where(
                    KnowledgeTaskOutbox.tenant_id == ref.dataset.tenant_id,
                    KnowledgeTaskOutbox.dataset_id == ref.dataset.dataset_id,
                    KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_INDEX_RETRY.value,
                    KnowledgeTaskOutbox.status.in_(covered_statuses),
                )
            ).all()
            if any(
                isinstance(payload, Mapping)
                and payload.get("repair") is True
                and _indexing_intent_matches_document_generation(
                    kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY.value,
                    intent_document_id=intent_document_id,
                    payload=payload,
                    document_id=document.id,
                    generation=expected_generation,
                )
                for intent_document_id, payload in existing_repairs
            ):
                return False

            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                resource_id=ref.dataset.dataset_id,
                payload={
                    "tenant_id": ref.dataset.tenant_id,
                    "dataset_id": ref.dataset.dataset_id,
                    "document_ids": [document.id],
                    "actor_id": actor_id or document.created_by,
                    "lock_tokens": {},
                    "generations": {document.id: expected_generation},
                    "repair": True,
                },
            )
            self._wake_after_commit(session)
            return True

    def repair_completed_summary_intents(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        force_successor: bool = False,
        checkpoint_source_intent_id: str | None = None,
    ) -> int:
        """Backfill missing summary intents for completed documents without rerunning indexing."""

        unique_ids = tuple(dict.fromkeys(document_ids))
        if not unique_ids:
            return 0
        with self._session_factory() as session, session.begin():
            dataset = lock_dataset_for_child_write(session, ref)
            if (
                dataset is None
                or dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY
                or not dataset.summary_index_setting
                or dataset.summary_index_setting.get("enable") is not True
            ):
                return 0
            documents = _lock_documents(session, ref, unique_ids)
            repaired = 0
            for document in documents:
                if (
                    document.indexing_status != IndexingStatus.COMPLETED
                    or not document.enabled
                    or document.archived
                    or document.is_paused
                    or document.doc_form == IndexStructureType.QA_INDEX
                    or document.need_summary is not True
                ):
                    continue
                generation_expression = KnowledgeTaskOutbox.payload["expected_generation"].as_string()
                generation_condition = (
                    generation_expression.is_(None)
                    if document.indexing_generation is None
                    else generation_expression == document.indexing_generation
                )
                existing_statuses = set(
                    session.scalars(
                        select(KnowledgeTaskOutbox.status).where(
                            KnowledgeTaskOutbox.tenant_id == ref.tenant_id,
                            KnowledgeTaskOutbox.dataset_id == ref.dataset_id,
                            KnowledgeTaskOutbox.document_id == document.id,
                            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX.value,
                            generation_condition,
                        )
                    ).all()
                )
                if checkpoint_source_intent_id is not None:
                    recovery_successor = session.scalar(
                        select(KnowledgeTaskOutbox.id)
                        .where(
                            KnowledgeTaskOutbox.tenant_id == ref.tenant_id,
                            KnowledgeTaskOutbox.dataset_id == ref.dataset_id,
                            KnowledgeTaskOutbox.document_id == document.id,
                            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX.value,
                            generation_condition,
                            KnowledgeTaskOutbox.payload["recovery_source_intent_id"].as_string()
                            == checkpoint_source_intent_id,
                        )
                        .limit(1)
                    )
                    if recovery_successor is not None:
                        continue
                if (
                    existing_statuses
                    and not force_successor
                    and existing_statuses != {KnowledgeTaskStatus.FAILED.value}
                ):
                    continue
                if force_successor or not existing_statuses or existing_statuses == {KnowledgeTaskStatus.FAILED.value}:
                    inherited_checkpoints: Mapping[str, object] | None = None
                    if checkpoint_source_intent_id is not None:
                        checkpoint_source = session.scalar(
                            select(KnowledgeTaskOutbox)
                            .where(
                                KnowledgeTaskOutbox.id == checkpoint_source_intent_id,
                                KnowledgeTaskOutbox.tenant_id == ref.tenant_id,
                                KnowledgeTaskOutbox.dataset_id == ref.dataset_id,
                                KnowledgeTaskOutbox.document_id == document.id,
                                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX.value,
                                generation_condition,
                            )
                            .limit(1)
                        )
                        if checkpoint_source is not None:
                            current_materializations = _lock_summary_checkpoint_resources(
                                session,
                                dataset=dataset,
                                document=document,
                                source_payload=checkpoint_source.payload,
                            )
                            locked_checkpoint_source = session.scalar(
                                select(KnowledgeTaskOutbox)
                                .where(
                                    KnowledgeTaskOutbox.id == checkpoint_source.id,
                                    KnowledgeTaskOutbox.tenant_id == ref.tenant_id,
                                    KnowledgeTaskOutbox.dataset_id == ref.dataset_id,
                                    KnowledgeTaskOutbox.document_id == document.id,
                                    KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX.value,
                                    generation_condition,
                                )
                                .with_for_update()
                                .limit(1)
                            )
                            if locked_checkpoint_source is not None:
                                inherited_checkpoints = inherit_summary_checkpoints(
                                    locked_checkpoint_source.payload,
                                    expected_indexing_technique=str(dataset.indexing_technique),
                                    expected_embedding_model_provider=dataset.embedding_model_provider,
                                    expected_embedding_model=dataset.embedding_model,
                                    expected_summary_index_setting=dataset.summary_index_setting,
                                    document_generation_replacements={},
                                    current_materializations=current_materializations,
                                )
                    _enqueue_document_summary_index(
                        session,
                        dataset,
                        document,
                        inherited_checkpoints=inherited_checkpoints,
                        recovery_source_intent_id=checkpoint_source_intent_id,
                    )
                    repaired += 1
            if repaired:
                self._wake_after_commit(session)
            return repaired

    def convert_legacy_indexing_deliveries(
        self,
        dataset_id: str,
        document_ids: Sequence[str],
        *,
        actor_id: str | None = None,
    ) -> bool:
        """Convert unversioned indexing deliveries into one current recovery intent.

        The locked document state is authoritative.  Active incomplete documents
        retain their current generation and persisted segments; documents already
        covered by a non-failed exact-generation intent need no successor.
        """

        unique_ids = tuple(sorted(set(document_ids)))
        if not unique_ids:
            return False
        covered_statuses = _ACTIVE_KNOWLEDGE_TASK_STATUSES | {KnowledgeTaskStatus.COMPLETED.value}
        with self._session_factory() as session, session.begin():
            tenant_id = session.scalar(select(Dataset.tenant_id).where(Dataset.id == dataset_id).limit(1))
            if tenant_id is None:
                return False
            ref = DatasetRef(tenant_id, dataset_id)
            if lock_dataset_for_child_write(session, ref) is None:
                return False
            documents = tuple(
                session.scalars(
                    select(Document)
                    .where(
                        Document.tenant_id == tenant_id,
                        Document.dataset_id == dataset_id,
                        Document.id.in_(unique_ids),
                    )
                    .order_by(Document.id)
                    .with_for_update(of=Document)
                    .execution_options(populate_existing=True)
                ).all()
            )
            candidates = tuple(
                document
                for document in documents
                if document.enabled
                and not document.archived
                and not document.is_paused
                and document.indexing_status != IndexingStatus.COMPLETED
            )
            if not candidates:
                return False
            for document in candidates:
                if document.indexing_generation is None:
                    _rotate_indexing_generation_preserving_pipeline_input(session, document, str(uuid.uuid4()))

            existing_intents = session.execute(
                select(
                    KnowledgeTaskOutbox.task_kind,
                    KnowledgeTaskOutbox.document_id,
                    KnowledgeTaskOutbox.payload,
                    KnowledgeTaskOutbox.status,
                ).where(
                    KnowledgeTaskOutbox.tenant_id == tenant_id,
                    KnowledgeTaskOutbox.dataset_id == dataset_id,
                    KnowledgeTaskOutbox.task_kind.in_(_DOCUMENT_INDEXING_TASK_KINDS),
                )
            ).all()

            repair_documents: list[Document] = []
            for document in candidates:
                generation = document.indexing_generation
                covered = False
                for kind, intent_document_id, payload, status in existing_intents:
                    if status not in covered_statuses:
                        continue
                    if _indexing_intent_matches_document_generation(
                        kind=kind,
                        intent_document_id=intent_document_id,
                        payload=payload,
                        document_id=document.id,
                        generation=generation,
                    ):
                        covered = True
                        break
                if not covered:
                    repair_documents.append(document)

            if not repair_documents:
                return False
            generations = {document.id: document.indexing_generation for document in repair_documents}
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                resource_id=dataset_id,
                payload={
                    "tenant_id": tenant_id,
                    "dataset_id": dataset_id,
                    "document_ids": sorted(generations),
                    "actor_id": actor_id or repair_documents[0].created_by,
                    "lock_tokens": {},
                    "generations": generations,
                    "repair": True,
                },
            )
            self._wake_after_commit(session)
            return True

    def convert_legacy_index_state_delivery(self, document_id: str) -> bool:
        """Convert an unversioned add/remove delivery into current durable work.

        The legacy action is intentionally absent: current locked document state
        decides whether the index should contain the document.  This prevents a
        late remove from undoing a newer enable, and serializes duplicate legacy
        deliveries behind the Dataset -> Document lock order.
        """

        with self._session_factory() as session, session.begin():
            owner = session.execute(
                select(Document.tenant_id, Document.dataset_id).where(Document.id == document_id).limit(1)
            ).one_or_none()
            if owner is None:
                return False
            ref = DatasetRef(owner.tenant_id, owner.dataset_id).document(document_id)
            document = _lock_document(session, ref)
            if document is None or document.is_paused:
                return False

            active = document.enabled and not document.archived
            if active and document.indexing_status != IndexingStatus.COMPLETED:
                # Creation/reindex recovery owns incomplete documents.  An old
                # enable delivery must not bypass that generation's pipeline.
                return False
            action = _document_index_state_action(document)
            generation = document.indexing_generation
            current = (
                get_latest_document_index_state_tasks(
                    session,
                    tenant_id=ref.dataset.tenant_id,
                    dataset_id=ref.dataset.dataset_id,
                    document_generations={document.id: generation},
                ).get(document.id)
                if generation is not None
                else None
            )
            if current is not None and current.action is action and current.status is not KnowledgeTaskStatus.FAILED:
                return False

            generation = str(uuid.uuid4())
            _rotate_indexing_generation_preserving_pipeline_input(session, document, generation)
            enqueue_knowledge_task(
                session,
                kind=KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                document_id=document.id,
                resource_id=document.id,
                payload={"document_id": document.id, "generation": generation, "action": action.value},
            )
            self._wake_after_commit(session)
            return True

    def get_indexing_models(
        self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None
    ) -> tuple[Dataset, Document]:
        """Detached legacy processor inputs; never pass them to another thread."""
        with self._session_factory() as session:
            document = require_owned_indexing_document(session, ref, execution=execution)
            dataset = session.scalar(
                select(Dataset).where(
                    Dataset.id == ref.dataset.dataset_id,
                    Dataset.tenant_id == ref.dataset.tenant_id,
                )
            )
            assert dataset is not None
            return dataset, document

    def get_indexing_user(self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None) -> Account:
        with self._session_factory() as session:
            document = require_owned_indexing_document(session, ref, execution=execution)
            account = session.get(Account, document.created_by)
            if account is None:
                raise ValueError("no current user found")
            account.set_tenant_id_with_session(ref.dataset.tenant_id, session=session)
            return account

    def mark_splitting(self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None) -> None:
        with self._session_factory.begin() as session:
            if lock_dataset_for_child_write(session, ref.dataset) is None:
                raise DocumentIsDeletedPausedError()
            document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
            document.indexing_status = IndexingStatus.SPLITTING
            document.parsing_completed_at = naive_utc_now()
            if execution is not None:
                execution.assert_owned()
            _guard_document_task_execution(session, execution)

    def complete_indexing(
        self,
        ref: DocumentRef,
        *,
        tokens: int,
        latency: float,
        execution: DocumentIndexingExecution | None = None,
    ) -> None:
        with self._session_factory.begin() as session:
            dataset = lock_dataset_for_child_write(session, ref.dataset)
            if dataset is None:
                raise DocumentIsDeletedPausedError()
            document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
            document.indexing_status = IndexingStatus.COMPLETED
            document.tokens = tokens
            document.indexing_latency = latency
            document.completed_at = naive_utc_now()
            document.error = None
            if execution is not None:
                execution.assert_owned()
            _guard_document_task_execution(session, execution)
            if _summary_required(dataset, document) and _ensure_document_summary_index(session, dataset, document):
                self._wake_after_commit(session)

    def complete_pipeline_indexing(
        self,
        session: Session,
        ref: DocumentRef,
        *,
        latency: float,
        need_summary: bool,
        execution: DocumentIndexingExecution,
    ) -> int:
        """Commit exact-claim completion and required summary work atomically."""

        try:
            word_count, summary_enqueued, document = _complete_pipeline_indexing(
                session,
                ref,
                latency=latency,
                need_summary=need_summary,
                execution=execution,
            )
            execution.assert_owned()
            _guard_pipeline_execution(session, ref, document, execution)
            document.indexing_execution_id = None
            if summary_enqueued:
                self._wake_after_commit(session)
            session.commit()
        except Exception:
            session.rollback()
            raise
        return word_count

    def load_pipeline_indexing_context(
        self,
        session: Session,
        *,
        dataset_id: str,
        document_id: str,
        original_document_id: str,
        execution: DocumentIndexingExecution,
    ) -> tuple[Dataset, Document, tuple[str, ...]]:
        """Materialize the legacy processor's scoped ORM bridge in one owner.

        ``IndexProcessor`` still requires ORM models, so this is intentionally a
        local bridge for that processor rather than a general repository read.
        All SQL needed to scope the models and replacement segment IDs remains
        in the document aggregate repository.
        """

        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            raise DocumentPersistenceDatasetNotFoundError(f"Dataset {dataset_id} not found.")
        ref = DatasetRef(dataset.tenant_id, dataset.id).document(document_id)
        document = self.require_pipeline_indexing_document(session, ref, execution=execution)
        index_node_ids: tuple[str, ...] = ()
        if original_document_id:
            index_node_ids = tuple(
                node_id
                for node_id in session.scalars(
                    select(DocumentSegment.index_node_id).where(
                        DocumentSegment.document_id == original_document_id,
                        DocumentSegment.dataset_id == dataset.id,
                        DocumentSegment.tenant_id == dataset.tenant_id,
                    )
                ).all()
                if node_id
            )
        return dataset, document, index_node_ids

    def require_pipeline_indexing_document(
        self,
        session: Session,
        ref: DocumentRef,
        *,
        execution: DocumentIndexingExecution,
    ) -> Document:
        """Lock and return the exact document generation for a legacy processor phase."""

        execution.assert_owned()
        document = _lock_document(session, ref)
        if document is None:
            raise DocumentIsDeletedPausedError()
        if document.is_paused:
            raise DocumentIsPausedError()
        if document.indexing_generation != execution.expected_generation:
            raise DocumentIndexingGenerationChangedError(ref.document_id)
        _guard_pipeline_execution(session, ref, document, execution)
        return document

    def commit_pipeline_indexing_phase(
        self,
        session: Session,
        ref: DocumentRef,
        *,
        execution: DocumentIndexingExecution,
    ) -> None:
        """Fence and commit SQL staged by one pipeline processor phase."""

        self.commit_indexing_phase(session, ref, execution=execution)

    def commit_indexing_phase(
        self,
        session: Session,
        ref: DocumentRef,
        *,
        execution: DocumentIndexingExecution,
    ) -> None:
        """Fence and commit SQL staged by one unavoidable legacy processor phase."""

        try:
            if lock_dataset_for_child_write(session, ref.dataset) is None:
                raise DocumentIsDeletedPausedError()
            document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
            execution.assert_owned()
            if execution.execution_id is not None:
                _guard_pipeline_execution(session, ref, document, execution)
            _guard_document_task_execution(session, execution)
            session.commit()
        except Exception:
            session.rollback()
            raise

    def fail_indexing(
        self, ref: DocumentRef, error: str, *, execution: DocumentIndexingExecution | None = None
    ) -> None:
        try:
            with self._session_factory.begin() as session:
                if lock_dataset_for_child_write(session, ref.dataset) is None:
                    raise DocumentIsDeletedPausedError()
                document = require_owned_indexing_document(session, ref, execution=execution, lock=True)
                document.indexing_status = IndexingStatus.ERROR
                document.error = error
                document.stopped_at = naive_utc_now()
                if execution is not None:
                    execution.assert_owned()
                    if execution.execution_id is not None:
                        _guard_pipeline_execution(session, ref, document, execution)
                        document.indexing_execution_id = None
                _guard_document_task_execution(session, execution)
        except (DocumentIsDeletedPausedError, DocumentIndexingGenerationChangedError):
            return

    def exists(self, *, workspace_id: str, dataset_id: str, document_id: str) -> bool:
        with self._session_factory() as session:
            return bool(
                session.scalar(
                    select(
                        exists().where(
                            Document.tenant_id == workspace_id,
                            Document.dataset_id == dataset_id,
                            Document.id == document_id,
                        )
                    )
                )
            )

    def get_estimate_document(self, document_ref: DocumentRef) -> EstimateDocumentRecord | None:
        with self._session_factory() as session:
            document = _get_document(session, document_ref)
            return _estimate_document_record(document) if document is not None else None

    def list_estimate_documents_by_batch(
        self, dataset_ref: DatasetRef, batch: str
    ) -> tuple[EstimateDocumentRecord, ...]:
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.batch == batch,
                )
            ).all()
            return tuple(_estimate_document_record(document) for document in documents)

    def get_sync_document(self, document_ref: DocumentRef) -> SyncDocumentRecord | None:
        with self._session_factory() as session:
            document = _get_document(session, document_ref)
            if document is None:
                return None
            return SyncDocumentRecord(id=document.id, data_source_type=str(document.data_source_type))

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]:
        with self._session_factory() as session:
            return tuple(
                dataset_ref.document(document_id)
                for document_id in session.scalars(
                    select(Document.id).where(
                        Document.tenant_id == dataset_ref.tenant_id,
                        Document.dataset_id == dataset_ref.dataset_id,
                        Document.data_source_type == "notion_import",
                        Document.enabled.is_(True),
                        Document.archived.is_(False),
                    )
                ).all()
            )

    def list_bound_notion_page_ids(self, dataset_ref: DatasetRef) -> frozenset[str]:
        page_ids: set[str] = set()
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.data_source_type == "notion_import",
                    Document.enabled.is_(True),
                )
            ).all()
        for document in documents:
            source_info = _mapping(document.data_source_info)
            if source_info is None:
                continue
            page_id = source_info.get("notion_page_id")
            if isinstance(page_id, str) and page_id:
                page_ids.add(page_id)
        return frozenset(page_ids)
