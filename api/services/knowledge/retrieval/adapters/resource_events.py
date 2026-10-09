from collections.abc import Sequence

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import QueueRetrieverResourcesEvent
from core.rag.entities import RetrievalSourceMetadata


class DatasetIndexToolCallbackHandler:
    """Callback handler for dataset tool."""

    def __init__(self, queue_manager: AppQueueManager):
        self._queue_manager = queue_manager

    def return_retriever_resource_info(self, resource: Sequence[RetrievalSourceMetadata]) -> None:
        """Handle return_retriever_resource_info."""
        self._queue_manager.publish(
            QueueRetrieverResourcesEvent(retriever_resources=resource), PublishFrom.APPLICATION_MANAGER
        )
