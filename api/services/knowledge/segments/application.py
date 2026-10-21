"""Application service for dataset segment and child-chunk HTTP use cases."""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import replace
from typing import Literal, Protocol
from uuid import uuid4

from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessDeniedError
from services.knowledge.entities.segments import (
    ChildChunkRecord,
    ChildChunkUpdateArgs,
    SegmentRecord,
    SegmentUpdateArgs,
)
from services.knowledge.indexing.locks import (
    dataset_index_lock_name,
    document_index_lock_name,
    segment_status_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.segments.contracts import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentBatchImport,
    SegmentChildIndexCompletion,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentCreationState,
    SegmentIndexingMutationError,
    SegmentIndexReconcileOutcome,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentMutationScope,
    SegmentPage,
    SegmentPageData,
    SegmentReadSnapshot,
    SegmentScope,
    SegmentUpdateState,
)

_HIGH_QUALITY = "high_quality"
_BATCH_STATE_CHANGED_ERROR = "Segment indexing was cancelled because the batch state changed"
logger = logging.getLogger(__name__)


def _noop() -> None:
    pass


class SegmentScopeReader(Protocol):
    def get_segment_scope(
        self,
        *,
        dataset_ref: DatasetRef,
        document_id: str,
        actor_id: str | None,
    ) -> SegmentScope: ...


class SegmentStore(Protocol):
    """Owner-scoped persistence; each operation owns a short session."""

    def list_segments(
        self,
        document_ref: DocumentRef,
        query: SegmentListFilter,
    ) -> SegmentPageData[SegmentReadSnapshot]: ...
    def get_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> tuple[SegmentIndexTarget, ...]: ...
    def get_segment(self, segment_ref: SegmentRef) -> SegmentDetail[SegmentReadSnapshot] | None: ...
    def get_segment_details(
        self, document_ref: DocumentRef, segment_ids: Sequence[str]
    ) -> tuple[SegmentDetail[SegmentReadSnapshot], ...]: ...
    def get_document_creation_state(self, document_ref: DocumentRef) -> SegmentDocumentCreationState | None: ...
    def get_segment_update_state(self, segment_ref: SegmentRef) -> SegmentUpdateState | None: ...
    def create_segments(
        self,
        document_ref: DocumentRef,
        values: Sequence[Mapping[str, object]],
        *,
        attachment_ids_list: Sequence[Sequence[str]],
        generation: str,
        batch_job_id: str | None,
    ) -> SegmentDocumentCreationState | None: ...
    def save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object]) -> None: ...
    def delete_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> None: ...
    def list_child_chunks(self, segment_ref: SegmentRef, query: ChildChunkListFilter) -> ChildChunkPage | None: ...
    def set_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str], values: Mapping[str, object]
    ) -> None: ...
    def set_segment_status(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        action: Literal["enable", "disable"],
        actor_id: str,
    ) -> None: ...
    def get_children(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...] | None: ...
    def save_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
        completion: SegmentChildIndexCompletion | None = None,
    ) -> str | None: ...
    def complete_created_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str], *, generation: str
    ) -> int: ...
    def fail_created_segments(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        generation: str,
        error: str,
    ) -> int: ...
    def enqueue_created_segments_repair(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        batch_job_id: str | None,
    ) -> bool: ...
    def enqueue_child_reconcile_repair(
        self,
        segment_ref: SegmentRef,
        *,
        delete_node_ids: Sequence[str],
        completion: SegmentChildIndexCompletion | None,
    ) -> bool: ...
    def complete_child_reconcile(
        self, segment_ref: SegmentRef, completion: SegmentChildIndexCompletion
    ) -> SegmentIndexReconcileOutcome: ...
    def fail_child_reconcile(
        self,
        segment_ref: SegmentRef,
        completion: SegmentChildIndexCompletion,
        *,
        error: str,
    ) -> bool: ...


class SegmentIndex(Protocol):
    def count_tokens(self, dataset: SegmentDatasetRecord, text: str) -> int: ...
    def count_tokens_many(self, dataset: SegmentDatasetRecord, texts: Sequence[str]) -> Sequence[int]: ...
    def create_many(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None,
        attachment_ids_list: Sequence[Sequence[str]] | None = None,
    ) -> None: ...
    def create(
        self, segment_ref: SegmentRef, *, keywords: Sequence[str] | None, attachment_ids: Sequence[str]
    ) -> None: ...
    def update(self, segment_ref: SegmentRef, *, keywords: Sequence[str] | None, regenerate_children: bool) -> None: ...
    def update_attachments(self, segment_ref: SegmentRef, attachment_ids: Sequence[str]) -> None: ...
    def update_summary(self, segment_ref: SegmentRef, *, summary: str | None, content_changed: bool) -> None: ...
    def reconcile_children(self, segment_ref: SegmentRef, *, delete_node_ids: Sequence[str]) -> None: ...
    def reconcile_created(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        generation: str,
        batch_job_id: str | None,
        assert_owned: Callable[[], None],
    ) -> SegmentIndexReconcileOutcome: ...


class SegmentLimits(Protocol):
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int
    DATASET_MAX_SEGMENTS_PER_REQUEST: int


class SegmentModelGuard(Protocol):
    def check(self, dataset: SegmentDatasetRecord) -> None: ...


class SegmentUploadCatalog(Protocol):
    def get_file_name(self, *, workspace_id: str, upload_file_id: str) -> str | None: ...


class SegmentIndexingState(Protocol):
    def lock(self, name: str, *, timeout: int) -> AbstractContextManager[object]: ...
    def is_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> bool: ...
    def mark_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> None: ...

    def is_document_indexing(self, document_id: str) -> bool: ...

    def set_batch_waiting(self, job_id: str) -> None: ...

    def get_batch_status(self, job_id: str) -> str | None: ...


class SegmentBatchImportDispatcher(Protocol):
    def dispatch(
        self,
        *,
        job_id: str,
        upload_file_id: str,
        dataset_id: str,
        document_id: str,
        workspace_id: str,
        actor_id: str,
    ) -> None: ...


class SegmentPresenter(Protocol):
    def present(self, snapshots: Sequence[SegmentReadSnapshot]) -> tuple[SegmentRecord, ...]: ...


class SegmentApplicationError(Exception):
    """Base class for framework-neutral segment use-case errors."""


class SegmentDatasetNotFoundError(SegmentApplicationError):
    pass


class SegmentDocumentNotFoundError(SegmentApplicationError):
    pass


class SegmentDocumentNotCompletedError(SegmentApplicationError):
    pass


class SegmentDocumentDisabledError(SegmentApplicationError):
    pass


class SegmentNotFoundError(SegmentApplicationError):
    pass


class ChildChunkNotFoundError(SegmentApplicationError):
    pass


class ChildChunkValidationError(SegmentApplicationError, ValueError):
    """The requested child-chunk replacement is internally inconsistent."""


class SegmentMixedStatusUpdateError(SegmentApplicationError, ValueError):
    """A status transition cannot be combined with content mutations."""


class SegmentUploadFileNotFoundError(SegmentApplicationError):
    pass


class SegmentPermissionDeniedError(SegmentApplicationError):
    pass


class SegmentInvalidFileTypeError(SegmentApplicationError):
    pass


class SegmentDocumentIndexingError(SegmentApplicationError):
    pass


class SegmentStatusUpdateError(SegmentApplicationError):
    pass


class SegmentBatchImportDispatchError(SegmentApplicationError):
    pass


class SegmentBatchImportNotFoundError(SegmentApplicationError):
    pass


class SegmentModelProviderError(Exception):
    """Adapter error raised when the configured embedding model cannot be loaded."""

    def __init__(self, *, kind: Literal["bad_request", "token"], description: str) -> None:
        super().__init__(description)
        self.kind = kind
        self.description = description


class SegmentDatasetModelUnavailableError(SegmentApplicationError):
    pass


class SegmentEmbeddingModelUnavailableError(SegmentApplicationError):
    pass


class ChildChunkIndexingApplicationError(SegmentApplicationError):
    pass


class DatasetSegmentApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        scopes: SegmentScopeReader,
        store: SegmentStore,
        presenter: SegmentPresenter,
        index: SegmentIndex,
        limits: SegmentLimits,
        text_hash: Callable[[str], str],
        uploads: SegmentUploadCatalog,
        model_guard: SegmentModelGuard,
        indexing_state: SegmentIndexingState,
        batch_dispatcher: SegmentBatchImportDispatcher,
        job_id_factory: Callable[[], str],
    ) -> None:
        self._dataset_access = dataset_access
        self._scopes = scopes
        self._store = store
        self._presenter = presenter
        self._index = index
        self._limits = limits
        self._uploads = uploads
        self._model_guard = model_guard
        self._indexing_state = indexing_state
        self._batch_dispatcher = batch_dispatcher
        self._job_id_factory = job_id_factory
        self.mutations = SegmentMutationService(
            store=store, index=index, text_hash=text_hash, indexing_state=indexing_state
        )

    def list_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        query: SegmentListFilter,
    ) -> SegmentPage:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        result = self._store.list_segments(scope.document.ref, query)
        return SegmentPage(
            items=self._presenter.present(result.items),
            total=result.total,
            total_pages=result.total_pages,
            page=result.page,
            limit=result.limit,
            doc_form=scope.document.doc_form,
        )

    def list_segments_requiring_embedding_model(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        query: SegmentListFilter,
    ) -> SegmentPage:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        self._check_embedding_model(scope.dataset)
        result = self._store.list_segments(scope.document.ref, query)
        return SegmentPage(
            items=self._presenter.present(result.items),
            total=result.total,
            total_pages=result.total_pages,
            page=result.page,
            limit=result.limit,
            doc_form=scope.document.doc_form,
        )

    def get_segment(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
    ) -> SegmentDetail:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        self._check_dataset_model(scope.dataset)
        return self._detail(scope.document.ref.segment(segment_id))

    def create_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        values: Sequence[Mapping[str, object]],
    ) -> tuple[SegmentDetail, ...]:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        _require_segment_creation_state(self._store.get_document_creation_state(scope.document.ref))
        self._check_embedding_model(scope.dataset)
        limit = self._limits.DATASET_MAX_SEGMENTS_PER_REQUEST
        if limit > 0 and len(values) > limit:
            raise ValueError(f"Exceeded maximum segments limit of {limit}.")
        args = tuple(self._validate_create_values(item, scope.document.doc_form) for item in values)
        segment_refs = self.mutations.create_segments(scope, actor_id=context.account_id, args=args)
        details = self._store.get_segment_details(scope.document.ref, [ref.segment_id for ref in segment_refs])
        if len(details) != len(segment_refs):
            raise SegmentNotFoundError("Segment not found")
        return self._present_details(details)

    def create_imported_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        values: Sequence[Mapping[str, object]],
        job_id: str,
    ) -> tuple[SegmentDetail, ...]:
        """Validate and enqueue CSV-created segments through the public create boundary."""

        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        _require_segment_creation_state(self._store.get_document_creation_state(scope.document.ref))
        self._check_embedding_model(scope.dataset)
        limit = self._limits.DATASET_MAX_SEGMENTS_PER_REQUEST
        if limit > 0 and len(values) > limit:
            raise ValueError(f"Exceeded maximum segments limit of {limit}.")
        args = tuple(self._validate_create_values(item, scope.document.doc_form) for item in values)
        segment_refs = self.mutations.create_imported_segments(
            scope,
            actor_id=context.account_id,
            args=args,
            job_id=job_id,
        )
        details = self._store.get_segment_details(scope.document.ref, [ref.segment_id for ref in segment_refs])
        if len(details) != len(segment_refs):
            raise SegmentNotFoundError("Segment not found")
        return self._present_details(details)

    def delete_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_ids: Sequence[str],
    ) -> None:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        self._check_dataset_model(scope.dataset)
        with self._indexing_state.lock(dataset_index_lock_name(scope.dataset.id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
                self._store.delete_segments(scope.document.ref, segment_ids)

    def change_segment_status(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_ids: Sequence[str],
        action: Literal["enable", "disable"],
    ) -> None:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        self._check_dataset_model(scope.dataset)
        self._check_embedding_model(scope.dataset)
        if self._indexing_state.is_document_indexing(scope.document.id):
            raise SegmentDocumentIndexingError("Document is being indexed, please try again later")
        try:
            with self._indexing_state.lock(dataset_index_lock_name(scope.dataset.id), timeout=600):
                with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
                    with self._indexing_state.lock(segment_status_lock_name(scope.document.id), timeout=600):
                        segments = self._store.get_segments(scope.document.ref, segment_ids)
                        ids = []
                        for segment in segments:
                            if (
                                segment.enabled == (action == "enable") and segment.status != "error"
                            ) or self._indexing_state.is_segment_indexing(segment.id):
                                continue
                            ids.append(segment.id)
                        if ids:
                            self._store.set_segment_status(
                                scope.document.ref,
                                ids,
                                action=action,
                                actor_id=context.account_id,
                            )
        except Exception as error:
            raise SegmentStatusUpdateError(str(error)) from error

    def create_segment(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        values: Mapping[str, object],
    ) -> SegmentDetail:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        _require_segment_creation_state(self._store.get_document_creation_state(scope.document.ref))
        self._check_embedding_model(scope.dataset)
        args = self._validate_create_values(values, scope.document.doc_form)
        segment_ref = self.mutations.create_segment(scope, actor_id=context.account_id, args=args)
        return self._detail(segment_ref)

    def update_segment(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        values: Mapping[str, object],
    ) -> SegmentDetail:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        args = self._validate_update_values(values, scope.document.doc_form)
        segment_ref = scope.document.ref.segment(segment_id)
        previous = self._store.get_segment_update_state(segment_ref)
        if previous is not None and previous.status == "indexing":
            raise SegmentDocumentIndexingError("Segment is indexing, please try again later")
        if scope.document.doc_form != "qa_model" or "answer" not in args.model_fields_set:
            previous = None
        if previous is None or not _is_qa_answer_only_update(args, previous):
            self._check_dataset_model(scope.dataset)
            self._check_embedding_model(scope.dataset)
        self.mutations.update_segment(
            scope,
            actor_id=context.account_id,
            segment_id=segment_id,
            args=args,
        )
        return self._detail(scope.document.ref.segment(segment_id))

    def _detail(self, segment_ref: SegmentRef) -> SegmentDetail:
        result = self._store.get_segment(segment_ref)
        if result is None:
            raise SegmentNotFoundError("Segment not found")
        return SegmentDetail(data=self._presenter.present((result.data,))[0], doc_form=result.doc_form)

    def _present_details(
        self,
        details: Sequence[SegmentDetail[SegmentReadSnapshot]],
    ) -> tuple[SegmentDetail, ...]:
        records = self._presenter.present(tuple(detail.data for detail in details))
        return tuple(
            SegmentDetail(data=record, doc_form=detail.doc_form)
            for detail, record in zip(details, records, strict=True)
        )

    def delete_segment(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
    ) -> None:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        self._check_dataset_model(scope.dataset)
        return self.mutations.delete_segment(scope.document.ref.segment(segment_id))

    def start_batch_import(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        upload_file_id: str,
    ) -> SegmentBatchImport:
        scope = self._require_scope(
            context,
            dataset_id=dataset_id,
            document_id=document_id,
        )
        filename = self._uploads.get_file_name(
            workspace_id=scope.dataset.workspace_id,
            upload_file_id=upload_file_id,
        )
        if filename is None:
            raise SegmentUploadFileNotFoundError("UploadFile not found")
        if not filename.lower().endswith(".csv"):
            raise SegmentInvalidFileTypeError("Invalid file type. Only CSV files are allowed")

        job_id = self._job_id_factory()
        try:
            self._indexing_state.set_batch_waiting(job_id)
            self._batch_dispatcher.dispatch(
                job_id=job_id,
                upload_file_id=upload_file_id,
                dataset_id=scope.dataset.id,
                document_id=scope.document.id,
                workspace_id=scope.dataset.workspace_id,
                actor_id=context.account_id,
            )
        except Exception as error:
            raise SegmentBatchImportDispatchError(str(error)) from error
        return SegmentBatchImport(job_id=job_id, job_status="waiting")

    def get_batch_import_status(self, job_id: str) -> SegmentBatchImport:
        status = self._indexing_state.get_batch_status(job_id)
        if status is None:
            raise SegmentBatchImportNotFoundError("The job does not exist.")
        return SegmentBatchImport(job_id=job_id, job_status=status)

    def create_child_chunk(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        content: str,
    ) -> ChildChunkRecord:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        segment_ref = scope.document.ref.segment(segment_id)
        self._require_child_mutation_ready(segment_ref)
        self._check_embedding_model(scope.dataset)
        return self.mutations.create_child_chunk(segment_ref, content=content, actor_id=context.account_id)

    def list_child_chunks(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        query: ChildChunkListFilter,
    ) -> ChildChunkPage:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        result = self._store.list_child_chunks(scope.document.ref.segment(segment_id), query)
        if result is None:
            raise SegmentNotFoundError("Segment not found")
        return result

    def update_child_chunks(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        chunks: Sequence[ChildChunkUpdateArgs],
    ) -> tuple[ChildChunkRecord, ...]:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        segment_ref = scope.document.ref.segment(segment_id)
        self._require_child_mutation_ready(segment_ref)
        self._check_dataset_model(scope.dataset)
        return self.mutations.update_child_chunks(segment_ref, chunks=chunks, actor_id=context.account_id)

    def delete_child_chunk(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        child_chunk_id: str,
    ) -> None:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        return self.mutations.delete_child_chunk(scope.document.ref.segment(segment_id), child_chunk_id=child_chunk_id)

    def update_child_chunk(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        child_chunk_id: str,
        content: str,
    ) -> ChildChunkRecord:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        segment_ref = scope.document.ref.segment(segment_id)
        self._require_child_mutation_ready(segment_ref)
        self._check_dataset_model(scope.dataset)
        return self.mutations.update_child_chunk(
            segment_ref,
            child_chunk_id=child_chunk_id,
            content=content,
            actor_id=context.account_id,
        )

    def _require_child_mutation_ready(self, segment_ref: SegmentRef) -> None:
        state = self._store.get_segment_update_state(segment_ref)
        if state is not None and state.status == "indexing":
            raise ChildChunkIndexingApplicationError("Segment is indexing, please try again later")

    def _validate_create_values(self, values: Mapping[str, object], doc_form: str) -> SegmentUpdateArgs:
        return validate_segment_values(
            values, doc_form=doc_form, attachment_limit=self._limits.SINGLE_CHUNK_ATTACHMENT_LIMIT
        )

    def _validate_update_values(self, values: Mapping[str, object], doc_form: str) -> SegmentUpdateArgs:
        return validate_segment_update_values(
            values, doc_form=doc_form, attachment_limit=self._limits.SINGLE_CHUNK_ATTACHMENT_LIMIT
        )

    def _require_scope(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
    ) -> SegmentMutationScope:
        scope = self._scopes.get_segment_scope(
            dataset_ref=DatasetRef(context.active_workspace_id, dataset_id),
            document_id=document_id,
            actor_id=context.account_id,
        )
        dataset = scope.dataset
        if dataset is None:
            raise SegmentDatasetNotFoundError("Dataset not found")
        if scope.access_snapshot is None:
            raise SegmentPermissionDeniedError("Dataset access state is missing")
        try:
            self._dataset_access.check_access(context, scope.access_snapshot)
        except DatasetAccessDeniedError as error:
            raise SegmentPermissionDeniedError(str(error)) from error
        document = scope.document
        if document is None:
            raise SegmentDocumentNotFoundError("Document not found")
        return SegmentMutationScope(dataset=dataset, document=document)

    def _check_dataset_model(self, dataset: SegmentDatasetRecord) -> None:
        if dataset.indexing_technique != _HIGH_QUALITY:
            return
        try:
            self._model_guard.check(dataset)
        except SegmentModelProviderError as error:
            if error.kind == "token":
                message = f"The dataset is unavailable, due to: {error.description}"
            else:
                message = (
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            raise SegmentDatasetModelUnavailableError(message) from error

    def _check_embedding_model(self, dataset: SegmentDatasetRecord) -> None:
        if dataset.indexing_technique != _HIGH_QUALITY:
            return
        try:
            self._model_guard.check(dataset)
        except SegmentModelProviderError as error:
            if error.kind == "bad_request":
                message = (
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            else:
                message = error.description
            raise SegmentEmbeddingModelUnavailableError(message) from error


class SegmentMutationService:
    """Shared writes for Console and Service API after their own admission checks.

    Callers supply an owner chain reconstructed from authorized database rows.
    Persistence ports recheck that chain and own their transactions. Partial
    update arguments are accepted here; transport validation stays at admission.
    """

    def __init__(
        self,
        *,
        store: SegmentStore,
        index: SegmentIndex,
        text_hash: Callable[[str], str],
        indexing_state: SegmentIndexingState,
    ) -> None:
        self._store = store
        self._index = index
        self._text_hash = text_hash
        self._indexing_state = indexing_state

    def index_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None = None,
        attachment_ids_list: Sequence[Sequence[str]] | None = None,
    ) -> None:
        """Index a committed batch and persist failures through the scoped store.

        Callers must finish their write transaction before invoking this method.
        The index adapter reloads the complete owner chain before external I/O.
        """
        with self._indexing_state.lock(dataset_index_lock_name(document_ref.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(document_ref.document_id), timeout=600):
                self._index_segments_locked(
                    document_ref,
                    segment_ids=segment_ids,
                    keywords_list=keywords_list,
                    attachment_ids_list=attachment_ids_list,
                )

    def _index_segments_locked(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None = None,
        attachment_ids_list: Sequence[Sequence[str]] | None = None,
    ) -> None:
        if keywords_list is not None and len(keywords_list) != len(segment_ids):
            raise ValueError("Keywords must correspond to the segment batch")
        if not segment_ids:
            return
        try:
            self._index.create_many(
                document_ref,
                segment_ids=segment_ids,
                keywords_list=keywords_list,
                attachment_ids_list=attachment_ids_list,
            )
        except Exception as error:
            logger.exception("Batch indexing failed for document %s", document_ref.document_id)
            self._store.set_segments(
                document_ref,
                segment_ids,
                {"enabled": False, "disabled_at": naive_utc_now(), "status": "error", "error": str(error)},
            )
            raise

    def create_segments(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        args: Sequence[SegmentUpdateArgs],
    ) -> tuple[SegmentRef, ...]:
        return self._create_segments(scope, actor_id=actor_id, args=args, batch_job_id=None)

    def create_imported_segments(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        args: Sequence[SegmentUpdateArgs],
        job_id: str,
    ) -> tuple[SegmentRef, ...]:
        return self._create_segments(scope, actor_id=actor_id, args=args, batch_job_id=job_id)

    def _create_segments(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        args: Sequence[SegmentUpdateArgs],
        batch_job_id: str | None,
    ) -> tuple[SegmentRef, ...]:
        if not args:
            return ()
        document_ref = scope.document.ref
        now = naive_utc_now()
        generation = str(uuid4())
        segment_refs = tuple(document_ref.segment(str(uuid4())) for _ in args)
        values: list[Mapping[str, object]] = []
        attachment_ids_list: list[Sequence[str]] = []
        contents = [item.content or "" for item in args]
        token_counts = self._index.count_tokens_many(scope.dataset, contents)
        if len(token_counts) != len(args):
            raise ValueError("Token counts must correspond to the segment batch")
        for segment_ref, item, content, tokens in zip(segment_refs, args, contents, token_counts, strict=True):
            answer = item.answer if scope.document.doc_form == "qa_model" else None
            values.append(
                {
                    "id": segment_ref.segment_id,
                    "content": content,
                    "answer": answer,
                    "word_count": len(content) + len(answer or ""),
                    "tokens": tokens,
                    "keywords": item.keywords or [],
                    "index_node_id": str(uuid4()),
                    "index_node_hash": self._text_hash(content),
                    "created_by": actor_id,
                    "status": "indexing",
                    "indexing_at": now,
                    "indexing_generation": generation,
                    "completed_at": None,
                }
            )
            attachment_ids_list.append(item.attachment_ids or ())
        with self._indexing_state.lock(dataset_index_lock_name(scope.dataset.id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
                state = self._store.create_segments(
                    document_ref,
                    values,
                    attachment_ids_list=attachment_ids_list,
                    generation=generation,
                    batch_job_id=batch_job_id,
                )
                _require_segment_creation_state(state)
        return segment_refs

    def create_segment(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        args: SegmentUpdateArgs,
    ) -> SegmentRef:
        return self._create_segments(scope, actor_id=actor_id, args=(args,), batch_job_id=None)[0]

    def reconcile_created_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        generation: str,
        job_id: str | None = None,
        assert_owned: Callable[[], None] | None = None,
    ) -> SegmentIndexReconcileOutcome:
        ownership_check = assert_owned or _noop

        def cancel_current_generation() -> SegmentIndexReconcileOutcome:
            ownership_check()
            self._store.fail_created_segments(
                document_ref,
                segment_ids,
                generation=generation,
                error=_BATCH_STATE_CHANGED_ERROR,
            )
            return SegmentIndexReconcileOutcome.CANCELLED

        with self._indexing_state.lock(dataset_index_lock_name(document_ref.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(document_ref.document_id), timeout=600):
                ownership_check()
                targets = self._store.get_segments(document_ref, segment_ids)
                requested_ids = set(segment_ids)
                generation_targets = [target for target in targets if target.generation == generation]
                if (
                    len(requested_ids) != len(segment_ids)
                    or {target.id for target in generation_targets} != requested_ids
                    or any(
                        not target.enabled or target.status not in {"indexing", "completed"}
                        for target in generation_targets
                    )
                ):
                    return cancel_current_generation()
                current_ids = [target.id for target in generation_targets if target.status == "indexing"]
                if not current_ids:
                    return (
                        SegmentIndexReconcileOutcome.COMPLETED
                        if generation_targets and all(target.status == "completed" for target in generation_targets)
                        else SegmentIndexReconcileOutcome.CANCELLED
                    )
                outcome = self._index.reconcile_created(
                    document_ref,
                    segment_ids=current_ids,
                    generation=generation,
                    batch_job_id=job_id,
                    assert_owned=ownership_check,
                )
                if outcome != SegmentIndexReconcileOutcome.COMPLETED:
                    return outcome
                ownership_check()
                completed_count = self._store.complete_created_segments(
                    document_ref,
                    current_ids,
                    generation=generation,
                )
                if completed_count != len(current_ids):
                    return cancel_current_generation()
                return SegmentIndexReconcileOutcome.COMPLETED

    def fail_created_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        generation: str,
        error: str,
    ) -> bool:
        return bool(
            self._store.fail_created_segments(
                document_ref,
                segment_ids,
                generation=generation,
                error=error,
            )
        )

    def enqueue_created_segments_repair(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        batch_job_id: str | None,
    ) -> bool:
        """Persist a successor from the segments' current locked generation."""

        return self._store.enqueue_created_segments_repair(
            document_ref,
            segment_ids,
            batch_job_id=batch_job_id,
        )

    def update_segment(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        segment_id: str,
        args: SegmentUpdateArgs,
    ) -> None:
        with self._indexing_state.lock(dataset_index_lock_name(scope.dataset.id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_id), timeout=600):
                    self._update_segment_locked(
                        scope,
                        actor_id=actor_id,
                        segment_id=segment_id,
                        args=args,
                    )

    def _update_segment_locked(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        segment_id: str,
        args: SegmentUpdateArgs,
    ) -> None:
        _validate_segment_update_mode(args)
        segment_ref = scope.document.ref.segment(segment_id)
        current = self._store.get_segment_update_state(segment_ref)
        if current is None:
            raise SegmentNotFoundError("Segment not found")
        if current.status == "indexing" or self._indexing_state.is_segment_indexing(segment_id):
            raise SegmentDocumentIndexingError("Segment is indexing, please try again later")
        previous = current
        if args.enabled is True and args.model_fields_set == {"enabled"}:
            if not previous.enabled or previous.status == "error":
                with self._indexing_state.lock(segment_status_lock_name(scope.document.id), timeout=600):
                    try:
                        self._store.set_segment_status(
                            scope.document.ref,
                            [segment_id],
                            action="enable",
                            actor_id=actor_id,
                        )
                    except SegmentIndexingMutationError as error:
                        raise SegmentDocumentIndexingError(str(error)) from error
            return
        if args.enabled is False:
            if previous.enabled or previous.status == "error":
                with self._indexing_state.lock(segment_status_lock_name(scope.document.id), timeout=600):
                    try:
                        self._store.set_segment_status(
                            scope.document.ref,
                            [segment_id],
                            action="disable",
                            actor_id=actor_id,
                        )
                    except SegmentIndexingMutationError as error:
                        raise SegmentDocumentIndexingError(str(error)) from error
            return
        if not previous.enabled and args.enabled is not True:
            raise ValueError("Can't update disabled segment")
        content = args.content if args.content is not None else previous.content
        content_changed = content != previous.content
        answer = args.answer if args.answer is not None else previous.answer
        answer_changed = scope.document.doc_form == "qa_model" and answer != previous.answer
        keyword_changed = args.keywords is not None and Counter(previous.keywords or ()) != Counter(args.keywords)
        if scope.document.doc_form == "qa_model" and _is_qa_answer_only_update(args, previous):
            if answer_changed:
                self._save_segment(
                    segment_ref,
                    {
                        "answer": answer,
                        "word_count": len(content) + len(answer or ""),
                        "updated_at": naive_utc_now(),
                        "updated_by": actor_id,
                    },
                )
            return
        changes: dict[str, object] = {
            "content": content,
            "word_count": len(content) + (len(answer or "") if scope.document.doc_form == "qa_model" else 0),
            "enabled": True,
            "disabled_at": None,
            "disabled_by": None,
        }
        if scope.document.doc_form == "qa_model":
            changes["answer"] = answer
        if args.keywords is not None:
            changes["keywords"] = args.keywords
        try:
            if content_changed:
                now = naive_utc_now()
                changes.update(
                    index_node_hash=self._text_hash(content),
                    tokens=self._index.count_tokens(scope.dataset, content),
                    status="completed",
                    indexing_at=now,
                    completed_at=now,
                    updated_at=now,
                    updated_by=actor_id,
                )
            self._save_segment(segment_ref, changes)
            if scope.document.doc_form == "hierarchical_model":
                if args.regenerate_child_chunks:
                    self._index.update(segment_ref, keywords=args.keywords, regenerate_children=True)
            elif content_changed or args.enabled or keyword_changed:
                self._index.update(segment_ref, keywords=args.keywords, regenerate_children=False)
            if args.attachment_ids is not None:
                self._index.update_attachments(segment_ref, args.attachment_ids)
            if scope.dataset.indexing_technique == _HIGH_QUALITY:
                try:
                    self._index.update_summary(segment_ref, summary=args.summary, content_changed=content_changed)
                except Exception:
                    logger.exception("Failed to update summary for segment %s", segment_id)
        except SegmentDocumentIndexingError:
            raise
        except Exception as error:
            self._mark_error(segment_ref, error)

    def delete_segment(self, segment_ref: SegmentRef) -> None:
        with self._indexing_state.lock(dataset_index_lock_name(segment_ref.document.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_ref.segment_id), timeout=600):
                    self._delete_segment_locked(segment_ref)

    def _delete_segment_locked(self, segment_ref: SegmentRef) -> None:
        segments = self._store.get_segments(segment_ref.document, (segment_ref.segment_id,))
        if not segments:
            raise SegmentNotFoundError("Segment not found")
        if self._indexing_state.is_segment_indexing(segment_ref.segment_id, deleting=True):
            raise ValueError("Segment is deleting.")
        self._store.delete_segments(segment_ref.document, (segment_ref.segment_id,))

    def create_child_chunk(self, segment_ref: SegmentRef, *, content: str, actor_id: str) -> ChildChunkRecord:
        with self._indexing_state.lock(dataset_index_lock_name(segment_ref.document.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_ref.segment_id), timeout=600):
                    children = self._children_for_mutation(segment_ref)
                    child = self._new_child(
                        segment_ref, content, max((c.data.position for c in children), default=0) + 1, actor_id
                    )
                    self._write_children(segment_ref, added=(child,))
        return child.data

    def update_child_chunks(
        self, segment_ref: SegmentRef, *, chunks: Sequence[ChildChunkUpdateArgs], actor_id: str
    ) -> tuple[ChildChunkRecord, ...]:
        with self._indexing_state.lock(dataset_index_lock_name(segment_ref.document.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_ref.segment_id), timeout=600):
                    return self._update_child_chunks_locked(segment_ref, chunks=chunks, actor_id=actor_id)

    def _update_child_chunks_locked(
        self, segment_ref: SegmentRef, *, chunks: Sequence[ChildChunkUpdateArgs], actor_id: str
    ) -> tuple[ChildChunkRecord, ...]:
        invalid_positions = [position for position, chunk in enumerate(chunks) if not chunk.content.strip()]
        if invalid_positions:
            raise ChildChunkValidationError("Child chunk content must not be empty")
        requested_ids = [chunk.id for chunk in chunks if chunk.id is not None]
        duplicate_ids = {chunk_id for chunk_id, count in Counter(requested_ids).items() if count > 1}
        if duplicate_ids:
            raise ChildChunkValidationError("Child chunk IDs must be unique")

        existing = self._children_for_mutation(segment_ref)
        remaining = {child.data.id: child for child in existing}
        unknown_ids = set(requested_ids).difference(remaining)
        if unknown_ids:
            raise ChildChunkNotFoundError("Child chunk not found")
        added: list[ChildChunkState] = []
        updated: list[ChildChunkState] = []
        for chunk in chunks:
            if chunk.id:
                previous = remaining.pop(chunk.id, None)
                if previous is not None and previous.data.content != chunk.content:
                    updated.append(self._updated_child(previous, chunk.content, actor_id))
            else:
                added.append(self._new_child(segment_ref, chunk.content, len(existing) + len(added) + 1, actor_id))
        self._write_children(segment_ref, added=added, updated=updated, deleted=tuple(remaining.values()))
        return tuple(child.data for child in sorted(added + updated, key=lambda child: child.data.position))

    def delete_child_chunk(self, segment_ref: SegmentRef, *, child_chunk_id: str) -> None:
        with self._indexing_state.lock(dataset_index_lock_name(segment_ref.document.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_ref.segment_id), timeout=600):
                    self._delete_child_chunk_locked(segment_ref, child_chunk_id=child_chunk_id)

    def _delete_child_chunk_locked(self, segment_ref: SegmentRef, *, child_chunk_id: str) -> None:
        try:
            child = self._child(segment_ref, child_chunk_id)
        except ChildChunkNotFoundError:
            if self._store.save_children(segment_ref) is not None:
                return
            raise
        self._write_children(segment_ref, deleted=(child,))

    def update_child_chunk(
        self, segment_ref: SegmentRef, *, child_chunk_id: str, content: str, actor_id: str
    ) -> ChildChunkRecord:
        with self._indexing_state.lock(dataset_index_lock_name(segment_ref.document.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_ref.segment_id), timeout=600):
                    return self._update_child_chunk_locked(
                        segment_ref, child_chunk_id=child_chunk_id, content=content, actor_id=actor_id
                    )

    def _update_child_chunk_locked(
        self, segment_ref: SegmentRef, *, child_chunk_id: str, content: str, actor_id: str
    ) -> ChildChunkRecord:
        child = self._updated_child(self._child(segment_ref, child_chunk_id), content, actor_id)
        self._write_children(segment_ref, updated=(child,))
        return child.data

    def _mark_error(self, segment_ref: SegmentRef, error: Exception) -> None:
        logger.exception("Segment indexing failed: %s", segment_ref.segment_id)
        self._save_segment(
            segment_ref, {"enabled": False, "disabled_at": naive_utc_now(), "status": "error", "error": str(error)}
        )

    def _save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object]) -> None:
        try:
            self._store.save_segment(segment_ref, values)
        except SegmentIndexingMutationError as error:
            raise SegmentDocumentIndexingError(str(error)) from error

    def _children_for_mutation(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...]:
        state = self._store.get_segment_update_state(segment_ref)
        if state is None:
            raise SegmentNotFoundError("Segment not found")
        if state.status == "indexing":
            raise ChildChunkIndexingApplicationError("Segment is indexing, please try again later")
        children = self._store.get_children(segment_ref)
        if children is None:
            raise SegmentNotFoundError("Segment not found")
        return children

    def _child(self, segment_ref: SegmentRef, child_id: str) -> ChildChunkState:
        for child in self._children_for_mutation(segment_ref):
            if child.data.id == child_id:
                return child
        raise ChildChunkNotFoundError("Child chunk not found")

    def _new_child(self, segment_ref: SegmentRef, content: str, position: int, actor_id: str) -> ChildChunkState:
        now = naive_utc_now()
        return ChildChunkState(
            data=ChildChunkRecord(
                id=str(uuid4()),
                segment_id=segment_ref.segment_id,
                content=content,
                position=position,
                word_count=len(content),
                type="customized",
                created_at=now,
                updated_at=now,
            ),
            index_node_id=str(uuid4()),
            index_node_hash=self._text_hash(content),
            created_by=actor_id,
        )

    def _updated_child(self, child: ChildChunkState, content: str, actor_id: str) -> ChildChunkState:
        return replace(
            child,
            data=child.data.model_copy(
                update={
                    "content": content,
                    "word_count": len(content),
                    "type": "customized",
                    "updated_at": naive_utc_now(),
                }
            ),
            updated_by=actor_id,
        )

    def _write_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None:
        try:
            self._store.save_children(segment_ref, added=added, updated=updated, deleted=deleted)
        except Exception as error:
            raise ChildChunkIndexingApplicationError(str(error)) from error

    def reconcile_children_index(
        self,
        segment_ref: SegmentRef,
        *,
        delete_node_ids: Sequence[str],
        completion: SegmentChildIndexCompletion | None = None,
        assert_owned: Callable[[], None] | None = None,
    ) -> SegmentIndexReconcileOutcome:
        ownership_check = assert_owned or _noop
        with self._indexing_state.lock(dataset_index_lock_name(segment_ref.document.dataset.dataset_id), timeout=600):
            with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
                with self._indexing_state.lock(_segment_mutation_lock(segment_ref.segment_id), timeout=600):
                    ownership_check()
                    self._index.reconcile_children(segment_ref, delete_node_ids=delete_node_ids)
                    ownership_check()
                    if completion is None:
                        return SegmentIndexReconcileOutcome.COMPLETED
                    return self._store.complete_child_reconcile(segment_ref, completion)

    def enqueue_child_reconcile_repair(
        self,
        segment_ref: SegmentRef,
        *,
        delete_node_ids: Sequence[str],
        completion: SegmentChildIndexCompletion | None,
    ) -> bool:
        """Persist a child-index successor based on the current locked parent."""

        return self._store.enqueue_child_reconcile_repair(
            segment_ref,
            delete_node_ids=delete_node_ids,
            completion=completion,
        )

    def fail_child_reconcile(
        self,
        segment_ref: SegmentRef,
        *,
        completion: SegmentChildIndexCompletion,
        error: str,
    ) -> bool:
        return self._store.fail_child_reconcile(segment_ref, completion, error=error)


def validate_segment_values(values: Mapping[str, object], *, doc_form: str, attachment_limit: int) -> SegmentUpdateArgs:
    """Validate fields required when creating a segment."""

    answer = values.get("answer")
    if doc_form == "qa_model":
        if not answer:
            raise ValueError("Answer is required")
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Answer is empty")
    content = values.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Content is empty")
    _validate_attachments(values, attachment_limit=attachment_limit)
    return SegmentUpdateArgs.model_validate(values)


def validate_segment_update_values(
    values: Mapping[str, object], *, doc_form: str, attachment_limit: int
) -> SegmentUpdateArgs:
    """Validate only fields supplied by a partial segment update."""

    if "content" in values:
        content = values.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Content is empty")
    if doc_form == "qa_model" and "answer" in values:
        answer = values.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Answer is empty")
    _validate_attachments(values, attachment_limit=attachment_limit)
    args = SegmentUpdateArgs.model_validate(values)
    _validate_segment_update_mode(args)
    return args


def _validate_attachments(values: Mapping[str, object], *, attachment_limit: int) -> None:
    attachments = values.get("attachment_ids")
    if not attachments:
        return
    if not isinstance(attachments, list):
        raise ValueError("Attachment IDs is invalid")
    if len(attachments) > attachment_limit:
        raise ValueError(f"Exceeded maximum attachment limit of {attachment_limit}")


def _segment_mutation_lock(segment_id: str) -> str:
    return f"knowledge:indexing:segment-mutation:{segment_id}"


def _validate_segment_update_mode(args: SegmentUpdateArgs) -> None:
    """Keep status transitions independent from content and index mutations."""

    if args.enabled is None:
        return
    mutation_fields = args.model_fields_set.difference({"enabled"})
    if mutation_fields:
        raise SegmentMixedStatusUpdateError("Enabled cannot be updated together with segment content")


def _require_segment_creation_state(state: SegmentDocumentCreationState | None) -> None:
    if state is None:
        raise SegmentDocumentNotFoundError("Document not found")
    if state.indexing_status != "completed":
        raise SegmentDocumentNotCompletedError("Document is not completed")
    if state.archived:
        raise SegmentDocumentDisabledError("Document is archived")
    if not state.enabled:
        raise SegmentDocumentDisabledError("Document is disabled")


def _is_qa_answer_only_update(args: SegmentUpdateArgs, previous: SegmentUpdateState) -> bool:
    """Return whether a QA update leaves every index input unchanged."""

    return (
        "answer" in args.model_fields_set
        and (args.content is None or args.content == previous.content)
        and args.keywords is None
        and not args.regenerate_child_chunks
        and args.enabled is None
        and args.attachment_ids is None
        and args.summary is None
    )
