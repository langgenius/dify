"""Document cleanup keeps SQL transactions closed during external index deletion."""

import json
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import ChildChunk, Dataset, DatasetKeywordTable, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom
from services.knowledge.indexing.adapters import cleanup
from services.knowledge.summaries import adapters as summaries
from tasks.batch_clean_document_task import batch_clean_document_task
from tasks.clean_document_task import clean_document_task
from tasks.clean_notion_document_task import clean_notion_document_task


@pytest.fixture
def graph(sqlite_session: Session) -> tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk]:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Dataset",
        created_by="admin",
        indexing_technique="high_quality",
        index_struct='{"type":"pgvector"}',
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="admin",
        doc_form="text_model",
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="Text",
        word_count=1,
        tokens=1,
        created_by="admin",
        index_node_id="body-node",
    )
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="Summary",
        summary_index_node_id="summary-node",
    )
    child = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="Child",
        word_count=1,
        index_node_id="child-node",
        created_by="admin",
        index_node_hash="child-hash",
    )
    sqlite_session.add_all([dataset, document, segment, summary, child])
    sqlite_session.commit()
    return dataset, document, segment, summary, child


@pytest.fixture
def vector(monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]) -> MagicMock:
    sessions: list[Session] = []

    def new_session() -> Session:
        session = sqlite_session_factory()
        sessions.append(session)
        return session

    def assert_closed(_node_ids: list[str]) -> None:
        assert sessions
        assert all(not session.in_transaction() for session in sessions)

    backend = MagicMock()
    backend.delete_by_ids.side_effect = assert_closed
    monkeypatch.setattr(cleanup, "Vector", MagicMock(return_value=backend))
    monkeypatch.setattr("core.db.session_factory.session_factory.create_session", new_session)
    return backend


@pytest.mark.parametrize("task_kind", ["single", "batch", "notion"])
@pytest.mark.parametrize("doc_form", [IndexStructureType.PARAGRAPH_INDEX, IndexStructureType.PARENT_CHILD_INDEX])
def test_tasks_delete_summary_and_body_indexes_without_an_open_transaction(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    vector: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    task_kind: str,
    doc_form: IndexStructureType,
) -> None:
    dataset, document, segment, summary, child = graph
    document.doc_form = doc_form
    dataset.chunk_structure = doc_form
    ids = (dataset.id, document.id, segment.id, summary.id, child.id)
    if task_kind != "notion":
        sqlite_session.delete(document)
    sqlite_session.commit()
    monkeypatch.setattr("tasks.clean_document_task.schedule_billing_vector_space_refresh", lambda _tenant_id: None)
    monkeypatch.setattr(
        "tasks.batch_clean_document_task.schedule_billing_vector_space_refresh", lambda _tenant_id: None
    )

    if task_kind == "single":
        clean_document_task(ids[1], ids[0], doc_form, None)
    elif task_kind == "batch":
        batch_clean_document_task([ids[1]], ids[0], doc_form, [])
    else:
        clean_notion_document_task([ids[1]], ids[0])

    vector.delete_by_ids.assert_called_once_with(
        ["summary-node", "child-node" if doc_form == IndexStructureType.PARENT_CHILD_INDEX else "body-node"]
    )
    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegmentSummary, ids[3]) is None
    assert sqlite_session.get(ChildChunk, ids[4]) is None
    assert sqlite_session.get(DocumentSegment, ids[2]) is None


def test_failed_vector_cleanup_preserves_records_for_retry(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    vector: MagicMock,
) -> None:
    dataset, document, _, summary, child = graph
    vector.delete_by_ids.side_effect = RuntimeError("unavailable")
    with pytest.raises(RuntimeError, match="unavailable"):
        cleanup.clean_document_indexes(
            dataset_id=dataset.id, document_ids=[document.id], doc_form="text_model", new_session=sqlite_session_factory
        )
    assert sqlite_session.get(DocumentSegmentSummary, summary.id) is not None
    assert sqlite_session.get(ChildChunk, child.id) is not None


@pytest.mark.parametrize("task_kind", ["single", "batch", "notion"])
def test_cleanup_retries_summaries_after_segments_have_been_deleted(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    vector: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    task_kind: str,
) -> None:
    dataset, document, segment, summary, _ = graph
    summary_id = summary.id
    sqlite_session.delete(segment)
    sqlite_session.commit()
    monkeypatch.setattr("tasks.clean_document_task.schedule_billing_vector_space_refresh", lambda _tenant_id: None)
    monkeypatch.setattr(
        "tasks.batch_clean_document_task.schedule_billing_vector_space_refresh", lambda _tenant_id: None
    )
    if task_kind == "single":
        clean_document_task(document.id, dataset.id, "text_model", None)
    elif task_kind == "batch":
        batch_clean_document_task([document.id], dataset.id, "text_model", [])
    else:
        clean_notion_document_task([document.id], dataset.id)
    vector.delete_by_ids.assert_called_once_with(["summary-node"])
    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegmentSummary, summary_id) is None


def test_cleanup_keeps_other_documents_and_datasets(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, _, summary, _ = graph
    summary_id = summary.id
    retained = [
        DocumentSegmentSummary(
            dataset_id=owner_dataset,
            document_id=owner_document,
            chunk_id=str(uuid4()),
            summary_content="Retained",
            summary_index_node_id=f"retained-{index}",
        )
        for index, (owner_dataset, owner_document) in enumerate(
            [
                (dataset.id, str(uuid4())),
                (str(uuid4()), document.id),
            ]
        )
    ]
    sqlite_session.add_all(retained)
    sqlite_session.commit()
    backend = MagicMock()
    monkeypatch.setattr(cleanup, "Vector", MagicMock(return_value=backend))
    cleanup.clean_document_indexes(
        dataset_id=dataset.id, document_ids=[document.id], doc_form="text_model", new_session=sqlite_session_factory
    )
    backend.delete_by_ids.assert_called_once_with(["summary-node", "body-node"])
    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegmentSummary, summary_id) is None
    for record in retained:
        assert sqlite_session.get(DocumentSegmentSummary, record.id) is not None


def test_economy_cleanup_preserves_unrelated_keyword_entries(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, _, summary, _ = graph
    summary_id = summary.id
    dataset.indexing_technique = IndexTechniqueType.ECONOMY
    keyword_table = DatasetKeywordTable(
        dataset_id=dataset.id,
        keyword_table=json.dumps({"__data__": {"table": {"term": ["body-node", "unrelated-node"]}}}),
    )
    sqlite_session.add(keyword_table)
    sqlite_session.commit()
    cleanup.clean_document_indexes(
        dataset_id=dataset.id, document_ids=[document.id], doc_form="text_model", new_session=sqlite_session_factory
    )
    sqlite_session.refresh(keyword_table)
    assert json.loads(keyword_table.keyword_table)["__data__"]["table"] == {"term": ["unrelated-node"]}
    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegmentSummary, summary_id) is None


def test_legacy_summary_delete_does_not_commit_callers_transaction(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, _, segment, summary, _ = graph
    dataset_id, summary_id = dataset.id, summary.id
    monkeypatch.setattr(summaries, "Vector", MagicMock())

    def rollback_delete() -> None:
        with sqlite_session.begin():
            dataset.name = "Uncommitted name"
            summaries.SummaryIndexAdapter.delete_summaries_for_segments(dataset, [segment.id], session=sqlite_session)
            assert sqlite_session.in_transaction()
            assert sqlite_session.get(DocumentSegmentSummary, summary_id) is None
            raise RuntimeError("rollback caller")

    with pytest.raises(RuntimeError, match="rollback caller"):
        rollback_delete()
    assert sqlite_session.get(DocumentSegmentSummary, summary_id) is not None
    stored_dataset = sqlite_session.get(Dataset, dataset_id)
    assert stored_dataset is not None
    assert stored_dataset.name == "Dataset"


def test_empty_document_selection_does_not_clear_the_dataset_index(
    graph: tuple[Dataset, Document, DocumentSegment, DocumentSegmentSummary, ChildChunk],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    vector: MagicMock,
) -> None:
    dataset, _, segment, summary, child = graph
    assert (
        cleanup.clean_document_indexes(
            dataset_id=dataset.id, document_ids=[], doc_form="text_model", new_session=sqlite_session_factory
        )
        is None
    )
    vector.delete_by_ids.assert_not_called()
    assert sqlite_session.get(DocumentSegment, segment.id) is not None
    assert sqlite_session.get(DocumentSegmentSummary, summary.id) is not None
    assert sqlite_session.get(ChildChunk, child.id) is not None
