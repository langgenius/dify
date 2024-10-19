from typing import Any

from configs import dify_config
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.datasource.keyword.keyword_type import KeyWordType
from core.rag.models.document import Document
from models.dataset import Dataset


class Keyword:
    def __init__(self, dataset: Dataset):
        self._dataset = dataset
        self._keyword_processor = self._init_keyword()

    def _init_keyword(self) -> BaseKeyword:
        keyword_type = dify_config.KEYWORD_STORE
        keyword_factory = self.get_keyword_factory(keyword_type)
        return keyword_factory(self._dataset)

    @staticmethod
    def get_keyword_factory(keyword_type: str) -> type[BaseKeyword]:
        match keyword_type:
            case KeyWordType.JIEBA:
                from core.rag.datasource.keyword.jieba.jieba import Jieba

                return Jieba
            case _:
                raise ValueError(f"Keyword store {keyword_type} is not supported.")

    def create(self, texts: list[Document], **kwargs):
        self._keyword_processor.create(texts, **kwargs)

    def add_texts(self, texts: list[Document], **kwargs):
        self._keyword_processor.add_texts(texts, **kwargs)

    def text_exists(self, id: str) -> bool:
        return self._keyword_processor.text_exists(id)

    def delete_by_ids(self, ids: list[str]) -> None:
        self._keyword_processor.delete_by_ids(ids)

    def delete(self) -> None:
        self._keyword_processor.delete()

    def search(self, query: str, **kwargs: Any) -> list[Document]:
        return self._keyword_processor.search(query, **kwargs)

    def __getattr__(self, name):
        if self._keyword_processor is not None:
            method = getattr(self._keyword_processor, name)
            if callable(method):
                return method

        raise AttributeError(f"'Keyword' object has no attribute '{name}'")
