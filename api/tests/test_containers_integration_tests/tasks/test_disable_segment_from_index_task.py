"""Container integration coverage for the single-segment disable task."""

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from models.dataset import DocumentSegment
from models.enums import SegmentStatus
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tests.test_containers_integration_tests.helpers.segment_state import (
    RecordingIndexProcessor,
    RecordingIndexProcessorFactory,
    create_graph,
    create_segment,
)


def test_single_disable_cleans_current_segment_from_index(
    db_session_with_containers: Session,
) -> None:
    graph = create_graph(db_session_with_containers)
    segment = create_segment(db_session_with_containers, graph, position=1, enabled=False)
    processor = RecordingIndexProcessor()

    with (
        patch(
            "tasks.disable_segment_from_index_task.IndexProcessorFactory",
            return_value=RecordingIndexProcessorFactory(processor),
        ),
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments"
        ) as disable_summaries,
    ):
        disable_segment_from_index_task(segment.id)

    assert processor.cleaned_node_ids == [(segment.index_node_id,)]
    disable_summaries.assert_called_once()
    db_session_with_containers.expire_all()
    persisted = db_session_with_containers.get_one(DocumentSegment, segment.id)
    assert persisted.indexing_request_id is None


def test_single_disable_ignores_missing_segment(db_session_with_containers: Session) -> None:
    create_graph(db_session_with_containers)

    with patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as processor_factory:
        disable_segment_from_index_task(str(uuid4()))

    processor_factory.assert_not_called()


def test_single_disable_ignores_noncompleted_segment(
    db_session_with_containers: Session,
) -> None:
    graph = create_graph(db_session_with_containers)
    segment = create_segment(
        db_session_with_containers,
        graph,
        position=1,
        enabled=False,
        status=SegmentStatus.ERROR,
    )

    with patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as processor_factory:
        disable_segment_from_index_task(segment.id)

    processor_factory.assert_not_called()
    db_session_with_containers.expire_all()
    persisted = db_session_with_containers.get_one(DocumentSegment, segment.id)
    assert persisted.indexing_request_id is None
