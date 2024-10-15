from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueRetrieverResourcesEvent
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import DatasetQuery, DocumentSegment
from models.model import DatasetRetrieverResource


class DatasetIndexToolCallbackHandler:
    """Callback handler for dataset tool."""

    def __init__(
        self, queue_manager: AppQueueManager, app_id: str, message_id: str, user_id: str, invoke_from: InvokeFrom
    ) -> None:
        self._queue_manager = queue_manager
        self._app_id = app_id
        self._message_id = message_id
        self._user_id = user_id
        self._invoke_from = invoke_from

    def on_query(self, query: str, dataset_id: str) -> None:
        """
        Handle query.
        """
        dataset_query = DatasetQuery(
            dataset_id=dataset_id,
            content=query,
            source="app",
            source_app_id=self._app_id,
            created_by_role=(
                "account" if self._invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER} else "end_user"
            ),
            created_by=self._user_id,
        )

        db.session.add(dataset_query)
        db.session.commit()

    def on_tool_end(self, documents: list[Document]) -> None:
        """Handle tool end."""
        for document in documents:
            query = db.session.query(DocumentSegment).filter(
                DocumentSegment.index_node_id == document.metadata["doc_id"]
            )

            if "dataset_id" in document.metadata:
                query = query.filter(DocumentSegment.dataset_id == document.metadata["dataset_id"])

            # add hit count to document segment
            query.update({DocumentSegment.hit_count: DocumentSegment.hit_count + 1}, synchronize_session=False)

            db.session.commit()

    def return_retriever_resource_info(self, resource: list):
        """Handle return_retriever_resource_info."""
        if resource and len(resource) > 0:
            for item in resource:
                dataset_retriever_resource = DatasetRetrieverResource(
                    message_id=self._message_id,
                    position=item.get("position") or 0,
                    dataset_id=item.get("dataset_id"),
                    dataset_name=item.get("dataset_name"),
                    document_id=item.get("document_id"),
                    document_name=item.get("document_name"),
                    data_source_type=item.get("data_source_type"),
                    segment_id=item.get("segment_id"),
                    score=item.get("score") if "score" in item else None,
                    hit_count=item.get("hit_count") if "hit_count" in item else None,
                    word_count=item.get("word_count") if "word_count" in item else None,
                    segment_position=item.get("segment_position") if "segment_position" in item else None,
                    index_node_hash=item.get("index_node_hash") if "index_node_hash" in item else None,
                    content=item.get("content"),
                    retriever_from=item.get("retriever_from"),
                    created_by=self._user_id,
                )
                db.session.add(dataset_retriever_resource)
                db.session.commit()

        self._queue_manager.publish(
            QueueRetrieverResourcesEvent(retriever_resources=resource), PublishFrom.APPLICATION_MANAGER
        )
