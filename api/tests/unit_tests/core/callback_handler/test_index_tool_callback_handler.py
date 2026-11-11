from unittest.mock import create_autospec

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import QueueRetrieverResourcesEvent
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from services.knowledge.entities.citation import RetrievalSourceMetadata


def test_return_retriever_resource_info_publishes_application_event() -> None:
    queue_manager = create_autospec(AppQueueManager, instance=True, spec_set=True)
    handler = DatasetIndexToolCallbackHandler(queue_manager=queue_manager)
    resources = [RetrievalSourceMetadata(dataset_id="dataset-1")]

    handler.return_retriever_resource_info(resources)

    queue_manager.publish.assert_called_once()
    event, publish_from = queue_manager.publish.call_args.args
    assert isinstance(event, QueueRetrieverResourcesEvent)
    assert event.retriever_resources == resources
    assert publish_from is PublishFrom.APPLICATION_MANAGER
