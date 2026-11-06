from collections.abc import Iterator

import pytest
from sqlalchemy import Connection, Engine, event, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, Document, DocumentPipelineExecutionLog, Pipeline
from models.enums import IndexingStatus
from models.pipeline_execution import PipelineDocumentSeed
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document


@pytest.fixture
def documents(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDocumentRepository:
    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "tenant-1")
        dataset.pipeline_id = "pipeline-1"
        dataset.chunk_structure = "text_model"
        session.add(dataset)
        pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", description="")
        pipeline.id = "pipeline-1"
        session.add(pipeline)
    return SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)


def _prepare(documents: SQLAlchemyDocumentRepository, original_document_id: str | None = None) -> list[Document]:
    return documents.prepare_pipeline_documents(
        tenant_id="tenant-1",
        pipeline_id="pipeline-1",
        dataset_id="dataset-1",
        user_id="account-1",
        batch="batch-1",
        start_node_id="source-1",
        inputs={"query": "test"},
        seeds=[
            PipelineDocumentSeed("first", "upload_file", {"name": "first"}, {}),
            PipelineDocumentSeed("second", "upload_file", {"name": "second"}, {}),
        ],
        original_document_id=original_document_id,
    )


@pytest.fixture
def active_transactions(sqlite_engine: Engine) -> Iterator[set[Connection]]:
    active: set[Connection] = set()
    begin, finish = active.add, active.discard
    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", finish)
    event.listen(sqlite_engine, "rollback", finish)
    try:
        yield active
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", finish)
        event.remove(sqlite_engine, "rollback", finish)


def test_preparation_commits_documents_and_logs_then_releases_connection(
    documents: SQLAlchemyDocumentRepository,
    sqlite_session_factory: sessionmaker[Session],
    active_transactions: set[Connection],
) -> None:
    rows = _prepare(documents)
    assert not active_transactions
    assert all(inspect(row).detached for row in rows)
    assert [row.position for row in rows] == [1, 2]
    with sqlite_session_factory() as reader:
        assert {row.id for row in reader.scalars(select(Document))} == {row.id for row in rows}
        logs = list(reader.scalars(select(DocumentPipelineExecutionLog)))
        assert {log.document_id for log in logs} == {row.id for row in rows}
        assert all(log.input_data == {"query": "test"} for log in logs)
    assert not active_transactions


@pytest.mark.parametrize("changed_owner", ["dataset", "pipeline", "document_tenant", "document_dataset"])
def test_preparation_rejects_another_owner_without_changing_document(
    documents: SQLAlchemyDocumentRepository,
    sqlite_session_factory: sessionmaker[Session],
    changed_owner: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        original = _document("original", workspace_id="tenant-1", dataset_id="dataset-1")
        original.indexing_status = IndexingStatus.COMPLETED
        if changed_owner == "document_tenant":
            original.tenant_id = "other-tenant"
        elif changed_owner == "document_dataset":
            original.dataset_id = "other-dataset"
        else:
            row = session.get(Dataset if changed_owner == "dataset" else Pipeline, f"{changed_owner}-1")
            assert row is not None
            row.tenant_id = "other-tenant"
        session.add(original)
    with pytest.raises(ValueError, match="Pipeline (dataset is required|document not found)"):
        _prepare(documents, "original")
    with sqlite_session_factory() as reader:
        original = reader.get(Document, "original")
        assert original is not None
        assert original.indexing_status == IndexingStatus.COMPLETED
        assert reader.scalars(select(DocumentPipelineExecutionLog)).all() == []


def test_preparation_updates_original_and_logs_in_one_transaction(
    documents: SQLAlchemyDocumentRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_document("original", workspace_id="tenant-1", dataset_id="dataset-1"))
    assert _prepare(documents, "original") == []
    with sqlite_session_factory() as reader:
        original = reader.get(Document, "original")
        assert original is not None
        assert original.indexing_status == IndexingStatus.WAITING
        assert reader.scalars(select(DocumentPipelineExecutionLog.document_id)).all() == ["original", "original"]


def test_log_failure_rolls_back_documents_and_original_status(
    documents: SQLAlchemyDocumentRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_document("original", workspace_id="tenant-1", dataset_id="dataset-1"))
        session.execute(
            text(
                "CREATE TRIGGER reject_pipeline_log BEFORE INSERT ON document_pipeline_execution_logs "
                "BEGIN SELECT RAISE(ABORT, 'log write failed'); END"
            )
        )
    for original_id in (None, "original"):
        with pytest.raises(IntegrityError, match="log write failed"):
            _prepare(documents, original_id)
        with sqlite_session_factory() as reader:
            assert reader.scalars(select(Document.id)).all() == ["original"]
            original = reader.get(Document, "original")
            assert original is not None
            assert original.indexing_status == IndexingStatus.COMPLETED
            assert reader.scalars(select(DocumentPipelineExecutionLog)).all() == []
