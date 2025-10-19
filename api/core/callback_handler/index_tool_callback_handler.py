import logging
from collections.abc import Sequence

from sqlalchemy import select

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueRetrieverResourcesEvent
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import ChildChunk, DatasetQuery, DocumentSegment
from models.dataset import Document as DatasetDocument

_logger = logging.getLogger(__name__)


class DatasetIndexToolCallbackHandler:
    """Callback handler for dataset tool."""

    def __init__(
        self, queue_manager: AppQueueManager, app_id: str, message_id: str, user_id: str, invoke_from: InvokeFrom
    ):
        self._queue_manager = queue_manager
        self._app_id = app_id
        self._message_id = message_id
        self._user_id = user_id
        self._invoke_from = invoke_from

    def on_query(self, query: str, dataset_id: str):
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

    def on_tool_end(self, documents: list[Document]):
        """Handle tool end."""
        for document in documents:
            if document.metadata is not None:
                document_id = document.metadata["document_id"]
                dataset_document_stmt = select(DatasetDocument).where(DatasetDocument.id == document_id)
                dataset_document = db.session.scalar(dataset_document_stmt)
                if not dataset_document:
                    _logger.warning(
                        "Expected DatasetDocument record to exist, but none was found, document_id=%s",
                        document_id,
                    )
                    continue
                if dataset_document.doc_form == IndexType.PARENT_CHILD_INDEX:
                    child_chunk_stmt = select(ChildChunk).where(
                        ChildChunk.index_node_id == document.metadata["doc_id"],
                        ChildChunk.dataset_id == dataset_document.dataset_id,
                        ChildChunk.document_id == dataset_document.id,
                    )
                    child_chunk = db.session.scalar(child_chunk_stmt)
                    if child_chunk:
                        _ = (
                            db.session.query(DocumentSegment)
                            .where(DocumentSegment.id == child_chunk.segment_id)
                            .update(
                                {DocumentSegment.hit_count: DocumentSegment.hit_count + 1}, synchronize_session=False
                            )
                        )
                else:
                    query = db.session.query(DocumentSegment).where(
                        DocumentSegment.index_node_id == document.metadata["doc_id"]
                    )

                    if "dataset_id" in document.metadata:
                        query = query.where(DocumentSegment.dataset_id == document.metadata["dataset_id"])

                    # add hit count to document segment
                    query.update({DocumentSegment.hit_count: DocumentSegment.hit_count + 1}, synchronize_session=False)

                db.session.commit()

    # TODO(-LAN-): Improve type check
    def return_retriever_resource_info(self, resource: Sequence[RetrievalSourceMetadata]):
        """Handle return_retriever_resource_info."""
        self._queue_manager.publish(
            QueueRetrieverResourcesEvent(retriever_resources=resource), PublishFrom.APPLICATION_MANAGER
        )
