"""Annotation writes and their index tasks, with vector work outside persistence sessions."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from services.annotation_query import AnnotationRecord, AnnotationSettingRecord
from services.annotation_reply_service import AnnotationIndexBinding, AnnotationIndexEntry


class AnnotationSettingNotFoundError(Exception):
    """The requested annotation setting does not belong to the admitted app."""


@dataclass(frozen=True, slots=True)
class AnnotationWriteResult:
    """A missing binding means annotation reply is disabled, so no index task is needed."""

    annotation: AnnotationRecord
    collection_binding_id: str | None


@dataclass(frozen=True, slots=True)
class AnnotationDeletionResult:
    """Only matched IDs need index cleanup; no binding means annotation reply is disabled."""

    annotation_ids: tuple[str, ...]
    collection_binding_id: str | None


@dataclass(frozen=True, slots=True)
class AnnotationIndexWritePlan:
    binding: AnnotationIndexBinding
    question: str
    content: str


class AnnotationWriteStore(Protocol):
    def prepare_index_write(
        self, *, tenant_id: str, app_id: str, annotation_id: str, collection_binding_id: str
    ) -> AnnotationIndexWritePlan | None:
        """Return detached index inputs, or None if the annotation or queued setting is no longer current."""
        ...

    def prepare_index_delete(
        self, *, tenant_id: str, app_id: str, annotation_id: str, collection_binding_id: str
    ) -> AnnotationIndexBinding | None:
        """Resolve the queued collection for a deleted row; None means a row still exists and must be retained."""
        ...

    def create(
        self, *, tenant_id: str, app_id: str, account_id: str, question: str, answer: str
    ) -> AnnotationWriteResult:
        """Create a manual annotation, preserving empty question and answer strings."""
        ...

    def upsert(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        message_id: str | None,
        question: str | None,
        answer: str | None,
    ) -> AnnotationWriteResult:
        """Create a manual entry or update the message's annotation, resolving its question as fallback.

        Missing answer or a manual entry's question is invalid. Check after app
        lookup in the write transaction so a missing app still takes precedence.
        """
        ...

    def update(
        self, *, tenant_id: str, app_id: str, annotation_id: str, question: str | None, answer: str | None
    ) -> AnnotationWriteResult:
        """None denotes a missing required field; validate after the app and annotation lookups."""
        ...

    def delete(self, *, tenant_id: str, app_id: str, annotation_id: str) -> str | None:
        """Delete the annotation and hit history; return its index binding, or None when reply is disabled."""
        ...

    def delete_many(self, *, tenant_id: str, app_id: str, annotation_ids: Sequence[str]) -> AnnotationDeletionResult:
        """Delete matching annotations and histories atomically; empty IDs delete nothing."""
        ...

    def clear(self, *, tenant_id: str, app_id: str) -> AnnotationDeletionResult:
        """Delete all annotations and their histories for this app, retaining its settings."""
        ...

    def update_setting(
        self,
        *,
        tenant_id: str,
        app_id: str,
        setting_id: str,
        account_id: str,
        score_threshold: float,
    ) -> AnnotationSettingRecord:
        """Update the threshold and audit fields atomically, returning detached settings."""
        ...


class AnnotationIndexWriter(Protocol):
    def __call__(
        self, *, annotation_id: str, question: str, tenant_id: str, app_id: str, collection_binding_id: str
    ) -> object: ...


class AnnotationIndexDeleter(Protocol):
    def __call__(self, *, annotation_id: str, app_id: str, tenant_id: str, collection_binding_id: str) -> object: ...


class AnnotationCommandIndex(Protocol):
    def add(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, entries: tuple[AnnotationIndexEntry, ...]
    ) -> None: ...

    def replace(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, entry: AnnotationIndexEntry
    ) -> None: ...

    def remove(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, annotation_id: str) -> None: ...


class AnnotationCommandService:
    def __init__(
        self,
        *,
        annotations: AnnotationWriteStore,
        index: AnnotationCommandIndex,
        add_index: AnnotationIndexWriter,
        update_index: AnnotationIndexWriter,
        delete_index: AnnotationIndexDeleter,
    ) -> None:
        self._annotations = annotations
        self._index = index
        self._add_index = add_index
        self._update_index = update_index
        self._delete_index = delete_index

    def execute_index_add(
        self, *, annotation_id: str, question: str, tenant_id: str, app_id: str, collection_binding_id: str
    ) -> None:
        # Skip tasks already stale at execution time. Changes during vector I/O
        # still need index reconciliation; this snapshot does not serialize workers.
        plan = self._annotations.prepare_index_write(
            tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, collection_binding_id=collection_binding_id
        )
        if plan is None or plan.question != question:
            return
        self._index.add(
            tenant_id=tenant_id,
            app_id=app_id,
            binding=plan.binding,
            entries=(AnnotationIndexEntry(id=annotation_id, question=plan.question),),
        )

    def execute_index_update(
        self, *, annotation_id: str, question: str, tenant_id: str, app_id: str, collection_binding_id: str
    ) -> None:
        plan = self._annotations.prepare_index_write(
            tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, collection_binding_id=collection_binding_id
        )
        # Updates retain the historical answer fallback; adds retain an empty question.
        if plan is None or (plan.question or plan.content) != question:
            return
        self._index.replace(
            tenant_id=tenant_id,
            app_id=app_id,
            binding=plan.binding,
            entry=AnnotationIndexEntry(id=annotation_id, question=plan.question or plan.content),
        )

    def execute_index_delete(
        self, *, annotation_id: str, app_id: str, tenant_id: str, collection_binding_id: str
    ) -> None:
        binding = self._annotations.prepare_index_delete(
            tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, collection_binding_id=collection_binding_id
        )
        if binding is not None:
            self._index.remove(tenant_id=tenant_id, app_id=app_id, binding=binding, annotation_id=annotation_id)

    def create(self, *, tenant_id: str, app_id: str, account_id: str, question: str, answer: str) -> AnnotationRecord:
        """Service API creation accepts empty text and never updates an existing annotation."""
        result = self._annotations.create(
            tenant_id=tenant_id, app_id=app_id, account_id=account_id, question=question, answer=answer
        )
        if result.collection_binding_id is not None:
            self._add_index(
                annotation_id=result.annotation.id,
                question=result.annotation.question,
                tenant_id=tenant_id,
                app_id=app_id,
                collection_binding_id=result.collection_binding_id,
            )
        return result.annotation

    def upsert(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        message_id: str | None,
        question: str | None,
        answer: str | None,
        content: str | None,
    ) -> AnnotationRecord:
        """A missing message ID creates a manual entry; empty question falls back to the linked message.

        A nonempty answer takes precedence over the legacy content field. Both
        absent is invalid; content may be empty, matching the existing request contract.
        """
        result = self._annotations.upsert(
            tenant_id=tenant_id,
            app_id=app_id,
            account_id=account_id,
            message_id=message_id,
            question=question,
            answer=answer or content,
        )
        if result.collection_binding_id is not None:
            self._add_index(
                annotation_id=result.annotation.id,
                question=result.annotation.question,
                tenant_id=tenant_id,
                app_id=app_id,
                collection_binding_id=result.collection_binding_id,
            )
        return result.annotation

    def update(
        self,
        *,
        tenant_id: str,
        app_id: str,
        annotation_id: str,
        question: str | None,
        answer: str | None,
    ) -> AnnotationRecord:
        """Question and answer may be empty but cannot be omitted (None)."""
        result = self._annotations.update(
            tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, question=question, answer=answer
        )
        if result.collection_binding_id is not None:
            self._update_index(
                annotation_id=result.annotation.id,
                question=result.annotation.question or result.annotation.content,
                tenant_id=tenant_id,
                app_id=app_id,
                collection_binding_id=result.collection_binding_id,
            )
        return result.annotation

    def delete(self, *, tenant_id: str, app_id: str, annotation_id: str) -> None:
        binding_id = self._annotations.delete(tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id)
        if binding_id is not None:
            self._delete_index(
                annotation_id=annotation_id,
                app_id=app_id,
                tenant_id=tenant_id,
                collection_binding_id=binding_id,
            )

    def delete_many(self, *, tenant_id: str, app_id: str, annotation_ids: Sequence[str]) -> None:
        result = self._annotations.delete_many(tenant_id=tenant_id, app_id=app_id, annotation_ids=annotation_ids)
        self._delete_indexes(tenant_id=tenant_id, app_id=app_id, result=result)

    def clear(self, *, tenant_id: str, app_id: str) -> None:
        result = self._annotations.clear(tenant_id=tenant_id, app_id=app_id)
        self._delete_indexes(tenant_id=tenant_id, app_id=app_id, result=result)

    def update_setting(
        self,
        *,
        tenant_id: str,
        app_id: str,
        setting_id: str,
        account_id: str,
        score_threshold: float,
    ) -> AnnotationSettingRecord:
        # Threshold changes affect matching, not stored embeddings, so no reindex task is needed.
        return self._annotations.update_setting(
            tenant_id=tenant_id,
            app_id=app_id,
            setting_id=setting_id,
            account_id=account_id,
            score_threshold=score_threshold,
        )

    def _delete_indexes(self, *, tenant_id: str, app_id: str, result: AnnotationDeletionResult) -> None:
        if result.collection_binding_id is None:
            return
        # Persistence has committed and closed its session before publishing any task.
        for annotation_id in result.annotation_ids:
            self._delete_index(
                annotation_id=annotation_id,
                app_id=app_id,
                tenant_id=tenant_id,
                collection_binding_id=result.collection_binding_id,
            )
