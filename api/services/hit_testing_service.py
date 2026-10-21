import json
import logging
import time
from dataclasses import dataclass
from typing import Any, TypedDict, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.app_config.entities import ModelConfig
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from graphon.model_runtime.entities import LLMMode
from models.dataset import Dataset
from models.dataset import Document as DatasetDocument
from models.enums import CreatorUserRole, DatasetQuerySource
from repositories.knowledge.dataset_read_repository import stage_dataset_queries

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


@dataclass(frozen=True, slots=True)
class HitTestingRetrievalPlan:
    model: HitTestingRetrievalModelDict
    document_ids_filter: list[str] | None
    should_retrieve: bool = True
    should_record_query: bool = True


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
    def _dump_retrieval_records(
        cls,
        session: Session,
        records: list[RetrievalSegments],
        *,
        tenant_id: str | None = None,
        dataset_id: str | None = None,
    ) -> list[dict[str, Any]]:
        document_ids = {
            document_id
            for record in records
            if record.segment
            for document_id in [record.segment.document_id]
            if isinstance(document_id, str) and document_id
        }
        if not document_ids:
            return [record.model_dump() for record in records]

        document_statement = select(DatasetDocument).where(DatasetDocument.id.in_(document_ids))
        if tenant_id is not None:
            document_statement = document_statement.where(DatasetDocument.tenant_id == tenant_id)
        if dataset_id is not None:
            document_statement = document_statement.where(DatasetDocument.dataset_id == dataset_id)
        documents = {
            document.id: cls._dump_dataset_document(document) for document in session.scalars(document_statement).all()
        }

        records_with_documents: list[dict[str, Any]] = []
        missing_document_ids: set[str] = set()
        for retrieval_record in records:
            segment = retrieval_record.segment
            if not segment or not isinstance(segment.document_id, str) or not segment.document_id:
                if tenant_id is not None or dataset_id is not None:
                    continue
                records_with_documents.append(retrieval_record.model_dump())
                continue

            if tenant_id is not None and segment.tenant_id != tenant_id:
                missing_document_ids.add(segment.document_id)
                continue
            if dataset_id is not None and segment.dataset_id != dataset_id:
                missing_document_ids.add(segment.document_id)
                continue

            document_id = segment.document_id
            document = documents.get(document_id)
            if document is None:
                missing_document_ids.add(document_id)
                continue

            record = retrieval_record.model_dump()
            segment_dict = record["segment"]
            segment_dict["created_at"] = segment.created_at
            segment_dict["document"] = document
            records_with_documents.append(record)

        if missing_document_ids:
            logger.warning(
                "Skipping hit-testing records with missing documents, document_ids=%s",
                sorted(missing_document_ids),
            )

        return records_with_documents

    @classmethod
    def prepare_retrieval(
        cls,
        *,
        session: Session,
        dataset: Dataset,
        query: str,
        retrieval_model: dict[str, Any] | None,
    ) -> HitTestingRetrievalPlan:
        """Resolve stored configuration and metadata filters within a read session."""

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
                session=session,
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
                return HitTestingRetrievalPlan(
                    model=resolved_retrieval_model,
                    document_ids_filter=document_ids_filter,
                    should_retrieve=False,
                    should_record_query=False,
                )
        return HitTestingRetrievalPlan(
            model=resolved_retrieval_model,
            document_ids_filter=document_ids_filter,
        )

    @classmethod
    def retrieve_documents(
        cls,
        *,
        dataset_id: str,
        query: str,
        attachment_ids: list[str] | None,
        plan: HitTestingRetrievalPlan,
    ) -> list[Document]:
        """Execute retrieval after the caller has released its database session."""

        start = time.perf_counter()
        model = plan.model
        all_documents = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod(model.get("search_method", RetrievalMethod.SEMANTIC_SEARCH)),
            dataset_id=dataset_id,
            query=query,
            attachment_ids=attachment_ids,
            top_k=model.get("top_k", 4),
            score_threshold=model.get("score_threshold", 0.0) if model["score_threshold_enabled"] else 0.0,
            reranking_model=model.get("reranking_model", None) if model["reranking_enable"] else None,
            reranking_mode=model.get("reranking_mode") or "reranking_model",
            weights=model.get("weights", None),
            document_ids_filter=plan.document_ids_filter,
        )
        end = time.perf_counter()
        logger.debug("Hit testing retrieve in %s seconds", end - start)
        return all_documents

    @staticmethod
    def record_query(
        *,
        session: Session,
        tenant_id: str,
        dataset_id: str,
        account_id: str,
        query: str,
        attachment_ids: list[str] | None,
    ) -> None:
        """Stage the query history row in the caller-owned write transaction."""

        dataset_queries = []
        if query:
            content = {"content_type": QueryType.TEXT_QUERY, "content": query}
            dataset_queries.append(content)
        if attachment_ids:
            for attachment_id in attachment_ids:
                content = {"content_type": QueryType.IMAGE_QUERY, "content": attachment_id}
                dataset_queries.append(content)
        if dataset_queries:
            stage_dataset_queries(
                session,
                tenant_id=tenant_id,
                dataset_ids=[dataset_id],
                content=json.dumps(dataset_queries),
                source=DatasetQuerySource.HIT_TESTING,
                source_app_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account_id,
            )
            # Stage the query log without committing: the caller owns the session
            # (e.g. `with_session`), and committing here would close a caller-managed
            # transaction before the document lookup below runs. See #38998.
            session.flush()

    @classmethod
    def compact_retrieve_response(
        cls,
        query: str,
        documents: list[Document],
        *,
        session: Session,
        tenant_id: str | None = None,
        dataset_id: str | None = None,
    ) -> RetrieveResponseDict:
        if tenant_id is not None or dataset_id is not None:
            document_ids = {
                document_id
                for document in documents
                if isinstance(document_id := document.metadata.get("document_id"), str) and document_id
            }
            allowed_statement = select(DatasetDocument.id).where(DatasetDocument.id.in_(document_ids))
            if tenant_id is not None:
                allowed_statement = allowed_statement.where(DatasetDocument.tenant_id == tenant_id)
            if dataset_id is not None:
                allowed_statement = allowed_statement.where(DatasetDocument.dataset_id == dataset_id)
            allowed_document_ids = set(session.scalars(allowed_statement).all()) if document_ids else set()
            documents = [
                document for document in documents if document.metadata.get("document_id") in allowed_document_ids
            ]
        with Session(bind=session.get_bind()) as format_session:
            records = RetrievalService.format_retrieval_documents(format_session, documents)

        return {
            "query": {
                "content": query,
            },
            "records": cls._dump_retrieval_records(
                session,
                records,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
            ),
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
