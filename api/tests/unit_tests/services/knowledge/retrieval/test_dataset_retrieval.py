from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueRetrieverResourcesEvent
from core.rag.models.document import Document
from extensions.application_services.retrieval import build_dataset_retrieval
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.knowledge.retrieval.dataset_retrieval import DatasetRetrieval


def test_external_context_preserves_document_metadata_in_published_resources(
    sqlite_session_factory: sessionmaker[Session],
    agent_queue_manager: MessageBasedAppQueueManager,
) -> None:
    """Publish external metadata unchanged through the production resource callback."""
    metadata = {
        "dataset_id": "external-dataset",
        "dataset_name": "External knowledge",
        "document_id": "external-document",
        "title": "External document",
        "score": 0.9,
        "category": "reference",
        "attributes": {"region": "global"},
    }
    document = Document(page_content="Retrieved content", metadata=metadata, provider="external")
    retrieval = build_dataset_retrieval(sqlite_session_factory)()
    assert isinstance(retrieval, DatasetRetrieval)

    context, files = retrieval._context(
        all_documents=[document],
        tenant_id="tenant",
        available_datasets_ids=["external-dataset"],
        show_retrieve_source=True,
        vision_enabled=False,
        invoke_from=InvokeFrom.SERVICE_API,
        hit_callback=DatasetIndexToolCallbackHandler(agent_queue_manager),
    )

    message = agent_queue_manager._q.get_nowait()
    assert message is not None
    assert isinstance(message.event, QueueRetrieverResourcesEvent)
    assert len(message.event.retriever_resources) == 1
    resource = message.event.retriever_resources[0]
    assert resource.doc_metadata == metadata
    assert resource.document_id == "external-document"
    assert resource.content == "Retrieved content"
    assert document.metadata == metadata
    assert context == "Retrieved content"
    assert files == []
