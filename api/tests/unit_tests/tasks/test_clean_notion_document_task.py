"""Unit tests for the Notion document cleanup task."""

from unittest.mock import MagicMock

import pytest

import tasks.clean_notion_document_task as task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, DocumentSegment
from models.enums import SegmentStatus


def _dataset() -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Notion dataset",
        created_by="creator-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )


def _segment(dataset: Dataset) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id="document-1",
        position=1,
        content="notion content",
        word_count=2,
        tokens=2,
        created_by=dataset.created_by,
        index_node_id=None,
        status=SegmentStatus.COMPLETED,
    )
    segment.id = "segment-1"
    return segment


def test_empty_document_list_is_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    create_session = MagicMock()
    index_processor_factory = MagicMock()
    monkeypatch.setattr(task_module.session_factory, "create_session", create_session)
    monkeypatch.setattr(task_module, "IndexProcessorFactory", index_processor_factory)

    task_module.clean_notion_document_task.run([], "dataset-1")

    create_session.assert_not_called()
    index_processor_factory.assert_not_called()


def test_segments_without_index_node_ids_use_scoped_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment(dataset)

    read_session = MagicMock()
    read_session.scalar.return_value = dataset
    read_session.scalars.return_value.all.return_value = [segment]
    cleanup_session = MagicMock()
    cleanup_session.scalar.return_value = dataset
    delete_session = MagicMock()

    session_contexts = []
    for session in (read_session, cleanup_session, delete_session):
        context = MagicMock()
        context.__enter__.return_value = session
        session_contexts.append(context)

    create_session = MagicMock(side_effect=session_contexts)
    monkeypatch.setattr(task_module.session_factory, "create_session", create_session)

    index_processor = MagicMock()
    index_processor_factory = MagicMock()
    index_processor_factory.return_value.init_index_processor.return_value = index_processor
    monkeypatch.setattr(task_module, "IndexProcessorFactory", index_processor_factory)

    task_module.clean_notion_document_task.run(["document-1"], dataset.id)

    index_processor.clean.assert_called_once_with(
        dataset,
        [],
        with_keywords=True,
        delete_child_chunks=True,
        delete_summaries=True,
        segment_ids=[segment.id],
        session=cleanup_session,
    )
    assert cleanup_session.commit.call_count == 2
    assert any(
        "DELETE FROM document_segment_summaries" in str(call.args[0]) for call in delete_session.execute.call_args_list
    )
    assert any("DELETE FROM child_chunks" in str(call.args[0]) for call in delete_session.execute.call_args_list)


def test_vector_cleanup_failure_still_removes_relational_summary_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment(dataset)
    segment.index_node_id = "node-1"

    read_session = MagicMock()
    read_session.scalar.return_value = dataset
    read_session.scalars.return_value.all.return_value = [segment]
    cleanup_session = MagicMock()
    cleanup_session.scalar.return_value = dataset
    delete_session = MagicMock()

    session_contexts = []
    for session in (read_session, cleanup_session, delete_session):
        context = MagicMock()
        context.__enter__.return_value = session
        session_contexts.append(context)
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        MagicMock(side_effect=session_contexts),
    )

    index_processor = MagicMock()
    index_processor.clean.side_effect = RuntimeError("vector provider unavailable")
    index_processor_factory = MagicMock()
    index_processor_factory.return_value.init_index_processor.return_value = index_processor
    monkeypatch.setattr(task_module, "IndexProcessorFactory", index_processor_factory)

    task_module.clean_notion_document_task.run([segment.document_id], dataset.id)

    index_processor.clean.assert_called_once()
    cleanup_session.rollback.assert_not_called()
    assert any(
        "DELETE FROM document_segment_summaries" in str(call.args[0]) for call in delete_session.execute.call_args_list
    )
    assert any("DELETE FROM child_chunks" in str(call.args[0]) for call in delete_session.execute.call_args_list)
