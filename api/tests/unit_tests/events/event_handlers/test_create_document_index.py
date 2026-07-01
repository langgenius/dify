import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.indexing_runner import DocumentIsPausedError
from events.event_handlers import create_document_index as handler_module


@pytest.fixture
def mock_document() -> SimpleNamespace:
    return SimpleNamespace(
        id="doc-1",
        dataset_id="dataset-1",
        indexing_status=None,
        processing_started_at=None,
    )


@pytest.fixture
def mock_session(mock_document: SimpleNamespace) -> MagicMock:
    session = MagicMock()
    session.scalar.return_value = mock_document
    return session


@pytest.fixture
def mock_session_factory(mock_session: MagicMock) -> MagicMock:
    factory = MagicMock()
    factory.create_session.return_value.__enter__.return_value = mock_session
    factory.create_session.return_value.__exit__.return_value = None
    return factory


@pytest.fixture
def mock_indexing_runner() -> MagicMock:
    return MagicMock()


def test_handle_logs_document_pause(
    mock_session_factory: MagicMock,
    mock_indexing_runner: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mock_indexing_runner.run.side_effect = DocumentIsPausedError("Document is paused")

    with (
        patch.object(handler_module, "session_factory", mock_session_factory),
        patch.object(handler_module, "IndexingRunner", return_value=mock_indexing_runner),
    ):
        with caplog.at_level(logging.INFO, logger=handler_module.logger.name):
            handler_module.handle("dataset-1", document_ids=["doc-1"])

    assert "Document is paused" in caplog.text


def test_handle_logs_unexpected_indexing_errors(
    mock_session_factory: MagicMock,
    mock_indexing_runner: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mock_indexing_runner.run.side_effect = RuntimeError("Indexing failed")

    with (
        patch.object(handler_module, "session_factory", mock_session_factory),
        patch.object(handler_module, "IndexingRunner", return_value=mock_indexing_runner),
    ):
        with caplog.at_level(logging.WARNING, logger=handler_module.logger.name):
            handler_module.handle("dataset-1", document_ids=["doc-1"])

    assert any(record.levelno >= logging.WARNING for record in caplog.records)
    assert "Document index event handler failed" in caplog.text


def test_handle_runs_indexing_on_success(
    mock_session_factory: MagicMock,
    mock_indexing_runner: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with (
        patch.object(handler_module, "session_factory", mock_session_factory),
        patch.object(handler_module, "IndexingRunner", return_value=mock_indexing_runner),
    ):
        with caplog.at_level(logging.INFO, logger=handler_module.logger.name):
            handler_module.handle("dataset-1", document_ids=["doc-1"])

    mock_indexing_runner.run.assert_called_once()
    assert "Processed dataset: dataset-1" in caplog.text
