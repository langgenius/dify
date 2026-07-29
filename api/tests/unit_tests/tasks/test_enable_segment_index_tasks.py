from contextlib import nullcontext
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from tasks.enable_segment_to_index_task import enable_segment_to_index_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


def _dataset() -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="00000000-0000-0000-0000-000000000001",
        is_multimodal=False,
    )


def _document(dataset: Dataset) -> Document:
    return Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="00000000-0000-0000-0000-000000000001",
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )


def _segment(dataset: Dataset, document: Document) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by="00000000-0000-0000-0000-000000000001",
        index_node_id="node-1",
        index_node_hash="hash-1",
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    segment.id = "segment-1"
    return segment


def test_enable_segment_commits_index_rows_after_loading() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    session = MagicMock()
    session.scalar.return_value = segment
    session.get.side_effect = lambda model, _identifier: dataset if model is Dataset else document
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    index_processor = MagicMock()
    index_processor.load.side_effect = lambda *_args, **_kwargs: phase_events.append("load")
    enable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        patch("tasks.enable_segment_to_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.enable_segment_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.enable_summaries_for_segments",
            enable_summaries,
        ),
        patch("tasks.enable_segment_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segment_to_index_task.run(segment.id)

    assert phase_events == ["commit", "load", "commit", "summary"]
    enable_summaries.assert_called_once_with(dataset=dataset, session=session, segment_ids=[segment.id])


def test_enable_segment_rolls_back_before_error_compensation() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    phase_events: list[str] = []
    session = MagicMock()
    session.scalar.return_value = segment
    session.get.side_effect = lambda model, _identifier: dataset if model is Dataset else document
    session.rollback.side_effect = lambda: phase_events.append("rollback")

    commit_count = 0

    def commit() -> None:
        nonlocal commit_count
        commit_count += 1
        if commit_count == 2:
            assert segment.enabled is False
            assert segment.status == SegmentStatus.ERROR
            assert segment.error == "load failed"
        phase_events.append("commit")

    session.commit.side_effect = commit
    index_processor = MagicMock()

    def fail_load(*_args, **_kwargs) -> None:
        phase_events.append("load")
        raise RuntimeError("load failed")

    index_processor.load.side_effect = fail_load

    with (
        patch("tasks.enable_segment_to_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.enable_segment_to_index_task.IndexProcessorFactory") as processor_factory,
        patch("services.summary_index_service.SummaryIndexService.enable_summaries_for_segments") as enable_summaries,
        patch("tasks.enable_segment_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segment_to_index_task.run(segment.id)

    assert phase_events == ["commit", "load", "rollback", "commit"]
    enable_summaries.assert_not_called()


def test_enable_segments_commits_index_rows_after_loading() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    session.scalars.return_value.all.return_value = [segment]
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    index_processor = MagicMock()
    index_processor.load.side_effect = lambda *_args, **_kwargs: phase_events.append("load")
    enable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        patch("tasks.enable_segments_to_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.enable_summaries_for_segments",
            enable_summaries,
        ),
        patch("tasks.enable_segments_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    assert phase_events == ["commit", "load", "commit", "summary"]
    enable_summaries.assert_called_once_with(dataset=dataset, session=session, segment_ids=[segment.id])


def test_enable_segments_rolls_back_before_error_compensation() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    phase_events: list[str] = []
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    session.scalars.return_value.all.return_value = [segment]
    session.rollback.side_effect = lambda: phase_events.append("rollback")
    session.execute.side_effect = lambda *_args, **_kwargs: phase_events.append("compensate")
    session.commit.side_effect = lambda: phase_events.append("commit")
    index_processor = MagicMock()

    def fail_load(*_args, **_kwargs) -> None:
        phase_events.append("load")
        raise RuntimeError("load failed")

    index_processor.load.side_effect = fail_load

    with (
        patch("tasks.enable_segments_to_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch("services.summary_index_service.SummaryIndexService.enable_summaries_for_segments") as enable_summaries,
        patch("tasks.enable_segments_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    assert phase_events == ["commit", "load", "rollback", "compensate", "commit"]
    enable_summaries.assert_not_called()
