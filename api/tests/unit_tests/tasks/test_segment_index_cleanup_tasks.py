from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from models.enums import SegmentStatus
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task


def test_disable_segment_commits_index_cleanup() -> None:
    dataset = SimpleNamespace(id="dataset-1")
    document = SimpleNamespace(enabled=True, archived=False, indexing_status="completed", doc_form="text_model")
    segment = SimpleNamespace(
        id="segment-1",
        status=SegmentStatus.COMPLETED,
        index_node_id="node-1",
        disabled_by="user-1",
        get_dataset=MagicMock(return_value=dataset),
        get_document=MagicMock(return_value=document),
    )
    session = MagicMock()
    session.scalar.return_value = segment
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        patch(
            "tasks.disable_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)
        ),
        patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segment_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segment_from_index_task.run(segment.id)

    assert phase_events == ["clean", "commit", "summary"]


def test_disable_segments_commits_index_cleanup() -> None:
    dataset = SimpleNamespace(id="dataset-1", is_multimodal=False)
    document = SimpleNamespace(
        id="document-1",
        enabled=True,
        archived=False,
        indexing_status="completed",
        doc_form="text_model",
    )
    segment = SimpleNamespace(id="segment-1", index_node_id="node-1", disabled_by="user-1")
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    session.scalars.return_value.all.return_value = [segment]
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        patch(
            "tasks.disable_segments_from_index_task.session_factory.create_session", return_value=nullcontext(session)
        ),
        patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segments_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segments_from_index_task.run([segment.id], dataset.id, document.id)

    assert phase_events == ["clean", "commit", "summary"]


def test_delete_segment_commits_index_cleanup_without_attachments() -> None:
    dataset = SimpleNamespace(id="dataset-1", is_multimodal=False)
    document = SimpleNamespace(
        id="document-1",
        enabled=True,
        archived=False,
        indexing_status="completed",
        doc_form="text_model",
    )
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, ["segment-1"])

    assert phase_events == ["clean", "commit"]
