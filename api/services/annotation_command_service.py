"""Annotation writes followed by index tasks after the database transaction closes."""

from dataclasses import dataclass
from typing import Protocol

from services.annotation_query import AnnotationRecord


@dataclass(frozen=True, slots=True)
class AnnotationWriteResult:
    """A missing binding means annotation reply is disabled, so no index task is needed."""

    annotation: AnnotationRecord
    collection_binding_id: str | None


class AnnotationWriteStore(Protocol):
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


class AnnotationIndexWriter(Protocol):
    def __call__(
        self, *, annotation_id: str, question: str, tenant_id: str, app_id: str, collection_binding_id: str
    ) -> object: ...


class AnnotationIndexDeleter(Protocol):
    def __call__(self, *, annotation_id: str, app_id: str, tenant_id: str, collection_binding_id: str) -> object: ...


class AnnotationCommandService:
    def __init__(
        self,
        *,
        annotations: AnnotationWriteStore,
        add_index: AnnotationIndexWriter,
        update_index: AnnotationIndexWriter,
        delete_index: AnnotationIndexDeleter,
    ) -> None:
        self._annotations = annotations
        self._add_index = add_index
        self._update_index = update_index
        self._delete_index = delete_index

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
