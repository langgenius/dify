from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest

from core.rag.models.document import Document
from services.knowledge.indexing.contracts import DocumentIndexingExecution, IndexingDocument, StoredSource
from services.knowledge.indexing.errors import (
    DocumentIndexingGenerationChangedError,
    DocumentIsDeletedPausedError,
    DocumentIsPausedError,
)
from services.knowledge.indexing.execution import DocumentIndexingService
from services.knowledge.resource_scope import DatasetRef


@dataclass
class OwnershipFence:
    lost: bool = False
    checks: int = 0

    def assert_owned(self) -> None:
        self.checks += 1
        if self.lost:
            raise DocumentIndexingGenerationChangedError("document")


ExecutionFixture = tuple[
    DocumentIndexingService,
    MagicMock,
    IndexingDocument,
    list[Document],
    DocumentIndexingExecution,
    OwnershipFence,
]


@pytest.fixture
def execution() -> ExecutionFixture:
    ref = DatasetRef("tenant", "dataset").document("document")
    fence = OwnershipFence()
    indexing_execution = DocumentIndexingExecution("generation-1", fence.assert_owned)
    document = IndexingDocument(
        StoredSource(ref, "upload_file", {}, "text_model"),
        {"mode": "automatic"},
        "English",
        False,
        execution=indexing_execution,
    )
    ports = MagicMock()
    ports.documents.get_indexing_document.return_value = document
    chunks = [Document(page_content="one"), Document(page_content="two")]
    ports.backend.extract.return_value = chunks
    ports.backend.transform.return_value = chunks
    ports.backend.count_tokens.return_value = [7, 11]
    ports.backend.describe_error.side_effect = str
    ports.segments.resume_indexing.return_value = (chunks[1:], 18)
    service = DocumentIndexingService(
        documents=ports.documents,
        segments=ports.segments,
        backend=ports.backend,
        enforce_vector_space_admission=True,
        clock=iter([10, 13]).__next__,
    )
    return service, ports, document, chunks, indexing_execution, fence


@pytest.mark.parametrize("start", ["parsing", "splitting", "indexing"])
def test_completion_waits_for_persisted_segments_and_all_index_writes(execution: ExecutionFixture, start: str) -> None:
    service, ports, document, chunks, indexing_execution, fence = execution
    if start == "parsing":
        service.run([document.ref], executions={document.ref.document_id: indexing_execution})
    elif start == "splitting":
        service.run_in_splitting_status(document.ref, execution=indexing_execution)
    else:
        service.run_in_indexing_status(document.ref, execution=indexing_execution)
    calls = [call[0] for call in ports.mock_calls]
    ports.documents.get_indexing_document.assert_called_once_with(document.ref, execution=indexing_execution)
    assert calls.index("backend.load") < calls.index("documents.complete_indexing")
    ports.documents.complete_indexing.assert_called_once_with(
        document.ref, tokens=18, latency=3, execution=indexing_execution
    )
    if start == "indexing":
        ports.backend.extract.assert_not_called()
        ports.segments.save_for_indexing.assert_not_called()
        ports.backend.load.assert_called_once_with(document, chunks[1:])
    else:
        ports.documents.mark_splitting.assert_called_once_with(document.ref, execution=indexing_execution)
        assert calls.index("segments.save_for_indexing") < calls.index("backend.load")
        ports.segments.save_for_indexing.assert_called_once_with(document, chunks, [7, 11])
        if start == "splitting":
            assert calls.index("segments.clear_for_indexing") < calls.index("backend.extract")
    assert ports.backend.ensure_admission.call_count == (start == "parsing")
    assert fence.checks > 0


@pytest.mark.parametrize("stage", ["extract", "transform", "ensure_admission", "count_tokens", "load"])
def test_failed_phase_records_error_without_completing(execution: ExecutionFixture, stage: str) -> None:
    service, ports, document, _, indexing_execution, _ = execution
    operation = {
        "extract": ports.backend.extract,
        "transform": ports.backend.transform,
        "ensure_admission": ports.backend.ensure_admission,
        "count_tokens": ports.backend.count_tokens,
        "load": ports.backend.load,
    }[stage]
    operation.side_effect = RuntimeError("index unavailable")
    service.run([document.ref], executions={document.ref.document_id: indexing_execution})
    ports.documents.complete_indexing.assert_not_called()
    ports.documents.fail_indexing.assert_called_once_with(
        document.ref, "index unavailable", execution=indexing_execution
    )
    if stage != "load":
        ports.backend.load.assert_not_called()


@pytest.mark.parametrize("stage", ["get_indexing_document", "mark_splitting", "complete_indexing"])
@pytest.mark.parametrize("error", [DocumentIsPausedError, DocumentIsDeletedPausedError])
def test_pause_and_deletion_do_not_become_indexing_errors(
    execution: ExecutionFixture, stage: str, error: type[Exception]
) -> None:
    service, ports, document, _, indexing_execution, _ = execution
    operation = {
        "get_indexing_document": ports.documents.get_indexing_document,
        "mark_splitting": ports.documents.mark_splitting,
        "complete_indexing": ports.documents.complete_indexing,
    }[stage]
    operation.side_effect = error()
    if error is DocumentIsPausedError:
        with pytest.raises(DocumentIsPausedError):
            service.run([document.ref], executions={document.ref.document_id: indexing_execution})
    else:
        service.run([document.ref], executions={document.ref.document_id: indexing_execution})
    ports.documents.fail_indexing.assert_not_called()


def test_pause_after_worker_completion_prevents_document_completion(execution: ExecutionFixture) -> None:
    service, ports, document, _, indexing_execution, _ = execution
    ports.backend.check_paused.side_effect = [None, None, DocumentIsPausedError()]
    with pytest.raises(DocumentIsPausedError):
        service.run([document.ref], executions={document.ref.document_id: indexing_execution})
    ports.documents.complete_indexing.assert_not_called()
    ports.documents.fail_indexing.assert_not_called()


def test_missing_document_is_skipped(execution: ExecutionFixture) -> None:
    service, ports, document, _, indexing_execution, _ = execution
    ports.documents.get_indexing_document.return_value = None
    service.run([document.ref], executions={document.ref.document_id: indexing_execution})
    ports.backend.extract.assert_not_called()
    ports.documents.fail_indexing.assert_not_called()


def test_indexing_persists_the_backend_error_description(execution: ExecutionFixture) -> None:
    service, ports, document, _, indexing_execution, _ = execution
    error = RuntimeError("backend details")
    ports.backend.extract.side_effect = error
    ports.backend.describe_error.side_effect = None
    ports.backend.describe_error.return_value = "source file missing"

    service.run([document.ref], executions={document.ref.document_id: indexing_execution})

    ports.backend.describe_error.assert_called_once_with(error)
    ports.documents.fail_indexing.assert_called_once_with(
        document.ref, "source file missing", execution=indexing_execution
    )
    ports.documents.complete_indexing.assert_not_called()


def test_lost_generation_after_segment_persistence_stops_remaining_side_effects(
    execution: ExecutionFixture,
) -> None:
    service, ports, document, _, indexing_execution, fence = execution

    def lose_ownership(*_args: object) -> None:
        fence.lost = True

    ports.segments.save_for_indexing.side_effect = lose_ownership

    service.run([document.ref], executions={document.ref.document_id: indexing_execution})

    ports.backend.load.assert_not_called()
    ports.documents.complete_indexing.assert_not_called()
    ports.documents.fail_indexing.assert_not_called()
