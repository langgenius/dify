from typing import cast

from core.embedding.cached_embedding import CacheEmbedding
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.datasource.vdb.vector_base import BaseVector
from flask import current_app
from models.dataset import Dataset


class Keyword:
    def __init__(self, dataset: Dataset):
        self._dataset = dataset
        self._keyword_processor = self._init_vector()

    def _init_keyword(self) -> BaseKeyword:
        config = cast(dict, current_app.config)
        keyword_type = config.get('KEYWORD_STORE')

        if not keyword_type:
            raise ValueError(f"Keyword store must be specified.")

        if keyword_type == "jieba":
            return Jieba(
                dataset=self._dataset
            )
        else:
            raise ValueError(f"Vector store {config.get('VECTOR_STORE')} is not supported.")

    def __getattr__(self, name):
        if self._vector_processor is not None:
            method = getattr(self._vector_processor, name)
            if callable(method):
                return method

        raise AttributeError(f"'vector_processor' object has no attribute '{name}'")

    @property
    def keyword_processor(self):
        return self._keyword_processor
