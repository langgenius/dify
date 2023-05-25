from llama_index import Response

from extensions.ext_database import db
from models.dataset import DocumentSegment


class IndexToolCallbackHandler:

    def __init__(self) -> None:
        self._response = None

    @property
    def response(self) -> Response:
        return self._response

    def on_tool_end(self, response: Response) -> None:
        """Handle tool end."""
        self._response = response


class DatasetIndexToolCallbackHandler(IndexToolCallbackHandler):
    """Callback handler for dataset tool."""

    def __init__(self, dataset_id: str) -> None:
        super().__init__()
        self.dataset_id = dataset_id

    def on_tool_end(self, response: Response) -> None:
        """Handle tool end."""
        for node in response.source_nodes:
            index_node_id = node.node.doc_id

            # add hit count to document segment
            db.session.query(DocumentSegment).filter(
                DocumentSegment.dataset_id == self.dataset_id,
                DocumentSegment.index_node_id == index_node_id
            ).update(
                {DocumentSegment.hit_count: DocumentSegment.hit_count + 1},
                synchronize_session=False
            )

            db.session.commit()
