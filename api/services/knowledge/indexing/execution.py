"""Document indexing phases and their application-owned persistence and execution ports."""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.rag.models.document import Document
from services.extraction.contracts import ExtractionResult
from services.knowledge.entities.resource_scope import DocumentRef
from services.knowledge.indexing.contracts import IndexingDocument
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError, DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLock,
    document_index_lock_name,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexingTransformResult:
    chunks: list[Document]
    created_upload_file_ids: tuple[str, ...] = ()


class IndexingDocumentStore(Protocol):
    def get_indexing_document(self, ref: DocumentRef) -> IndexingDocument | None: ...

    def mark_splitting(self, ref: DocumentRef, *, source_version: str | None = None) -> None: ...

    def complete_indexing(
        self,
        ref: DocumentRef,
        *,
        tokens: int,
        latency: float,
    ) -> None: ...

    def fail_indexing(self, ref: DocumentRef, error: str) -> None: ...


class IndexingSegmentStore(Protocol):
    def save_for_indexing(
        self,
        document: IndexingDocument,
        chunks: list[Document],
        token_counts: list[int],
    ) -> tuple[str, ...]: ...

    def get_pending_upload_cleanup_ids(self, document: IndexingDocument) -> tuple[str, ...]: ...

    def acknowledge_upload_cleanup(self, document: IndexingDocument, processed_file_ids: Sequence[str]) -> None: ...

    def resume_indexing(self, document: IndexingDocument) -> tuple[list[Document], int]: ...


class IndexingBackend(Protocol):
    def describe_error(self, error: Exception) -> str:
        """Translate backend-specific exceptions into the persisted error message."""
        ...

    def check_paused(self, ref: DocumentRef) -> None: ...

    def extract(self, document: IndexingDocument) -> ExtractionResult[Document]: ...

    def cleanup_created_upload_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None: ...

    def reclaim_upload_files(self, document: IndexingDocument, file_ids: Sequence[str]) -> None: ...

    def transform(self, document: IndexingDocument, texts: list[Document]) -> IndexingTransformResult: ...

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
        indexing_locks: KnowledgeIndexingLock,
        enforce_vector_space_admission: bool = False,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._documents = documents
        self._segments = segments
        self._backend = backend
        self._indexing_locks = indexing_locks
        self._enforce_vector_space_admission = enforce_vector_space_admission
        self._clock = clock

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run(
        self,
        document_refs: Sequence[DocumentRef],
        *,
        owned_leases: Mapping[str, KnowledgeIndexingLease] | None = None,
    ) -> None:
        for ref in document_refs:
            self._run_guarded(
                ref,
                start="parsing",
                owned_lease=owned_leases.get(ref.document_id) if owned_leases is not None else None,
            )

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run_in_splitting_status(
        self,
        ref: DocumentRef,
        *,
        owned_lease: KnowledgeIndexingLease | None = None,
    ) -> None:
        self._run_guarded(ref, start="splitting", owned_lease=owned_lease)

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run_in_indexing_status(
        self,
        ref: DocumentRef,
        *,
        owned_lease: KnowledgeIndexingLease | None = None,
    ) -> None:
        self._run_guarded(ref, start="indexing", owned_lease=owned_lease)

    def _run_guarded(
        self,
        ref: DocumentRef,
        *,
        start: Literal["parsing", "splitting", "indexing"],
        owned_lease: KnowledgeIndexingLease | None,
    ) -> None:
        if owned_lease is not None:
            owned_lease.assert_owned()
            self._run(ref, start=start, lease=owned_lease)
            owned_lease.assert_owned()
            return
        with self._indexing_locks.hold(
            document_index_lock_name(ref.document_id),
            timeout=600,
            blocking_timeout=600,
        ) as lease:
            self._run(ref, start=start, lease=lease)

    def _run(
        self,
        ref: DocumentRef,
        *,
        start: Literal["parsing", "splitting", "indexing"],
        lease: KnowledgeIndexingLease,
    ) -> None:
        document: IndexingDocument | None = None
        created_upload_file_ids: tuple[str, ...] = ()
        try:
            document = self._documents.get_indexing_document(ref)
            if document is None:
                logger.info("Document not found, skipping indexing: %s", ref)
                return
            self._backend.check_paused(ref)
            if start == "indexing":
                pending_upload_cleanup_ids = self._segments.get_pending_upload_cleanup_ids(document)
                self._reconcile_pending_upload_cleanup(document, pending_upload_cleanup_ids, lease=lease)
                chunks, total_tokens = self._segments.resume_indexing(document)
            else:
                extraction = self._backend.extract(document)
                created_upload_file_ids = tuple(artifact.id for artifact in extraction.created_upload_artifacts)
                lease.assert_owned()
                self._documents.mark_splitting(ref, source_version=extraction.source_version)
                transformation = self._backend.transform(document, extraction.documents)
                created_upload_file_ids += transformation.created_upload_file_ids
                chunks = transformation.chunks
                # Recovery retains its existing admission policy; only normal
                # indexing callers that explicitly opt in reserve vector space.
                if start == "parsing" and self._enforce_vector_space_admission:
                    self._backend.ensure_admission(document, chunks)
                token_counts = self._backend.count_tokens(document, chunks)
                total_tokens = sum(token_counts)
                lease.assert_owned()
                pending_upload_cleanup_ids = self._segments.save_for_indexing(document, chunks, token_counts)
                self._reconcile_pending_upload_cleanup(document, pending_upload_cleanup_ids, lease=lease)

            started = self._clock()
            self._backend.check_paused(ref)
            lease.assert_owned()
            self._backend.load(document, chunks)
            self._backend.check_paused(ref)
            lease.assert_owned()
            self._documents.complete_indexing(
                ref,
                tokens=total_tokens,
                latency=self._clock() - started,
            )
        except DocumentIsPausedError:
            self._cleanup_created_upload_files(document, created_upload_file_ids)
            raise
        except DocumentIsDeletedPausedError:
            self._cleanup_created_upload_files(document, created_upload_file_ids)
            logger.info("Document deleted during indexing: %s", ref)
        except KnowledgeIndexingLeaseLostError:
            self._cleanup_created_upload_files(document, created_upload_file_ids)
            raise
        except Exception as error:
            self._cleanup_created_upload_files(document, created_upload_file_ids)
            logger.exception("Document indexing failed: %s", ref)
            lease.assert_owned()
            self._documents.fail_indexing(ref, self._backend.describe_error(error))

    def _reconcile_pending_upload_cleanup(
        self,
        document: IndexingDocument,
        pending_file_ids: Sequence[str],
        *,
        lease: KnowledgeIndexingLease,
    ) -> None:
        if not pending_file_ids:
            return
        lease.assert_owned()
        self._backend.reclaim_upload_files(document, pending_file_ids)
        lease.assert_owned()
        self._segments.acknowledge_upload_cleanup(document, pending_file_ids)

    def _cleanup_created_upload_files(
        self,
        document: IndexingDocument | None,
        file_ids: Sequence[str],
    ) -> None:
        if document is None or not file_ids:
            return
        try:
            self._backend.cleanup_created_upload_files(document, file_ids)
        except Exception:
            logger.exception("Failed to clean extraction files after document indexing stopped: %s", document.ref)
