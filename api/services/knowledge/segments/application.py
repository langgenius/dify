"""Application service for dataset segment and child-chunk HTTP use cases."""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from typing import Literal, Protocol
from uuid import uuid4

from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from services.entities.knowledge_entities.segments import (
    ChildChunkRecord,
    ChildChunkUpdateArgs,
    SegmentRecord,
    SegmentUpdateArgs,
)
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessDeniedError, DatasetAccessSnapshot
from services.knowledge.resource_scope import DatasetRef, DocumentRef, SegmentRef

_HIGH_QUALITY = "high_quality"
logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SegmentDatasetRecord:
    id: str
    workspace_id: str
    indexing_technique: str
    embedding_model_provider: str | None
    embedding_model: str | None


@dataclass(frozen=True, slots=True)
class SegmentDocumentRecord:
    id: str
    dataset_id: str
    workspace_id: str
    doc_form: str

    @property
    def ref(self) -> DocumentRef:
        return DatasetRef(self.workspace_id, self.dataset_id).document(self.id)


@dataclass(frozen=True, slots=True)
class SegmentScope:
    dataset: SegmentDatasetRecord | None
    document: SegmentDocumentRecord | None
    access_snapshot: DatasetAccessSnapshot | None = None


@dataclass(frozen=True, slots=True)
class SegmentListFilter:
    page: int = 1
    limit: int = 20
    statuses: tuple[str, ...] = ()
    hit_count_gte: int | None = None
    enabled: str = "all"
    keyword: str | None = None


@dataclass(frozen=True, slots=True)
class ChildChunkListFilter:
    page: int = 1
    limit: int = 20
    keyword: str | None = None


@dataclass(frozen=True, slots=True)
class SegmentPage:
    items: tuple[SegmentRecord, ...]
    total: int
    total_pages: int
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class SegmentDetail:
    data: SegmentRecord
    doc_form: str


@dataclass(frozen=True, slots=True)
class ChildChunkPage:
    items: tuple[ChildChunkRecord, ...]
    total: int
    total_pages: int
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class SegmentBatchImport:
    job_id: str
    job_status: str


class SegmentScopeReader(Protocol):
    def get_segment_scope(
        self,
        *,
        dataset_ref: DatasetRef,
        document_id: str,
        actor_id: str | None,
    ) -> SegmentScope: ...


@dataclass(frozen=True, slots=True)
class ChildChunkState:
    data: ChildChunkRecord
    index_node_id: str | None
    index_node_hash: str | None
    created_by: str
    updated_by: str | None = None


@dataclass(frozen=True, slots=True)
class SegmentIndexTarget:
    id: str
    index_node_id: str | None
    enabled: bool


class SegmentStore(Protocol):
    """Owner-scoped persistence; each operation owns a short session."""

    def list_segments(self, document_ref: DocumentRef, query: SegmentListFilter) -> SegmentPage: ...
    def get_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> tuple[SegmentIndexTarget, ...]: ...
    def get_segment(self, segment_ref: SegmentRef) -> SegmentDetail | None: ...
    def save_segment(self, segment_ref: SegmentRef, values: Mapping[str, object], *, create: bool = False) -> None: ...
    def delete_segments(self, document_ref: DocumentRef, segment_ids: Sequence[str]) -> None: ...
    def list_child_chunks(self, segment_ref: SegmentRef, query: ChildChunkListFilter) -> ChildChunkPage | None: ...
    def get_children_for_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str]
    ) -> tuple[ChildChunkState, ...]: ...
    def set_segments(
        self, document_ref: DocumentRef, segment_ids: Sequence[str], values: Mapping[str, object]
    ) -> None: ...
    def get_children(self, segment_ref: SegmentRef) -> tuple[ChildChunkState, ...] | None: ...
    def save_children(
        self,
        segment_ref: SegmentRef,
        *,
        added: Sequence[ChildChunkState] = (),
        updated: Sequence[ChildChunkState] = (),
        deleted: Sequence[ChildChunkState] = (),
    ) -> None: ...


class SegmentIndex(Protocol):
    def count_tokens(self, dataset: SegmentDatasetRecord, text: str) -> int: ...
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


class SegmentApplicationError(Exception):
    """Base class for framework-neutral segment use-case errors."""


class SegmentDatasetNotFoundError(SegmentApplicationError):
    pass


class SegmentDocumentNotFoundError(SegmentApplicationError):
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


class DatasetSegmentApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        scopes: SegmentScopeReader,
        store: SegmentStore,
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
        self._index = index
        self._limits = limits
        self._text_hash = text_hash
        self._uploads = uploads
        self._model_guard = model_guard
        self._indexing_state = indexing_state
        self._batch_dispatcher = batch_dispatcher
        self._job_id_factory = job_id_factory

    def list_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        query: SegmentListFilter,
    ) -> SegmentPage:
        scope = self._require_scope(context, dataset_id=dataset_id, document_id=document_id)
        return self._store.list_segments(scope.document.ref, query)

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
        segments = self._store.get_segments(scope.document.ref, segment_ids)
        children = self._store.get_children_for_segments(scope.document.ref, [segment.id for segment in segments])
        if segments:
            self._index.delete(scope.document.ref, segments, children)
            self._store.delete_segments(scope.document.ref, [segment.id for segment in segments])

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
            segments = self._store.get_segments(scope.document.ref, segment_ids)
            ids = []
            for segment in segments:
                if segment.enabled == (action == "enable") or self._indexing_state.is_segment_indexing(segment.id):
                    continue
                ids.append(segment.id)
            if ids:
                self._store.set_segments(
                    scope.document.ref,
                    ids,
                    {
                        "enabled": action == "enable",
                        "disabled_at": naive_utc_now() if action == "disable" else None,
                        "disabled_by": context.account_id if action == "disable" else None,
                    },
                )
                self._index.change_status(scope.document.ref, ids, action)
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
        args = self._validate_values(values, scope.document.doc_form)
        now = naive_utc_now()
        segment_ref = scope.document.ref.segment(str(uuid4()))
        saved = False
        try:
            with self._indexing_state.lock(f"add_segment_lock_document_id_{document_id}", timeout=600):
                self._store.save_segment(
                    segment_ref,
                    {
                        "content": args.content,
                        "answer": args.answer if scope.document.doc_form == "qa_model" else None,
                        "word_count": len(args.content or "")
                        + (len(args.answer or "") if scope.document.doc_form == "qa_model" else 0),
                        "tokens": self._index.count_tokens(scope.dataset, args.content or ""),
                        "index_node_id": str(uuid4()),
                        "index_node_hash": self._text_hash(args.content or ""),
                        "created_by": context.account_id,
                        "status": "completed",
                        "indexing_at": now,
                        "completed_at": now,
                    },
                    create=True,
                )
                saved = True
        except Exception as error:
            if saved:
                self._mark_error(segment_ref, error)
            raise
        try:
            self._index.create(segment_ref, keywords=args.keywords, attachment_ids=args.attachment_ids or ())
        except Exception as error:
            self._mark_error(segment_ref, error)
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
        segment_ref = scope.document.ref.segment(segment_id)
        previous = self._detail(segment_ref).data
        args = self._validate_values(values, scope.document.doc_form)
        if self._indexing_state.is_segment_indexing(segment_id):
            raise ValueError("Segment is indexing, please try again later")
        if args.enabled is False and previous.enabled:
            self._store.save_segment(
                segment_ref, {"enabled": False, "disabled_at": naive_utc_now(), "disabled_by": context.account_id}
            )
            self._indexing_state.mark_segment_indexing(segment_id)
            self._index.change_status(scope.document.ref, [segment_id], "disable")
            return self._detail(segment_ref)
        if not previous.enabled and args.enabled is not True:
            raise ValueError("Can't update disabled segment")
        content = args.content or previous.content
        content_changed = content != previous.content
        keyword_changed = bool(args.keywords) and Counter(previous.keywords or ()) != Counter(args.keywords or ())
        changes: dict[str, object] = {
            "content": content,
            "word_count": len(content) + (len(args.answer or "") if scope.document.doc_form == "qa_model" else 0),
            "enabled": True,
            "disabled_at": None,
            "disabled_by": None,
        }
        if scope.document.doc_form == "qa_model":
            changes["answer"] = args.answer
        if keyword_changed and not content_changed:
            changes["keywords"] = args.keywords
        try:
            if content_changed:
                now = naive_utc_now()
                changes.update(
                    index_node_hash=self._text_hash(content),
                    tokens=self._index.count_tokens(
                        scope.dataset,
                        content + (args.answer or "") if scope.document.doc_form == "qa_model" else content,
                    ),
                    status="completed",
                    indexing_at=now,
                    completed_at=now,
                    updated_at=now,
                    updated_by=context.account_id,
                )
            self._store.save_segment(segment_ref, changes)
            if scope.document.doc_form == "hierarchical_model":
                if args.regenerate_child_chunks:
                    self._index.update(segment_ref, keywords=args.keywords, regenerate_children=True)
            elif content_changed or args.enabled or keyword_changed:
                self._index.update(segment_ref, keywords=args.keywords, regenerate_children=False)
            if scope.dataset.indexing_technique == _HIGH_QUALITY:
                try:
                    self._index.update_summary(segment_ref, summary=args.summary, content_changed=content_changed)
                except Exception:
                    logger.exception("Failed to update summary for segment %s", segment_id)
            self._index.update_attachments(segment_ref, args.attachment_ids or ())
        except Exception as error:
            self._mark_error(segment_ref, error)
        return self._detail(segment_ref)

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
        segment_ref = scope.document.ref.segment(segment_id)
        segment = self._detail(segment_ref).data
        if self._indexing_state.is_segment_indexing(segment_id, deleting=True):
            raise ValueError("Segment is deleting.")
        if segment.enabled:
            self._indexing_state.mark_segment_indexing(segment_id, deleting=True)
            self._index.delete(
                scope.document.ref,
                (SegmentIndexTarget(segment.id, segment.index_node_id, segment.enabled),),
                self._children(segment_ref),
            )
        self._store.delete_segments(scope.document.ref, (segment_id,))

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
            enforce_permission=False,
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
        segment_ref = scope.document.ref.segment(segment_id)
        with self._indexing_state.lock(f"add_child_lock_{segment_id}", timeout=20):
            children = self._children(segment_ref)
            child = self._new_child(
                segment_ref, content, max((c.data.position for c in children), default=0) + 1, context.account_id
            )
            self._write_children(segment_ref, added=(child,))
        return child.data

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
        segment_ref = scope.document.ref.segment(segment_id)
        existing = self._children(segment_ref)
        remaining = {child.data.id: child for child in existing}
        added: list[ChildChunkState] = []
        updated: list[ChildChunkState] = []
        for chunk in chunks:
            if chunk.id:
                previous = remaining.pop(chunk.id, None)
                if previous is not None and previous.data.content != chunk.content:
                    updated.append(self._updated_child(previous, chunk.content, context.account_id))
            else:
                added.append(
                    self._new_child(segment_ref, chunk.content, len(existing) + len(added) + 1, context.account_id)
                )
        self._write_children(segment_ref, added=added, updated=updated, deleted=tuple(remaining.values()))
        return tuple(child.data for child in sorted(added + updated, key=lambda child: child.data.position))

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
        segment_ref = scope.document.ref.segment(segment_id)
        child = self._child(segment_ref, child_chunk_id)
        try:
            self._index.update_children(segment_ref, deleted=(child,))
        except Exception as error:
            raise ChildChunkDeleteIndexApplicationError(str(error)) from error
        self._store.save_children(segment_ref, deleted=(child,))

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
        segment_ref = scope.document.ref.segment(segment_id)
        child = self._updated_child(self._child(segment_ref, child_chunk_id), content, context.account_id)
        self._write_children(segment_ref, updated=(child,))
        return child.data

    def _validate_values(self, values: Mapping[str, object], doc_form: str) -> SegmentUpdateArgs:
        return validate_segment_values(
            values, doc_form=doc_form, attachment_limit=self._limits.SINGLE_CHUNK_ATTACHMENT_LIMIT
        )

    def _detail(self, segment_ref: SegmentRef) -> SegmentDetail:
        result = self._store.get_segment(segment_ref)
        if result is None:
            raise SegmentNotFoundError("Segment not found")
        return result

    def _mark_error(self, segment_ref: SegmentRef, error: Exception) -> None:
        logger.exception("Segment indexing failed: %s", segment_ref.segment_id)
        self._store.save_segment(
            segment_ref, {"enabled": False, "disabled_at": naive_utc_now(), "status": "error", "error": str(error)}
        )

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
            self._index.update_children(segment_ref, added=added, updated=updated, deleted=deleted)
            self._store.save_children(segment_ref, added=added, updated=updated, deleted=deleted)
        except Exception as error:
            raise ChildChunkIndexingApplicationError(str(error)) from error

    def _require_scope(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        enforce_permission: bool = True,
    ) -> _RequiredSegmentScope:
        scope = self._scopes.get_segment_scope(
            dataset_ref=DatasetRef(context.active_workspace_id, dataset_id),
            document_id=document_id,
            actor_id=context.account_id if enforce_permission else None,
        )
        dataset = scope.dataset
        if dataset is None:
            raise SegmentDatasetNotFoundError("Dataset not found")
        if enforce_permission:
            if scope.access_snapshot is None:
                raise SegmentPermissionDeniedError("Dataset access state is missing")
            try:
                self._dataset_access.check_access(context, scope.access_snapshot)
            except DatasetAccessDeniedError as error:
                raise SegmentPermissionDeniedError(str(error)) from error
        document = scope.document
        if document is None:
            raise SegmentDocumentNotFoundError("Document not found")
        return _RequiredSegmentScope(dataset=dataset, document=document)

    def _require_scope_without_actor(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
    ) -> _RequiredSegmentScope:
        scope = self._scopes.get_segment_scope(
            dataset_ref=DatasetRef(workspace_id, dataset_id),
            document_id=document_id,
            actor_id=None,
        )
        if scope.dataset is None:
            raise SegmentDatasetNotFoundError("Dataset not found")
        if scope.document is None:
            raise SegmentDocumentNotFoundError("Document not found")
        return _RequiredSegmentScope(dataset=scope.dataset, document=scope.document)

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


@dataclass(frozen=True, slots=True)
class _RequiredSegmentScope:
    dataset: SegmentDatasetRecord
    document: SegmentDocumentRecord


def validate_segment_values(values: Mapping[str, object], *, doc_form: str, attachment_limit: int) -> SegmentUpdateArgs:
    answer = values.get("answer")
    if doc_form == "qa_model":
        if not answer:
            raise ValueError("Answer is required")
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Answer is empty")
    content = values.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Content is empty")
    attachments = values.get("attachment_ids")
    if attachments:
        if not isinstance(attachments, list):
            raise ValueError("Attachment IDs is invalid")
        if len(attachments) > attachment_limit:
            raise ValueError(f"Exceeded maximum attachment limit of {attachment_limit}")
    return SegmentUpdateArgs.model_validate(values)
