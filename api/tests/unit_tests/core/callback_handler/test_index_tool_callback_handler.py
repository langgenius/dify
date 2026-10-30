from typing import TypeIs

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import AppQueueEvent, QueueRetrieverResourcesEvent
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from services.knowledge.entities.citation import RetrievalSourceMetadata


class RecordingQueueManager:
    def __init__(self) -> None:
        self.published: list[tuple[AppQueueEvent, PublishFrom]] = []

    def publish(self, event: AppQueueEvent, publish_from: PublishFrom) -> None:
        self.published.append((event, publish_from))


def test_return_retriever_resource_info_publishes_application_event() -> None:
    queue_manager = RecordingQueueManager()

    def is_queue_manager(value: object) -> TypeIs[AppQueueManager]:
        return callable(getattr(value, "publish", None))

    assert is_queue_manager(queue_manager)
    handler = DatasetIndexToolCallbackHandler(queue_manager=queue_manager)
    resources = [RetrievalSourceMetadata(dataset_id="dataset-1")]

    handler.return_retriever_resource_info(resources)

    assert len(queue_manager.published) == 1
    event, publish_from = queue_manager.published[0]
    assert isinstance(event, QueueRetrieverResourcesEvent)
    assert event.retriever_resources == resources
    assert publish_from is PublishFrom.APPLICATION_MANAGER
