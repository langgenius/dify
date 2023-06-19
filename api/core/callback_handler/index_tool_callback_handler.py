from typing import List

from langchain.schema import Document

from extensions.ext_database import db
from models.dataset import DocumentSegment


class DatasetIndexToolCallbackHandler:
    """Callback handler for dataset tool."""

    def __init__(self, dataset_id: str) -> None:
        self.dataset_id = dataset_id

    def on_tool_end(self, documents: List[Document]) -> None:
        """Handle tool end."""
        for document in documents:
            doc_id = document.metadata['doc_id']

            # add hit count to document segment
            db.session.query(DocumentSegment).filter(
                DocumentSegment.dataset_id == self.dataset_id,
                DocumentSegment.index_node_id == doc_id
            ).update(
                {DocumentSegment.hit_count: DocumentSegment.hit_count + 1},
                synchronize_session=False
            )

            db.session.commit()
