import concurrent.futures
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from flask import Flask, current_app
from sqlalchemy.orm import load_only

from configs import dify_config
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
    # Cache precompiled regular expressions to avoid repeated compilation
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
        document_ids_filter: Optional[list[str]] = None,
    ):
        if not query:
            return []
        dataset = cls._get_dataset(dataset_id)
        if not dataset:
            return []

        all_documents: list[Document] = []
        exceptions: list[str] = []

        # Optimize multithreading with thread pools
        with ThreadPoolExecutor(max_workers=dify_config.RETRIEVAL_SERVICE_EXECUTORS) as executor:  # type: ignore
            futures = []
            if retrieval_method == "keyword_search":
                futures.append(
                    executor.submit(
                        cls.keyword_search,
                        flask_app=current_app._get_current_object(),  # type: ignore
                        dataset_id=dataset_id,
                        query=query,
                        top_k=top_k,
                        all_documents=all_documents,
                        exceptions=exceptions,
                        document_ids_filter=document_ids_filter,
                    )
                )
            if RetrievalMethod.is_support_semantic_search(retrieval_method):
                futures.append(
                    executor.submit(
                        cls.embedding_search,
                        flask_app=current_app._get_current_object(),  # type: ignore
                        dataset_id=dataset_id,
                        query=query,
                        top_k=top_k,
                        score_threshold=score_threshold,
                        reranking_model=reranking_model,
                        all_documents=all_documents,
                        retrieval_method=retrieval_method,
                        exceptions=exceptions,
                        document_ids_filter=document_ids_filter,
                    )
                )
            if RetrievalMethod.is_support_fulltext_search(retrieval_method):
                futures.append(
                    executor.submit(
                        cls.full_text_index_search,
                        flask_app=current_app._get_current_object(),  # type: ignore
                        dataset_id=dataset_id,
                        query=query,
                        top_k=top_k,
                        score_threshold=score_threshold,
                        reranking_model=reranking_model,
                        all_documents=all_documents,
                        retrieval_method=retrieval_method,
                        exceptions=exceptions,
                        document_ids_filter=document_ids_filter,
                    )
                )
            concurrent.futures.wait(futures, timeout=30, return_when=concurrent.futures.ALL_COMPLETED)

        if exceptions:
            raise ValueError(";\n".join(exceptions))

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
    def _get_dataset(cls, dataset_id: str) -> Optional[Dataset]:
        return db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

    @classmethod
    def keyword_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        all_documents: list,
        exceptions: list,
        document_ids_filter: Optional[list[str]] = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                keyword = Keyword(dataset=dataset)

                documents = keyword.search(
                    cls.escape_query_for_search(query), top_k=top_k, document_ids_filter=document_ids_filter
                )
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
        document_ids_filter: Optional[list[str]] = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                start = time.time()
                vector = Vector(dataset=dataset)
                documents = vector.search_by_vector(
                    query,
                    search_type="similarity_score_threshold",
                    top_k=top_k,
                    score_threshold=score_threshold,
                    filter={"group_id": [dataset.id]},
                    document_ids_filter=document_ids_filter,
                )
                logging.debug(f"embedding_search ends at {time.time() - start:.2f} seconds")

                if documents:
                    if (
                        reranking_model
                        and reranking_model.get("reranking_model_name")
                        and reranking_model.get("reranking_provider_name")
                        and retrieval_method == RetrievalMethod.SEMANTIC_SEARCH.value
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id), str(RerankMode.RERANKING_MODEL.value), reranking_model, None, False
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
        document_ids_filter: Optional[list[str]] = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                vector_processor = Vector(dataset=dataset)

                documents = vector_processor.search_by_full_text(
                    cls.escape_query_for_search(query), top_k=top_k, document_ids_filter=document_ids_filter
                )
                if documents:
                    if (
                        reranking_model
                        and reranking_model.get("reranking_model_name")
                        and reranking_model.get("reranking_provider_name")
                        and retrieval_method == RetrievalMethod.FULL_TEXT_SEARCH.value
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id), str(RerankMode.RERANKING_MODEL.value), reranking_model, None, False
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

    @classmethod
    def format_retrieval_documents(cls, documents: list[Document]) -> list[RetrievalSegments]:
        """Format retrieval documents with optimized batch processing"""
        if not documents:
            return []

        try:
            start_time = time.time()
            # Collect document IDs with existence check
            document_ids = {doc.metadata.get("document_id") for doc in documents if "document_id" in doc.metadata}
            if not document_ids:
                return []

            # Batch query dataset documents
            dataset_documents = {
                doc.id: doc
                for doc in db.session.query(DatasetDocument)
                .filter(DatasetDocument.id.in_(document_ids))
                .options(load_only(DatasetDocument.id, DatasetDocument.doc_form, DatasetDocument.dataset_id))
                .all()
            }

            records = []
            include_segment_ids = set()
            segment_child_map = {}

            # Precompute doc_forms to avoid redundant checks
            doc_forms = {}
            for doc in documents:
                document_id = doc.metadata.get("document_id")
                dataset_doc = dataset_documents.get(document_id)
                if dataset_doc:
                    doc_forms[document_id] = dataset_doc.doc_form

            # Batch collect index node IDs with type safety
            child_index_node_ids = []
            index_node_ids = []
            for doc in documents:
                document_id = doc.metadata.get("document_id")
                if doc_forms.get(document_id) == IndexType.PARENT_CHILD_INDEX:
                    child_index_node_ids.append(doc.metadata.get("doc_id"))
                else:
                    index_node_ids.append(doc.metadata.get("doc_id"))

            # Batch query ChildChunk
            child_chunks = db.session.query(ChildChunk).filter(ChildChunk.index_node_id.in_(child_index_node_ids)).all()
            child_chunk_map = {chunk.index_node_id: chunk for chunk in child_chunks}

            # Batch query DocumentSegment with unified conditions
            segment_map = {
                segment.id: segment
                for segment in db.session.query(DocumentSegment)
                .filter(
                    (
                        DocumentSegment.index_node_id.in_(index_node_ids)
                        | DocumentSegment.id.in_([chunk.segment_id for chunk in child_chunks])
                    ),
                    DocumentSegment.enabled == True,
                    DocumentSegment.status == "completed",
                )
                .options(
                    load_only(
                        DocumentSegment.id,
                        DocumentSegment.content,
                        DocumentSegment.answer,
                    )
                )
                .all()
            }

            for document in documents:
                document_id = document.metadata.get("document_id")
                dataset_document = dataset_documents.get(document_id)
                if not dataset_document:
                    continue

                doc_form = doc_forms.get(document_id)
                if doc_form == IndexType.PARENT_CHILD_INDEX:
                    # Handle parent-child documents using preloaded data
                    child_index_node_id = document.metadata.get("doc_id")
                    if not child_index_node_id:
                        continue

                    child_chunk = child_chunk_map.get(child_index_node_id)
                    if not child_chunk:
                        continue

                    segment = segment_map.get(child_chunk.segment_id)
                    if not segment:
                        continue

                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)
                        map_detail = {"max_score": document.metadata.get("score", 0.0), "child_chunks": []}
                        segment_child_map[segment.id] = map_detail
                        records.append({"segment": segment})

                    # Append child chunk details
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
                    # Handle normal documents
                    index_node_id = document.metadata.get("doc_id")
                    if not index_node_id:
                        continue

                    segment = next(
                        (
                            s
                            for s in segment_map.values()
                            if s.index_node_id == index_node_id and s.dataset_id == dataset_document.dataset_id
                        ),
                        None,
                    )

                    if not segment:
                        continue

                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)
                        records.append(
                            {
                                "segment": segment,
                                "score": document.metadata.get("score", 0.0),
                            }
                        )

            # Merge child chunks information
            for record in records:
                segment_id = record["segment"].id
                if segment_id in segment_child_map:
                    record["child_chunks"] = segment_child_map[segment_id]["child_chunks"]
                    record["score"] = segment_child_map[segment_id]["max_score"]

            logging.debug(f"Formatting retrieval documents took {time.time() - start_time:.2f} seconds")
            return [RetrievalSegments(**record) for record in records]
        except Exception as e:
            # Only rollback if there were write operations
            db.session.rollback()
            raise e
