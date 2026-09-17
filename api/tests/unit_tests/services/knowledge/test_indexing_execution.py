from unittest.mock import MagicMock

import pytest

from core.rag.models.document import Document
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError, DocumentIsPausedError
from services.knowledge.indexing.estimate import StoredSource
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingDocument
from services.knowledge.resource_scope import DatasetRef

ExecutionFixture = tuple[DocumentIndexingService, MagicMock, IndexingDocument, list[Document]]


@pytest.fixture
def execution() -> ExecutionFixture:
    ref = DatasetRef("tenant", "dataset").document("document")
    document = IndexingDocument(
        StoredSource(ref, "upload_file", {}, "text_model"), {"mode": "automatic"}, "English", False
    )
    ports = MagicMock()
    ports.documents.get_indexing_document.return_value = document
    chunks = [Document(page_content="one"), Document(page_content="two")]
    ports.backend.extract.return_value = chunks
    ports.backend.transform.return_value = chunks
    ports.backend.count_tokens.return_value = [7, 11]
    ports.segments.resume_indexing.return_value = (chunks[1:], 18)
    service = DocumentIndexingService(
        documents=ports.documents,
        segments=ports.segments,
        backend=ports.backend,
        enforce_vector_space_admission=True,
        clock=iter([10, 13]).__next__,
    )
    return service, ports, document, chunks


@pytest.mark.parametrize("start", ["parsing", "splitting", "indexing"])
def test_completion_waits_for_persisted_segments_and_all_index_writes(execution: ExecutionFixture, start: str) -> None:
    service, ports, document, chunks = execution
    if start == "parsing":
        service.run([document.ref])
    else:
        getattr(service, f"run_in_{start}_status")(document.ref)
    calls = [call[0] for call in ports.mock_calls]
    assert calls.index("backend.load") < calls.index("documents.complete_indexing")
    ports.documents.complete_indexing.assert_called_once_with(document.ref, tokens=18, latency=3)
    if start == "indexing":
        ports.backend.extract.assert_not_called()
        ports.segments.save_for_indexing.assert_not_called()
        ports.backend.load.assert_called_once_with(document, chunks[1:])
    else:
        assert calls.index("segments.save_for_indexing") < calls.index("backend.load")
        ports.segments.save_for_indexing.assert_called_once_with(document, chunks, [7, 11])
        if start == "splitting":
            assert calls.index("segments.clear_for_indexing") < calls.index("backend.extract")
    assert ports.backend.ensure_admission.call_count == (start == "parsing")


@pytest.mark.parametrize("stage", ["extract", "transform", "ensure_admission", "count_tokens", "load"])
def test_failed_phase_records_error_without_completing(execution: ExecutionFixture, stage: str) -> None:
    service, ports, document, _ = execution
    getattr(ports.backend, stage).side_effect = RuntimeError("index unavailable")
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
    getattr(ports.documents, stage).side_effect = error()
    if error is DocumentIsPausedError:
        with pytest.raises(DocumentIsPausedError):
            service.run([document.ref])
    else:
        service.run([document.ref])
    ports.documents.fail_indexing.assert_not_called()


def test_pause_after_worker_completion_prevents_document_completion(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    ports.backend.check_paused.side_effect = [None, None, DocumentIsPausedError()]
    with pytest.raises(DocumentIsPausedError):
        service.run([document.ref])
    ports.documents.complete_indexing.assert_not_called()
    ports.documents.fail_indexing.assert_not_called()


def test_missing_document_is_skipped(execution: ExecutionFixture) -> None:
    service, ports, document, _ = execution
    ports.documents.get_indexing_document.return_value = None
    service.run([document.ref])
    ports.backend.extract.assert_not_called()
    ports.documents.fail_indexing.assert_not_called()
