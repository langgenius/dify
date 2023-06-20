from typing import cast

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

    def _reload_if_needed(self):
        if isinstance(self.client, QdrantLocal):
            self.client = cast(QdrantLocal, self.client)
            self.client._load()
