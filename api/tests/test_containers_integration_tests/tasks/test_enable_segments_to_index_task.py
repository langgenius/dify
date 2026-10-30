"""Container integration coverage for the batch segment-enable task."""

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from tasks.enable_segments_to_index_task import enable_segments_to_index_task
from tests.test_containers_integration_tests.helpers.segment_state import (
    RecordingIndexProcessor,
    RecordingIndexProcessorFactory,
    create_graph,
    create_segment,
)


def test_batch_enable_indexes_only_segments_owned_by_document(
    db_session_with_containers: Session,
) -> None:
    graph = create_graph(db_session_with_containers)
    segments = [
        create_segment(db_session_with_containers, graph, position=position, enabled=True) for position in range(1, 4)
    ]
    foreign_graph = create_graph(db_session_with_containers)
    foreign = create_segment(db_session_with_containers, foreign_graph, position=1, enabled=True)
    processor = RecordingIndexProcessor()

    with (
        patch(
            "tasks.enable_segments_to_index_task.IndexProcessorFactory",
            return_value=RecordingIndexProcessorFactory(processor),
        ),
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments"
        ) as enable_summaries,
    ):
        enable_segments_to_index_task(
            [*[segment.id for segment in segments], foreign.id],
            graph.dataset.id,
            graph.document.id,
        )

    assert len(processor.loaded_documents) == 1
    assert {document.metadata["doc_id"] for document in processor.loaded_documents[0]} == {
        segment.index_node_id for segment in segments
    }
    enable_summaries.assert_called_once()


def test_batch_enable_missing_dataset_is_a_noop() -> None:
    with patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory:
        enable_segments_to_index_task([str(uuid4())], str(uuid4()), str(uuid4()))

    processor_factory.assert_not_called()
