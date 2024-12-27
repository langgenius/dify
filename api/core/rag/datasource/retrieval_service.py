import threading
from typing import Optional

from flask import Flask, current_app

from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from models.dataset import ChildChunk, Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
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
        reranking_mode: str = "reranking_model",
        weights: Optional[dict] = None,
    ):
        if not query:
            return []
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            return []

        if not dataset or dataset.available_document_count == 0 or dataset.available_segment_count == 0:
            return []
        all_documents: list[Document] = []
        threads: list[threading.Thread] = []
        exceptions: list[str] = []
        # retrieval_model source with keyword
        if retrieval_method == "keyword_search":
            keyword_thread = threading.Thread(
                target=RetrievalService.keyword_search,
                kwargs={
                    "flask_app": current_app._get_current_object(),  # type: ignore
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
                    "flask_app": current_app._get_current_object(),  # type: ignore
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
                    "flask_app": current_app._get_current_object(),  # type: ignore
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
            raise ValueError(exception_message)

        if retrieval_method == RetrievalMethod.HYBRID_SEARCH.value:
            data_post_processor = DataPostProcessor(
                str(dataset.tenant_id), reranking_mode, reranking_model, weights, False
            )
            all_documents = data_post_processor.invoke(
                query=query,
                documents=all_documents,
                score_threshold=score_threshold,
                top_n=top_k,
            )

        return all_documents

    @classmethod
    def external_retrieve(cls, dataset_id: str, query: str, external_retrieval_model: Optional[dict] = None):
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            return []
        all_documents = ExternalDatasetService.fetch_external_knowledge_retrieval(
            dataset.tenant_id, dataset_id, query, external_retrieval_model or {}
        )
        return all_documents

    @classmethod
    def keyword_search(
        cls, flask_app: Flask, dataset_id: str, query: str, top_k: int, all_documents: list, exceptions: list
    ):
        with flask_app.app_context():
            try:
                dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
                if not dataset:
                    raise ValueError("dataset not found")

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
                if not dataset:
                    raise ValueError("dataset not found")

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
                                query=query,
                                documents=documents,
                                score_threshold=score_threshold,
                                top_n=len(documents),
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
                if not dataset:
                    raise ValueError("dataset not found")

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
                                query=query,
                                documents=documents,
                                score_threshold=score_threshold,
                                top_n=len(documents),
                            )
                        )
                    else:
                        all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @staticmethod
    def escape_query_for_search(query: str) -> str:
        return query.replace('"', '\\"')

    @staticmethod
    def format_retrieval_documents(documents: list[Document]) -> list[RetrievalSegments]:
        records = []
        include_segment_ids = []
        segment_child_map = {}
        for document in documents:
            document_id = document.metadata.get("document_id")
            dataset_document = db.session.query(DatasetDocument).filter(DatasetDocument.id == document_id).first()
            if dataset_document:
                if dataset_document.doc_form == IndexType.PARENT_CHILD_INDEX:
                    child_index_node_id = document.metadata.get("doc_id")
                    result = (
                        db.session.query(ChildChunk, DocumentSegment)
                        .join(DocumentSegment, ChildChunk.segment_id == DocumentSegment.id)
                        .filter(
                            ChildChunk.index_node_id == child_index_node_id,
                            DocumentSegment.dataset_id == dataset_document.dataset_id,
                            DocumentSegment.enabled == True,
                            DocumentSegment.status == "completed",
                        )
                        .first()
                    )
                    if result:
                        child_chunk, segment = result
                        if not segment:
                            continue
                        if segment.id not in include_segment_ids:
                            include_segment_ids.append(segment.id)
                            child_chunk_detail = {
                                "id": child_chunk.id,
                                "content": child_chunk.content,
                                "position": child_chunk.position,
                                "score": document.metadata.get("score", 0.0),
                            }
                            map_detail = {
                                "max_score": document.metadata.get("score", 0.0),
                                "child_chunks": [child_chunk_detail],
                            }
                            segment_child_map[segment.id] = map_detail
                            record = {
                                "segment": segment,
                            }
                            records.append(record)
                        else:
                            child_chunk_detail = {
                                "id": child_chunk.id,
                                "content": child_chunk.content,
                                "position": child_chunk.position,
                                "score": document.metadata.get("score", 0.0),
                            }
                            segment_child_map[segment.id]["child_chunks"].append(child_chunk_detail)
                            segment_child_map[segment.id]["max_score"] = max(
                                segment_child_map[segment.id]["max_score"], document.metadata.get("score", 0.0)
                            )
                    else:
                        continue
                else:
                    index_node_id = document.metadata["doc_id"]

                    segment = (
                        db.session.query(DocumentSegment)
                        .filter(
                            DocumentSegment.dataset_id == dataset_document.dataset_id,
                            DocumentSegment.enabled == True,
                            DocumentSegment.status == "completed",
                            DocumentSegment.index_node_id == index_node_id,
                        )
                        .first()
                    )

                    if not segment:
                        continue
                    include_segment_ids.append(segment.id)
                    record = {
                        "segment": segment,
                        "score": document.metadata.get("score", None),
                    }

                    records.append(record)
            for record in records:
                if record["segment"].id in segment_child_map:
                    record["child_chunks"] = segment_child_map[record["segment"].id].get("child_chunks", None)
                    record["score"] = segment_child_map[record["segment"].id]["max_score"]

        return [RetrievalSegments(**record) for record in records]
