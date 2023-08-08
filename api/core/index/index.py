from flask import current_app

from core.embedding.cached_embedding import CacheEmbedding
from core.index.keyword_table_index.keyword_table_index import KeywordTableIndex, KeywordTableConfig
from core.index.vector_index.vector_index import VectorIndex
from core.model_providers.model_factory import ModelFactory
from models.dataset import Dataset


class IndexBuilder:
    @classmethod
    def get_index(cls, dataset: Dataset, indexing_technique: str, ignore_high_quality_check: bool = False):
        if indexing_technique == "high_quality":
            if not ignore_high_quality_check and dataset.indexing_technique != 'high_quality':
                return None

            embedding_model = ModelFactory.get_embedding_model(
                tenant_id=dataset.tenant_id
            )

            embeddings = CacheEmbedding(embedding_model)

            return VectorIndex(
                dataset=dataset,
                config=current_app.config,
                embeddings=embeddings
            )
        elif indexing_technique == "economy":
            return KeywordTableIndex(
                dataset=dataset,
                config=KeywordTableConfig(
                    max_keywords_per_chunk=10
                )
            )
        else:
            raise ValueError('Unknown indexing technique')