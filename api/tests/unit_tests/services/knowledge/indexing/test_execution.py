from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from unittest.mock import MagicMock

import pytest

from core.rag.models.document import Document
from services.entities.upload_file import CreatedUploadArtifact
from services.extraction.contracts import ExtractionResult
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.contracts import IndexingDocument, StoredSource
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError, DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingTransformResult
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    document_index_lock_name,
)


@dataclass
class _TestIndexingLease:
    token: str = "test-indexing-lease"
    lose_on_assertion: int | None = None
    assertions: int = 0
    released: bool = False

    def assert_owned(self) -> None:
        self.assertions += 1
        if self.lose_on_assertion == self.assertions:
            raise KnowledgeIndexingLeaseLostError("test lease lost")

    def renew(self) -> bool:
        return not self.released

    def release(self) -> bool:
        was_owned = not self.released
        self.released = True
        return was_owned


@dataclass
class _TestIndexingLock:
    held_names: list[str] = field(default_factory=list)
    leases: list[_TestIndexingLease] = field(default_factory=list)

    def try_acquire(self, name: str, *, timeout: int) -> KnowledgeIndexingLease | None:
        del name, timeout
        raise AssertionError("unexpected try_acquire call")

    def try_acquire_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
    ) -> KnowledgeIndexingLease | None:
        del name, timeout, owner_id
        raise AssertionError("unexpected try_acquire_handoff call")

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[KnowledgeIndexingLease]:
        assert timeout == 600
        assert expected_token is None
        assert blocking_timeout == 600
        lease = _TestIndexingLease(token=f"test-indexing-lease-{len(self.leases) + 1}")
        self.held_names.append(name)
        self.leases.append(lease)
        try:
            yield lease
        finally:
            lease.release()

    def hold_handoff(
        self,
        name: str,
        *,
        timeout: int,
        owner_id: str,
        blocking_timeout: float = 0,
    ) -> AbstractContextManager[KnowledgeIndexingLease]:
        del name, timeout, owner_id, blocking_timeout
        raise AssertionError("unexpected hold_handoff call")


ExecutionFixture = tuple[DocumentIndexingService, MagicMock, IndexingDocument, list[Document]]


@pytest.fixture
def execution() -> ExecutionFixture:
    ref = DatasetRef("tenant", "dataset").document("document")
    document = IndexingDocument(
        StoredSource(ref, "upload_file", {}, "text_model"),
        {"mode": "automatic"},
        "English",
        False,
    )
    ports = MagicMock()
    ports.documents.get_indexing_document.return_value = document
    chunks = [Document(page_content="one"), Document(page_content="two")]
    ports.backend.extract.return_value = ExtractionResult(documents=chunks)
    ports.backend.transform.return_value = IndexingTransformResult(chunks=chunks)
    ports.backend.count_tokens.return_value = [7, 11]
    ports.backend.describe_error.side_effect = str
    ports.segments.resume_indexing.return_value = (chunks[1:], 18)
    ports.segments.save_for_indexing.return_value = ()
    ports.segments.get_pending_upload_cleanup_ids.return_value = ()
    ports.indexing_locks = _TestIndexingLock()
    service = DocumentIndexingService(
        documents=ports.documents,
        segments=ports.segments,
        backend=ports.backend,
        indexing_locks=ports.indexing_locks,
        enforce_vector_space_admission=True,
        clock=iter([10, 13]).__next__,
    )
    return service, ports, document, chunks


@pytest.mark.parametrize("start", ["parsing", "splitting", "indexing"])
def test_completion_waits_for_persisted_segments_and_all_index_writes(execution: ExecutionFixture, start: str) -> None:
    service, ports, document, chunks = execution
    if start == "parsing":
        service.run([document.ref])
    elif start == "splitting":
        service.run_in_splitting_status(document.ref)
    else:
        service.run_in_indexing_status(document.ref)

    calls = [call[0] for call in ports.mock_calls]
    assert calls.index("backend.load") < calls.index("documents.complete_indexing")
    ports.documents.complete_indexing.assert_called_once_with(document.ref, tokens=18, latency=3)
    if start == "indexing":
        ports.backend.extract.assert_not_called()
        ports.documents.mark_splitting.assert_not_called()
        ports.segments.save_for_indexing.assert_not_called()
        ports.backend.load.assert_called_once_with(document, chunks[1:])
    else:
        ports.documents.mark_splitting.assert_called_once_with(document.ref, source_version=None)
        assert calls.index("segments.save_for_indexing") < calls.index("backend.load")
        ports.segments.save_for_indexing.assert_called_once_with(document, chunks, [7, 11])
    assert ports.backend.ensure_admission.call_count == (start == "parsing")


def test_execution_acquires_and_releases_the_document_indexing_lock(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution

    service.run([document.ref])

    indexing_locks = ports.indexing_locks
    assert isinstance(indexing_locks, _TestIndexingLock)
    assert indexing_locks.held_names == [document_index_lock_name(document.ref.document_id)]
    [lease] = indexing_locks.leases
    assert lease.assertions > 0
    assert lease.released


def test_owned_lease_is_reused_without_acquiring_or_releasing_another_lock(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    owned_lease = _TestIndexingLease(token="task-owned-lease")

    service.run([document.ref], owned_leases={document.ref.document_id: owned_lease})

    indexing_locks = ports.indexing_locks
    assert isinstance(indexing_locks, _TestIndexingLock)
    assert indexing_locks.held_names == []
    assert owned_lease.assertions > 0
    assert not owned_lease.released


def test_lost_owned_lease_does_not_persist_failure_or_completion(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    owned_lease = _TestIndexingLease(token="task-owned-lease", lose_on_assertion=3)

    with pytest.raises(KnowledgeIndexingLeaseLostError, match="test lease lost"):
        service.run([document.ref], owned_leases={document.ref.document_id: owned_lease})

    ports.documents.mark_splitting.assert_called_once()
    ports.documents.fail_indexing.assert_not_called()
    ports.documents.complete_indexing.assert_not_called()


def test_replacement_reclaims_old_files_only_after_new_segments_commit(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    ports.segments.save_for_indexing.return_value = ("old-image",)

    service.run_in_splitting_status(document.ref)

    calls = [call[0] for call in ports.mock_calls]
    assert calls.index("segments.save_for_indexing") < calls.index("backend.reclaim_upload_files")
    assert calls.index("backend.reclaim_upload_files") < calls.index("segments.acknowledge_upload_cleanup")
    assert calls.index("segments.acknowledge_upload_cleanup") < calls.index("backend.load")
    ports.backend.reclaim_upload_files.assert_called_once_with(document, ("old-image",))
    ports.segments.acknowledge_upload_cleanup.assert_called_once_with(document, ("old-image",))


def test_replacement_reclaim_failure_keeps_pending_evidence(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    ports.segments.save_for_indexing.return_value = ("old-image",)
    ports.backend.reclaim_upload_files.side_effect = RuntimeError("storage unavailable")

    service.run_in_splitting_status(document.ref)

    ports.segments.acknowledge_upload_cleanup.assert_not_called()
    ports.backend.load.assert_not_called()
    ports.documents.fail_indexing.assert_called_once_with(document.ref, "storage unavailable")


def test_source_version_is_staged_with_splitting_and_not_passed_to_completion(execution: ExecutionFixture) -> None:
    service, ports, document, chunks = execution
    ports.backend.extract.return_value = ExtractionResult(
        documents=chunks,
        source_version="2026-10-24T00:00:00Z",
    )

    service.run([document.ref])

    ports.documents.mark_splitting.assert_called_once_with(
        document.ref,
        source_version="2026-10-24T00:00:00Z",
    )
    ports.documents.complete_indexing.assert_called_once_with(document.ref, tokens=18, latency=3)


def test_extractor_artifacts_are_cleaned_when_a_later_phase_fails(execution: ExecutionFixture) -> None:
    service, ports, document, chunks = execution
    artifact = CreatedUploadArtifact("upload-1", "workspace-1/extracted.png")
    ports.backend.extract.return_value = ExtractionResult(
        documents=chunks,
        created_upload_artifacts=(artifact,),
    )
    ports.backend.load.side_effect = RuntimeError("index unavailable")

    service.run([document.ref])

    ports.backend.cleanup_created_upload_files.assert_called_once_with(document, (artifact.id,))


@pytest.mark.parametrize("stage", ["extract", "transform", "ensure_admission", "count_tokens", "load"])
def test_failed_phase_records_error_without_completing(execution: ExecutionFixture, stage: str) -> None:
    service, ports, document, _ = execution
    operation = {
        "extract": ports.backend.extract,
        "transform": ports.backend.transform,
        "ensure_admission": ports.backend.ensure_admission,
        "count_tokens": ports.backend.count_tokens,
        "load": ports.backend.load,
    }[stage]
    operation.side_effect = RuntimeError("index unavailable")

    service.run([document.ref])

    ports.documents.complete_indexing.assert_not_called()
    ports.documents.fail_indexing.assert_called_once_with(document.ref, "index unavailable")
    if stage != "load":
        ports.backend.load.assert_not_called()


@pytest.mark.parametrize("stage", ["get_indexing_document", "mark_splitting", "complete_indexing"])
@pytest.mark.parametrize("error", [DocumentIsPausedError, DocumentIsDeletedPausedError])
def test_pause_and_deletion_do_not_become_indexing_errors(
    execution: ExecutionFixture, stage: str, error: type[Exception]
) -> None:
    service, ports, document, _ = execution
    operation = {
        "get_indexing_document": ports.documents.get_indexing_document,
        "mark_splitting": ports.documents.mark_splitting,
        "complete_indexing": ports.documents.complete_indexing,
    }[stage]
    operation.side_effect = error()
    if error is DocumentIsPausedError:
        with pytest.raises(DocumentIsPausedError):
            service.run([document.ref])
    else:
        service.run([document.ref])
    ports.documents.fail_indexing.assert_not_called()


def test_pause_after_source_version_is_staged_preserves_it_for_recovery(execution: ExecutionFixture) -> None:
    service, ports, document, chunks = execution
    ports.backend.extract.return_value = ExtractionResult(
        documents=chunks,
        source_version="2026-10-24T00:00:00Z",
    )
    ports.backend.check_paused.side_effect = [None, DocumentIsPausedError()]

    with pytest.raises(DocumentIsPausedError):
        service.run([document.ref])

    ports.documents.mark_splitting.assert_called_once_with(
        document.ref,
        source_version="2026-10-24T00:00:00Z",
    )
    ports.documents.fail_indexing.assert_not_called()
    ports.documents.complete_indexing.assert_not_called()


def test_resume_from_indexing_relies_on_persisted_source_version(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution

    service.run_in_indexing_status(document.ref)

    ports.backend.extract.assert_not_called()
    ports.documents.mark_splitting.assert_not_called()
    ports.documents.complete_indexing.assert_called_once_with(document.ref, tokens=18, latency=3)


def test_missing_document_is_skipped(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    ports.documents.get_indexing_document.return_value = None
    service.run([document.ref])
    ports.backend.extract.assert_not_called()
    ports.documents.fail_indexing.assert_not_called()


def test_indexing_persists_the_backend_error_description(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    error = RuntimeError("backend details")
    ports.backend.extract.side_effect = error
    ports.backend.describe_error.side_effect = None
    ports.backend.describe_error.return_value = "source file missing"

    service.run([document.ref])

    ports.backend.describe_error.assert_called_once_with(error)
    ports.documents.fail_indexing.assert_called_once_with(document.ref, "source file missing")
    ports.documents.complete_indexing.assert_not_called()


@pytest.mark.parametrize("start", ["parsing", "indexing"])
def test_deletion_after_index_write_discards_the_written_entries(execution: ExecutionFixture, start: str) -> None:
    service, ports, document, chunks = execution
    ports.documents.complete_indexing.side_effect = DocumentIsDeletedPausedError()
    if start == "parsing":
        service.run([document.ref])
    else:
        service.run_in_indexing_status(document.ref)
    loaded = chunks if start == "parsing" else chunks[1:]
    calls = [call[0] for call in ports.mock_calls]
    assert calls.index("backend.load") < calls.index("backend.discard")
    ports.backend.discard.assert_called_once_with(document, loaded)
    ports.documents.fail_indexing.assert_not_called()


def test_deletion_detected_inside_load_discards_the_chunks_handed_to_load(execution: ExecutionFixture) -> None:
    service, ports, document, chunks = execution
    ports.backend.load.side_effect = DocumentIsDeletedPausedError()
    service.run([document.ref])
    ports.backend.discard.assert_called_once_with(document, chunks)
    ports.documents.complete_indexing.assert_not_called()


@pytest.mark.parametrize("stage", ["get_indexing_document", "mark_splitting"])
def test_deletion_before_index_write_has_nothing_to_discard(execution: ExecutionFixture, stage: str) -> None:
    service, ports, document, _ = execution
    operation = {
        "get_indexing_document": ports.documents.get_indexing_document,
        "mark_splitting": ports.documents.mark_splitting,
    }[stage]
    operation.side_effect = DocumentIsDeletedPausedError()
    service.run([document.ref])
    ports.backend.load.assert_not_called()
    ports.backend.discard.assert_not_called()


def test_discard_failure_is_logged_without_failing_the_deleted_document(
    execution: ExecutionFixture, caplog: pytest.LogCaptureFixture
) -> None:
    service, ports, document, _ = execution
    ports.documents.complete_indexing.side_effect = DocumentIsDeletedPausedError()
    ports.backend.discard.side_effect = RuntimeError("vector store unavailable")
    service.run([document.ref])
    ports.documents.fail_indexing.assert_not_called()
    assert "Failed to discard index entries of document deleted during indexing" in caplog.text


@pytest.mark.parametrize(
    ("existence_check", "discarded"), [(DocumentIsDeletedPausedError, True), (DocumentIsPausedError, False)]
)
def test_pause_after_index_write_discards_only_when_the_document_was_deleted(
    execution: ExecutionFixture, existence_check: type[Exception], discarded: bool
) -> None:
    service, ports, document, chunks = execution
    # The pause flag survives deletion and is checked before document existence.
    ports.backend.check_paused.side_effect = [None, None, DocumentIsPausedError()]
    ports.documents.get_indexing_document.side_effect = [document, existence_check()]
    with pytest.raises(DocumentIsPausedError):
        service.run([document.ref])
    if discarded:
        ports.backend.discard.assert_called_once_with(document, chunks)
    else:
        ports.backend.discard.assert_not_called()
    ports.documents.complete_indexing.assert_not_called()


@pytest.mark.parametrize("document_deleted", [True, False])
def test_failed_index_write_discards_entries_only_for_a_deleted_document(
    execution: ExecutionFixture, document_deleted: bool
) -> None:
    service, ports, document, chunks = execution
    ports.backend.load.side_effect = RuntimeError("vector store unavailable")
    ports.documents.get_indexing_document.side_effect = [
        document,
        DocumentIsDeletedPausedError() if document_deleted else document,
    ]
    service.run([document.ref])
    ports.documents.fail_indexing.assert_called_once_with(document.ref, "vector store unavailable")
    if document_deleted:
        ports.backend.discard.assert_called_once_with(document, chunks)
    else:
        ports.backend.discard.assert_not_called()


def test_unverifiable_existence_after_a_pause_keeps_entries_and_the_pause(
    execution: ExecutionFixture, caplog: pytest.LogCaptureFixture
) -> None:
    service, ports, document, _ = execution
    ports.backend.check_paused.side_effect = [None, None, DocumentIsPausedError()]
    ports.documents.get_indexing_document.side_effect = [document, RuntimeError("database unavailable")]
    with pytest.raises(DocumentIsPausedError):
        service.run([document.ref])
    ports.backend.discard.assert_not_called()
    assert "Could not check whether document still exists after indexing stopped" in caplog.text
