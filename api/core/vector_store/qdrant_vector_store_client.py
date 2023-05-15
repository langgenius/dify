import os
from typing import cast, List

from llama_index.data_structs import Node
from llama_index.data_structs.node_v2 import DocumentRelationship
from llama_index.vector_stores.types import VectorStoreQuery, VectorStoreQueryResult
from qdrant_client.http.models import Payload, Filter

import qdrant_client
from llama_index import ServiceContext, GPTVectorStoreIndex, GPTQdrantIndex
from llama_index.data_structs.data_structs_v2 import QdrantIndexDict
from llama_index.vector_stores import QdrantVectorStore
from qdrant_client.local.qdrant_local import QdrantLocal

from core.vector_store.base import BaseVectorStoreClient, BaseGPTVectorStoreIndex, EnhanceVectorStore


class QdrantVectorStoreClient(BaseVectorStoreClient):

    def __init__(self, url: str, api_key: str, root_path: str):
        self._client = self.init_from_config(url, api_key, root_path)

    @classmethod
    def init_from_config(cls, url: str, api_key: str, root_path: str):
        if url and url.startswith('path:'):
            path = url.replace('path:', '')
            if not os.path.isabs(path):
                path = os.path.join(root_path, path)

            return qdrant_client.QdrantClient(
                path=path
            )
        else:
            return qdrant_client.QdrantClient(
                url=url,
                api_key=api_key,
            )

    def get_index(self, service_context: ServiceContext, config: dict) -> GPTVectorStoreIndex:
        index_struct = QdrantIndexDict()

        if self._client is None:
            raise Exception("Vector client is not initialized.")

        # {"collection_name": "Gpt_index_xxx"}
        collection_name = config.get('collection_name')
        if not collection_name:
            raise Exception("collection_name cannot be None.")

        return GPTQdrantEnhanceIndex(
            service_context=service_context,
            index_struct=index_struct,
            vector_store=QdrantEnhanceVectorStore(
                client=self._client,
                collection_name=collection_name
            )
        )

    def to_index_config(self, index_id: str) -> dict:
        return {"collection_name": index_id}


class GPTQdrantEnhanceIndex(GPTQdrantIndex, BaseGPTVectorStoreIndex):
    pass


class QdrantEnhanceVectorStore(QdrantVectorStore, EnhanceVectorStore):
    def delete_node(self, node_id: str):
        """
        Delete node from the index.

        :param node_id: node id
        """
        from qdrant_client.http import models as rest

        self._reload_if_needed()

        self._client.delete(
            collection_name=self._collection_name,
            points_selector=rest.Filter(
                must=[
                    rest.FieldCondition(
                        key="id", match=rest.MatchValue(value=node_id)
                    )
                ]
            ),
        )

    def exists_by_node_id(self, node_id: str) -> bool:
        """
        Get node from the index by node id.

        :param node_id: node id
        """
        self._reload_if_needed()

        response = self._client.retrieve(
            collection_name=self._collection_name,
            ids=[node_id]
        )

        return len(response) > 0

    def query(
        self,
        query: VectorStoreQuery,
    ) -> VectorStoreQueryResult:
        """Query index for top k most similar nodes.

        Args:
            query (VectorStoreQuery): query
        """
        query_embedding = cast(List[float], query.query_embedding)

        self._reload_if_needed()

        response = self._client.search(
            collection_name=self._collection_name,
            query_vector=query_embedding,
            limit=cast(int, query.similarity_top_k),
            query_filter=cast(Filter, self._build_query_filter(query)),
            with_vectors=True
        )

        nodes = []
        similarities = []
        ids = []
        for point in response:
            payload = cast(Payload, point.payload)
            node = Node(
                doc_id=str(point.id),
                text=payload.get("text"),
                embedding=point.vector,
                extra_info=payload.get("extra_info"),
                relationships={
                    DocumentRelationship.SOURCE: payload.get("doc_id", "None"),
                },
            )
            nodes.append(node)
            similarities.append(point.score)
            ids.append(str(point.id))

        return VectorStoreQueryResult(nodes=nodes, similarities=similarities, ids=ids)

    def _reload_if_needed(self):
        if isinstance(self._client._client, QdrantLocal):
            self._client._client._load()
