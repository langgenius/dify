from abc import abstractmethod
from typing import List, Any, Tuple

from langchain.schema import Document
from langchain.vectorstores import VectorStore

from index.base import BaseIndex


class BaseVectorIndex(BaseIndex):
    def get_type(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_index_name(self, dataset_id: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def to_index_struct(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    def _get_vector_store(self) -> VectorStore:
        raise NotImplementedError
