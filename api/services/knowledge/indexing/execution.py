"""Document indexing phases and their application-owned persistence and execution ports."""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from werkzeug.exceptions import HTTPException

from core.credit_usage import CreditUsageCreatedBy
from core.errors.error import (
    AppInvokeQuotaExceededError,
    InvokeRateLimitError,
    LLMError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_context import with_credit_usage_created_by
from core.plugin.impl.exc import PluginDaemonError
from core.rag.models.document import Document
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError, DocumentIsPausedError
from services.knowledge.indexing.estimate import StoredSource
from services.knowledge.resource_scope import DocumentRef

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexingDocument:
    source: StoredSource
    processing_rule: Mapping[str, object]
    doc_language: str
    need_summary: bool

    @property
    def ref(self) -> DocumentRef:
        return self.source.document_ref

    @property
    def doc_form(self) -> str:
        return self.source.document_model


class IndexingDocumentStore(Protocol):
    def get_indexing_document(self, ref: DocumentRef) -> IndexingDocument | None: ...

    def mark_splitting(self, ref: DocumentRef) -> None: ...

    def complete_indexing(self, ref: DocumentRef, *, tokens: int, latency: float) -> None: ...

    def fail_indexing(self, ref: DocumentRef, error: str) -> None: ...


class IndexingSegmentStore(Protocol):
    def clear_for_indexing(self, document: IndexingDocument) -> None: ...

    def save_for_indexing(
        self, document: IndexingDocument, chunks: list[Document], token_counts: list[int]
    ) -> None: ...

    def resume_indexing(self, document: IndexingDocument) -> tuple[list[Document], int]: ...


class IndexingBackend(Protocol):
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
    def run(self, document_refs: Sequence[DocumentRef]) -> None:
        for ref in document_refs:
            self._run(ref, start="parsing")

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run_in_splitting_status(self, ref: DocumentRef) -> None:
        self._run(ref, start="splitting")

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run_in_indexing_status(self, ref: DocumentRef) -> None:
        self._run(ref, start="indexing")

    def _run(self, ref: DocumentRef, *, start: Literal["parsing", "splitting", "indexing"]) -> None:
        try:
            document = self._documents.get_indexing_document(ref)
            if document is None:
                logger.info("Document not found, skipping indexing: %s", ref)
                return
            self._backend.check_paused(ref)
            if start == "indexing":
                chunks, total_tokens = self._segments.resume_indexing(document)
            else:
                if start == "splitting":
                    self._segments.clear_for_indexing(document)
                texts = self._backend.extract(document)
                self._documents.mark_splitting(ref)
                chunks = self._backend.transform(document, texts)
                # Recovery retains its existing admission policy; only normal
                # indexing callers that explicitly opt in reserve vector space.
                if start == "parsing" and self._enforce_vector_space_admission:
                    self._backend.ensure_admission(document, chunks)
                token_counts = self._backend.count_tokens(document, chunks)
                total_tokens = sum(token_counts)
                self._segments.save_for_indexing(document, chunks, token_counts)

            started = self._clock()
            self._backend.check_paused(ref)
            self._backend.load(document, chunks)
            self._backend.check_paused(ref)
            self._documents.complete_indexing(ref, tokens=total_tokens, latency=self._clock() - started)
        except DocumentIsPausedError:
            raise
        except DocumentIsDeletedPausedError:
            logger.info("Document deleted during indexing: %s", ref)
        except Exception as error:
            logger.exception("Document indexing failed: %s", ref)
            if isinstance(
                error,
                (
                    LLMError,
                    ProviderTokenNotInitError,
                    QuotaExceededError,
                    AppInvokeQuotaExceededError,
                    ModelCurrentlyNotSupportError,
                    InvokeRateLimitError,
                    PluginDaemonError,
                    HTTPException,
                ),
            ):
                message = str(error.description)
            else:
                message = str(error)
            self._documents.fail_indexing(ref, message)
