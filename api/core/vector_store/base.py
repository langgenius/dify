from abc import ABC, abstractmethod
from typing import Optional

from llama_index import ServiceContext, GPTVectorStoreIndex
from llama_index.data_structs import Node
from llama_index.vector_stores.types import VectorStore


class BaseVectorStoreClient(ABC):
    @abstractmethod
    def get_index(self, service_context: ServiceContext, config: dict) -> GPTVectorStoreIndex:
        raise NotImplementedError

    @abstractmethod
    def to_index_config(self, index_id: str) -> dict:
        raise NotImplementedError


class BaseGPTVectorStoreIndex(GPTVectorStoreIndex):
    def delete_node(self, node_id: str):
        self._vector_store.delete_node(node_id)

    def exists_by_node_id(self, node_id: str) -> bool:
        return self._vector_store.exists_by_node_id(node_id)


class EnhanceVectorStore(ABC):
    @abstractmethod
    def delete_node(self, node_id: str):
        pass

    @abstractmethod
    def exists_by_node_id(self, node_id: str) -> bool:
        pass
