import threading
from typing import Optional

from flask import Flask, current_app

from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from extensions.ext_database import db
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
    def retrieve(cls, retrival_method: str, dataset_id: str, query: str,
                 top_k: int, score_threshold: Optional[float] = .0, reranking_model: Optional[dict] = None):
        dataset = db.session.query(Dataset).filter(
            Dataset.id == dataset_id
        ).first()
        if not dataset or dataset.available_document_count == 0 or dataset.available_segment_count == 0:
            return []
        all_documents = []
        threads = []
        # retrieval_model source with keyword
        if retrival_method == 'keyword_search':
            keyword_thread = threading.Thread(target=RetrievalService.keyword_search, kwargs={
                'flask_app': current_app._get_current_object(),
                'dataset_id': dataset_id,
                'query': query,
                'top_k': top_k,
                'all_documents': all_documents
            })
            threads.append(keyword_thread)
            keyword_thread.start()
        # retrieval_model source with semantic
        if retrival_method == 'semantic_search' or retrival_method == 'hybrid_search':
            embedding_thread = threading.Thread(target=RetrievalService.embedding_search, kwargs={
                'flask_app': current_app._get_current_object(),
                'dataset_id': dataset_id,
                'query': query,
                'top_k': top_k,
                'score_threshold': score_threshold,
                'reranking_model': reranking_model,
                'all_documents': all_documents,
                'retrival_method': retrival_method
            })
            threads.append(embedding_thread)
            embedding_thread.start()

        # retrieval source with full text
        if retrival_method == 'full_text_search' or retrival_method == 'hybrid_search':
            full_text_index_thread = threading.Thread(target=RetrievalService.full_text_index_search, kwargs={
                'flask_app': current_app._get_current_object(),
                'dataset_id': dataset_id,
                'query': query,
                'retrival_method': retrival_method,
                'score_threshold': score_threshold,
                'top_k': top_k,
                'reranking_model': reranking_model,
                'all_documents': all_documents
            })
            threads.append(full_text_index_thread)
            full_text_index_thread.start()

        for thread in threads:
            thread.join()

        if retrival_method == 'hybrid_search':
            data_post_processor = DataPostProcessor(str(dataset.tenant_id), reranking_model, False)
            all_documents = data_post_processor.invoke(
                query=query,
                documents=all_documents,
                score_threshold=score_threshold,
                top_n=top_k
            )
        return all_documents

    @classmethod
    def keyword_search(cls, flask_app: Flask, dataset_id: str, query: str,
                       top_k: int, all_documents: list):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(
                Dataset.id == dataset_id
            ).first()

            keyword = Keyword(
                dataset=dataset
            )

            documents = keyword.search(
                query,
                top_k=top_k
            )
            all_documents.extend(documents)

    @classmethod
    def embedding_search(cls, flask_app: Flask, dataset_id: str, query: str,
                         top_k: int, score_threshold: Optional[float], reranking_model: Optional[dict],
                         all_documents: list, retrival_method: str):
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
                top_k=top_k,
                score_threshold=score_threshold,
                filter={
                    'group_id': [dataset.id]
                }
            )

            if documents:
                if reranking_model and retrival_method == 'semantic_search':
                    data_post_processor = DataPostProcessor(str(dataset.tenant_id), reranking_model, False)
                    all_documents.extend(data_post_processor.invoke(
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
                               all_documents: list, retrival_method: str):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(
                Dataset.id == dataset_id
            ).first()

            vector_processor = Vector(
                dataset=dataset,
            )

            documents = vector_processor.search_by_full_text(
                query,
                top_k=top_k
            )
            if documents:
                if reranking_model and retrival_method == 'full_text_search':
                    data_post_processor = DataPostProcessor(str(dataset.tenant_id), reranking_model, False)
                    all_documents.extend(data_post_processor.invoke(
                        query=query,
                        documents=documents,
                        score_threshold=score_threshold,
                        top_n=len(documents)
                    ))
                else:
                    all_documents.extend(documents)
