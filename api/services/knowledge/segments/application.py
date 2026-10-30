"""Application service for dataset segment and child-chunk HTTP use cases."""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from dataclasses import replace
from typing import Literal, Protocol
from uuid import uuid4

from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from services.errors.file import UploadFileReferenceNotFoundError
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessDeniedError
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef, SegmentRef
from services.knowledge.entities.segments import (
    ChildChunkRecord,
    ChildChunkUpdateArgs,
    SegmentReadSnapshot,
    SegmentRecord,
    SegmentUpdateArgs,
)
from services.knowledge.indexing.locks import document_index_lock_name
from services.knowledge.segments.contracts import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentBatchImport,
    SegmentCreateRecord,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentMutationBusyError,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentMutationScope,
    SegmentPage,
    SegmentPageData,
    SegmentScope,
    SegmentStatusTransition,
    SegmentUpdateState,
)

_HIGH_QUALITY = "high_quality"
logger = logging.getLogger(__name__)


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
        self, document_ref: DocumentRef, query: SegmentListFilter
    ) -> SegmentPageData[SegmentReadSnapshot]: ...
    def get_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> tuple[SegmentIndexTarget, ...]: ...
    def get_segment(self, segment_ref: SegmentRef) -> SegmentDetail[SegmentReadSnapshot] | None: ...
    def get_segment_update_state(self, segment_ref: SegmentRef) -> SegmentUpdateState | None: ...
    def save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object]) -> None: ...
    def create_segments(self, document_ref: DocumentRef, segments: Sequence[SegmentCreateRecord]) -> None: ...
    def delete_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> None: ...
    def stage_segment_status(
        self,
        document_ref: DocumentRef,
        segment_ids: Sequence[str],
        *,
        action: Literal["enable", "disable"],
        actor_id: str,
    ) -> tuple[SegmentStatusTransition, ...]: ...
    def restore_segment_status(
        self, document_ref: DocumentRef, transitions: Sequence[SegmentStatusTransition]
    ) -> tuple[str, ...]: ...
    def list_child_chunks(self, segment_ref: SegmentRef, query: ChildChunkListFilter) -> ChildChunkPage | None: ...
    def get_children_for_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str]
    ) -> tuple[ChildChunkState, ...]: ...
    def set_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str], values: Mapping[str, object]
    ) -> None: ...
    def get_children(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...] | None: ...
    def child_mutation(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> AbstractContextManager[None]: ...
    def save_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None: ...


class SegmentIndex(Protocol):
    def count_tokens_many(self, dataset: SegmentDatasetRecord, texts: Sequence[str]) -> list[int]: ...
    def count_tokens(self, dataset: SegmentDatasetRecord, text: str) -> int: ...
    def create_many(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None,
    ) -> None: ...
    def create(
        self, segment_ref: SegmentRef, *, keywords: Sequence[str] | None, attachment_ids: Sequence[str]
    ) -> None: ...
    def update(self, segment_ref: SegmentRef, *, keywords: Sequence[str] | None, regenerate_children: bool) -> None: ...
    def update_attachments(self, segment_ref: SegmentRef, attachment_ids: Sequence[str]) -> None: ...
    def update_summary(self, segment_ref: SegmentRef, *, summary: str | None, content_changed: bool) -> None: ...
    def update_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None: ...
    def delete(
        self, document_ref: DocumentRef, segments: Sequence[SegmentIndexTarget], children: Sequence[ChildChunkState]
    ) -> None: ...
    def change_status(
        self, document_ref: DocumentRef, segment_ids: Sequence[str], action: Literal["enable", "disable"]
    ) -> None: ...


class SegmentLimits(Protocol):
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int
    DATASET_MAX_SEGMENTS_PER_REQUEST: int


class SegmentModelGuard(Protocol):
    def check(self, dataset: SegmentDatasetRecord) -> None: ...


class SegmentUploadCatalog(Protocol):
    def get_file_name(self, *, workspace_id: str, upload_file_id: str) -> str | None: ...
    def get_existing_file_ids(self, *, workspace_id: str, file_ids: Sequence[str]) -> frozenset[str]: ...


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


class ChildChunkDeleteIndexApplicationError(SegmentApplicationError):
    pass


class SegmentPresenter(Protocol):
    def present(self, snapshots: Sequence[SegmentReadSnapshot]) -> tuple[SegmentRecord, ...]: ...


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
            store=store,
            index=index,
            text_hash=text_hash,
            uploads=uploads,
            indexing_state=indexing_state,
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
        page = self._store.list_segments(scope.document.ref, query)
        return SegmentPage(
            items=self._presenter.present(page.items),
            total=page.total,
            total_pages=page.total_pages,
            page=page.page,
            limit=page.limit,
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
        page = self._store.list_segments(scope.document.ref, query)
        return SegmentPage(
            items=self._presenter.present(page.items),
            total=page.total,
            total_pages=page.total_pages,
            page=page.page,
            limit=page.limit,
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
        self._check_embedding_model(scope.dataset)
        limit = self._limits.DATASET_MAX_SEGMENTS_PER_REQUEST
        if limit > 0 and len(values) > limit:
            raise ValueError(f"Exceeded maximum segments limit of {limit}.")
        args = tuple(self._validate_create_values(item, scope.document.doc_form) for item in values)
        self._require_attachment_ids(
            scope.dataset.workspace_id,
            tuple(file_id for item in args for file_id in (item.attachment_ids or ())),
        )
        refs = self.mutations.create_segments(scope, actor_id=context.account_id, args=args)
        return tuple(self._detail(ref) for ref in refs)

    def import_segments(
        self,
        ref: DocumentRef,
        *,
        actor_id: str,
        values: Sequence[Mapping[str, object]],
    ) -> tuple[SegmentRef, ...]:
        """Persist an already-admitted CSV job through the shared mutation boundary."""
        scope = self._require_scope_without_actor(
            workspace_id=ref.dataset.tenant_id,
            dataset_id=ref.dataset.dataset_id,
            document_id=ref.document_id,
        )
        args = tuple(self._validate_create_values(item, scope.document.doc_form) for item in values)
        return self.mutations.create_segments(scope, actor_id=actor_id, args=args, fail_on_indexing_error=True)

    def delete_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        segment_ids: Sequence[str],
    ) -> None:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        self.mutations.delete_segments(scope.document.ref, segment_ids=segment_ids)

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
        if action == "enable":
            self._check_embedding_model(scope.dataset)
        if self._indexing_state.is_document_indexing(scope.document.id):
            raise SegmentDocumentIndexingError("Document is being indexed, please try again later")
        try:
            ids = [segment_id for segment_id in segment_ids if not self._indexing_state.is_segment_indexing(segment_id)]
            self.mutations.change_status(scope, actor_id=context.account_id, segment_ids=ids, action=action)
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
        self._check_embedding_model(scope.dataset)
        args = self._validate_create_values(values, scope.document.doc_form)
        self._require_attachment_ids(scope.dataset.workspace_id, args.attachment_ids)
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
        self._check_dataset_model(scope.dataset)
        self._check_embedding_model(scope.dataset)
        args = self._validate_update_values(values, scope.document.doc_form)
        self._require_attachment_ids(scope.dataset.workspace_id, args.attachment_ids)
        self.mutations.update_segment(scope, actor_id=context.account_id, segment_id=segment_id, args=args)
        return self._detail(scope.document.ref.segment(segment_id))

    def _detail(self, segment_ref: SegmentRef) -> SegmentDetail:
        result = self._store.get_segment(segment_ref)
        if result is None:
            raise SegmentNotFoundError("Segment not found")
        return SegmentDetail(
            data=self._presenter.present((result.data,))[0],
            doc_form=result.doc_form,
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
        self._check_embedding_model(scope.dataset)
        return self.mutations.create_child_chunk(
            scope.document.ref.segment(segment_id), content=content, actor_id=context.account_id
        )

    def list_child_chunks(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
        segment_id: str,
        query: ChildChunkListFilter,
    ) -> ChildChunkPage:
        scope = self._require_scope_without_actor(
            workspace_id=workspace_id,
            dataset_id=dataset_id,
            document_id=document_id,
        )
        self._check_dataset_model(scope.dataset)
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
        self._check_dataset_model(scope.dataset)
        return self.mutations.update_child_chunks(
            scope.document.ref.segment(segment_id), chunks=chunks, actor_id=context.account_id
        )

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
        self._check_dataset_model(scope.dataset)
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
        self._check_dataset_model(scope.dataset)
        return self.mutations.update_child_chunk(
            scope.document.ref.segment(segment_id),
            child_chunk_id=child_chunk_id,
            content=content,
            actor_id=context.account_id,
        )

    def _validate_create_values(self, values: Mapping[str, object], doc_form: str) -> SegmentUpdateArgs:
        return validate_segment_values(
            values, doc_form=doc_form, attachment_limit=self._limits.SINGLE_CHUNK_ATTACHMENT_LIMIT
        )

    def _validate_update_values(self, values: Mapping[str, object], doc_form: str) -> SegmentUpdateArgs:
        return validate_segment_update_values(
            values, doc_form=doc_form, attachment_limit=self._limits.SINGLE_CHUNK_ATTACHMENT_LIMIT
        )

    def _require_attachment_ids(self, workspace_id: str, attachment_ids: Sequence[str] | None) -> None:
        if attachment_ids is None:
            return
        requested = tuple(dict.fromkeys(attachment_ids))
        existing = self._uploads.get_existing_file_ids(workspace_id=workspace_id, file_ids=requested)
        missing = [file_id for file_id in requested if file_id not in existing]
        if missing:
            raise SegmentUploadFileNotFoundError(f"UploadFile not found in the current workspace: {missing}")

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

    def _require_scope_without_actor(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
    ) -> SegmentMutationScope:
        scope = self._scopes.get_segment_scope(
            dataset_ref=DatasetRef(workspace_id, dataset_id),
            document_id=document_id,
            actor_id=None,
        )
        if scope.dataset is None:
            raise SegmentDatasetNotFoundError("Dataset not found")
        if scope.document is None:
            raise SegmentDocumentNotFoundError("Document not found")
        return SegmentMutationScope(dataset=scope.dataset, document=scope.document)

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
        uploads: SegmentUploadCatalog,
        indexing_state: SegmentIndexingState,
    ) -> None:
        self._store = store
        self._index = index
        self._text_hash = text_hash
        self._uploads = uploads
        self._indexing_state = indexing_state

    def index_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
        keywords_list: Sequence[Sequence[str] | None] | None = None,
    ) -> None:
        """Index a committed batch and persist failures through the scoped store.

        Callers must finish their write transaction before invoking this method.
        The index adapter reloads the complete owner chain before external I/O.
        """
        if keywords_list is not None and len(keywords_list) != len(segment_ids):
            raise ValueError("Keywords must correspond to the segment batch")
        if not segment_ids:
            return
        try:
            self._index.create_many(document_ref, segment_ids=segment_ids, keywords_list=keywords_list)
        except Exception as error:
            logger.exception("Batch indexing failed for document %s", document_ref.document_id)
            self._store.set_segments(
                document_ref,
                segment_ids,
                {"enabled": False, "disabled_at": naive_utc_now(), "status": "error", "error": str(error)},
            )
            raise

    def delete_segments(
        self,
        document_ref: DocumentRef,
        *,
        segment_ids: Sequence[str],
    ) -> tuple[SegmentIndexTarget, ...]:
        with self._indexing_state.lock(document_index_lock_name(document_ref.document_id), timeout=600):
            segments = self._store.get_segments(document_ref, tuple(dict.fromkeys(segment_ids)))
            children = self._store.get_children_for_segments(document_ref, [segment.id for segment in segments])
            if segments:
                try:
                    self._store.delete_segments(document_ref, [segment.id for segment in segments])
                except SegmentDocumentMutationBusyError as error:
                    raise SegmentDocumentIndexingError(str(error)) from error
        if segments:
            self._index.delete(document_ref, segments, children)
        return segments

    def change_status(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        segment_ids: Sequence[str],
        action: Literal["enable", "disable"],
    ) -> tuple[str, ...]:
        with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
            return self._change_status_locked(
                scope.document.ref,
                actor_id=actor_id,
                segment_ids=segment_ids,
                action=action,
            )

    def _change_status_locked(
        self,
        document_ref: DocumentRef,
        *,
        actor_id: str,
        segment_ids: Sequence[str],
        action: Literal["enable", "disable"],
    ) -> tuple[str, ...]:
        try:
            transitions = self._store.stage_segment_status(
                document_ref,
                tuple(dict.fromkeys(segment_ids)),
                action=action,
                actor_id=actor_id,
            )
        except SegmentDocumentMutationBusyError as error:
            raise SegmentDocumentIndexingError(str(error)) from error
        ids = tuple(transition.applied.id for transition in transitions)
        if not ids:
            return ()
        try:
            self._index.change_status(document_ref, ids, action)
        except Exception:
            self._store.restore_segment_status(document_ref, transitions)
            raise
        return ids

    def create_segment(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        args: SegmentUpdateArgs,
    ) -> SegmentRef:
        return self.create_segments(scope, actor_id=actor_id, args=(args,))[0]

    def create_segments(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        args: Sequence[SegmentUpdateArgs],
        fail_on_indexing_error: bool = False,
    ) -> tuple[SegmentRef, ...]:
        if not args:
            return ()
        self._require_attachment_ids(
            scope.dataset.workspace_id,
            tuple(file_id for item in args for file_id in (item.attachment_ids or ())),
        )
        token_counts = self._index.count_tokens_many(scope.dataset, [item.content or "" for item in args])
        now = naive_utc_now()
        records = tuple(
            SegmentCreateRecord(
                segment_id=str(uuid4()),
                content=item.content or "",
                answer=item.answer if scope.document.doc_form == "qa_model" else None,
                word_count=len(item.content or "")
                + (len(item.answer or "") if scope.document.doc_form == "qa_model" else 0),
                tokens=tokens,
                index_node_id=str(uuid4()),
                index_node_hash=self._text_hash(item.content or ""),
                created_by=actor_id,
                indexing_at=now,
                completed_at=now,
                attachment_ids=tuple(dict.fromkeys(item.attachment_ids or ())),
            )
            for item, tokens in zip(args, token_counts, strict=True)
        )
        segment_ids = tuple(record.segment_id for record in records)
        document_ref = scope.document.ref
        with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
            try:
                self._store.create_segments(document_ref, records)
            except SegmentDocumentMutationBusyError as error:
                raise SegmentDocumentIndexingError(str(error)) from error
            try:
                self._index.create_many(
                    document_ref,
                    segment_ids=segment_ids,
                    keywords_list=tuple(item.keywords for item in args),
                )
            except Exception as error:
                logger.exception("Batch indexing failed for document %s", document_ref.document_id)
                self._store.set_segments(
                    document_ref,
                    segment_ids,
                    {"enabled": False, "disabled_at": naive_utc_now(), "status": "error", "error": str(error)},
                )
                if fail_on_indexing_error:
                    raise
        return tuple(document_ref.segment(segment_id) for segment_id in segment_ids)

    def update_segment(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        segment_id: str,
        args: SegmentUpdateArgs,
    ) -> None:
        with self._indexing_state.lock(document_index_lock_name(scope.document.id), timeout=600):
            with self._indexing_state.lock(f"knowledge:indexing:segment-mutation:{segment_id}", timeout=600):
                self._update_segment_locked(scope, actor_id=actor_id, segment_id=segment_id, args=args)

    def _update_segment_locked(
        self,
        scope: SegmentMutationScope,
        *,
        actor_id: str,
        segment_id: str,
        args: SegmentUpdateArgs,
    ) -> None:
        self._require_attachment_ids(scope.dataset.workspace_id, args.attachment_ids)
        segment_ref = scope.document.ref.segment(segment_id)
        previous = self._store.get_segment_update_state(segment_ref)
        if previous is None:
            raise SegmentNotFoundError("Segment not found")
        if self._indexing_state.is_segment_indexing(segment_id):
            raise ValueError("Segment is indexing, please try again later")
        if args.enabled is False and args.model_fields_set != {"enabled"}:
            raise ValueError("Enabled cannot be updated together with segment content")
        if args.enabled is True and not previous.enabled and args.model_fields_set == {"enabled"}:
            # Disabled segments have no vectors to update. Reuse the console's load-based enable task.
            self._change_status_locked(
                scope.document.ref,
                actor_id=actor_id,
                segment_ids=(segment_id,),
                action="enable",
            )
            return
        if args.enabled is False and previous.enabled:
            self._change_status_locked(
                scope.document.ref,
                actor_id=actor_id,
                segment_ids=(segment_id,),
                action="disable",
            )
            self._indexing_state.mark_segment_indexing(segment_id)
            return
        if not previous.enabled and args.enabled is not True:
            raise ValueError("Can't update disabled segment")
        content = args.content if args.content is not None else previous.content
        content_changed = content != previous.content
        is_qa = scope.document.doc_form == "qa_model"
        answer_provided = "answer" in args.model_fields_set
        answer = args.answer if answer_provided else previous.answer
        answer_changed = is_qa and answer_provided and answer != previous.answer
        text_changed = content_changed or answer_changed
        keywords_provided = "keywords" in args.model_fields_set
        keyword_changed = keywords_provided and Counter(previous.keywords or ()) != Counter(args.keywords or ())
        changes: dict[str, object] = {
            "content": content,
            "word_count": len(content) + (len(answer or "") if is_qa else 0),
        }
        if args.enabled is True:
            changes.update(enabled=True, disabled_at=None, disabled_by=None)
        if is_qa and answer_provided:
            changes["answer"] = answer
        if keywords_provided:
            changes["keywords"] = args.keywords
        if text_changed:
            now = naive_utc_now()
            changes.update(
                index_node_hash=self._text_hash(content),
                tokens=self._index.count_tokens(scope.dataset, content + (answer or "") if is_qa else content),
                status="completed",
                indexing_at=now,
                completed_at=now,
                updated_at=now,
                updated_by=actor_id,
            )
        # Input/persistence failures must not disable the previously published segment.
        try:
            self._store.save_segment(segment_ref, changes)
        except SegmentDocumentMutationBusyError as error:
            raise SegmentDocumentIndexingError(str(error)) from error
        try:
            if scope.document.doc_form == "hierarchical_model":
                if args.regenerate_child_chunks:
                    self._index.update(segment_ref, keywords=args.keywords, regenerate_children=True)
            elif text_changed or args.enabled is True or keyword_changed:
                self._index.update(segment_ref, keywords=args.keywords, regenerate_children=False)
            if scope.dataset.indexing_technique == _HIGH_QUALITY:
                try:
                    self._index.update_summary(segment_ref, summary=args.summary, content_changed=content_changed)
                except Exception:
                    logger.exception("Failed to update summary for segment %s", segment_id)
            if args.attachment_ids is not None:
                self._index.update_attachments(segment_ref, args.attachment_ids)
        except Exception as error:
            self._mark_error(segment_ref, error)

    def delete_segment(self, segment_ref: SegmentRef) -> None:
        with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
            with self._indexing_state.lock(
                f"knowledge:indexing:segment-mutation:{segment_ref.segment_id}", timeout=600
            ):
                segments = self._store.get_segments(segment_ref.document, (segment_ref.segment_id,))
                if not segments:
                    raise SegmentNotFoundError("Segment not found")
                children = self._store.get_children_for_segments(segment_ref.document, (segment_ref.segment_id,))
                try:
                    self._store.delete_segments(segment_ref.document, (segment_ref.segment_id,))
                except SegmentDocumentMutationBusyError as error:
                    raise SegmentDocumentIndexingError(str(error)) from error
        self._index.delete(segment_ref.document, segments, children)

    def create_child_chunk(self, segment_ref: SegmentRef, *, content: str, actor_id: str) -> ChildChunkRecord:
        with self._child_mutation_lock(segment_ref):
            children = self._children(segment_ref)
            child = self._new_child(
                segment_ref, content, max((c.data.position for c in children), default=0) + 1, actor_id
            )
            self._write_children_locked(segment_ref, added=(child,))
        return child.data

    def update_child_chunks(
        self, segment_ref: SegmentRef, *, chunks: Sequence[ChildChunkUpdateArgs], actor_id: str
    ) -> tuple[ChildChunkRecord, ...]:
        with self._child_mutation_lock(segment_ref):
            existing = self._children(segment_ref)
            remaining = {child.data.id: child for child in existing}
            added: list[ChildChunkState] = []
            updated: list[ChildChunkState] = []
            for chunk in chunks:
                if chunk.id:
                    previous = remaining.pop(chunk.id, None)
                    if previous is not None and previous.data.content != chunk.content:
                        updated.append(self._updated_child(previous, chunk.content, actor_id))
                else:
                    added.append(
                        self._new_child(
                            segment_ref,
                            chunk.content,
                            max((child.data.position for child in existing), default=0) + len(added) + 1,
                            actor_id,
                        )
                    )
            self._write_children_locked(segment_ref, added=added, updated=updated, deleted=tuple(remaining.values()))
            return tuple(child.data for child in sorted(added + updated, key=lambda child: child.data.position))

    def delete_child_chunk(self, segment_ref: SegmentRef, *, child_chunk_id: str) -> None:
        with self._child_mutation_lock(segment_ref):
            child = self._child(segment_ref, child_chunk_id)
            try:
                self._write_children_locked(segment_ref, deleted=(child,))
            except ChildChunkIndexingApplicationError as error:
                raise ChildChunkDeleteIndexApplicationError(str(error)) from error

    def update_child_chunk(
        self, segment_ref: SegmentRef, *, child_chunk_id: str, content: str, actor_id: str
    ) -> ChildChunkRecord:
        with self._child_mutation_lock(segment_ref):
            child = self._updated_child(self._child(segment_ref, child_chunk_id), content, actor_id)
            self._write_children_locked(segment_ref, updated=(child,))
            return child.data

    def _mark_error(self, segment_ref: SegmentRef, error: Exception) -> None:
        logger.exception("Segment indexing failed: %s", segment_ref.segment_id)
        try:
            self._store.save_segment(
                segment_ref, {"enabled": False, "disabled_at": naive_utc_now(), "status": "error", "error": str(error)}
            )
        except SegmentDocumentMutationBusyError as conflict:
            raise SegmentDocumentIndexingError(str(conflict)) from conflict

    def _require_attachment_ids(self, workspace_id: str, attachment_ids: Sequence[str] | None) -> None:
        if attachment_ids is None:
            return
        requested = tuple(dict.fromkeys(attachment_ids))
        existing = self._uploads.get_existing_file_ids(workspace_id=workspace_id, file_ids=requested)
        missing = [file_id for file_id in requested if file_id not in existing]
        if missing:
            raise SegmentUploadFileNotFoundError(f"UploadFile not found in the current workspace: {missing}")

    def _children(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...]:
        children = self._store.get_children(segment_ref)
        if children is None:
            raise SegmentNotFoundError("Segment not found")
        return children

    def _child(self, segment_ref: SegmentRef, child_id: str) -> ChildChunkState:
        for child in self._children(segment_ref):
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
            index_node_hash=self._text_hash(content),
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

    @contextmanager
    def _child_mutation_lock(self, segment_ref: SegmentRef) -> Generator[None]:
        with self._indexing_state.lock(document_index_lock_name(segment_ref.document.document_id), timeout=600):
            with self._indexing_state.lock(
                f"knowledge:indexing:segment-mutation:{segment_ref.segment_id}", timeout=600
            ):
                yield

    def _write_children_locked(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None:
        previous = self._children(segment_ref)
        updated_ids = {child.data.id for child in updated}
        deleted_ids = {child.data.id for child in deleted}
        expected = {child.data.id: child for child in previous if child.data.id not in deleted_ids}
        expected.update((child.data.id, child) for child in (*added, *updated))
        vectors_written = False
        try:
            with self._store.child_mutation(segment_ref, added=added, updated=updated, deleted=deleted):
                self._index.update_children(segment_ref, added=added, updated=updated, deleted=deleted)
                vectors_written = True
        except SegmentDocumentMutationBusyError as error:
            raise SegmentDocumentIndexingError(str(error)) from error
        except UploadFileReferenceNotFoundError:
            raise
        except Exception as error:
            if vectors_written:
                # A commit may have succeeded before its connection failed.
                # Never undo vectors belonging to a committed publication.
                current = self._children(segment_ref)

                def identity(children: Sequence[ChildChunkState]) -> dict[str, tuple[str, str | None]]:
                    return {child.data.id: (child.data.content, child.index_node_id) for child in children}

                if identity(current) == identity(tuple(expected.values())):
                    return
                if identity(current) == identity(previous):
                    self._index.update_children(
                        segment_ref,
                        added=tuple(child for child in previous if child.data.id in deleted_ids),
                        updated=tuple(child for child in previous if child.data.id in updated_ids),
                        deleted=added,
                    )
                else:
                    logger.exception("Child publication outcome changed during compensation: %s", segment_ref)
            raise ChildChunkIndexingApplicationError(str(error)) from error


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
    return SegmentUpdateArgs.model_validate(values)


def _validate_attachments(values: Mapping[str, object], *, attachment_limit: int) -> None:
    attachments = values.get("attachment_ids")
    if not attachments:
        return
    if not isinstance(attachments, list):
        raise ValueError("Attachment IDs is invalid")
    if len(attachments) > attachment_limit:
        raise ValueError(f"Exceeded maximum attachment limit of {attachment_limit}")
