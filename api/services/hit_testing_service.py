import json
import logging
import time
from typing import Any

from core.app.app_config.entities import ModelConfig
from core.model_runtime.entities import LLMMode
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from models import Account
from models.dataset import Dataset, DatasetQuery

logger = logging.getLogger(__name__)

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
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
        attachment_ids: list | None = None,
        limit: int = 10,
    ):
        start = time.perf_counter()

        # get retrieval model , if the model is not setting , using default
        if not retrieval_model:
            retrieval_model = dataset.retrieval_model or default_retrieval_model
        document_ids_filter = None
        metadata_filtering_conditions = retrieval_model.get("metadata_filtering_conditions", {})
        if metadata_filtering_conditions and query:
            dataset_retrieval = DatasetRetrieval()

            from core.app.app_config.entities import MetadataFilteringCondition

            metadata_filtering_conditions = MetadataFilteringCondition.model_validate(metadata_filtering_conditions)

            metadata_filter_document_ids, metadata_condition = dataset_retrieval.get_metadata_filter_condition(
                dataset_ids=[dataset.id],
                query=query,
                metadata_filtering_mode="manual",
                metadata_filtering_conditions=metadata_filtering_conditions,
                inputs={},
                tenant_id="",
                user_id="",
                metadata_model_config=ModelConfig(provider="", name="", mode=LLMMode.CHAT, completion_params={}),
            )
            if metadata_filter_document_ids:
                document_ids_filter = metadata_filter_document_ids.get(dataset.id, [])
            if metadata_condition and not document_ids_filter:
                return cls.compact_retrieve_response(query, [])
        all_documents = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod(retrieval_model.get("search_method", RetrievalMethod.SEMANTIC_SEARCH)),
            dataset_id=dataset.id,
            query=query,
            attachment_ids=attachment_ids,
            top_k=retrieval_model.get("top_k", 4),
            score_threshold=retrieval_model.get("score_threshold", 0.0)
            if retrieval_model["score_threshold_enabled"]
            else 0.0,
            reranking_model=retrieval_model.get("reranking_model", None)
            if retrieval_model["reranking_enable"]
            else None,
            reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
            weights=retrieval_model.get("weights", None),
            document_ids_filter=document_ids_filter,
        )

        end = time.perf_counter()
        logger.debug("Hit testing retrieve in %s seconds", end - start)
        dataset_queries = []
        if query:
            content = {"content_type": QueryType.TEXT_QUERY, "content": query}
            dataset_queries.append(content)
        if attachment_ids:
            for attachment_id in attachment_ids:
                content = {"content_type": QueryType.IMAGE_QUERY, "content": attachment_id}
                dataset_queries.append(content)
        if dataset_queries:
            dataset_query = DatasetQuery(
                dataset_id=dataset.id,
                content=json.dumps(dataset_queries),
                source="hit_testing",
                source_app_id=None,
                created_by_role="account",
                created_by=account.id,
            )
            db.session.add(dataset_query)
        db.session.commit()

        return cls.compact_retrieve_response(query, all_documents)

    @classmethod
    def external_retrieve(
        cls,
        dataset: Dataset,
        query: str,
        account: Account,
        external_retrieval_model: dict | None = None,
        metadata_filtering_conditions: dict | None = None,
    ):
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
            metadata_filtering_conditions=metadata_filtering_conditions,
        )

        end = time.perf_counter()
        logger.debug("External knowledge hit testing retrieve in %s seconds", end - start)

        dataset_query = DatasetQuery(
            dataset_id=dataset.id,
            content=query,
            source="hit_testing",
            source_app_id=None,
            created_by_role="account",
            created_by=account.id,
        )

        db.session.add(dataset_query)
        db.session.commit()

        return dict(cls.compact_external_retrieve_response(dataset, query, all_documents))

    @classmethod
    def compact_retrieve_response(cls, query: str, documents: list[Document]) -> dict[Any, Any]:
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
        query = args.get("query")
        attachment_ids = args.get("attachment_ids")

        if not attachment_ids and not query:
            raise ValueError("Query or attachment_ids is required")
        if query and len(query) > 250:
            raise ValueError("Query cannot exceed 250 characters")
        if attachment_ids and not isinstance(attachment_ids, list):
            raise ValueError("Attachment_ids must be a list")

    @staticmethod
    def escape_query_for_search(query: str) -> str:
        return query.replace('"', '\\"')
