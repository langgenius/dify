"""Console document use cases, independent of HTTP and persistence frameworks."""

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.resource_scope import DatasetRef, DocumentRef


@dataclass(frozen=True)
class DocumentListFilter:
    page: int = 1
    limit: int = 20
    search: str = ""
    sort: str = "-created_at"
    status: str | None = None
    fetch: bool = False


@dataclass(frozen=True)
class DocumentState:
    id: str
    archived: bool
    indexing_status: str
    is_paused: bool
    data_source_type: str
    doc_form: str
    need_summary: bool


@dataclass(frozen=True)
class DocumentZip:
    path: str
    filename: str


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


class DocumentOperations(Protocol):
    """Owned document operations; adapters return materialized values and own their sessions."""

    def find_document(self, *, workspace_id: str, document_id: str) -> DocumentRef | None: ...
    def get_state(self, ref: DocumentRef) -> DocumentState | None: ...
    def get_states(self, ref: DatasetRef, document_ids: Sequence[str]) -> Sequence[DocumentState]: ...
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
    def create_documents(
        self, context: RequestContext, ref: DatasetRef, settings: Mapping[str, Any]
    ) -> dict[str, Any]: ...
    def initialize_dataset(self, context: RequestContext, settings: Mapping[str, Any]) -> dict[str, Any]: ...
    def delete_document(self, ref: DocumentRef) -> None: ...
    def delete_documents(self, ref: DatasetRef, document_ids: Sequence[str]) -> None: ...
    def update_document(self, ref: DocumentRef, values: Mapping[str, object]) -> None: ...
    def rename_document(self, ref: DocumentRef, name: str) -> dict[str, Any]: ...
    def pause_document(self, ref: DocumentRef, *, actor_id: str) -> None: ...
    def recover_document(self, ref: DocumentRef) -> None: ...
    def retry_documents(self, ref: DatasetRef, document_ids: Sequence[str], *, actor_id: str) -> None: ...
    def change_status(
        self,
        context: RequestContext,
        ref: DatasetRef,
        document_ids: Sequence[str],
        action: Literal["enable", "disable", "archive", "un_archive"],
    ) -> None: ...
    def sync_website(self, ref: DocumentRef) -> None: ...
    def require_summary_enabled(self, ref: DatasetRef) -> None: ...
    def enable_summary(self, ref: DatasetRef, document_ids: Sequence[str]) -> None: ...
    def dispatch_summary(self, ref: DocumentRef) -> None: ...


class DatasetDocumentApplicationService:
    """Authorize document use cases and apply document state transitions."""

    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        operations: DocumentOperations,
        metadata_schema: Mapping[str, Mapping[str, type]],
    ) -> None:
        self._dataset_access = dataset_access
        self._operations = operations
        self._metadata_schema = metadata_schema

    def _dataset(self, context: RequestContext, dataset_id: str) -> DatasetRef:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        return DatasetRef(tenant_id=dataset.workspace_id, dataset_id=dataset.id)

    def _document(
        self, context: RequestContext, dataset_id: str, document_id: str
    ) -> tuple[DocumentRef, DocumentState]:
        ref = self._dataset(context, dataset_id).document(document_id)
        state = self._operations.get_state(ref)
        if state is None:
            raise DocumentNotFoundError("Document not found.")
        return ref, state

    @staticmethod
    def _require_mutable(state: DocumentState) -> None:
        if state.archived:
            raise DocumentArchivedError()

    def get_process_rule(self, context: RequestContext, *, document_id: str | None) -> dict[str, Any]:
        ref = None
        if document_id:
            document_ref = self._operations.find_document(
                workspace_id=context.active_workspace_id, document_id=document_id
            )
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

    def create_documents(
        self, context: RequestContext, *, dataset_id: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        return self._operations.create_documents(context, self._dataset(context, dataset_id), settings)

    def initialize_dataset(self, context: RequestContext, *, settings: Mapping[str, Any]) -> dict[str, Any]:
        return self._operations.initialize_dataset(context, settings)

    def delete_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, _ = self._document(context, dataset_id, document_id)
        self._operations.delete_document(ref)

    def delete_documents(self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]) -> None:
        self._operations.delete_documents(self._dataset(context, dataset_id), document_ids)

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
            values: dict[str, object] = {
                "paused_by": context.account_id,
                "paused_at": naive_utc_now(),
                "is_paused": True,
            }
        elif action == "resume":
            if state.indexing_status not in {"paused", "error"}:
                raise DocumentInvalidActionError("Document not in paused or error state.")
            values = {"paused_by": None, "paused_at": None, "is_paused": False}
        else:
            raise DocumentInvalidActionError("Invalid action.")
        self._operations.update_document(ref, values)

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
        if doc_type not in self._metadata_schema:
            raise ValueError("Invalid doc_type.")
        metadata = (
            doc_metadata
            if doc_type == "others"
            else {
                key: doc_metadata[key]
                for key, value_type in self._metadata_schema[doc_type].items()
                if doc_metadata.get(key) is not None and isinstance(doc_metadata[key], value_type)
            }
        )
        self._operations.update_document(
            ref, {"doc_type": doc_type, "doc_metadata": metadata, "updated_at": naive_utc_now()}
        )

    def change_status(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_ids: Sequence[str],
        action: Literal["enable", "disable", "archive", "un_archive"],
    ) -> None:
        self._operations.change_status(context, self._dataset(context, dataset_id), document_ids, action)

    def pause_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        self._require_mutable(state)
        if state.indexing_status not in {"waiting", "parsing", "cleaning", "splitting", "indexing"}:
            raise DocumentIndexingStateError("Cannot pause completed document.")
        self._operations.pause_document(ref, actor_id=context.account_id)

    def recover_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        self._require_mutable(state)
        if not state.is_paused:
            raise DocumentIndexingStateError("Document is not in paused status.")
        self._operations.recover_document(ref)

    def retry_documents(self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]) -> None:
        ref = self._dataset(context, dataset_id)
        states = {state.id: state for state in self._operations.get_states(ref, document_ids)}
        retry_ids = [
            document_id
            for document_id in dict.fromkeys(document_ids)
            if (state := states.get(document_id)) is not None
            and not state.archived
            and state.indexing_status != "completed"
        ]
        self._operations.retry_documents(ref, retry_ids, actor_id=context.account_id)

    def rename_document(
        self, context: RequestContext, *, dataset_id: str, document_id: str, name: str
    ) -> dict[str, Any]:
        ref, _ = self._document(context, dataset_id, document_id)
        return self._operations.rename_document(ref, name)

    def sync_website(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        ref, state = self._document(context, dataset_id, document_id)
        if state.data_source_type != "website_crawl":
            raise ValueError("Document is not a website document.")
        self._require_mutable(state)
        self._operations.sync_website(ref)

    def generate_summary(self, context: RequestContext, *, dataset_id: str, document_ids: Sequence[str]) -> None:
        ref = self._dataset(context, dataset_id)
        self._operations.require_summary_enabled(ref)
        states = self._operations.get_states(ref, document_ids)
        if len(states) != len(document_ids):
            missing_ids = set(document_ids) - {state.id for state in states}
            raise DocumentNotFoundError(f"Some documents not found: {sorted(missing_ids)}")
        targets = [state for state in states if state.doc_form != "qa_model"]
        self._operations.enable_summary(ref, [state.id for state in targets if not state.need_summary])
        for state in targets:
            self._operations.dispatch_summary(ref.document(state.id))
