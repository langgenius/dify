import json
import weaviate
from dataclasses import field
from typing import List, Any, Dict, Optional

from core.vector_store.base import BaseVectorStoreClient, BaseGPTVectorStoreIndex, EnhanceVectorStore
from llama_index import ServiceContext, GPTWeaviateIndex, GPTVectorStoreIndex
from llama_index.data_structs.data_structs_v2 import WeaviateIndexDict, Node
from llama_index.data_structs.node_v2 import DocumentRelationship
from llama_index.readers.weaviate.client import _class_name, NODE_SCHEMA, _logger
from llama_index.vector_stores import WeaviateVectorStore
from llama_index.vector_stores.types import VectorStoreQuery, VectorStoreQueryResult, VectorStoreQueryMode
from llama_index.readers.weaviate.utils import (
    parse_get_response,
    validate_client,
)


class WeaviateVectorStoreClient(BaseVectorStoreClient):

    def __init__(self, endpoint: str, api_key: str, grpc_enabled: bool, batch_size: int):
        self._client = self.init_from_config(endpoint, api_key, grpc_enabled, batch_size)

    def init_from_config(self, endpoint: str, api_key: str, grpc_enabled: bool, batch_size: int):
        auth_config = weaviate.auth.AuthApiKey(api_key=api_key)

        weaviate.connect.connection.has_grpc = grpc_enabled

        client = weaviate.Client(
            url=endpoint,
            auth_client_secret=auth_config,
            timeout_config=(5, 60),
            startup_period=None
        )

        client.batch.configure(
            # `batch_size` takes an `int` value to enable auto-batching
            # (`None` is used for manual batching)
            batch_size=batch_size,
            # dynamically update the `batch_size` based on import speed
            dynamic=True,
            # `timeout_retries` takes an `int` value to retry on time outs
            timeout_retries=3,
        )

        return client

    def get_index(self, service_context: ServiceContext, config: dict) -> GPTVectorStoreIndex:
        index_struct = WeaviateIndexDict()

        if self._client is None:
            raise Exception("Vector client is not initialized.")

        # {"class_prefix": "Gpt_index_xxx"}
        class_prefix = config.get('class_prefix')
        if not class_prefix:
            raise Exception("class_prefix cannot be None.")

        return GPTWeaviateEnhanceIndex(
            service_context=service_context,
            index_struct=index_struct,
            vector_store=WeaviateWithSimilaritiesVectorStore(
                weaviate_client=self._client,
                class_prefix=class_prefix
            )
        )

    def to_index_config(self, index_id: str) -> dict:
        return {"class_prefix": index_id}


class WeaviateWithSimilaritiesVectorStore(WeaviateVectorStore, EnhanceVectorStore):
    def query(self, query: VectorStoreQuery) -> VectorStoreQueryResult:
        """Query index for top k most similar nodes."""
        nodes = self.weaviate_query(
            self._client,
            self._class_prefix,
            query,
        )
        nodes = nodes[: query.similarity_top_k]
        node_idxs = [str(i) for i in range(len(nodes))]

        similarities = []
        for node in nodes:
            similarities.append(node.extra_info['similarity'])
            del node.extra_info['similarity']

        return VectorStoreQueryResult(nodes=nodes, ids=node_idxs, similarities=similarities)

    def weaviate_query(
            self,
            client: Any,
            class_prefix: str,
            query_spec: VectorStoreQuery,
    ) -> List[Node]:
        """Convert to LlamaIndex list."""
        validate_client(client)

        class_name = _class_name(class_prefix)
        prop_names = [p["name"] for p in NODE_SCHEMA]
        vector = query_spec.query_embedding

        # build query
        query = client.query.get(class_name, prop_names).with_additional(["id", "vector", "certainty"])
        if query_spec.mode == VectorStoreQueryMode.DEFAULT:
            _logger.debug("Using vector search")
            if vector is not None:
                query = query.with_near_vector(
                    {
                        "vector": vector,
                    }
                )
        elif query_spec.mode == VectorStoreQueryMode.HYBRID:
            _logger.debug(f"Using hybrid search with alpha {query_spec.alpha}")
            query = query.with_hybrid(
                query=query_spec.query_str,
                alpha=query_spec.alpha,
                vector=vector,
            )
        query = query.with_limit(query_spec.similarity_top_k)
        _logger.debug(f"Using limit of {query_spec.similarity_top_k}")

        # execute query
        query_result = query.do()

        # parse results
        parsed_result = parse_get_response(query_result)
        entries = parsed_result[class_name]
        results = [self._to_node(entry) for entry in entries]
        return results

    def _to_node(self, entry: Dict) -> Node:
        """Convert to Node."""
        extra_info_str = entry["extra_info"]
        if extra_info_str == "":
            extra_info = None
        else:
            extra_info = json.loads(extra_info_str)

        if 'certainty' in entry['_additional']:
            if extra_info:
                extra_info['similarity'] = entry['_additional']['certainty']
            else:
                extra_info = {'similarity': entry['_additional']['certainty']}

        node_info_str = entry["node_info"]
        if node_info_str == "":
            node_info = None
        else:
            node_info = json.loads(node_info_str)

        relationships_str = entry["relationships"]
        relationships: Dict[DocumentRelationship, str]
        if relationships_str == "":
            relationships = field(default_factory=dict)
        else:
            relationships = {
                DocumentRelationship(k): v for k, v in json.loads(relationships_str).items()
            }

        return Node(
            text=entry["text"],
            doc_id=entry["doc_id"],
            embedding=entry["_additional"]["vector"],
            extra_info=extra_info,
            node_info=node_info,
            relationships=relationships,
        )

    def delete(self, doc_id: str, **delete_kwargs: Any) -> None:
        """Delete a document.

        Args:
            doc_id (str): document id

        """
        delete_document(self._client, doc_id, self._class_prefix)

    def delete_node(self, node_id: str):
        """
        Delete node from the index.

        :param node_id: node id
        """
        delete_node(self._client, node_id, self._class_prefix)

    def exists_by_node_id(self, node_id: str) -> bool:
        """
        Get node from the index by node id.

        :param node_id: node id
        """
        entry = get_by_node_id(self._client, node_id, self._class_prefix)
        return True if entry else False


class GPTWeaviateEnhanceIndex(GPTWeaviateIndex, BaseGPTVectorStoreIndex):
    pass


def delete_document(client: Any, ref_doc_id: str, class_prefix: str) -> None:
    """Delete entry."""
    validate_client(client)
    # make sure that each entry
    class_name = _class_name(class_prefix)
    where_filter = {
        "path": ["ref_doc_id"],
        "operator": "Equal",
        "valueString": ref_doc_id,
    }
    query = (
        client.query.get(class_name).with_additional(["id"]).with_where(where_filter)
    )

    query_result = query.do()
    parsed_result = parse_get_response(query_result)
    entries = parsed_result[class_name]
    for entry in entries:
        client.data_object.delete(entry["_additional"]["id"], class_name)

    while len(entries) > 0:
        query_result = query.do()
        parsed_result = parse_get_response(query_result)
        entries = parsed_result[class_name]
        for entry in entries:
            client.data_object.delete(entry["_additional"]["id"], class_name)


def delete_node(client: Any, node_id: str, class_prefix: str) -> None:
    """Delete entry."""
    validate_client(client)
    # make sure that each entry
    class_name = _class_name(class_prefix)
    where_filter = {
        "path": ["doc_id"],
        "operator": "Equal",
        "valueString": node_id,
    }
    query = (
        client.query.get(class_name).with_additional(["id"]).with_where(where_filter)
    )

    query_result = query.do()
    parsed_result = parse_get_response(query_result)
    entries = parsed_result[class_name]
    for entry in entries:
        client.data_object.delete(entry["_additional"]["id"], class_name)


def get_by_node_id(client: Any, node_id: str, class_prefix: str) -> Optional[Dict]:
    """Delete entry."""
    validate_client(client)
    # make sure that each entry
    class_name = _class_name(class_prefix)
    where_filter = {
        "path": ["doc_id"],
        "operator": "Equal",
        "valueString": node_id,
    }
    query = (
        client.query.get(class_name).with_additional(["id"]).with_where(where_filter)
    )

    query_result = query.do()
    parsed_result = parse_get_response(query_result)
    entries = parsed_result[class_name]
    if len(entries) == 0:
        return None

    return entries[0]
