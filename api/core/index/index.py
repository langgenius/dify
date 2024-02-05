from flask import current_app
from langchain.embeddings import OpenAIEmbeddings

from core.embedding.cached_embedding import CacheEmbedding
from core.index.keyword_table_index.keyword_table_index import KeywordTableConfig, KeywordTableIndex
from core.index.vector_index.vector_index import VectorIndex
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset


class IndexBuilder:
    @classmethod
    def get_index(cls, dataset: Dataset, indexing_technique: str, ignore_high_quality_check: bool = False):
        if indexing_technique == "high_quality":
            if not ignore_high_quality_check and dataset.indexing_technique != 'high_quality':
                return None

            model_manager = ModelManager()
            embedding_model = model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                model_type=ModelType.TEXT_EMBEDDING,
                provider=dataset.embedding_model_provider,
                model=dataset.embedding_model
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

    @classmethod
    def get_default_high_quality_index(cls, dataset: Dataset):
        embeddings = OpenAIEmbeddings(openai_api_key=' ')
        return VectorIndex(
            dataset=dataset,
            config=current_app.config,
            embeddings=embeddings
        )
