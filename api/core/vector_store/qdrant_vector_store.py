from typing import cast, Any

from langchain.schema import Document
from langchain.vectorstores import Qdrant
from qdrant_client.http.models import Filter, PointIdsList, FilterSelector
from qdrant_client.local.qdrant_local import QdrantLocal


class QdrantVectorStore(Qdrant):
    def del_texts(self, filter: Filter):
        if not filter:
            raise ValueError('filter must not be empty')

        self._reload_if_needed()

        self.client.delete(
            collection_name=self.collection_name,
            points_selector=FilterSelector(
                filter=filter
            ),
        )

    def del_text(self, uuid: str) -> None:
        self._reload_if_needed()

        self.client.delete(
            collection_name=self.collection_name,
            points_selector=PointIdsList(
                points=[uuid],
            ),
        )

    def text_exists(self, uuid: str) -> bool:
        self._reload_if_needed()

        response = self.client.retrieve(
            collection_name=self.collection_name,
            ids=[uuid]
        )

        return len(response) > 0

    def delete(self):
        self._reload_if_needed()

        self.client.delete_collection(collection_name=self.collection_name)

    @classmethod
    def _document_from_scored_point(
            cls,
            scored_point: Any,
            content_payload_key: str,
            metadata_payload_key: str,
    ) -> Document:
        if scored_point.payload.get('doc_id'):
            return Document(
                page_content=scored_point.payload.get(content_payload_key),
                metadata={'doc_id': scored_point.id}
            )

        return Document(
            page_content=scored_point.payload.get(content_payload_key),
            metadata=scored_point.payload.get(metadata_payload_key) or {},
        )

    def _reload_if_needed(self):
        if isinstance(self.client, QdrantLocal):
            self.client = cast(QdrantLocal, self.client)
            self.client._load()
