"""Session-owning adapters for document queries and existing document operations."""

from collections.abc import Generator, Sequence
from contextlib import contextmanager
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_redis import RedisClientWrapper
from graphon.file import helpers as file_helpers
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from machinery.context import RequestContext
from models import Dataset, Document, UploadFile
from models.enums import CreatorUserRole
from repositories.knowledge.dataset_read_repository import (
    get_dataset_process_rules,
    get_latest_dataset_process_rule,
)
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.document_query_repository import (
    get_document_hit_count,
    get_document_process_rule,
    get_document_segment_count,
    project_current_document_index_states,
)
from repositories.knowledge.document_repository import _get_document
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.errors.base import NoPermissionError
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError
from services.feature_service import FeatureService
from services.file_service import FileService, FileUploadActor
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.dataset_read_service import (
    get_document_metadata_details,
    get_document_source_detail,
)
from services.knowledge.documents.application import (
    DocumentModelConfigurationGateway,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentRepository,
    DocumentUploadError,
)
from services.knowledge.documents.contracts import (
    DocumentListFilter,
    DocumentPersistenceDatasetNotFoundError,
    DocumentPersistenceNotFoundError,
    DocumentZip,
)
from services.knowledge.documents.creation_adapters import default_document_process_rules
from services.knowledge.entities.model_configuration import (
    DatasetModelConfiguration,
    EmbeddingModelConfiguration,
)
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.vector_space_admission_service import get_vector_space_admission_error_fields


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
        uploads: SQLAlchemyKnowledgeUploadRepository,
    ) -> None:
        self._sessions = session_factory
        self._documents = documents
        self._uploads = uploads

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
            return self._documents.list_documents(ref, query)
        except DocumentPersistenceDatasetNotFoundError as error:
            raise DatasetNotFoundError() from error

    def get_detail(self, ref: DocumentRef, *, metadata_only: bool) -> dict[str, Any]:
        with self._sessions() as session:
            dataset = _require_dataset(session, ref.dataset)
            document = _require_document(session, ref)
            result = {
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
            project_current_document_index_states(
                session,
                tenant_id=ref.dataset.tenant_id,
                dataset_id=ref.dataset.dataset_id,
                documents=[document],
                values=[result],
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

    def _download_uploads(self, ref: DatasetRef, document_ids: Sequence[str]) -> dict[str, UploadFile]:
        upload_ids = self._documents.get_upload_file_ids(ref, document_ids)
        if upload_ids is None:
            raise DocumentNotFoundError("Document not found or is not backed by an uploaded file.")
        uploads = self._uploads.get_files(workspace_id=ref.tenant_id, file_ids=tuple(upload_ids.values()))
        if set(upload_ids.values()) - set(uploads):
            raise DocumentNotFoundError("Uploaded file not found.")
        return {document_id: uploads[upload_id] for document_id, upload_id in upload_ids.items()}

    @contextmanager
    def build_download_zip(self, ref: DatasetRef, document_ids: Sequence[str]) -> Generator[DocumentZip]:
        files_by_document = self._download_uploads(ref, document_ids)
        files = [files_by_document[document_id] for document_id in document_ids]
        filename = f"{uuid4().hex}.zip"
        with FileService.build_upload_files_zip_tempfile(upload_files=files) as path:
            yield DocumentZip(path=path, filename=filename)


class DocumentUploadAdapter:
    """Store Service API document sources and expose only their stable identifiers."""

    def __init__(self, *, files: FileService) -> None:
        self._files = files

    def upload_text(self, context: RequestContext, *, name: str, text: str) -> str:
        upload = self._files.upload_text(
            text=text,
            text_name=name,
            user_id=context.account_id,
            tenant_id=context.active_workspace_id,
        )
        return upload.id

    def upload_file(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
        with _translate_upload_errors():
            upload = self._files.upload_file_for_actor(
                actor=FileUploadActor(id=context.account_id, creator_role=CreatorUserRole.ACCOUNT),
                resource_tenant_id=context.active_workspace_id,
                filename=filename,
                content=content,
                mimetype=mimetype,
                source="datasets",
                default_file_size_limit=FeatureService.get_knowledge_file_size_limit(context.active_workspace_id),
            )
        return upload.id
