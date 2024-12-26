import logging
import time
from typing import Any

from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from models.account import Account
from models.dataset import Dataset, DatasetQuery

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class HitTestingService:
    @classmethod
    def retrieve(
        cls,
        dataset: Dataset,
        query: str,
        account: Account,
        retrieval_model: Any,  # FIXME drop this any
        external_retrieval_model: dict,
        limit: int = 10,
    ) -> dict:
        if dataset.available_document_count == 0 or dataset.available_segment_count == 0:
            return {
                "query": {
                    "content": query,
                    "tsne_position": {"x": 0, "y": 0},
                },
                "records": [],
            }

        start = time.perf_counter()

        # get retrieval model , if the model is not setting , using default
        if not retrieval_model:
            retrieval_model = dataset.retrieval_model or default_retrieval_model

        all_documents = RetrievalService.retrieve(
            retrieval_method=retrieval_model.get("search_method", "semantic_search"),
            dataset_id=dataset.id,
            query=cls.escape_query_for_search(query),
            top_k=retrieval_model.get("top_k", 2),
            score_threshold=retrieval_model.get("score_threshold", 0.0)
            if retrieval_model["score_threshold_enabled"]
            else 0.0,
            reranking_model=retrieval_model.get("reranking_model", None)
            if retrieval_model["reranking_enable"]
            else None,
            reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
            weights=retrieval_model.get("weights", None),
        )

        end = time.perf_counter()
        logging.debug(f"Hit testing retrieve in {end - start:0.4f} seconds")

        dataset_query = DatasetQuery(
            dataset_id=dataset.id, content=query, source="hit_testing", created_by_role="account", created_by=account.id
        )

        db.session.add(dataset_query)
        db.session.commit()

        return cls.compact_retrieve_response(query, all_documents)  # type: ignore

    @classmethod
    def external_retrieve(
        cls,
        dataset: Dataset,
        query: str,
        account: Account,
        external_retrieval_model: dict,
    ) -> dict:
        if dataset.provider != "external":
            return {
                "query": {"content": query},
                "records": [],
            }

        start = time.perf_counter()

        all_documents = RetrievalService.external_retrieve(
            dataset_id=dataset.id,
            query=cls.escape_query_for_search(query),
            external_retrieval_model=external_retrieval_model,
        )

        end = time.perf_counter()
        logging.debug(f"External knowledge hit testing retrieve in {end - start:0.4f} seconds")

        dataset_query = DatasetQuery(
            dataset_id=dataset.id, content=query, source="hit_testing", created_by_role="account", created_by=account.id
        )

        db.session.add(dataset_query)
        db.session.commit()

        return dict(cls.compact_external_retrieve_response(dataset, query, all_documents))

    @classmethod
    def compact_retrieve_response(cls, query: str, documents: list[Document]):
        records = RetrievalService.format_retrieval_documents(documents)

        return {
            "query": {
                "content": query,
            },
            "records": [record.model_dump() for record in records],
        }

    @classmethod
    def compact_external_retrieve_response(cls, dataset: Dataset, query: str, documents: list) -> dict[Any, Any]:
        records = []
        if dataset.provider == "external":
            for document in documents:
                record = {
                    "content": document.get("content", None),
                    "title": document.get("title", None),
                    "score": document.get("score", None),
                    "metadata": document.get("metadata", None),
                }
                records.append(record)
            return {
                "query": {"content": query},
                "records": records,
            }
        return {"query": {"content": query}, "records": []}

    @classmethod
    def hit_testing_args_check(cls, args):
        query = args["query"]

        if not query or len(query) > 250:
            raise ValueError("Query is required and cannot exceed 250 characters")

    @staticmethod
    def escape_query_for_search(query: str) -> str:
        return query.replace('"', '\\"')
