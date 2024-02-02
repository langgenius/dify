from typing import Optional

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.vdb.vector_factory import Vector
from core.rerank.rerank import RerankRunner
from extensions.ext_database import db
from flask import Flask, current_app
from langchain.embeddings.base import Embeddings
from models.dataset import Dataset

default_retrieval_model = {
    'search_method': 'semantic_search',
    'reranking_enable': False,
    'reranking_model': {
        'reranking_provider_name': '',
        'reranking_model_name': ''
    },
    'top_k': 2,
    'score_threshold_enabled': False
}


class RetrievalService:

    @classmethod
    def embedding_search(cls, flask_app: Flask, dataset_id: str, query: str,
                         top_k: int, score_threshold: Optional[float], reranking_model: Optional[dict],
                         all_documents: list, search_method: str):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(
                Dataset.id == dataset_id
            ).first()

            vector = Vector(
                dataset=dataset
            )

            documents = vector.search_by_vector(
                query,
                search_type='similarity_score_threshold',
                k=top_k,
                score_threshold=score_threshold,
                filter={
                    'group_id': [dataset.id]
                }
            )

            if documents:
                if reranking_model and search_method == 'semantic_search':
                    try:
                        model_manager = ModelManager()
                        rerank_model_instance = model_manager.get_model_instance(
                            tenant_id=dataset.tenant_id,
                            provider=reranking_model['reranking_provider_name'],
                            model_type=ModelType.RERANK,
                            model=reranking_model['reranking_model_name']
                        )
                    except InvokeAuthorizationError:
                        return
                    rerank_runner = RerankRunner(rerank_model_instance)
                    data_post_processor = DataPostProcessor(rerank_runner)
                    all_documents.extend(data_post_processor.rerank(
                        query=query,
                        documents=documents,
                        score_threshold=score_threshold,
                        top_n=len(documents)
                    ))
                else:
                    all_documents.extend(documents)

    @classmethod
    def full_text_index_search(cls, flask_app: Flask, dataset_id: str, query: str,
                               top_k: int, score_threshold: Optional[float], reranking_model: Optional[dict],
                               all_documents: list, search_method: str):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(
                Dataset.id == dataset_id
            ).first()

            vector_processor = Vector(
                dataset=dataset,
            )

            documents = vector_processor.vector.search_by_full_text(
                query,
                search_type='similarity_score_threshold',
                top_k=top_k
            )
            if documents:
                if reranking_model and search_method == 'full_text_search':
                    try:
                        model_manager = ModelManager()
                        rerank_model_instance = model_manager.get_model_instance(
                            tenant_id=dataset.tenant_id,
                            provider=reranking_model['reranking_provider_name'],
                            model_type=ModelType.RERANK,
                            model=reranking_model['reranking_model_name']
                        )
                    except InvokeAuthorizationError:
                        return

                    rerank_runner = RerankRunner(rerank_model_instance)
                    data_post_processor = DataPostProcessor(rerank_runner)

                    all_documents.extend(data_post_processor.rerank(
                        query=query,
                        documents=documents,
                        score_threshold=score_threshold,
                        top_n=len(documents)
                    ))
                else:
                    all_documents.extend(documents)
