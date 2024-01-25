from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, List

from core.rag.datasource.entity.embedding import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset


class BaseVector(ABC):

    def __init__(self, dataset: Dataset, embeddings: Embeddings):
        self.dataset = dataset
        self._embeddings = embeddings

    @abstractmethod
    def create(self, texts: list[Document], **kwargs) -> BaseVector:
        raise NotImplementedError

    @abstractmethod
    def add_texts(self, texts: list[Document], collection_name: str, **kwargs):
        raise NotImplementedError

    @abstractmethod
    def text_exists(self, id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def delete_by_ids(self, ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def delete_by_metadata_field(self, key: str, value: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search_by_vector(
            self, query: str,
            **kwargs: Any
    ) -> List[Document]:
        raise NotImplementedError

    @abstractmethod
    def search_by_full_text(
            self, query: str,
            **kwargs: Any
    ) -> List[Document]:
        raise NotImplementedError

    def delete(self) -> None:
        raise NotImplementedError

    def _filter_duplicate_texts(self, texts: list[Document]) -> list[Document]:
        for text in texts:
            doc_id = text.metadata['doc_id']
            exists_duplicate_node = self.text_exists(doc_id)
            if exists_duplicate_node:
                texts.remove(text)

        return texts

    def _get_uuids(self, texts: list[Document]) -> list[str]:
        return [text.metadata['doc_id'] for text in texts]
