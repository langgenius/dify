"""Session-owning adapters for document queries and existing document operations."""

import logging
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict, replace
from typing import Any, Protocol, TypedDict
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants import DOCUMENT_EXTENSIONS
from core.entities.document_task import DocumentTask
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums import DeploymentEdition
from enums.creator import CreatorUserRole
from extensions.ext_redis import RedisClientWrapper
from graphon.file import helpers as file_helpers
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from machinery.context import RequestContext
from models import Dataset, Document
from repositories.knowledge.dataset_read_repository import (
    get_dataset_process_rules,
    get_latest_dataset_process_rule,
)
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.document_query_repository import (
    get_document_hit_count,
    get_document_process_rule,
    get_document_segment_count,
)
from repositories.knowledge.document_repository import _get_document
from services.data_source.credential_gateway import (
    ActorDatasourceCredentialResolver,
    DatasourceCredentialError,
    DatasourceCredentialNotFoundError,
)
from services.data_source.entities.website import WebsiteJobRef, WebsiteJobSelection
from services.entities.upload_file import FileUploadActor, UploadFileRecord
from services.errors.base import NoPermissionError
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError
from services.feature_service import FeatureService
from services.file_service import FileService
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.dataset_read_service import (
    format_document_creation,
    format_document_page,
    format_document_read_projection,
    get_document_metadata_details,
    get_document_source_detail,
)
from services.knowledge.datasets.task_gateway import dispatch_dataset_cleanup
from services.knowledge.documents.application import (
    DocumentModelConfigurationGateway,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentRepository,
    DocumentSourceAuthorization,
    DocumentTaskDispatcher,
    DocumentUploadError,
)
from services.knowledge.documents.contracts import (
    DocumentBatchCleanupJob,
    DocumentCleanupJob,
    DocumentCreationProjection,
    DocumentIndexingJobs,
    DocumentListFilter,
    DocumentPersistenceDatasetNotFoundError,
    DocumentPersistenceNotFoundError,
    DocumentReadProjection,
    DocumentStatusAction,
    DocumentWriteConfig,
    DocumentWriteWebsiteSource,
    DocumentZip,
)
from services.knowledge.documents.creation import build_document_write_config
from services.knowledge.documents.creation_adapters import default_document_process_rules
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.entities.model_configuration import (
    DatasetModelConfiguration,
    EmbeddingModelConfiguration,
)
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.vector_space_admission_service import get_vector_space_admission_error_fields

logger = logging.getLogger(__name__)


class WebsiteJobResolver(Protocol):
    def resolve_job_ref(self, *, tenant_id: str, selection: WebsiteJobSelection) -> WebsiteJobRef: ...
    def validate_stored_source(self, *, tenant_id: str, source_info: Mapping[str, object]) -> WebsiteJobRef: ...


class DocumentResponsePresentationAdapter:
    """Format persistence-neutral document projections for API responses."""

    @staticmethod
    def creation(result: DocumentCreationProjection) -> dict[str, Any]:
        return format_document_creation(result)

    @staticmethod
    def document(result: DocumentReadProjection) -> dict[str, Any]:
        return format_document_read_projection(result)


class CeleryBatchTask(Protocol):
    def delay(self, *, tenant_id: str, dataset_id: str, document_ids: Sequence[str]) -> object: ...


class DocumentIndexingPayload(TypedDict):
    tenant_id: str
    dataset_id: str
    document_ids: Sequence[str]


def _dispatch_indexing_batch(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    priority: bool,
    duplicate: bool,
) -> None:
    if duplicate:
        from tasks.duplicate_document_indexing_task import (
            normal_duplicate_document_indexing_task,
            priority_duplicate_document_indexing_task,
        )

        normal_task = normal_duplicate_document_indexing_task
        priority_task = priority_duplicate_document_indexing_task
        queue_name = "duplicate_document_indexing"
    else:
        from tasks.document_indexing_task import normal_document_indexing_task, priority_document_indexing_task

        normal_task = normal_document_indexing_task
        priority_task = priority_document_indexing_task
        queue_name = "document_indexing"

    task: CeleryBatchTask = (
        priority_task if priority or dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD else normal_task
    )
    task_kwargs: DocumentIndexingPayload = {
        "tenant_id": tenant_id,
        "dataset_id": dataset_id,
        "document_ids": document_ids,
    }
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        task.delay(**task_kwargs)
        return

    queue = TenantIsolatedTaskQueue(tenant_id, queue_name)
    if queue.get_task_key():
        queue.push_tasks([asdict(DocumentTask(tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids))])
        return
    queue.set_task_waiting_time()
    task.delay(**task_kwargs)


class DocumentSourceAuthorizationAdapter(DocumentSourceAuthorization):
    """Authorize actor-selected sources and return a frozen persistence command.

    Callers run this adapter before taking dataset-wide persistence locks because
    credential refresh may call an external provider.
    """

    def __init__(
        self,
        *,
        actor_credentials: ActorDatasourceCredentialResolver,
        website_jobs: WebsiteJobResolver,
    ) -> None:
        self._actor_credentials = actor_credentials
        self._website_jobs = website_jobs

    def authorize(self, context: RequestContext, config: KnowledgeConfig) -> DocumentWriteConfig:
        data_source = config.data_source
        if data_source is not None and data_source.info_list.data_source_type == "notion_import":
            notion_sources = data_source.info_list.notion_info_list
            if not notion_sources:
                raise ValueError("No notion info list found.")
            credential_ids = {source.credential_id for source in notion_sources}
            if "" in credential_ids:
                raise DatasourceCredentialNotFoundError()
            try:
                for credential_id in sorted(credential_ids):
                    self._actor_credentials.resolve(
                        workspace_id=context.active_workspace_id,
                        actor_id=context.account_id,
                        credential_id=credential_id,
                        provider="notion_datasource",
                        plugin_id="langgenius/notion_datasource",
                    )
            except DatasourceCredentialError as error:
                raise DocumentProviderError(str(error), kind="uninitialized") from error

        command = build_document_write_config(config)
        if data_source is None or data_source.info_list.data_source_type != "website_crawl":
            return command
        website = data_source.info_list.website_info_list
        source = command.data_source
        if website is None or source is None or source.website_source is None:
            raise ValueError("No website info list found.")
        website_source = source.website_source
        job_ref = self._website_jobs.resolve_job_ref(
            tenant_id=context.active_workspace_id,
            selection=WebsiteJobSelection(
                provider=website.provider,
                job_id=website.job_id,
            ),
        )
        if job_ref.tenant_id != context.active_workspace_id:
            raise ValueError("Website source tenant does not match the current workspace")
        return replace(
            command,
            data_source=replace(
                source,
                website_source=DocumentWriteWebsiteSource(
                    provider=job_ref.provider,
                    provider_instance_id=job_ref.provider_instance_id,
                    job_id=job_ref.job_id,
                    urls=website_source.urls,
                    only_main_content=website_source.only_main_content,
                ),
            ),
        )

    def validate_stored_website(self, context: RequestContext, source_info: Mapping[str, object]) -> None:
        job_ref = self._website_jobs.validate_stored_source(
            tenant_id=context.active_workspace_id,
            source_info=source_info,
        )
        if job_ref.tenant_id != context.active_workspace_id:
            raise ValueError("Website source tenant does not match the current workspace")


class RedisDocumentLifecycleCache:
    """Compatibility Redis flags used by existing indexing workers."""

    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis
        self._sync_locks = RedisKnowledgeIndexingLock(redis=redis)

    @staticmethod
    def _sync_marker_name(document_id: str) -> str:
        return f"document_{document_id}_is_sync"

    def is_indexing(self, document_id: str) -> bool:
        return self._redis.get(f"document_{document_id}_indexing") is not None

    def mark_indexing(self, document_ids: Sequence[str]) -> None:
        for document_id in document_ids:
            self._redis.setex(f"document_{document_id}_indexing", 600, 1)

    def clear_indexing(self, document_ids: Sequence[str]) -> None:
        if document_ids:
            self._redis.delete(*(f"document_{document_id}_indexing" for document_id in document_ids))

    def mark_paused(self, document_id: str) -> None:
        self._redis.setnx(f"document_{document_id}_is_paused", "True")

    def clear_paused(self, document_id: str) -> None:
        self._redis.delete(f"document_{document_id}_is_paused")

    def try_mark_syncing(self, document_id: str, *, token: str) -> bool:
        return bool(self._redis.set(self._sync_marker_name(document_id), token, nx=True, ex=600))

    def clear_syncing(self, document_id: str, *, token: str) -> None:
        try:
            with self._sync_locks.hold(
                self._sync_marker_name(document_id),
                timeout=1,
                expected_token=token,
            ):
                pass
        except KnowledgeIndexingLockBusyError:
            # A newer sync request owns the marker. Its worker must release it.
            return


class CeleryDocumentTaskDispatcher(DocumentTaskDispatcher):
    """Publish the established document task messages after state commits."""

    def dispatch_indexing(self, jobs: DocumentIndexingJobs, *, priority: bool) -> None:
        from tasks.document_indexing_update_task import document_indexing_update_task

        if jobs.removed_notion_cleanup is not None:
            self.cleanup(jobs.dataset, jobs.removed_notion_cleanup)
        if jobs.created:
            _dispatch_indexing_batch(
                tenant_id=jobs.dataset.tenant_id,
                dataset_id=jobs.dataset.dataset_id,
                document_ids=jobs.created,
                priority=priority,
                duplicate=False,
            )
        if jobs.duplicated:
            _dispatch_indexing_batch(
                tenant_id=jobs.dataset.tenant_id,
                dataset_id=jobs.dataset.dataset_id,
                document_ids=jobs.duplicated,
                priority=priority,
                duplicate=True,
            )
        if jobs.updated:
            document_indexing_update_task.delay(jobs.dataset.dataset_id, jobs.updated)

    def cleanup(
        self,
        ref: DatasetRef,
        cleanup: DocumentCleanupJob | DocumentBatchCleanupJob,
    ) -> None:
        if isinstance(cleanup, DocumentBatchCleanupJob):
            from tasks.batch_clean_document_task import batch_clean_document_task

            batch_clean_document_task.delay(
                list(cleanup.document_ids),
                cleanup.dataset_id,
                cleanup.doc_form,
                list(cleanup.file_ids),
            )
            return

        from tasks.clean_document_task import clean_document_task

        clean_document_task.delay(
            cleanup.document_id,
            cleanup.dataset_id,
            cleanup.doc_form,
            cleanup.file_id,
        )

    def cleanup_dataset(self, cleanup: DatasetCleanupRecord) -> None:
        dispatch_dataset_cleanup(cleanup)

    def recover(self, ref: DocumentRef) -> None:
        from tasks.recover_document_indexing_task import recover_document_indexing_task

        recover_document_indexing_task.delay(ref.dataset.dataset_id, ref.document_id)

    def retry(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        actor_id: str,
    ) -> None:
        from tasks.retry_document_indexing_task import retry_document_indexing_task

        retry_document_indexing_task.delay(ref.dataset_id, list(document_ids), actor_id)

    def change_status(self, document_ids: Sequence[str], *, action: DocumentStatusAction) -> tuple[str, ...]:
        if action in {"enable", "un_archive"}:
            from tasks.add_document_to_index_task import add_document_to_index_task

            failed: list[str] = []
            for document_id in document_ids:
                try:
                    add_document_to_index_task.delay(document_id)
                except Exception:
                    logger.exception("Failed to queue add-document task for document %s", document_id)
                    failed.append(document_id)
            return tuple(failed)

        from tasks.remove_document_from_index_task import remove_document_from_index_task

        failed = []
        for document_id in document_ids:
            try:
                remove_document_from_index_task.delay(document_id)
            except Exception:
                logger.exception("Failed to queue remove-document task for document %s", document_id)
                failed.append(document_id)
        return tuple(failed)

    def sync_website(self, ref: DocumentRef) -> None:
        from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task

        sync_website_document_indexing_task.delay(ref.dataset.dataset_id, ref.document_id)

    def sync_notion(self, ref: DocumentRef) -> None:
        from tasks.document_indexing_sync_task import document_indexing_sync_task

        document_indexing_sync_task.delay(ref.dataset.dataset_id, ref.document_id)

    def generate_summary(self, ref: DatasetRef, document_ids: Sequence[str]) -> None:
        from tasks.generate_summary_index_task import generate_summary_index_task

        for document_id in document_ids:
            generate_summary_index_task.delay(ref.dataset_id, document_id, None)


class DocumentModelConfigurationAdapter:
    """Translate provider implementation failures at the document boundary."""

    def __init__(self, *, models: DocumentModelConfigurationGateway) -> None:
        self._models = models

    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration:
        with _translate_model_errors():
            return self._models.resolve_default_embedding_model(tenant_id=tenant_id)

    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> EmbeddingModelConfiguration:
        with _translate_model_errors():
            return self._models.resolve_embedding_model(tenant_id=tenant_id, provider=provider, model=model)

    def validate_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        with _translate_model_errors():
            self._models.validate_embedding_model(tenant_id=tenant_id, provider=provider, model=model)

    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        with _translate_model_errors():
            self._models.validate_reranking_model(tenant_id=tenant_id, provider=provider, model=model)

    def validate_dataset_model(
        self,
        *,
        configuration: DatasetModelConfiguration,
        dataset_unavailable: bool = True,
    ) -> None:
        with _translate_model_errors():
            self._models.validate_dataset_model(
                configuration=configuration,
                dataset_unavailable=dataset_unavailable,
            )


@contextmanager
def _translate_model_errors() -> Generator[None]:
    try:
        yield
    except (ProviderTokenNotInitError, InvokeAuthorizationError) as error:
        raise DocumentProviderError(str(error), kind="uninitialized") from error
    except QuotaExceededError as error:
        raise DocumentProviderError(str(error), kind="quota") from error
    except ModelCurrentlyNotSupportError as error:
        raise DocumentProviderError(str(error), kind="unsupported") from error


@contextmanager
def _translate_upload_errors() -> Generator[None]:
    try:
        yield
    except NoPermissionError as error:
        raise DatasetAccessDeniedError() from error
    except FileTooLargeError as error:
        raise DocumentUploadError(error.description, kind="too_large") from error
    except UnsupportedFileTypeError as error:
        raise DocumentUploadError(error.description, kind="unsupported") from error


def _require_dataset(session: Session, ref: DatasetRef) -> Dataset:
    dataset = _get_dataset(session, ref)
    if dataset is None:
        raise DatasetNotFoundError()
    return dataset


def _require_document(session: Session, ref: DocumentRef) -> Document:
    document = _get_document(session, ref)
    if document is None:
        raise DocumentNotFoundError("Document not found.")
    return document


class SQLAlchemyDocumentOperations:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        documents: DocumentRepository,
        files: FileService,
    ) -> None:
        self._sessions = session_factory
        self._documents = documents
        self._files = files

    def get_process_rule(self, ref: DatasetRef | None) -> dict[str, Any]:
        result = default_document_process_rules()
        if ref is not None:
            with self._sessions() as session:
                rule = get_latest_dataset_process_rule(_require_dataset(session, ref), session=session)
                if rule is not None:
                    result.update(mode=rule.mode, rules=rule.rules_dict)
        return result

    def list_documents(self, ref: DatasetRef, query: DocumentListFilter) -> dict[str, Any]:
        try:
            return format_document_page(self._documents.list_documents(ref, query))
        except DocumentPersistenceDatasetNotFoundError as error:
            raise DatasetNotFoundError() from error

    def get_detail(self, ref: DocumentRef, *, metadata_only: bool) -> dict[str, Any]:
        with self._sessions() as session:
            dataset = _require_dataset(session, ref.dataset)
            document = _require_document(session, ref)
            result: dict[str, Any] = {
                "id": document.id,
                "doc_type": document.doc_type,
                "doc_metadata": get_document_metadata_details(document, session=session),
            }
            if metadata_only:
                return result
            rule = get_document_process_rule(document, session=session)
            segment_count = get_document_segment_count(document, session=session)
            result.update(
                {
                    "position": document.position,
                    "data_source_type": document.data_source_type,
                    "dataset_process_rule_id": document.dataset_process_rule_id,
                    "name": document.name,
                    "created_from": document.created_from,
                    "created_by": document.created_by,
                    "tokens": document.tokens,
                    "indexing_status": document.indexing_status,
                    "indexing_latency": document.indexing_latency,
                    "error": document.error,
                    "enabled": document.enabled,
                    "disabled_by": document.disabled_by,
                    "archived": document.archived,
                    "display_status": document.display_status,
                    "doc_form": document.doc_form,
                    "doc_language": document.doc_language,
                }
            )
            result.update(
                {
                    "created_at": int(document.created_at.timestamp()) if document.created_at else None,
                    "completed_at": int(document.completed_at.timestamp()) if document.completed_at else None,
                    "updated_at": int(document.updated_at.timestamp()) if document.updated_at else None,
                    "disabled_at": int(document.disabled_at.timestamp()) if document.disabled_at else None,
                }
            )
            process_rule_mode, process_rule_rules = get_dataset_process_rules(
                session,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
            )
            result.update(
                data_source_info=document.data_source_info_dict,
                data_source_detail_dict=get_document_source_detail(document, session=session),
                dataset_process_rule={"mode": process_rule_mode, "rules": process_rule_rules},
                document_process_rule=dict(rule.to_dict()) if rule else None,
                segment_count=segment_count,
                average_segment_length=(document.word_count or 0) // segment_count if segment_count else 0,
                hit_count=get_document_hit_count(document, session=session),
                need_summary=bool(document.need_summary),
            )
            has_summary_index = bool(
                dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True
            )
            result["summary_index_status"] = (
                SummaryIndexAdapter.get_document_summary_index_status(
                    document_id=document.id,
                    dataset_id=dataset.id,
                    tenant_id=dataset.tenant_id,
                    session=session,
                )
                if has_summary_index and document.need_summary is True
                else None
            )
            return result

    def get_indexing_status(self, ref: DocumentRef) -> dict[str, Any]:
        try:
            value = self._documents.get_indexing_status(ref)
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error
        processing_error = value.pop("_processing_error", value.get("error"))
        value.update(get_vector_space_admission_error_fields(processing_error))
        return value

    def get_batch_indexing_status(self, ref: DatasetRef, batch: str) -> dict[str, Any]:
        try:
            result = self._documents.get_batch_indexing_status(ref, batch)
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error
        for value in result["data"]:
            processing_error = value.pop("_processing_error", value.get("error"))
            value.update(get_vector_space_admission_error_fields(processing_error))
        return result

    def get_execution_log(self, ref: DocumentRef) -> dict[str, Any]:
        try:
            return self._documents.get_execution_log(ref)
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error

    def get_summary_status(self, ref: DocumentRef) -> dict[str, Any]:
        with self._sessions() as session:
            _require_document(session, ref)
            return dict(
                SummaryIndexAdapter.get_document_summary_status_detail(
                    tenant_id=ref.dataset.tenant_id,
                    document_id=ref.document_id,
                    dataset_id=ref.dataset.dataset_id,
                    session=session,
                )
            )

    def get_download_url(self, ref: DocumentRef) -> str:
        uploads = self._download_uploads(ref.dataset, [ref.document_id])
        return file_helpers.get_signed_file_url(upload_file_id=uploads[ref.document_id].id, as_attachment=True)

    def _download_uploads(self, ref: DatasetRef, document_ids: Sequence[str]) -> dict[str, UploadFileRecord]:
        upload_ids = self._documents.get_upload_file_ids(ref, document_ids)
        if upload_ids is None:
            raise DocumentNotFoundError("Document not found or is not backed by an uploaded file.")
        uploads = self._files.get_files(tenant_id=ref.tenant_id, file_ids=tuple(upload_ids.values()))
        if set(upload_ids.values()) - set(uploads):
            raise DocumentNotFoundError("Uploaded file not found.")
        return {document_id: uploads[upload_id] for document_id, upload_id in upload_ids.items()}

    @contextmanager
    def build_download_zip(self, ref: DatasetRef, document_ids: Sequence[str]) -> Generator[DocumentZip]:
        files_by_document = self._download_uploads(ref, document_ids)
        files = [files_by_document[document_id] for document_id in document_ids]
        filename = f"{uuid4().hex}.zip"
        with self._files.build_upload_files_zip_tempfile(upload_files=files) as path:
            yield DocumentZip(path=path, filename=filename)


class DocumentUploadAdapter:
    """Store Service API document sources and expose only their stable identifiers."""

    def __init__(self, *, files: FileService) -> None:
        self._files = files

    def upload_text(self, context: RequestContext, *, name: str, text: str) -> str:
        upload = self._files.upload_text(
            actor=FileUploadActor(id=context.account_id, creator_role=CreatorUserRole.ACCOUNT),
            tenant_id=context.active_workspace_id,
            text=text,
            text_name=name,
        )
        return upload.id

    def upload_file(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
        with _translate_upload_errors():
            upload = self._files.upload_file(
                actor=FileUploadActor(id=context.account_id, creator_role=CreatorUserRole.ACCOUNT),
                tenant_id=context.active_workspace_id,
                filename=filename,
                content=content,
                mimetype=mimetype,
                allowed_extensions=frozenset(DOCUMENT_EXTENSIONS),
                default_file_size_limit=FeatureService.get_knowledge_file_size_limit(context.active_workspace_id),
            )
        return upload.id
