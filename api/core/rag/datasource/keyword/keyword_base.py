from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from core.rag.models.document import Document
from models.dataset import Dataset


class BaseKeyword(ABC):
    def __init__(self, dataset: Dataset):
        self.dataset = dataset

    @abstractmethod
    def create(self, texts: list[Document], **kwargs) -> BaseKeyword:
        raise NotImplementedError

    @abstractmethod
    def add_texts(self, texts: list[Document], **kwargs):
        raise NotImplementedError

    @abstractmethod
    def text_exists(self, id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def delete_by_ids(self, ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def delete(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str, **kwargs: Any) -> list[Document]:
        raise NotImplementedError

    def _filter_duplicate_texts(self, texts: list[Document]) -> list[Document]:
        for text in texts.copy():
            doc_id = text.metadata["doc_id"]
            exists_duplicate_node = self.text_exists(doc_id)
            if exists_duplicate_node:
                texts.remove(text)

        return texts

    def _get_uuids(self, texts: list[Document]) -> list[str]:
        return [text.metadata["doc_id"] for text in texts]
