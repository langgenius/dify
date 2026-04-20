import json
import logging
import time
from copy import deepcopy
from typing import Any, TypedDict

from core.app.app_config.entities import ModelConfig
from core.rag.data_post_processor.data_post_processor import RerankingModelDict, WeightsDict
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from graphon.model_runtime.entities import LLMMode
from models import Account
from models.dataset import Dataset, DatasetQuery
from models.enums import CreatorUserRole, DatasetQuerySource
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel

logger = logging.getLogger(__name__)


class QueryDict(TypedDict):
    content: str


class RetrieveResponseDict(TypedDict):
    query: QueryDict
    records: list[dict[str, Any]]


default_retrieval_model: DefaultRetrievalModelDict = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class HitTestingService:
    @staticmethod
    def _deep_merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        merged = deepcopy(base)
        for key, value in override.items():
            current_value = merged.get(key)
            if isinstance(current_value, dict) and isinstance(value, dict):
                merged[key] = HitTestingService._deep_merge_dicts(current_value, value)
            else:
                merged[key] = value
        return merged

    @classmethod
    def _normalize_retrieval_model(
        cls, dataset: Dataset, retrieval_model: RetrievalModel | dict[str, Any] | None
    ) -> RetrievalModel:
        merged_model_dict: dict[str, Any] = deepcopy(dict(default_retrieval_model))
        if dataset.retrieval_model:
            merged_model_dict = cls._deep_merge_dicts(merged_model_dict, dataset.retrieval_model)

        if isinstance(retrieval_model, RetrievalModel):
            incoming_model_dict = retrieval_model.model_dump(exclude_unset=True)
        else:
            incoming_model_dict = retrieval_model or {}

        if incoming_model_dict:
            merged_model_dict = cls._deep_merge_dicts(merged_model_dict, incoming_model_dict)

        return RetrievalModel.model_validate(merged_model_dict)

    @staticmethod
    def _serialize_reranking_model(retrieval_model: RetrievalModel) -> RerankingModelDict | None:
        if not retrieval_model.reranking_enable or not retrieval_model.reranking_model:
            return None

        return {
            "reranking_provider_name": retrieval_model.reranking_model.reranking_provider_name or "",
            "reranking_model_name": retrieval_model.reranking_model.reranking_model_name or "",
        }

    @staticmethod
    def _serialize_weights(retrieval_model: RetrievalModel) -> WeightsDict | None:
        if (
            not retrieval_model.weights
            or not retrieval_model.weights.vector_setting
            or not retrieval_model.weights.keyword_setting
        ):
            return None

        return {
            "vector_setting": {
                "vector_weight": retrieval_model.weights.vector_setting.vector_weight,
                "embedding_provider_name": retrieval_model.weights.vector_setting.embedding_provider_name,
                "embedding_model_name": retrieval_model.weights.vector_setting.embedding_model_name,
            },
            "keyword_setting": {
                "keyword_weight": retrieval_model.weights.keyword_setting.keyword_weight,
            },
        }

    @classmethod
    def retrieve(
        cls,
        dataset: Dataset,
        query: str,
        account: Account,
        retrieval_model: RetrievalModel | dict[str, Any] | None,
        external_retrieval_model: dict[str, Any],
        attachment_ids: list | None = None,
        limit: int = 10,
    ):
        start = time.perf_counter()

        retrieval_model = cls._normalize_retrieval_model(dataset, retrieval_model)

        document_ids_filter = None
        metadata_filtering_conditions = retrieval_model.metadata_filtering_conditions or {}
        if metadata_filtering_conditions and query:
            dataset_retrieval = DatasetRetrieval()

            from core.rag.entities import MetadataFilteringCondition

            metadata_filtering_conditions_obj = MetadataFilteringCondition.model_validate(metadata_filtering_conditions)

            metadata_filter_document_ids, metadata_condition = dataset_retrieval.get_metadata_filter_condition(
                dataset_ids=[dataset.id],
                query=query,
                metadata_filtering_mode="manual",
                metadata_filtering_conditions=metadata_filtering_conditions_obj,
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
            retrieval_method=RetrievalMethod(retrieval_model.search_method or RetrievalMethod.SEMANTIC_SEARCH),
            dataset_id=dataset.id,
            query=query,
            attachment_ids=attachment_ids,
            top_k=retrieval_model.top_k,
            score_threshold=(retrieval_model.score_threshold or 0.0)
            if retrieval_model.score_threshold_enabled
            else 0.0,
            reranking_model=cls._serialize_reranking_model(retrieval_model),
            reranking_mode=retrieval_model.reranking_mode or "reranking_model",
            weights=cls._serialize_weights(retrieval_model),
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
                source=DatasetQuerySource.HIT_TESTING,
                source_app_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
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
        external_retrieval_model: dict[str, Any] | None = None,
        metadata_filtering_conditions: dict[str, Any] | None = None,
    ) -> RetrieveResponseDict:
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
            source=DatasetQuerySource.HIT_TESTING,
            source_app_id=None,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )

        db.session.add(dataset_query)
        db.session.commit()

        return cls.compact_external_retrieve_response(dataset, query, all_documents)

    @classmethod
    def compact_retrieve_response(cls, query: str, documents: list[Document]) -> RetrieveResponseDict:
        records = RetrievalService.format_retrieval_documents(documents)

        return {
            "query": {
                "content": query,
            },
            "records": [record.model_dump() for record in records],
        }

    @classmethod
    def compact_external_retrieve_response(cls, dataset: Dataset, query: str, documents: list) -> RetrieveResponseDict:
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
