from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.orm import Session

from core.rag.models.document import Document
from models.dataset import Dataset


class BaseKeyword(ABC):
    def __init__(self, dataset: Dataset):
        self.dataset = dataset

    @abstractmethod
    def create(self, texts: list[Document], session: Session, **kwargs: Any) -> BaseKeyword:
        raise NotImplementedError

    @abstractmethod
    def add_texts(self, texts: list[Document], session: Session, **kwargs: Any):
        raise NotImplementedError

    @abstractmethod
    def text_exists(self, id: str, *, session: Session) -> bool:
        raise NotImplementedError

    @abstractmethod
    def delete_by_ids(self, ids: list[str], session: Session, **kwargs: Any):
        raise NotImplementedError

    @abstractmethod
    def delete(self, *, session: Session):
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str, *, session: Session, **kwargs: Any) -> list[Document]:
        raise NotImplementedError

    def _filter_duplicate_texts(self, texts: list[Document], *, session: Session) -> list[Document]:
        for text in texts.copy():
            if text.metadata is None:
                continue
            doc_id = text.metadata["doc_id"]
            exists_duplicate_node = self.text_exists(doc_id, session=session)
            if exists_duplicate_node:
                texts.remove(text)

        return texts

    def _get_uuids(self, texts: list[Document]) -> list[str]:
        return [text.metadata["doc_id"] for text in texts if text.metadata]
