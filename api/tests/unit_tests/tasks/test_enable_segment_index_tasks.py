from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.enums import IndexingStatus, SegmentStatus
from tasks.enable_segment_to_index_task import enable_segment_to_index_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


def test_enable_segment_commits_index_rows_after_loading() -> None:
    dataset = SimpleNamespace(id="dataset-1", is_multimodal=False)
    document = SimpleNamespace(
        id="document-1",
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = SimpleNamespace(
        id="segment-1",
        status=SegmentStatus.COMPLETED,
        content="content",
        index_node_id="node-1",
        index_node_hash="hash-1",
        document_id=document.id,
        dataset_id=dataset.id,
        get_dataset=MagicMock(return_value=dataset),
        get_document=MagicMock(return_value=document),
    )
    session = MagicMock()
    session.scalar.return_value = segment
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

    assert phase_events == ["load", "commit", "summary"]


def test_enable_segment_rolls_back_before_error_compensation() -> None:
    dataset = SimpleNamespace(id="dataset-1", is_multimodal=False)
    document = SimpleNamespace(
        id="document-1",
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = SimpleNamespace(
        id="segment-1",
        status=SegmentStatus.COMPLETED,
        content="content",
        index_node_id="node-1",
        index_node_hash="hash-1",
        document_id=document.id,
        dataset_id=dataset.id,
        enabled=True,
        disabled_at=None,
        error=None,
        get_dataset=MagicMock(return_value=dataset),
        get_document=MagicMock(return_value=document),
    )
    phase_events: list[str] = []
    session = MagicMock()
    session.scalar.return_value = segment
    session.rollback.side_effect = lambda: phase_events.append("rollback")

    def commit() -> None:
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

    assert phase_events == ["load", "rollback", "commit"]
    enable_summaries.assert_not_called()


def test_enable_segments_commits_index_rows_after_loading() -> None:
    dataset = SimpleNamespace(id="dataset-1", is_multimodal=False)
    document = SimpleNamespace(
        id="document-1",
        enabled=True,
        archived=False,
        indexing_status="completed",
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = SimpleNamespace(
        id="segment-1",
        content="content",
        index_node_id="node-1",
        index_node_hash="hash-1",
        document_id=document.id,
        dataset_id=dataset.id,
    )
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

    assert phase_events == ["load", "commit", "summary"]


def test_enable_segments_rolls_back_before_error_compensation() -> None:
    dataset = SimpleNamespace(id="dataset-1", is_multimodal=False)
    document = SimpleNamespace(
        id="document-1",
        enabled=True,
        archived=False,
        indexing_status="completed",
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = SimpleNamespace(
        id="segment-1",
        content="content",
        index_node_id="node-1",
        index_node_hash="hash-1",
        document_id=document.id,
        dataset_id=dataset.id,
    )
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

    assert phase_events == ["load", "rollback", "compensate", "commit"]
    enable_summaries.assert_not_called()
