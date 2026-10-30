"""Infrastructure adapters used by knowledge retrieval application services."""

from collections.abc import Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models.dataset import Dataset
from models.model import App
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)
from services.knowledge.entities.retrieval_settings import RerankingModelDict, WeightsDict
from services.knowledge.retrieval.candidate_search import (
    CandidateReranker,
    InternalDatasetCandidateRetriever,
)


class SQLAlchemyInnerKnowledgeRetrievalScope:
    """Validate the complete app/dataset owner chain in a short read session."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def validate_inner_retrieval_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        with self._sessions() as session:
            app_tenant_id = session.scalar(select(App.tenant_id).where(App.id == app_id).limit(1))
            if app_tenant_id is None:
                raise InnerKnowledgeRetrieveAppNotFoundError(f"App '{app_id}' not found")
            if app_tenant_id != tenant_id:
                raise InnerKnowledgeRetrieveAppTenantMismatchError(
                    f"App '{app_id}' does not belong to tenant '{tenant_id}'"
                )
            datasets = dict(
                session.execute(select(Dataset.id, Dataset.tenant_id).where(Dataset.id.in_(dataset_ids))).tuples().all()
            )
            missing_ids = sorted(set(dataset_ids) - datasets.keys())
            if missing_ids:
                raise InnerKnowledgeRetrieveDatasetNotFoundError(f"Datasets not found: {', '.join(missing_ids)}")
            mismatched_ids = sorted(dataset_id for dataset_id, owner in datasets.items() if owner != tenant_id)
            if mismatched_ids:
                raise InnerKnowledgeRetrieveDatasetTenantMismatchError(
                    f"Datasets do not belong to tenant '{tenant_id}': {', '.join(mismatched_ids)}"
                )


class DatasetCandidateRetriever(InternalDatasetCandidateRetriever):
    """Adapt the existing provider retrieval implementation to the candidate boundary."""

    def retrieve(
        self,
        *,
        retrieval_method: RetrievalMethod,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float = 0.0,
        reranking_model: RerankingModelDict | None = None,
        reranking_mode: str = "reranking_model",
        weights: WeightsDict | None = None,
        document_ids_filter: list[str] | None = None,
        allowed_document_ids_filter: Sequence[str] | None = None,
        attachment_ids: list[str] | None = None,
    ) -> list[Document]:
        return RetrievalService.retrieve(
            retrieval_method=retrieval_method,
            dataset_id=dataset_id,
            query=query,
            top_k=top_k,
            score_threshold=score_threshold,
            reranking_model=reranking_model,
            reranking_mode=reranking_mode,
            weights=weights,
            document_ids_filter=document_ids_filter,
            allowed_document_ids_filter=allowed_document_ids_filter,
            attachment_ids=attachment_ids,
        )


class DataPostProcessorReranker(CandidateReranker):
    """Create the legacy reranker with its database dependency outside the application layer."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def rerank(
        self,
        *,
        tenant_id: str,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None,
        weights: WeightsDict | None,
        dataset_document_filters: Mapping[str, tuple[str, ...] | None],
        documents: list[Document],
        query: str,
        query_type: QueryType,
        score_threshold: float,
    ) -> tuple[list[Document], bool]:
        processor = DataPostProcessor(
            tenant_id,
            reranking_mode,
            reranking_model,
            weights,
            False,
            session_factory=self._sessions,
            dataset_document_filters=dict(dataset_document_filters),
        )
        if processor.rerank_runner is None:
            return documents, False
        return (
            processor.invoke(
                query=query,
                documents=documents,
                score_threshold=score_threshold,
                top_n=len(documents),
                query_type=query_type,
            ),
            True,
        )
