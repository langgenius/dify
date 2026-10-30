"""Container integration coverage for the document-enable indexing task."""

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment
from tasks.add_document_to_index_task import add_document_to_index_task
from tests.test_containers_integration_tests.helpers.segment_state import (
    RecordingIndexProcessor,
    RecordingIndexProcessorFactory,
    create_graph,
    create_segment,
)


def test_add_document_indexes_completed_segments_and_enables_them(
    db_session_with_containers: Session,
) -> None:
    graph = create_graph(db_session_with_containers)
    segments = [
        create_segment(db_session_with_containers, graph, position=position, enabled=False) for position in range(1, 4)
    ]
    processor = RecordingIndexProcessor()
    cache_key = f"document_{graph.document.id}_indexing"
    redis_client.set(cache_key, "processing", ex=300)

    with (
        patch(
            "tasks.add_document_to_index_task.IndexProcessorFactory",
            return_value=RecordingIndexProcessorFactory(processor),
        ),
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments"
        ) as enable_summaries,
    ):
        add_document_to_index_task(graph.document.id)

    assert len(processor.loaded_documents) == 1
    assert {document.metadata["doc_id"] for document in processor.loaded_documents[0]} == {
        segment.index_node_id for segment in segments
    }
    db_session_with_containers.expire_all()
    assert all(db_session_with_containers.get_one(DocumentSegment, segment.id).enabled for segment in segments)
    enable_summaries.assert_called_once()
    assert redis_client.exists(cache_key) == 0


def test_add_document_missing_document_is_a_noop() -> None:
    processor = RecordingIndexProcessor()

    with patch(
        "tasks.add_document_to_index_task.IndexProcessorFactory",
        return_value=RecordingIndexProcessorFactory(processor),
    ) as processor_factory:
        add_document_to_index_task(str(uuid4()))

    processor_factory.assert_not_called()
    assert processor.loaded_documents == []
