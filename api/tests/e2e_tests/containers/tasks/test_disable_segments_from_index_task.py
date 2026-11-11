"""Container integration coverage for the batch segment-disable task."""

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tests.e2e_tests.containers.helpers.segment_state import (
    RecordingIndexProcessor,
    RecordingIndexProcessorFactory,
    create_graph,
    create_segment,
)


def test_batch_disable_cleans_only_segments_owned_by_document(
    db_session_with_containers: Session,
) -> None:
    graph = create_graph(db_session_with_containers)
    segments = [
        create_segment(db_session_with_containers, graph, position=position, enabled=False) for position in range(1, 4)
    ]
    foreign_graph = create_graph(db_session_with_containers)
    foreign = create_segment(db_session_with_containers, foreign_graph, position=1, enabled=False)
    processor = RecordingIndexProcessor()

    with (
        patch(
            "tasks.disable_segments_from_index_task.IndexProcessorFactory",
            return_value=RecordingIndexProcessorFactory(processor),
        ),
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments"
        ) as disable_summaries,
    ):
        disable_segments_from_index_task(
            [*[segment.id for segment in segments], foreign.id],
            graph.dataset.id,
            graph.document.id,
        )

    assert processor.cleaned_node_ids == [tuple(segment.index_node_id for segment in segments)]
    disable_summaries.assert_called_once()


def test_batch_disable_missing_dataset_is_a_noop() -> None:
    with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as processor_factory:
        disable_segments_from_index_task([str(uuid4())], str(uuid4()), str(uuid4()))

    processor_factory.assert_not_called()
