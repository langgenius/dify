import json

from flask import current_app
from langchain.embeddings import OpenAIEmbeddings

from core.embedding.cached_embedding import CacheEmbedding
from core.index.keyword_table_index.keyword_table_index import KeywordTableIndex, KeywordTableConfig
from core.index.vector_index.vector_index import VectorIndex
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.embedding.openai_embedding import OpenAIEmbedding
from core.model_providers.models.entity.model_params import ModelKwargs
from core.model_providers.models.llm.openai_model import OpenAIModel
from core.model_providers.providers.openai_provider import OpenAIProvider
from models.dataset import Dataset
from models.provider import Provider, ProviderType


class IndexBuilder:
    @classmethod
    def get_index(cls, dataset: Dataset, indexing_technique: str, ignore_high_quality_check: bool = False):
        if indexing_technique == "high_quality":
            if not ignore_high_quality_check and dataset.indexing_technique != 'high_quality':
                return None

            embedding_model = ModelFactory.get_embedding_model(
                tenant_id=dataset.tenant_id,
                model_provider_name=dataset.embedding_model_provider,
                model_name=dataset.embedding_model
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
