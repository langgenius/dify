import threading
from typing import Optional

from flask import Flask, current_app

from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from models.dataset import Dataset
from services.external_knowledge_service import ExternalDatasetService

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class RetrievalService:
    @classmethod
    def retrieve(
        cls,
        retrieval_method: str,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: Optional[float] = 0.0,
        reranking_model: Optional[dict] = None,
        reranking_mode: Optional[str] = "reranking_model",
        weights: Optional[dict] = None,
    ):
        if not query:
            return []
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            return []

        if not dataset or dataset.available_document_count == 0 or dataset.available_segment_count == 0:
            return []
        all_documents = []
        threads = []
        exceptions = []
        # retrieval_model source with keyword
        if retrieval_method == "keyword_search":
            keyword_thread = threading.Thread(
                target=RetrievalService.keyword_search,
                kwargs={
                    "flask_app": current_app._get_current_object(),
                    "dataset_id": dataset_id,
                    "query": query,
                    "top_k": top_k,
                    "all_documents": all_documents,
                    "exceptions": exceptions,
                },
            )
            threads.append(keyword_thread)
            keyword_thread.start()
        # retrieval_model source with semantic
        if RetrievalMethod.is_support_semantic_search(retrieval_method):
            embedding_thread = threading.Thread(
                target=RetrievalService.embedding_search,
                kwargs={
                    "flask_app": current_app._get_current_object(),
                    "dataset_id": dataset_id,
                    "query": query,
                    "top_k": top_k,
                    "score_threshold": score_threshold,
                    "reranking_model": reranking_model,
                    "all_documents": all_documents,
                    "retrieval_method": retrieval_method,
                    "exceptions": exceptions,
                },
            )
            threads.append(embedding_thread)
            embedding_thread.start()

        # retrieval source with full text
        if RetrievalMethod.is_support_fulltext_search(retrieval_method):
            full_text_index_thread = threading.Thread(
                target=RetrievalService.full_text_index_search,
                kwargs={
                    "flask_app": current_app._get_current_object(),
                    "dataset_id": dataset_id,
                    "query": query,
                    "retrieval_method": retrieval_method,
                    "score_threshold": score_threshold,
                    "top_k": top_k,
                    "reranking_model": reranking_model,
                    "all_documents": all_documents,
                    "exceptions": exceptions,
                },
            )
            threads.append(full_text_index_thread)
            full_text_index_thread.start()

        for thread in threads:
            thread.join()

        if exceptions:
            exception_message = ";\n".join(exceptions)
            raise Exception(exception_message)

        if retrieval_method == RetrievalMethod.HYBRID_SEARCH.value:
            data_post_processor = DataPostProcessor(
                str(dataset.tenant_id), reranking_mode, reranking_model, weights, False
            )
            all_documents = data_post_processor.invoke(
                query=query, documents=all_documents, score_threshold=score_threshold, top_n=top_k
            )
        return all_documents

    @classmethod
    def external_retrieve(cls, dataset_id: str, query: str, external_retrieval_model: Optional[dict] = None):
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            return []
        all_documents = ExternalDatasetService.fetch_external_knowledge_retrieval(
            dataset.tenant_id, dataset_id, query, external_retrieval_model
        )
        return all_documents

    @classmethod
    def keyword_search(
        cls, flask_app: Flask, dataset_id: str, query: str, top_k: int, all_documents: list, exceptions: list
    ):
        with flask_app.app_context():
            try:
                dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

                keyword = Keyword(dataset=dataset)

                documents = keyword.search(cls.escape_query_for_search(query), top_k=top_k)
                all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @classmethod
    def embedding_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: Optional[float],
        reranking_model: Optional[dict],
        all_documents: list,
        retrieval_method: str,
        exceptions: list,
    ):
        with flask_app.app_context():
            try:
                dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

                vector = Vector(dataset=dataset)

                documents = vector.search_by_vector(
                    cls.escape_query_for_search(query),
                    search_type="similarity_score_threshold",
                    top_k=top_k,
                    score_threshold=score_threshold,
                    filter={"group_id": [dataset.id]},
                )

                if documents:
                    if (
                        reranking_model
                        and reranking_model.get("reranking_model_name")
                        and reranking_model.get("reranking_provider_name")
                        and retrieval_method == RetrievalMethod.SEMANTIC_SEARCH.value
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id), RerankMode.RERANKING_MODEL.value, reranking_model, None, False
                        )
                        all_documents.extend(
                            data_post_processor.invoke(
                                query=query, documents=documents, score_threshold=score_threshold, top_n=len(documents)
                            )
                        )
                    else:
                        all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @classmethod
    def full_text_index_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: Optional[float],
        reranking_model: Optional[dict],
        all_documents: list,
        retrieval_method: str,
        exceptions: list,
    ):
        with flask_app.app_context():
            try:
                dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

                vector_processor = Vector(
                    dataset=dataset,
                )

                documents = vector_processor.search_by_full_text(cls.escape_query_for_search(query), top_k=top_k)
                if documents:
                    if (
                        reranking_model
                        and reranking_model.get("reranking_model_name")
                        and reranking_model.get("reranking_provider_name")
                        and retrieval_method == RetrievalMethod.FULL_TEXT_SEARCH.value
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id), RerankMode.RERANKING_MODEL.value, reranking_model, None, False
                        )
                        all_documents.extend(
                            data_post_processor.invoke(
                                query=query, documents=documents, score_threshold=score_threshold, top_n=len(documents)
                            )
                        )
                    else:
                        all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @staticmethod
    def escape_query_for_search(query: str) -> str:
        return query.replace('"', '\\"')
