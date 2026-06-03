import json
import logging
import time
from typing import Any, TypedDict, cast

from sqlalchemy import select

from core.app.app_config.entities import ModelConfig
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from graphon.model_runtime.entities import LLMMode
from models import Account
from models.dataset import Dataset, DatasetQuery
from models.dataset import Document as DatasetDocument
from models.enums import CreatorUserRole, DatasetQuerySource

logger = logging.getLogger(__name__)


class QueryDict(TypedDict):
    content: str


class RetrieveResponseDict(TypedDict):
    query: QueryDict
    records: list[dict[str, Any]]


default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class HitTestingRetrievalModelDict(DefaultRetrievalModelDict, total=False):
    metadata_filtering_conditions: dict[str, Any]


class HitTestingService:
    @staticmethod
    def _dump_dataset_document(document: DatasetDocument) -> dict[str, Any]:
        return {
            "id": document.id,
            "data_source_type": document.data_source_type,
            "name": document.name,
            "doc_type": document.doc_type,
            "doc_metadata": document.doc_metadata,
        }

    @classmethod
    def _dump_retrieval_records(cls, records: list[Any]) -> list[dict[str, Any]]:
        dumped_records = [record.model_dump() for record in records]
        document_ids = {
            segment.get("document_id")
            for record in dumped_records
            if isinstance(record, dict)
            for segment in [record.get("segment")]
            if isinstance(segment, dict) and segment.get("document_id")
        }
        if not document_ids:
            return dumped_records

        documents = {
            document.id: cls._dump_dataset_document(document)
            for document in db.session.scalars(
                select(DatasetDocument).where(DatasetDocument.id.in_(document_ids))
            ).all()
        }

        records_with_documents: list[dict[str, Any]] = []
        missing_document_ids: set[str] = set()
        for record in dumped_records:
            segment = record.get("segment")
            if not isinstance(segment, dict):
                records_with_documents.append(record)
                continue

            document_id = segment.get("document_id")
            if document_id in documents:
                segment["document"] = documents[document_id]
                records_with_documents.append(record)
            elif document_id:
                missing_document_ids.add(document_id)

        if missing_document_ids:
            logger.warning(
                "Skipping hit-testing records with missing documents, document_ids=%s",
                sorted(missing_document_ids),
            )

        return records_with_documents

    @classmethod
    def retrieve(
        cls,
        dataset: Dataset,
        query: str,
        account: Account,
        retrieval_model: dict[str, Any] | None,
        external_retrieval_model: dict[str, Any],
        attachment_ids: list | None = None,
        limit: int = 10,
    ):
        start = time.perf_counter()

        # get retrieval model , if the model is not setting , using default
        resolved_retrieval_model = cast(
            HitTestingRetrievalModelDict,
            retrieval_model or dataset.retrieval_model or default_retrieval_model,
        )
        document_ids_filter = None
        metadata_filtering_conditions_raw = resolved_retrieval_model.get("metadata_filtering_conditions", {})
        if metadata_filtering_conditions_raw and query:
            dataset_retrieval = DatasetRetrieval()

            from core.rag.entities import MetadataFilteringCondition

            metadata_filtering_conditions = MetadataFilteringCondition.model_validate(metadata_filtering_conditions_raw)

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
            retrieval_method=RetrievalMethod(
                resolved_retrieval_model.get("search_method", RetrievalMethod.SEMANTIC_SEARCH)
            ),
            dataset_id=dataset.id,
            query=query,
            attachment_ids=attachment_ids,
            top_k=resolved_retrieval_model.get("top_k", 4),
            score_threshold=resolved_retrieval_model.get("score_threshold", 0.0)
            if resolved_retrieval_model["score_threshold_enabled"]
            else 0.0,
            reranking_model=resolved_retrieval_model.get("reranking_model", None)
            if resolved_retrieval_model["reranking_enable"]
            else None,
            reranking_mode=resolved_retrieval_model.get("reranking_mode") or "reranking_model",
            weights=resolved_retrieval_model.get("weights", None),
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
            source=DatasetQuerySource.HIT_TESTING,
            source_app_id=None,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )

        db.session.add(dataset_query)
        db.session.commit()

        return dict(cls.compact_external_retrieve_response(dataset, query, all_documents))

    @classmethod
    def compact_retrieve_response(cls, query: str, documents: list[Document]) -> RetrieveResponseDict:
        records = RetrievalService.format_retrieval_documents(documents)

        return {
            "query": {
                "content": query,
            },
            "records": cls._dump_retrieval_records(records),
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
