from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.enums import SegmentStatus, SummaryStatus
from tasks.regenerate_segment_summary_task import (
    SUMMARY_REGENERATION_DELAY_SECONDS,
    SUMMARY_REGENERATION_TOKEN_TTL_SECONDS,
    regenerate_segment_summary_task,
    schedule_segment_summary_regeneration,
)


def test_schedule_segment_summary_regeneration_marks_pending_and_uses_ten_minute_countdown() -> None:
    session = MagicMock()
    segment = cast(
        DocumentSegment,
        SimpleNamespace(id="segment-1", document_id="document-1", index_node_hash="hash-1"),
    )
    dataset = cast(Dataset, SimpleNamespace(id="dataset-1"))
    summary_record = cast(
        DocumentSegmentSummary,
        SimpleNamespace(status=SummaryStatus.COMPLETED, error="old error"),
    )

    with (
        patch("tasks.regenerate_segment_summary_task.secrets.token_urlsafe", return_value="token-1"),
        patch("tasks.regenerate_segment_summary_task.redis_client") as redis,
        patch("tasks.regenerate_segment_summary_task.regenerate_segment_summary_task") as task,
    ):
        token = schedule_segment_summary_regeneration(
            segment,
            dataset,
            summary_record,
            session=session,
        )

    assert token == "token-1"
    assert summary_record.status == SummaryStatus.NOT_STARTED
    assert summary_record.error is None
    session.add.assert_called_once_with(summary_record)
    session.commit.assert_called_once()
    redis.setex.assert_called_once_with(
        "segment_summary_regeneration:segment-1",
        SUMMARY_REGENERATION_TOKEN_TTL_SECONDS,
        "token-1",
    )
    task.apply_async.assert_called_once_with(
        kwargs={
            "dataset_id": "dataset-1",
            "document_id": "document-1",
            "segment_id": "segment-1",
            "expected_index_node_hash": "hash-1",
            "token": "token-1",
        },
        countdown=SUMMARY_REGENERATION_DELAY_SECONDS,
    )
    assert SUMMARY_REGENERATION_DELAY_SECONDS == 600


def test_regenerate_segment_summary_task_skips_superseded_edit() -> None:
    with (
        patch("tasks.regenerate_segment_summary_task.redis_client") as redis,
        patch("tasks.regenerate_segment_summary_task.session_factory") as session_factory,
    ):
        redis.eval.return_value = 0

        regenerate_segment_summary_task.run(
            "dataset-1",
            "document-1",
            "segment-1",
            "hash-1",
            "stale-token",
        )

    session_factory.create_session.assert_not_called()


def test_regenerate_segment_summary_task_discards_result_if_segment_changes_during_generation() -> None:
    session = MagicMock()
    dataset = SimpleNamespace(
        id="dataset-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        summary_index_setting={"enable": True},
    )
    segment = SimpleNamespace(
        id="segment-1",
        document_id="document-1",
        index_node_hash="hash-1",
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    summary_record = SimpleNamespace(enabled=True, status=SummaryStatus.NOT_STARTED, error=None)
    session.get.side_effect = lambda model, _id: (
        dataset if model is Dataset else segment if model is DocumentSegment else None
    )
    session.scalar.return_value = summary_record

    with (
        patch("tasks.regenerate_segment_summary_task.redis_client") as redis,
        patch("tasks.regenerate_segment_summary_task.session_factory") as session_factory,
        patch(
            "tasks.regenerate_segment_summary_task.SummaryIndexService.generate_summary_for_segment",
            return_value=("generated summary", SimpleNamespace(total_tokens=5)),
        ) as generate_summary,
        patch("tasks.regenerate_segment_summary_task.SummaryIndexService.update_summary_for_segment") as update_summary,
    ):
        redis.eval.return_value = 1
        redis.get.side_effect = [b"running:token-1", b"token-2"]
        session_factory.create_session.return_value.__enter__.return_value = session

        regenerate_segment_summary_task.run(
            "dataset-1",
            "document-1",
            "segment-1",
            "hash-1",
            "token-1",
        )

    assert summary_record.status == SummaryStatus.GENERATING
    generate_summary.assert_called_once()
    update_summary.assert_not_called()


def test_regenerate_segment_summary_task_updates_latest_segment_and_clears_token() -> None:
    session = MagicMock()
    dataset = SimpleNamespace(
        id="dataset-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        summary_index_setting={"enable": True},
    )
    segment = SimpleNamespace(
        id="segment-1",
        document_id="document-1",
        index_node_hash="hash-1",
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    summary_record = SimpleNamespace(enabled=True, status=SummaryStatus.NOT_STARTED, error=None)
    session.get.side_effect = lambda model, _id: (
        dataset if model is Dataset else segment if model is DocumentSegment else None
    )
    session.scalar.return_value = summary_record

    with (
        patch("tasks.regenerate_segment_summary_task.redis_client") as redis,
        patch("tasks.regenerate_segment_summary_task.session_factory") as session_factory,
        patch(
            "tasks.regenerate_segment_summary_task.SummaryIndexService.generate_summary_for_segment",
            return_value=("latest summary", SimpleNamespace(total_tokens=8)),
        ) as generate_summary,
        patch("tasks.regenerate_segment_summary_task.SummaryIndexService.update_summary_for_segment") as update_summary,
    ):
        redis.eval.return_value = 1
        redis.get.return_value = b"running:token-1"
        session_factory.create_session.return_value.__enter__.return_value = session

        regenerate_segment_summary_task.run(
            "dataset-1",
            "document-1",
            "segment-1",
            "hash-1",
            "token-1",
        )

    assert summary_record.status == SummaryStatus.GENERATING
    generate_summary.assert_called_once_with(segment, dataset, {"enable": True}, session=session)
    update_summary.assert_called_once_with(segment, dataset, "latest summary", session=session)
    assert redis.eval.call_count == 2
