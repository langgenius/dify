import logging
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.indexing_runner import DocumentIsPausedError
from events.event_handlers import create_document_index as handler_module
from models.dataset import Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus


@pytest.fixture
def persisted_document(
    sqlite_engine: Engine,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> Document:
    real_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "_session_maker", real_session_maker)

    document = Document(
        id="doc-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        indexing_status=IndexingStatus.WAITING,
    )
    sqlite_session.add(document)
    sqlite_session.commit()
    return document


@pytest.fixture
def mock_indexing_runner() -> MagicMock:
    return MagicMock()


@pytest.mark.parametrize("sqlite_session", [(Document,)], indirect=True)
def test_handle_logs_document_pause(
    persisted_document: Document,
    sqlite_session: Session,
    mock_indexing_runner: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mock_indexing_runner.run.side_effect = DocumentIsPausedError("Document is paused")

    with patch.object(handler_module, "IndexingRunner", return_value=mock_indexing_runner):
        with caplog.at_level(logging.INFO, logger=handler_module.logger.name):
            handler_module.handle("dataset-1", document_ids=["doc-1"])

    sqlite_session.refresh(persisted_document)
    assert persisted_document.indexing_status == IndexingStatus.PARSING
    assert persisted_document.processing_started_at is not None
    assert "Document is paused" in caplog.text


@pytest.mark.parametrize("sqlite_session", [(Document,)], indirect=True)
def test_handle_logs_unexpected_indexing_errors(
    persisted_document: Document,
    sqlite_session: Session,
    mock_indexing_runner: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mock_indexing_runner.run.side_effect = RuntimeError("Indexing failed")

    with patch.object(handler_module, "IndexingRunner", return_value=mock_indexing_runner):
        with caplog.at_level(logging.ERROR, logger=handler_module.logger.name):
            handler_module.handle("dataset-1", document_ids=["doc-1"])

    sqlite_session.refresh(persisted_document)
    assert persisted_document.indexing_status == IndexingStatus.PARSING
    assert persisted_document.processing_started_at is not None
    assert any(record.levelno >= logging.ERROR for record in caplog.records)
    assert "Document index event handler failed" in caplog.text
    assert "Indexing failed" in caplog.text


@pytest.mark.parametrize("sqlite_session", [(Document,)], indirect=True)
def test_handle_runs_indexing_on_success(
    persisted_document: Document,
    sqlite_session: Session,
    mock_indexing_runner: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def assert_status_committed(_documents: list[Document], session: Session) -> None:
        assert not session.in_transaction()

    mock_indexing_runner.run.side_effect = assert_status_committed

    with patch.object(handler_module, "IndexingRunner", return_value=mock_indexing_runner):
        with caplog.at_level(logging.INFO, logger=handler_module.logger.name):
            handler_module.handle("dataset-1", document_ids=["doc-1"])

    mock_indexing_runner.run.assert_called_once()
    sqlite_session.refresh(persisted_document)
    assert persisted_document.indexing_status == IndexingStatus.PARSING
    assert persisted_document.processing_started_at is not None
    assert "Processed dataset: dataset-1" in caplog.text
