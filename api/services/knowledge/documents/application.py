"""Document use cases, independent of HTTP and persistence frameworks."""

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext
from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import uuid4

from enums.knowledge import DocumentCreatedFrom
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from services.errors.file import FileNotExistsError
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.documents.contracts import (
    DOCUMENT_METADATA_SCHEMA,
    DocumentCreationDataset,
    DocumentCreationDefaults,
    DocumentCreationGateway,
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
    DocumentZip,
)
from services.knowledge.documents.creation import (
    build_document_write_config,
    prepare_document_creation,
    validate_document_creation,
)
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.entities.model_configuration import DatasetModelConfiguration, EmbeddingModelConfiguration
from services.knowledge.indexing.cleanup import UploadFilePendingDeletionError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLock,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef


class DocumentApplicationError(Exception):
    """Base class for document use-case failures mapped by the transport."""


class DocumentNotFoundError(DocumentApplicationError):
    pass


class DocumentArchivedError(DocumentApplicationError):
    pass


class DocumentIndexingStateError(DocumentApplicationError):
    pass


class DocumentInvalidActionError(DocumentApplicationError):
    pass


class DocumentProviderError(DocumentApplicationError):
    def __init__(self, description: str, *, kind: Literal["uninitialized", "quota", "unsupported"]) -> None:
        super().__init__(description)
        self.kind = kind


class DocumentUploadError(DocumentApplicationError):
    def __init__(self, description: str, *, kind: Literal["too_large", "unsupported"]) -> None:
        super().__init__(description)
        self.description = description
        self.kind = kind


class DocumentSourceConflictError(DocumentApplicationError):
    """The selected source file entered cleanup before it could be attached."""


class DocumentOperations(Protocol):
    """Owned document operations; adapters return materialized values and own their sessions."""

    def list_documents(self, ref: DatasetRef, query: DocumentListFilter) -> dict[str, Any]: ...
    def get_detail(self, ref: DocumentRef, *, metadata_only: bool) -> dict[str, Any]: ...
    def get_process_rule(self, ref: DatasetRef | None) -> dict[str, Any]: ...
    def get_indexing_status(self, ref: DocumentRef) -> dict[str, Any]: ...
    def get_batch_indexing_status(self, ref: DatasetRef, batch: str) -> dict[str, Any]: ...
    def get_execution_log(self, ref: DocumentRef) -> dict[str, Any]: ...
    def get_summary_status(self, ref: DocumentRef) -> dict[str, Any]: ...
    def get_download_url(self, ref: DocumentRef) -> str: ...
    def build_download_zip(
        self, ref: DatasetRef, document_ids: Sequence[str]
    ) -> AbstractContextManager[DocumentZip]: ...


class DatasetCreatorAccess(Protocol):
    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None: ...


class DocumentLifecycleCache(Protocol):
    """Compatibility cache around durable lifecycle state."""

    def is_indexing(self, document_id: str) -> bool: ...
    def mark_indexing(self, document_ids: Sequence[str]) -> None: ...
    def mark_paused(self, document_id: str) -> None: ...
    def clear_paused(self, document_id: str) -> None: ...
    def try_mark_syncing(self, document_id: str, *, token: str) -> bool: ...
    def clear_syncing(self, document_id: str, *, token: str) -> None: ...


class DatasetModelConfigurationGateway(Protocol):
    def validate_dataset_model(
        self,
        *,
        configuration: DatasetModelConfiguration,
        dataset_unavailable: bool = True,
    ) -> None: ...


class DocumentModelConfigurationGateway(DatasetModelConfigurationGateway, Protocol):
    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration: ...
    def validate_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> None: ...
    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None: ...
    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> EmbeddingModelConfiguration: ...


class DocumentUploads(Protocol):
    """Persist request-owned document sources without exposing storage or ORM values."""

    def upload_text(self, context: RequestContext, *, name: str, text: str) -> str: ...

    def upload_file(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str: ...


class DocumentDatasetRepository(Protocol):
    """Dataset state needed by document use cases."""

    def get_document_creation_defaults(self, ref: DatasetRef) -> DocumentCreationDefaults | None: ...

    def get_model_configuration(self, ref: DatasetRef, /) -> DatasetModelConfiguration | None: ...

    def delete_with_relations(self, dataset_ref: DatasetRef) -> bool: ...


class DocumentRepository(Protocol):
    """Document identity and state lookups needed before invoking document operations."""

    def find_ref(self, *, workspace_id: str, document_id: str) -> DocumentRef | None: ...
    def get_state(self, ref: DocumentRef) -> DocumentState | None: ...
    def get_states(self, ref: DatasetRef, document_ids: Sequence[str]) -> Sequence[DocumentState]: ...
    def list_documents(self, ref: DatasetRef, query: DocumentListFilter) -> dict[str, Any]: ...
    def get_indexing_status(self, ref: DocumentRef) -> dict[str, Any]: ...
    def get_batch_indexing_status(self, ref: DatasetRef, batch: str) -> dict[str, Any]: ...
    def get_execution_log(self, ref: DocumentRef) -> dict[str, Any]: ...
    def get_upload_file_ids(self, dataset_ref: DatasetRef, document_ids: Sequence[str]) -> dict[str, str] | None: ...
    def get_creation_dataset(
        self,
        ref: DatasetRef,
        *,
        actor_id: str,
        doc_form: str,
        indexing_technique: str | None,
    ) -> DocumentCreationDataset: ...
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
    ) -> dict[str, Any]: ...
    def delete_document(self, ref: DocumentRef) -> bool: ...
    def delete_documents(self, ref: DatasetRef, document_ids: Sequence[str]) -> int: ...
    def update_metadata(
        self,
        ref: DocumentRef,
        *,
        doc_type: str,
        doc_metadata: Mapping[str, object],
        updated_at: datetime,
    ) -> None: ...
    def rename_document(self, ref: DocumentRef, name: str) -> dict[str, Any]: ...
    def pause_document(self, ref: DocumentRef, *, actor_id: str) -> None: ...
    def recover_document(self, ref: DocumentRef, *, generation: str) -> None: ...
    def retry_documents(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        actor_id: str,
        generation: str,
        lock_tokens: Mapping[str, str],
    ) -> tuple[str, ...]: ...
    def change_status(
        self,
        ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        action: DocumentStatusAction,
        actor_id: str,
        generations: Mapping[str, str],
    ) -> DocumentStatusMutation: ...
    def sync_website(self, ref: DocumentRef, *, generation: str) -> None: ...
    def get_summary_configuration(self, ref: DatasetRef) -> DocumentSummaryConfiguration | None: ...
    def enable_summary(self, ref: DatasetRef, document_ids: Sequence[str]) -> int: ...


class DatasetDocumentApplicationService:
    """Authorize document use cases and apply document state transitions."""

    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        datasets: DocumentDatasetRepository,
        documents: DocumentRepository,
        operations: DocumentOperations,
        uploads: DocumentUploads,
        indexing_locks: KnowledgeIndexingLock,
        lifecycle_cache: DocumentLifecycleCache,
        model_configuration: DocumentModelConfigurationGateway,
        creation: DocumentCreationGateway,
        creator_access: DatasetCreatorAccess,
    ) -> None:
        self._dataset_access = dataset_access
        self._datasets = datasets
        self._documents = documents
        self._operations = operations
        self._uploads = uploads
        self._indexing_locks = indexing_locks
        self._lifecycle_cache = lifecycle_cache
        self._model_configuration = model_configuration
        self._creation = creation
        self._creator_access = creator_access

    def _creation_defaults(self, ref: DatasetRef) -> DocumentCreationDefaults:
        defaults = self._datasets.get_document_creation_defaults(ref)
        if defaults is None:
            raise DatasetNotFoundError()
        return defaults

    def _dataset(self, context: RequestContext, dataset_id: str) -> DatasetRef:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        return DatasetRef(tenant_id=dataset.workspace_id, dataset_id=dataset.id)

    def _document(
        self, context: RequestContext, dataset_id: str, document_id: str
    ) -> tuple[DocumentRef, DocumentState]:
        ref = self._dataset(context, dataset_id).document(document_id)
        state = self._documents.get_state(ref)
        if state is None:
            raise DocumentNotFoundError("Document not found.")
        return ref, state

    @staticmethod
    def _require_mutable(state: DocumentState) -> None:
        if state.archived:
            raise DocumentArchivedError()

    def _pause(self, ref: DocumentRef, *, actor_id: str) -> None:
        try:
            self._documents.pause_document(ref, actor_id=actor_id)
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error
        except DocumentPersistenceInvalidStateError as error:
            raise DocumentIndexingStateError(str(error)) from error
        self._lifecycle_cache.mark_paused(ref.document_id)

    def _recover(self, ref: DocumentRef) -> None:
        try:
            self._documents.recover_document(ref, generation=str(uuid4()))
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error
        except DocumentPersistenceInvalidStateError as error:
            raise DocumentIndexingStateError(str(error)) from error
        self._lifecycle_cache.clear_paused(ref.document_id)

    def get_process_rule(self, context: RequestContext, *, document_id: str | None) -> dict[str, Any]:
        ref = None
        if document_id:
            document_ref = self._documents.find_ref(workspace_id=context.active_workspace_id, document_id=document_id)
            if document_ref is None:
                raise DocumentNotFoundError("Document not found.")
            ref = self._dataset(context, document_ref.dataset.dataset_id)
        return self._operations.get_process_rule(ref)

    def list_documents(self, context: RequestContext, *, dataset_id: str, query: DocumentListFilter) -> dict[str, Any]:
        return self._operations.list_documents(self._dataset(context, dataset_id), query)

    def get_document(
        self, context: RequestContext, *, dataset_id: str, document_id: str, metadata_only: bool = False
    ) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        return self._operations.get_detail(ref, metadata_only=metadata_only)

    def get_indexing_status(self, context: RequestContext, *, dataset_id: str, document_id: str) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        return self._operations.get_indexing_status(ref)

    def get_batch_indexing_status(self, context: RequestContext, *, dataset_id: str, batch: str) -> dict[str, Any]:
        return self._operations.get_batch_indexing_status(self._dataset(context, dataset_id), batch)

    def get_execution_log(self, context: RequestContext, *, dataset_id: str, document_id: str) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        return self._operations.get_execution_log(ref)

    def get_summary_status(self, context: RequestContext, *, dataset_id: str, document_id: str) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        return self._operations.get_summary_status(ref)

    def get_download_url(self, context: RequestContext, *, dataset_id: str, document_id: str) -> str:
        ref, _ = self._document(context, dataset_id, document_id)
        return self._operations.get_download_url(ref)

    def build_download_zip(
        self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]
    ) -> AbstractContextManager[DocumentZip]:
        return self._operations.build_download_zip(self._dataset(context, dataset_id), document_ids)

    def _validate_model_settings(
        self,
        workspace_id: str,
        settings: Mapping[str, Any],
        *,
        embedding: bool,
        reranking: bool,
    ) -> None:
        if embedding:
            provider = settings.get("embedding_model_provider")
            model = settings.get("embedding_model")
            if provider and model:
                self._model_configuration.validate_embedding_model(
                    tenant_id=workspace_id,
                    provider=str(provider),
                    model=str(model),
                )
        if reranking:
            retrieval_model = settings.get("retrieval_model")
            if isinstance(retrieval_model, Mapping):
                reranking_model = retrieval_model.get("reranking_model")
                if isinstance(reranking_model, Mapping):
                    provider = reranking_model.get("reranking_provider_name")
                    model = reranking_model.get("reranking_model_name")
                    if provider and model:
                        self._model_configuration.validate_reranking_model(
                            tenant_id=workspace_id,
                            provider=str(provider),
                            model=str(model),
                        )

    def _persist_creation(
        self,
        context: RequestContext,
        ref: DatasetRef,
        config: KnowledgeConfig,
        *,
        initialize: bool,
        created_from: DocumentCreatedFrom,
        priority: bool,
        initial_permission: str | None,
    ) -> dict[str, Any]:
        try:
            return self._documents.persist_creation(
                ref,
                build_document_write_config(config),
                actor_id=context.account_id,
                initialize=initialize,
                created_from=created_from,
                priority=priority,
                initial_permission=initial_permission,
            )
        except DocumentPersistenceDatasetNotFoundError as error:
            raise DatasetNotFoundError() from error
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error
        except DocumentSourceFileNotFoundError as error:
            raise FileNotExistsError(str(error)) from error
        except UploadFilePendingDeletionError as error:
            raise DocumentSourceConflictError(str(error)) from error

    def _run_creation(
        self,
        context: RequestContext,
        ref: DatasetRef,
        config: KnowledgeConfig,
        *,
        initialize: bool,
        created_from: DocumentCreatedFrom,
        priority: bool,
        initial_permission: str | None = None,
    ) -> dict[str, Any]:
        creation_lock = (
            nullcontext()
            if config.original_document_id
            else self._indexing_locks.hold(
                f"add_document_lock_dataset_id_{ref.dataset_id}",
                timeout=600,
                blocking_timeout=600,
            )
        )
        result: dict[str, Any] | None = None
        try:
            with creation_lock:
                result = self._persist_creation(
                    context,
                    ref,
                    config,
                    initialize=initialize,
                    created_from=created_from,
                    priority=priority,
                    initial_permission=initial_permission,
                )
        except KnowledgeIndexingLeaseLostError:
            if config.original_document_id:
                raise
            if result is None:
                raise
        assert result is not None
        return result

    def _create_documents(
        self,
        context: RequestContext,
        ref: DatasetRef,
        settings: Mapping[str, Any],
        *,
        created_from: DocumentCreatedFrom,
    ) -> dict[str, Any]:
        config = validate_document_creation(KnowledgeConfig.model_validate(settings))
        snapshot = self._documents.get_creation_dataset(
            ref,
            actor_id=context.account_id,
            doc_form=config.doc_form,
            indexing_technique=config.indexing_technique,
        )
        environment = self._creation.load_environment(context.active_workspace_id)
        config = prepare_document_creation(snapshot, config, environment, self._creation)
        return self._run_creation(
            context,
            ref,
            config,
            initialize=False,
            created_from=created_from,
            priority=environment.priority_indexing,
        )

    def create_documents(
        self, context: RequestContext, *, dataset_id: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        return self._create_documents(
            context,
            self._dataset(context, dataset_id),
            settings,
            created_from=DocumentCreatedFrom.WEB,
        )

    @staticmethod
    def _with_upload(settings: Mapping[str, Any], upload_id: str) -> dict[str, Any]:
        return {
            **settings,
            "data_source": {
                "type": "upload_file",
                "info_list": {
                    "data_source_type": "upload_file",
                    "file_info_list": {"file_ids": [upload_id]},
                },
            },
        }

    def create_by_text(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        name: str,
        text: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any]:
        ref = self._dataset(context, dataset_id)
        defaults = self._creation_defaults(ref)
        if not defaults.indexing_technique and not settings.get("indexing_technique"):
            raise ValueError("indexing_technique is required.")
        self._validate_model_settings(ref.tenant_id, settings, embedding=True, reranking=True)
        upload_id = self._uploads.upload_text(context, name=name, text=text)
        return self._create_documents(
            context,
            ref,
            self._with_upload(settings, upload_id),
            created_from=DocumentCreatedFrom.API,
        )

    def update_by_text(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        defaults = self._creation_defaults(ref.dataset)
        resolved = {
            **settings,
            "indexing_technique": defaults.indexing_technique,
            "original_document_id": document_id,
        }
        self._validate_model_settings(ref.dataset.tenant_id, resolved, embedding=False, reranking=True)
        text = settings.get("text")
        if text:
            name = settings.get("name")
            if not isinstance(name, str):
                raise ValueError("name is required when text is provided")
            upload_id = self._uploads.upload_text(context, name=name, text=str(text))
            resolved = self._with_upload(resolved, upload_id)
        return self._create_documents(
            context,
            ref.dataset,
            resolved,
            created_from=DocumentCreatedFrom.API,
        )

    def create_by_file(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any]:
        ref = self._dataset(context, dataset_id)
        defaults = self._creation_defaults(ref)
        if defaults.provider == "external":
            raise ValueError("External datasets are not supported.")
        resolved = {
            "doc_form": defaults.chunk_structure or "text_model",
            "doc_language": "English",
            **settings,
            "indexing_technique": settings.get("indexing_technique") or defaults.indexing_technique,
        }
        if not resolved["indexing_technique"]:
            raise ValueError("indexing_technique is required.")
        self._validate_model_settings(ref.tenant_id, resolved, embedding=True, reranking=True)
        upload_id = self._uploads.upload_file(context, filename=filename, content=content, mimetype=mimetype)
        return self._create_documents(
            context,
            ref,
            self._with_upload(resolved, upload_id),
            created_from=DocumentCreatedFrom.API,
        )

    def update_by_file(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        filename: str | None,
        content: bytes | None,
        mimetype: str | None,
        settings: Mapping[str, Any],
    ) -> dict[str, Any]:
        document_ref, _ = self._document(context, dataset_id, document_id)
        defaults = self._creation_defaults(document_ref.dataset)
        if defaults.provider == "external":
            raise ValueError("External datasets are not supported.")
        resolved = {
            "doc_form": defaults.chunk_structure or "text_model",
            "doc_language": "English",
            **settings,
            "indexing_technique": defaults.indexing_technique,
            "original_document_id": document_id,
        }
        if filename is not None:
            if content is None or mimetype is None:
                raise ValueError("File content and MIME type are required.")
            upload_id = self._uploads.upload_file(context, filename=filename, content=content, mimetype=mimetype)
            resolved = self._with_upload(resolved, upload_id)
        return self._create_documents(
            context,
            document_ref.dataset,
            resolved,
            created_from=DocumentCreatedFrom.API,
        )

    def initialize_dataset(self, context: RequestContext, *, settings: Mapping[str, Any]) -> dict[str, Any]:
        if context.resource_dataset_ids is not None:
            raise DatasetAccessDeniedError()
        config = validate_document_creation(KnowledgeConfig.model_validate(settings))
        if config.indexing_technique == "high_quality":
            if config.embedding_model is None or config.embedding_model_provider is None:
                raise ValueError("embedding model and embedding model provider are required for high quality indexing.")
            embedding = self._model_configuration.resolve_embedding_model(
                tenant_id=context.active_workspace_id,
                provider=config.embedding_model_provider,
                model=config.embedding_model,
            )
            config = config.model_copy(update={"is_multimodal": embedding.supports_vision})
        environment = self._creation.load_environment(context.active_workspace_id)
        config = prepare_document_creation(
            DocumentCreationDataset(
                context.active_workspace_id,
                config.indexing_technique,
                config.embedding_model,
                config.embedding_model_provider,
            ),
            config,
            environment,
            self._creation,
        )
        dataset_id = str(uuid4())
        ref = DatasetRef(context.active_workspace_id, dataset_id)
        result = self._run_creation(
            context,
            ref,
            config,
            initialize=True,
            created_from=DocumentCreatedFrom.WEB,
            priority=environment.priority_indexing,
            initial_permission=environment.initial_permission,
        )
        try:
            self._creator_access.initialize_creator_access(context, dataset_id=dataset_id)
        except Exception as access_error:
            if not self._datasets.delete_with_relations(ref):
                raise RuntimeError("failed to compensate dataset creation after RBAC initialization") from access_error
            raise
        return result

    def delete_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        self._require_mutable(state)
        try:
            self._documents.delete_document(ref)
        except DocumentPersistenceArchivedError as error:
            raise DocumentArchivedError(str(error)) from error

    def delete_documents(self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]) -> None:
        try:
            self._documents.delete_documents(self._dataset(context, dataset_id), document_ids)
        except DocumentPersistenceArchivedError as error:
            raise DocumentArchivedError(str(error)) from error

    def update_processing(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        action: Literal["pause", "resume"],
    ) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        if action == "pause":
            if state.indexing_status != "indexing":
                raise DocumentInvalidActionError("Document not in indexing state.")
            self._pause(ref, actor_id=context.account_id)
        elif action == "resume":
            if not state.is_paused:
                raise DocumentInvalidActionError("Document is not in paused state. Retry failed documents instead.")
            self._recover(ref)
        else:
            raise DocumentInvalidActionError("Invalid action.")

    def update_metadata(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        doc_type: str | None,
        doc_metadata: dict[str, Any] | None,
    ) -> None:
        ref, _ = self._document(context, dataset_id, document_id)
        if doc_type is None or doc_metadata is None:
            raise ValueError("Both doc_type and doc_metadata must be provided.")
        if doc_type not in DOCUMENT_METADATA_SCHEMA:
            raise ValueError("Invalid doc_type.")
        metadata = (
            doc_metadata
            if doc_type == "others"
            else {
                key: doc_metadata[key]
                for key, value_type in DOCUMENT_METADATA_SCHEMA[doc_type].items()
                if doc_metadata.get(key) is not None and isinstance(doc_metadata[key], value_type)
            }
        )
        try:
            self._documents.update_metadata(
                ref,
                doc_type=doc_type,
                doc_metadata=metadata,
                updated_at=naive_utc_now(),
            )
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error

    def change_status(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_ids: Sequence[str],
        action: Literal["enable", "disable", "archive", "un_archive"],
    ) -> None:
        ref = self._dataset(context, dataset_id)
        unique_ids = tuple(dict.fromkeys(document_ids))
        owned_id_set = {state.id for state in self._documents.get_states(ref, unique_ids)}
        owned_ids = tuple(document_id for document_id in unique_ids if document_id in owned_id_set)
        if not owned_ids:
            return
        configuration = self._datasets.get_model_configuration(ref)
        if configuration is None:
            raise DatasetNotFoundError()
        self._model_configuration.validate_dataset_model(configuration=configuration)
        for document_id in owned_ids:
            if self._lifecycle_cache.is_indexing(document_id):
                raise DocumentIndexingStateError("Document is being indexed, please try again later.")
        try:
            mutation = self._documents.change_status(
                ref,
                owned_ids,
                action=action,
                actor_id=context.account_id,
                generations={document_id: str(uuid4()) for document_id in owned_ids},
            )
        except DocumentPersistenceInvalidStateError as error:
            raise DocumentInvalidActionError(str(error)) from error
        self._lifecycle_cache.mark_indexing(mutation.indexing_document_ids)

    def pause_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        self._require_mutable(state)
        if state.indexing_status not in {"waiting", "parsing", "cleaning", "splitting", "indexing"}:
            raise DocumentIndexingStateError("Cannot pause completed document.")
        self._pause(ref, actor_id=context.account_id)

    def recover_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        self._require_mutable(state)
        if not state.is_paused:
            raise DocumentIndexingStateError("Document is not in paused status.")
        self._recover(ref)

    def retry_documents(self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]) -> None:
        ref = self._dataset(context, dataset_id)
        states = {state.id: state for state in self._documents.get_states(ref, document_ids)}
        retry_ids = [
            document_id
            for document_id in dict.fromkeys(document_ids)
            if (state := states.get(document_id)) is not None and state.indexing_retry_action == "retry"
        ]
        if not retry_ids:
            return
        leases: dict[str, KnowledgeIndexingLease] = {}
        try:
            for document_id in sorted(retry_ids):
                lease = self._indexing_locks.try_acquire(document_index_lock_name(document_id), timeout=600)
                if lease is None:
                    raise DocumentInvalidActionError("Document is being retried, please try again later.")
                leases[document_id] = lease
            generation = str(uuid4())
            enqueued_ids = set(
                self._documents.retry_documents(
                    ref,
                    retry_ids,
                    actor_id=context.account_id,
                    generation=generation,
                    lock_tokens={document_id: lease.token for document_id, lease in leases.items()},
                )
            )
            for document_id in retry_ids:
                if document_id not in enqueued_ids:
                    leases.pop(document_id).release()
        except Exception:
            for lease in leases.values():
                lease.release()
            raise

    def rename_document(
        self, context: RequestContext, *, dataset_id: str, document_id: str, name: str
    ) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        try:
            return self._documents.rename_document(ref, name)
        except DocumentPersistenceNotFoundError as error:
            raise DocumentNotFoundError(str(error)) from error

    def sync_website(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        if state.data_source_type != "website_crawl":
            raise ValueError("Document is not a website document.")
        self._require_mutable(state)
        generation = str(uuid4())
        if not self._lifecycle_cache.try_mark_syncing(ref.document_id, token=generation):
            raise DocumentInvalidActionError("Document is being synced, please try again later.")
        try:
            self._documents.sync_website(ref, generation=generation)
        except DocumentPersistenceNotFoundError as error:
            self._lifecycle_cache.clear_syncing(ref.document_id, token=generation)
            raise DocumentNotFoundError(str(error)) from error
        except DocumentPersistenceArchivedError as error:
            self._lifecycle_cache.clear_syncing(ref.document_id, token=generation)
            raise DocumentArchivedError(str(error)) from error
        except DocumentPersistenceInvalidStateError as error:
            self._lifecycle_cache.clear_syncing(ref.document_id, token=generation)
            raise DocumentInvalidActionError(str(error)) from error
        except Exception:
            self._lifecycle_cache.clear_syncing(ref.document_id, token=generation)
            raise

    def generate_summary(self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]) -> None:
        ref = self._dataset(context, dataset_id)
        configuration = self._documents.get_summary_configuration(ref)
        if configuration is None:
            raise DatasetNotFoundError()
        if configuration.indexing_technique != "high_quality":
            raise ValueError(
                "Summary generation is only available for 'high_quality' indexing technique. "
                f"Current indexing technique: {configuration.indexing_technique}"
            )
        if not configuration.enabled:
            raise ValueError("Summary index is not enabled for this dataset. Please enable it in the dataset settings.")
        states = self._documents.get_states(ref, document_ids)
        if len(states) != len(document_ids):
            missing_ids = set(document_ids) - {state.id for state in states}
            raise DocumentNotFoundError(f"Some documents not found: {sorted(missing_ids)}")
        targets = [state for state in states if state.doc_form != "qa_model"]
        self._documents.enable_summary(ref, [state.id for state in targets])
