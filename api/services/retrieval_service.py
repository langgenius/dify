
from typing import Optional
from flask import current_app, Flask
from langchain.embeddings.base import Embeddings
from core.index.vector_index.vector_index import VectorIndex
from core.model_providers.model_factory import ModelFactory
from models.dataset import Dataset

default_retrieval_model = {
    'search_method': 'semantic_search',
    'reranking_enable': False,
    'reranking_model': {
        'reranking_provider_name': '',
        'reranking_model_name': ''
    },
    'top_k': 2,
    'score_threshold_enable': False
}


class RetrievalService:

    @classmethod
    def embedding_search(cls, flask_app: Flask, dataset: Dataset, query: str,
                         top_k: int, score_threshold: Optional[float], reranking_model: Optional[dict],
                         all_documents: list, search_method: str, embeddings: Embeddings):
        with flask_app.app_context():

            vector_index = VectorIndex(
                dataset=dataset,
                config=current_app.config,
                embeddings=embeddings
            )

            documents = vector_index.search(
                query,
                search_type='similarity_score_threshold',
                search_kwargs={
                    'k': top_k,
                    'score_threshold': score_threshold,
                    'filter': {
                        'group_id': [dataset.id]
                    }
                }
            )

            if documents:
                if reranking_model and search_method == 'semantic_search':
                    rerank = ModelFactory.get_reranking_model(
                        tenant_id=dataset.tenant_id,
                        model_provider_name=reranking_model['reranking_provider_name'],
                        model_name=reranking_model['reranking_model_name']
                    )
                    all_documents.extend(rerank.rerank(query, documents, score_threshold, len(documents)))
                else:
                    all_documents.extend(documents)

    @classmethod
    def full_text_index_search(cls, flask_app: Flask, dataset: Dataset, query: str,
                               top_k: int, score_threshold: Optional[float], reranking_model: Optional[dict],
                               all_documents: list, search_method: str, embeddings: Embeddings):
        with flask_app.app_context():

            vector_index = VectorIndex(
                dataset=dataset,
                config=current_app.config,
                embeddings=embeddings
            )

            documents = vector_index.search_by_full_text_index(
                query,
                search_type='similarity_score_threshold',
                top_k=top_k
            )
            if documents:
                if reranking_model and search_method == 'full_text_search':
                    rerank = ModelFactory.get_reranking_model(
                        tenant_id=dataset.tenant_id,
                        model_provider_name=reranking_model['reranking_provider_name'],
                        model_name=reranking_model['reranking_model_name']
                    )
                    all_documents.extend(rerank.rerank(query, documents, score_threshold, len(documents)))
                else:
                    all_documents.extend(documents)




