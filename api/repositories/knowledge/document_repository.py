"""SQLAlchemy repository for tenant-owned document state."""

import datetime
import json
import logging
import secrets
import time
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

import sqlalchemy as sa
from pydantic import TypeAdapter
from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from libs.datetime_utils import naive_utc_now
from libs.pagination import paginate_query
from models import Account
from models.dataset import (
    Dataset,
    DatasetProcessRule,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    Pipeline,
    build_built_in_field_values,
)
from models.enums import (
    DataSourceType,
    DocumentCreatedFrom,
    DocumentDocType,
    IndexingStatus,
    ProcessRuleMode,
    SegmentStatus,
)
from models.model import UploadFile
from models.source import DataSourceOauthBinding
from repositories.file.upload_file_repository import (
    lock_and_validate_owned_upload_files_in_session,
)
from repositories.knowledge.dataset_read_repository import (
    get_dataset_creator,
    get_dataset_doc_form,
    get_latest_dataset_process_rule,
    get_or_create_dataset_collection_binding,
)
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_query_repository import (
    apply_document_display_status_filter,
    get_document_segment_counts,
    get_documents_position,
    load_document_read_projections,
)
from repositories.knowledge.metadata_filter import query_metadata_filter_document_ids
from repositories.knowledge.metadata_repository import (
    lock_metadata_dataset,
    lock_metadata_document,
    lock_metadata_document_bindings,
)
from repositories.knowledge.pipeline_query_repository import get_pipeline_dataset
from repositories.knowledge.summary_repository import get_documents_summary_index_status
from services.file_reference_parser import trusted_upload_file_ids
from services.knowledge.document_sync import SyncDocumentRecord
from services.knowledge.documents.contracts import (
    DocumentBatchCleanupJob,
    DocumentCleanupJob,
    DocumentCreationDataset,
    DocumentCreationProjection,
    DocumentDatasetProjection,
    DocumentIndexingJobs,
    DocumentListFilter,
    DocumentPageProjection,
    DocumentPersistenceArchivedError,
    DocumentPersistenceDatasetNotFoundError,
    DocumentPersistenceInvalidStateError,
    DocumentPersistenceNotFoundError,
    DocumentReadProjection,
    DocumentRetryBatch,
    DocumentSourceFileNotFoundError,
    DocumentState,
    DocumentStatusAction,
    DocumentStatusMutation,
    DocumentStatusRollback,
    DocumentSummaryConfiguration,
    DocumentWriteConfig,
    UnchangedNotionSyncOutcome,
    build_initial_retrieval_model,
    build_initialized_dataset_identity,
    build_notion_document_source,
    build_upload_document_source,
    build_website_document_source,
)
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.hit_testing.entities import RetrievalDocumentRecord
from services.knowledge.indexing.contracts import (
    EstimateDocumentRecord,
    IndexingDocument,
    StoredSource,
    pending_upload_cleanup_ids,
)
from services.knowledge.indexing.errors import (
    DocumentIsDeletedPausedError,
    DocumentIsPausedError,
)

logger = logging.getLogger(__name__)

_MAPPING_ADAPTER = TypeAdapter(dict[str, object])
_PENDING_NOTION_SOURCE_VERSION_KEY = "pending_last_edited_time"


@dataclass(frozen=True)
class _DocumentStatusSnapshot:
    enabled: bool
    disabled_at: datetime.datetime | None
    disabled_by: str | None
    archived: bool
    archived_at: datetime.datetime | None
    archived_by: str | None
    updated_at: datetime.datetime


def _status_snapshot(document: Document) -> _DocumentStatusSnapshot:
    return _DocumentStatusSnapshot(
        enabled=bool(document.enabled),
        disabled_at=document.disabled_at,
        disabled_by=document.disabled_by,
        archived=bool(document.archived),
        archived_at=document.archived_at,
        archived_by=document.archived_by,
        updated_at=document.updated_at,
    )


def _mapping(value: object) -> Mapping[str, object] | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            return _MAPPING_ADAPTER.validate_json(value)
        return _MAPPING_ADAPTER.validate_python(value)
    except (TypeError, ValueError):
        return {}


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


def _document_state(document: Document) -> DocumentState:
    return DocumentState(
        id=document.id,
        archived=bool(document.archived),
        indexing_status=str(document.indexing_status),
        is_paused=bool(document.is_paused),
        data_source_type=str(document.data_source_type),
        doc_form=str(document.doc_form),
        need_summary=bool(document.need_summary),
        enabled=bool(document.enabled),
        data_source_info=_mapping(document.data_source_info),
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


def _document_cleanup_file_ids(document: Document) -> tuple[str, ...]:
    source_info = document.data_source_info_dict
    file_ids = list(pending_upload_cleanup_ids(source_info))
    if str(document.data_source_type) == "upload_file":
        file_id = source_info.get("upload_file_id")
        if isinstance(file_id, str) and file_id:
            file_ids.append(file_id)
    return tuple(dict.fromkeys(file_ids))


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
    if document is None or not document.enabled or document.archived:
        raise DocumentIsDeletedPausedError()
    if document.is_paused:
        raise DocumentIsPausedError()
    return document


def _check_doc_form(dataset: Dataset, doc_form: str, *, session: Session) -> None:
    current = get_dataset_doc_form(dataset, session=session)
    if current and current != doc_form:
        raise ValueError("doc_form is different from the dataset doc_form.")


def prepare_document_batch_cleanup(
    dataset_ref: DatasetRef,
    documents: Sequence[Document],
    doc_form: str | None,
    session: Session,
) -> DocumentBatchCleanupJob | None:
    """Stage locked deletions and snapshot cleanup arguments before the caller commits."""
    deleted_document_ids = [document.id for document in documents]
    if not deleted_document_ids:
        return None
    file_ids = [file_id for document in documents for file_id in _document_cleanup_file_ids(document)]
    cleanup_doc_form = doc_form or (str(documents[0].doc_form) if documents else None)
    for document in documents:
        session.delete(document)
    if deleted_document_ids and cleanup_doc_form:
        return DocumentBatchCleanupJob(
            document_ids=tuple(deleted_document_ids),
            dataset_id=dataset_ref.dataset_id,
            doc_form=cleanup_doc_form,
            file_ids=tuple(file_ids),
        )
    return None


def generate_document_batch() -> str:
    return time.strftime("%Y%m%d%H%M%S") + str(100000 + secrets.randbelow(exclusive_upper_bound=900000))


def build_document(
    dataset: Dataset,
    process_rule_id: str | None,
    data_source_type: str,
    document_form: str,
    document_language: str,
    data_source_info: dict[str, object],
    created_from: DocumentCreatedFrom,
    position: int,
    account: Account,
    name: str,
    batch: str,
) -> Document:
    # Set need_summary based on dataset's summary_index_setting
    need_summary = False
    if dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True:
        need_summary = True

    document = Document(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=position,
        data_source_type=DataSourceType(data_source_type),
        data_source_info=json.dumps(data_source_info),
        dataset_process_rule_id=process_rule_id,
        batch=batch,
        name=name,
        created_from=created_from,
        created_by=account.id,
        doc_form=IndexStructureType(document_form),
        doc_language=document_language,
        need_summary=need_summary,
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
    created_from: DocumentCreatedFrom = DocumentCreatedFrom.WEB,
    *,
    session: Session,
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
                    file = lock_and_validate_owned_upload_files_in_session(
                        session,
                        tenant_id=dataset.tenant_id,
                        upload_file_ids=(file_id,),
                    )[file_id]
                except ValueError as error:
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
                if not website_info.provider_instance_id.strip():
                    raise ValueError("Website source provider instance is required.")
                for url in website_info.urls:
                    source_projection = build_website_document_source(website_info, url)
        if source_projection is not None:
            document.data_source_type = DataSourceType(source_projection.data_source_type)
            document.data_source_info = json.dumps(source_projection.data_source_info)
            document.name = source_projection.name

    # update document name
    if document_data.name:
        document.name = document_data.name
    # update document to be waiting
    document.indexing_status = IndexingStatus.WAITING
    document.error = None
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
    created_from: DocumentCreatedFrom = DocumentCreatedFrom.WEB,
    *,
    session: Session,
) -> tuple[list[Document], str, DocumentIndexingJobs]:
    """Persist prepared input without remote calls, Redis locks, or task dispatch.

    The caller must resolve quotas/models with prepare_document_creation and
    hold the dataset's creation lock for new documents. ORM values stay within
    this persistence adapter; the caller publishes returned jobs after commit.
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
    jobs = DocumentIndexingJobs(DatasetRef(dataset.tenant_id, dataset.id))
    if knowledge_config.original_document_id:
        document = update_prepared_document(
            dataset,
            knowledge_config,
            account,
            session=session,
        )
        documents.append(document)
        batch = document.batch
        jobs = DocumentIndexingJobs(DatasetRef(dataset.tenant_id, dataset.id), updated=document.id)
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
                    return [], "", jobs
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
        removed_notion_cleanup: DocumentBatchCleanupJob | None = None
        if knowledge_config.data_source.data_source_type == "upload_file":
            if not knowledge_config.data_source.file_ids:
                raise ValueError("File source info is required")
            upload_file_list = knowledge_config.data_source.file_ids
            if any(not file_id for file_id in upload_file_list):
                raise DocumentSourceFileNotFoundError("One or more files not found.")
            # Use a locking current read so MySQL REPEATABLE READ can see
            # uploads committed after an earlier consistent read. Keep the
            # dataset lifecycle lock until documents and references commit.
            try:
                files = list(
                    lock_and_validate_owned_upload_files_in_session(
                        session,
                        tenant_id=dataset.tenant_id,
                        upload_file_ids=upload_file_list,
                    ).values()
                )
            except ValueError as error:
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
                    document.error = None
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
                    data_source_info = document.data_source_info_dict
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
                removed_notion_cleanup = prepare_document_batch_cleanup(
                    DatasetRef(dataset.tenant_id, dataset.id),
                    removed_documents,
                    knowledge_config.doc_form,
                    session,
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
        jobs = DocumentIndexingJobs(
            dataset=DatasetRef(dataset.tenant_id, dataset.id),
            created=tuple(document_ids),
            duplicated=tuple(duplicate_document_ids),
            removed_notion_cleanup=removed_notion_cleanup,
        )
    return documents, batch, jobs


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
) -> DocumentCreationProjection:
    return DocumentCreationProjection(
        dataset=DocumentDatasetProjection(
            id=dataset.id,
            name=dataset.name,
            description=dataset.description,
            permission=dataset.permission,
            data_source_type=dataset.data_source_type,
            indexing_technique=dataset.indexing_technique,
            created_by=dataset.created_by,
            created_at=dataset.created_at,
        ),
        documents=load_document_read_projections(documents, session=session),
        batch=batch,
    )


class SQLAlchemyDocumentRepository:
    """Own SQL access to documents through their complete owner chain."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
    ) -> None:
        self._session_factory = session_factory

    def get_hit_testing_document_filter(self, ref: DatasetRef, conditions: dict[str, object]) -> list[str]:
        """Resolve manual metadata filters only within the active owned document set."""

        model = MetadataFilteringCondition.model_validate(conditions)
        with self._session_factory() as session:
            return query_metadata_filter_document_ids(
                session,
                tenant_id=ref.tenant_id,
                dataset_ids=(ref.dataset_id,),
                logical_operator=model.logical_operator,
                conditions=model.conditions,
            ).get(ref.dataset_id, [])

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
            _require_actor(session, tenant_id=ref.tenant_id, actor_id=actor_id)
            _check_doc_form(dataset, doc_form, session=session)
            return DocumentCreationDataset(
                dataset.tenant_id,
                dataset.indexing_technique,
                dataset.embedding_model,
                dataset.embedding_model_provider,
            )

    def resolve_file_document_actor(self, ref: DatasetRef, *, fallback_actor_id: str) -> str:
        """Use the dataset creator while they remain a member; otherwise retain the admitted actor."""
        with self._session_factory() as session:
            dataset = _require_dataset(session, ref)
            creator = get_dataset_creator(dataset, session=session)
            if creator is not None:
                creator.set_tenant_id_with_session(ref.tenant_id, session=session)
                if creator.current_tenant_id == ref.tenant_id:
                    return creator.id
            fallback = _require_actor(session, tenant_id=ref.tenant_id, actor_id=fallback_actor_id)
            if fallback.current_tenant_id != ref.tenant_id:
                raise DocumentPersistenceDatasetNotFoundError()
            return fallback.id

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
    ) -> tuple[DocumentCreationProjection, DocumentIndexingJobs]:
        """Persist document rows and return work that may be published after commit."""
        with self._session_factory() as session:
            account = _require_actor(session, tenant_id=ref.tenant_id, actor_id=actor_id)
            dataset = (
                build_dataset_for_documents(ref, config, account, session)
                if initialize
                else _require_dataset(session, ref)
            )
            documents, batch, jobs = save_prepared_documents(
                dataset,
                config,
                account,
                created_from=created_from,
                session=session,
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
            return result, jobs

    def delete_document(self, ref: DocumentRef) -> DocumentCleanupJob | DocumentBatchCleanupJob | None:
        """Remove the owned document row and return post-commit cleanup inputs."""
        with self._session_factory.begin() as session:
            document = _lock_document(session, ref)
            if document is None:
                return None
            file_ids = _document_cleanup_file_ids(document)
            if pending_upload_cleanup_ids(document.data_source_info_dict) or len(file_ids) > 1:
                cleanup = prepare_document_batch_cleanup(
                    ref.dataset,
                    (document,),
                    str(document.doc_form),
                    session,
                )
            else:
                cleanup = DocumentCleanupJob(
                    document_id=ref.document_id,
                    dataset_id=ref.dataset.dataset_id,
                    doc_form=str(document.doc_form),
                    file_id=file_ids[0] if file_ids else None,
                )
                session.delete(document)
            return cleanup

    def delete_documents(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
    ) -> DocumentBatchCleanupJob | None:
        """Remove the owned documents and return post-commit cleanup inputs."""
        with self._session_factory.begin() as session:
            documents = _lock_documents(session, ref, document_ids)
            if not documents:
                return None
            cleanup = prepare_document_batch_cleanup(
                ref,
                documents,
                get_dataset_doc_form(_require_dataset(session, ref), session=session),
                session,
            )
            return cleanup

    def update_metadata(
        self,
        ref: DocumentRef,
        *,
        doc_type: str,
        doc_metadata: Mapping[str, object],
        updated_at: datetime.datetime,
    ) -> None:
        with self._session_factory.begin() as session:
            dataset = lock_metadata_dataset(session, ref.dataset)
            if dataset is None:
                raise DocumentPersistenceDatasetNotFoundError("Dataset not found.")
            document = lock_metadata_document(session, ref.dataset, ref.document_id)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            current = dict(document.doc_metadata or {})
            bound = lock_metadata_document_bindings(session, ref.dataset, ref.document_id)
            custom_values = {field.name: current[field.name] for _binding, field in bound if field.name in current}
            values = dict(doc_metadata)
            for field in BuiltInField:
                values.pop(field.value, None)
            if dataset.built_in_field_enabled:
                values.update({field.value: current[field.value] for field in BuiltInField if field.value in current})
            values.update(custom_values)
            document.doc_type = DocumentDocType(doc_type)
            document.doc_metadata = values
            document.updated_at = updated_at

    def rename_document(self, ref: DocumentRef, name: str) -> DocumentReadProjection:
        with self._session_factory.begin() as session:
            dataset = lock_metadata_dataset(session, ref.dataset)
            if dataset is None:
                raise DocumentPersistenceDatasetNotFoundError("Dataset not found.")
            document = lock_metadata_document(session, ref.dataset, ref.document_id)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if dataset.built_in_field_enabled:
                document.doc_metadata = {
                    **(document.doc_metadata or {}),
                    BuiltInField.document_name.value: name,
                }
            document.name = name
            file_id = document.data_source_info_dict.get("upload_file_id")
            if isinstance(file_id, str):
                session.execute(
                    update(UploadFile)
                    .where(UploadFile.id == file_id, UploadFile.tenant_id == ref.dataset.tenant_id)
                    .values(name=name)
                )
            session.flush()
            return load_document_read_projections((document,), session=session)[0]

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

    def recover_document(self, ref: DocumentRef) -> None:
        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if not document.is_paused:
                raise DocumentPersistenceInvalidStateError("Document is not in paused status.")
            document.is_paused = False
            document.paused_by = None
            document.paused_at = None
            session.commit()

    def retry_documents(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        actor_id: str,
    ) -> DocumentRetryBatch | None:
        """Retry locked body-index failures and return only the documents actually enqueued."""

        with self._session_factory() as session:
            documents = _lock_documents(session, ref, document_ids)
            if not documents:
                return None
            documents = [
                document
                for document in documents
                if not document.archived and document.indexing_status == IndexingStatus.ERROR
            ]
            if not documents:
                return None
            retry_started_at = naive_utc_now()
            for document in documents:
                document.indexing_status = IndexingStatus.WAITING
                document.processing_started_at = retry_started_at
                document.error = None
                document.enabled = True
                document.disabled_at = None
                document.disabled_by = None
            ids = tuple(document.id for document in documents)
            session.commit()
            return DocumentRetryBatch(ids, retry_started_at)

    def fail_retry_dispatch(self, ref: DatasetRef, batch: DocumentRetryBatch) -> None:
        """Fail only the retry generation whose broker dispatch was not confirmed."""

        with self._session_factory() as session:
            documents = _lock_documents(session, ref, batch.document_ids)
            stopped_at = naive_utc_now()
            for document in documents:
                if (
                    document.indexing_status == IndexingStatus.WAITING
                    and document.processing_started_at == batch.started_at
                ):
                    document.indexing_status = IndexingStatus.ERROR
                    document.error = "Document retry could not be queued."
                    document.stopped_at = stopped_at
            session.commit()

    def change_status(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        action: DocumentStatusAction,
        actor_id: str,
    ) -> DocumentStatusMutation:
        with self._session_factory() as session:
            documents = _lock_documents(session, ref, document_ids)
            now = naive_utc_now()
            indexing_ids: list[str] = []
            previous_by_id: dict[str, _DocumentStatusSnapshot] = {}
            for document in documents:
                previous = _status_snapshot(document)
                was_active = bool(document.enabled and not document.archived)
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

                is_active = bool(document.enabled and not document.archived)
                if is_active != was_active:
                    indexing_ids.append(document.id)
                    previous_by_id[document.id] = previous
            session.flush()
            rollbacks: list[DocumentStatusRollback] = []
            for document in documents:
                previous = previous_by_id.get(document.id)
                if previous is None:
                    continue
                session.refresh(
                    document,
                    attribute_names=[
                        "enabled",
                        "disabled_at",
                        "disabled_by",
                        "archived",
                        "archived_at",
                        "archived_by",
                        "updated_at",
                    ],
                )
                applied = _status_snapshot(document)
                rollbacks.append(
                    DocumentStatusRollback(
                        document_id=document.id,
                        applied_updated_at=applied.updated_at,
                        applied_enabled=applied.enabled,
                        applied_disabled_at=applied.disabled_at,
                        applied_disabled_by=applied.disabled_by,
                        applied_archived=applied.archived,
                        applied_archived_at=applied.archived_at,
                        applied_archived_by=applied.archived_by,
                        enabled=previous.enabled,
                        disabled_at=previous.disabled_at,
                        disabled_by=previous.disabled_by,
                        archived=previous.archived,
                        archived_at=previous.archived_at,
                        archived_by=previous.archived_by,
                        updated_at=previous.updated_at,
                    )
                )
            session.commit()
            return DocumentStatusMutation(
                indexing_document_ids=tuple(indexing_ids),
                rollbacks=tuple(rollbacks),
            )

    def rollback_status_change(
        self,
        ref: DatasetRef,
        rollbacks: Sequence[DocumentStatusRollback],
    ) -> tuple[str, ...]:
        """Restore only status rows still owned by the failed post-commit dispatch."""

        if not rollbacks:
            return ()
        by_id = {rollback.document_id: rollback for rollback in rollbacks}
        restored: list[str] = []
        with self._session_factory() as session:
            for document in _lock_documents(session, ref, tuple(by_id)):
                rollback = by_id[document.id]
                if (
                    document.updated_at != rollback.applied_updated_at
                    or bool(document.enabled) != rollback.applied_enabled
                    or document.disabled_at != rollback.applied_disabled_at
                    or document.disabled_by != rollback.applied_disabled_by
                    or bool(document.archived) != rollback.applied_archived
                    or document.archived_at != rollback.applied_archived_at
                    or document.archived_by != rollback.applied_archived_by
                ):
                    continue
                document.enabled = rollback.enabled
                document.disabled_at = rollback.disabled_at
                document.disabled_by = rollback.disabled_by
                document.archived = rollback.archived
                document.archived_at = rollback.archived_at
                document.archived_by = rollback.archived_by
                document.updated_at = rollback.updated_at
                restored.append(document.id)
            session.commit()
        return tuple(restored)

    def sync_website(self, ref: DocumentRef) -> None:
        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if document.archived:
                raise DocumentPersistenceArchivedError("Document is archived.")
            if document.data_source_type != DataSourceType.WEBSITE_CRAWL:
                raise DocumentPersistenceInvalidStateError("Document is not a website document.")
            document.indexing_status = IndexingStatus.WAITING
            document.error = None
            data_source_info = document.data_source_info_dict
            data_source_info["mode"] = "scrape"
            document.data_source_info = json.dumps(data_source_info, ensure_ascii=False)
            session.commit()

    def sync_notion(self, ref: DocumentRef) -> None:
        """Mark one owned Notion document waiting before publishing its sync task."""

        with self._session_factory() as session:
            document = _lock_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            if document.archived:
                raise DocumentPersistenceArchivedError("Document is archived.")
            if document.data_source_type != DataSourceType.NOTION_IMPORT:
                raise DocumentPersistenceInvalidStateError("Document is not a Notion document.")
            document.indexing_status = IndexingStatus.WAITING
            document.error = None
            session.commit()

    def complete_unchanged_notion_sync(
        self,
        ref: DocumentRef,
        *,
        expected_source_info: Mapping[str, object],
    ) -> UnchangedNotionSyncOutcome:
        """Keep healthy indexed material when a Notion source has not changed."""

        with self._session_factory.begin() as session:
            document = require_indexing_document(session, ref, lock=True)
            if (
                document.data_source_type != DataSourceType.NOTION_IMPORT
                or document.archived
                or not document.enabled
                or document.is_paused
            ):
                raise DocumentPersistenceInvalidStateError("Document is not eligible for Notion sync.")
            # A stale or duplicate task must not overwrite a newer indexing
            # attempt or a replacement Notion source with the same timestamp.
            if document.indexing_status != IndexingStatus.WAITING:
                return "stale"
            source_info = dict(_mapping(document.data_source_info) or {})
            if source_info != dict(expected_source_info):
                return "stale"
            if document.completed_at is None:
                return "requires_indexing"
            document.indexing_status = IndexingStatus.COMPLETED
            document.completed_at = naive_utc_now()
            document.error = None
            return "completed"

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
            session.commit()
            return len(documents)

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

    def next_document_position(self, session: Session, *, workspace_id: str, dataset_id: str) -> int:
        return get_documents_position(session, tenant_id=workspace_id, dataset_id=dataset_id)

    def lock_new_upload_file_references(
        self,
        session: Session,
        *,
        workspace_id: str,
        payloads: Sequence[Mapping[str, object]],
    ) -> None:
        file_ids = {file_id for payload in payloads for file_id in trusted_upload_file_ids(payload)}
        lock_and_validate_owned_upload_files_in_session(
            session,
            tenant_id=workspace_id,
            upload_file_ids=tuple(sorted(file_ids)),
        )

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
            return _document_state(document)

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
            return tuple(_document_state(document) for document in documents)

    def list_documents(self, ref: DatasetRef, query: DocumentListFilter) -> DocumentPageProjection:
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
            values = load_document_read_projections(documents, session=session)
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
            values = tuple(
                replace(
                    value,
                    summary_index_status=(
                        summary_statuses.get(value.id) if summary_enabled and value.need_summary is True else None
                    ),
                )
                for value in values
            )
            return DocumentPageProjection(
                documents=values,
                has_more=page.has_next,
                limit=page.per_page,
                total=page.total,
                page=page.page,
            )

    def get_indexing_status(self, ref: DocumentRef) -> dict[str, Any]:
        with self._session_factory() as session:
            document = _get_document(session, ref)
            if document is None:
                raise DocumentPersistenceNotFoundError("Document not found.")
            counts = get_document_segment_counts(session, [document])
            return _indexing_status_values(document, counts.get(document.id, (0, 0)))

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

    def get_indexing_document(self, ref: DocumentRef) -> IndexingDocument:
        with self._session_factory() as session:
            document = require_indexing_document(session, ref)
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
            )

    def get_indexing_models(self, ref: DocumentRef) -> tuple[Dataset, Document]:
        """Detached legacy processor inputs; never pass them to another thread."""
        with self._session_factory() as session:
            document = require_indexing_document(session, ref)
            dataset = session.scalar(
                select(Dataset).where(
                    Dataset.id == ref.dataset.dataset_id,
                    Dataset.tenant_id == ref.dataset.tenant_id,
                )
            )
            assert dataset is not None
            return dataset, document

    def get_indexing_dataset(self, dataset_ref: DatasetRef) -> Dataset | None:
        """Detached dataset for index cleanup after the document row may already be gone.

        None means the dataset was deleted too, so dataset cleanup owns its whole index.
        """
        with self._session_factory() as session:
            return session.scalar(
                select(Dataset).where(
                    Dataset.id == dataset_ref.dataset_id,
                    Dataset.tenant_id == dataset_ref.tenant_id,
                )
            )

    def get_indexing_user(self, ref: DocumentRef) -> Account:
        with self._session_factory() as session:
            document = require_indexing_document(session, ref)
            account = session.get(Account, document.created_by)
            if account is None:
                raise ValueError("no current user found")
            account.set_tenant_id_with_session(ref.dataset.tenant_id, session=session)
            return account

    def mark_splitting(self, ref: DocumentRef, *, source_version: str | None = None) -> None:
        with self._session_factory.begin() as session:
            document = require_indexing_document(session, ref, lock=True)
            if document.data_source_type == DataSourceType.NOTION_IMPORT:
                source_info = dict(_mapping(document.data_source_info) or {})
                if source_version is None:
                    source_info.pop(_PENDING_NOTION_SOURCE_VERSION_KEY, None)
                else:
                    source_info[_PENDING_NOTION_SOURCE_VERSION_KEY] = source_version
                document.data_source_info = json.dumps(source_info)
            document.indexing_status = IndexingStatus.SPLITTING
            document.parsing_completed_at = naive_utc_now()

    def complete_indexing(
        self,
        ref: DocumentRef,
        *,
        tokens: int,
        latency: float,
    ) -> None:
        with self._session_factory.begin() as session:
            document = require_indexing_document(session, ref, lock=True)
            if document.data_source_type == DataSourceType.NOTION_IMPORT:
                source_info = dict(_mapping(document.data_source_info) or {})
                pending_source_version = source_info.pop(_PENDING_NOTION_SOURCE_VERSION_KEY, None)
                if isinstance(pending_source_version, str):
                    source_info["last_edited_time"] = pending_source_version
                document.data_source_info = json.dumps(source_info)
            document.indexing_status = IndexingStatus.COMPLETED
            document.tokens = tokens
            document.indexing_latency = latency
            document.completed_at = naive_utc_now()
            document.error = None

    def fail_indexing(self, ref: DocumentRef, error: str) -> None:
        try:
            with self._session_factory.begin() as session:
                document = require_indexing_document(session, ref, lock=True)
                if document.data_source_type == DataSourceType.NOTION_IMPORT:
                    source_info = dict(_mapping(document.data_source_info) or {})
                    source_info.pop(_PENDING_NOTION_SOURCE_VERSION_KEY, None)
                    document.data_source_info = json.dumps(source_info)
                document.indexing_status = IndexingStatus.ERROR
                document.error = error
                document.stopped_at = naive_utc_now()
        except DocumentIsDeletedPausedError:
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

    def mark_failed(self, *, workspace_id: str, dataset_id: str, document_id: str, error: str) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(Document)
                .where(
                    Document.tenant_id == workspace_id,
                    Document.dataset_id == dataset_id,
                    Document.id == document_id,
                )
                .values(indexing_status=IndexingStatus.ERROR, error=error)
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
