"""Document indexing phases and their application-owned persistence and execution ports."""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Literal, Protocol

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.rag.models.document import Document
from services.knowledge.indexing.contracts import DocumentIndexingExecution, IndexingDocument
from services.knowledge.indexing.errors import (
    DocumentIndexingGenerationChangedError,
    DocumentIsDeletedPausedError,
    DocumentIsPausedError,
)
from services.knowledge.resource_scope import DocumentRef

logger = logging.getLogger(__name__)


class IndexingDocumentStore(Protocol):
    def get_indexing_document(
        self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None
    ) -> IndexingDocument | None: ...

    def mark_splitting(self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None) -> None: ...

    def complete_indexing(
        self,
        ref: DocumentRef,
        *,
        tokens: int,
        latency: float,
        execution: DocumentIndexingExecution | None = None,
    ) -> None: ...

    def fail_indexing(
        self, ref: DocumentRef, error: str, *, execution: DocumentIndexingExecution | None = None
    ) -> None: ...


class IndexingSegmentStore(Protocol):
    def clear_for_indexing(self, document: IndexingDocument) -> None: ...

    def save_for_indexing(
        self, document: IndexingDocument, chunks: list[Document], token_counts: list[int]
    ) -> None: ...

    def resume_indexing(self, document: IndexingDocument) -> tuple[list[Document], int]: ...


class IndexingBackend(Protocol):
    def describe_error(self, error: Exception) -> str:
        """Translate backend-specific exceptions into the persisted error message."""
        ...

    def check_paused(self, ref: DocumentRef) -> None: ...

    def extract(self, document: IndexingDocument) -> list[Document]: ...

    def transform(self, document: IndexingDocument, texts: list[Document]) -> list[Document]: ...

    def ensure_admission(self, document: IndexingDocument, chunks: list[Document]) -> None: ...

    def count_tokens(self, document: IndexingDocument, chunks: list[Document]) -> list[int]: ...

    def load(self, document: IndexingDocument, chunks: list[Document]) -> None: ...


class DocumentIndexingService:
    """Coordinate committed phases; no caller session is held across execution."""

    def __init__(
        self,
        *,
        documents: IndexingDocumentStore,
        segments: IndexingSegmentStore,
        backend: IndexingBackend,
        enforce_vector_space_admission: bool = False,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._documents = documents
        self._segments = segments
        self._backend = backend
        self._enforce_vector_space_admission = enforce_vector_space_admission
        self._clock = clock

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run(
        self,
        document_refs: Sequence[DocumentRef],
        *,
        executions: Mapping[str, DocumentIndexingExecution] | None = None,
    ) -> None:
        for ref in document_refs:
            self._run(ref, start="parsing", execution=executions.get(ref.document_id) if executions else None)

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run_in_splitting_status(self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None) -> None:
        self._run(ref, start="splitting", execution=execution)

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run_in_indexing_status(self, ref: DocumentRef, *, execution: DocumentIndexingExecution | None = None) -> None:
        self._run(ref, start="indexing", execution=execution)

    def _run(
        self,
        ref: DocumentRef,
        *,
        start: Literal["parsing", "splitting", "indexing"],
        execution: DocumentIndexingExecution | None,
    ) -> None:
        try:
            self._assert_owned(execution)
            document = (
                self._documents.get_indexing_document(ref, execution=execution)
                if execution is not None
                else self._documents.get_indexing_document(ref)
            )
            if document is None:
                logger.info("Document not found, skipping indexing: %s", ref)
                return
            self._backend.check_paused(ref)
            self._assert_owned(execution)
            if start == "indexing":
                chunks, total_tokens = self._segments.resume_indexing(document)
            else:
                if start == "splitting":
                    self._assert_owned(execution)
                    self._segments.clear_for_indexing(document)
                    self._assert_owned(execution)
                texts = self._backend.extract(document)
                self._assert_owned(execution)
                if execution is None:
                    self._documents.mark_splitting(ref)
                else:
                    self._documents.mark_splitting(ref, execution=execution)
                chunks = self._backend.transform(document, texts)
                # Recovery retains its existing admission policy; only normal
                # indexing callers that explicitly opt in reserve vector space.
                if start == "parsing" and self._enforce_vector_space_admission:
                    self._backend.ensure_admission(document, chunks)
                token_counts = self._backend.count_tokens(document, chunks)
                total_tokens = sum(token_counts)
                self._assert_owned(execution)
                self._segments.save_for_indexing(document, chunks, token_counts)
                self._assert_owned(execution)

            started = self._clock()
            self._backend.check_paused(ref)
            self._assert_owned(execution)
            self._backend.load(document, chunks)
            self._assert_owned(execution)
            self._backend.check_paused(ref)
            if execution is None:
                self._documents.complete_indexing(ref, tokens=total_tokens, latency=self._clock() - started)
            else:
                self._documents.complete_indexing(
                    ref, tokens=total_tokens, latency=self._clock() - started, execution=execution
                )
        except DocumentIsPausedError:
            raise
        except (DocumentIsDeletedPausedError, DocumentIndexingGenerationChangedError):
            logger.info("Document indexing ownership changed, skipping stale delivery: %s", ref)
        except Exception as error:
            logger.exception("Document indexing failed: %s", ref)
            if execution is None:
                self._documents.fail_indexing(ref, self._backend.describe_error(error))
            else:
                self._documents.fail_indexing(ref, self._backend.describe_error(error), execution=execution)

    @staticmethod
    def _assert_owned(execution: DocumentIndexingExecution | None) -> None:
        if execution is not None:
            execution.assert_owned()
