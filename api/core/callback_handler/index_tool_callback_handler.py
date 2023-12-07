from typing import List

from langchain.schema import Document

from core.conversation_message_task import ConversationMessageTask
from extensions.ext_database import db
from models.dataset import DocumentSegment


class DatasetIndexToolCallbackHandler:
    """Callback handler for dataset tool."""

    def __init__(self, conversation_message_task: ConversationMessageTask) -> None:
        self.conversation_message_task = conversation_message_task

    def on_tool_end(self, documents: List[Document]) -> None:
        """Handle tool end."""
        for document in documents:
            doc_id = document.metadata['doc_id']

            # add hit count to document segment
            db.session.query(DocumentSegment).filter(
                DocumentSegment.index_node_id == doc_id
            ).update(
                {DocumentSegment.hit_count: DocumentSegment.hit_count + 1},
                synchronize_session=False
            )

            db.session.commit()

    def return_retriever_resource_info(self, resource: List):
        """Handle return_retriever_resource_info."""
        self.conversation_message_task.on_dataset_query_finish(resource)
