"""Focused tests for attachment-aware dataset retrieval entry behavior."""

from unittest.mock import create_autospec

from graphon.model_runtime.entities.llm_entities import LLMUsage
from services.knowledge.admission.application import DatasetAdmissionLimits
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest
from services.knowledge.retrieval.application import KnowledgeRetrievalApplicationService
from services.knowledge.retrieval.candidate_search import CandidateSearch, CandidateSearchResult
from services.knowledge.retrieval.metadata_filtering import MetadataFilterPlan, MetadataFilterPlanner
from services.knowledge.retrieval.records import RetrievalFinalizer
from services.knowledge.retrieval.retrieval import RetrievalDatasetSnapshot, RetrievalRepository


def test_knowledge_retrieval_allows_attachment_only_requests() -> None:
    repository = create_autospec(RetrievalRepository, instance=True, spec_set=True)
    candidate_search = create_autospec(CandidateSearch, instance=True, spec_set=True)
    metadata_filters = create_autospec(MetadataFilterPlanner, instance=True, spec_set=True)
    finalizer = create_autospec(RetrievalFinalizer, instance=True, spec_set=True)
    limits = create_autospec(DatasetAdmissionLimits, instance=True, spec_set=True)
    retrieval = KnowledgeRetrievalApplicationService(
        repository=repository,
        candidate_search=candidate_search,
        metadata_filters=metadata_filters,
        finalizer=finalizer,
        limits=limits,
    )
    available_dataset = RetrievalDatasetSnapshot(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description=None,
        provider="dify",
        retrieval_model=None,
        indexing_technique="high_quality",
        embedding_model_provider=None,
        embedding_model=None,
    )
    repository.list_available_datasets.return_value = [available_dataset]
    metadata_filters.plan.return_value = MetadataFilterPlan(None, None, LLMUsage.empty_usage())
    candidate_search.search_multiple.return_value = CandidateSearchResult(
        candidates=(),
        top_k=4,
        queried_dataset_ids=(),
        timer={},
        usage=LLMUsage.empty_usage(),
    )

    request = KnowledgeRetrievalRequest(
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        user_from="account",
        dataset_ids=["dataset-1"],
        query=None,
        retrieval_mode="multiple",
        top_k=4,
        score_threshold=0.0,
        reranking_mode="reranking_model",
        reranking_enable=True,
        attachment_ids=["attachment-1"],
    )

    result = retrieval.retrieve(request, request_metadata=None)

    assert result.sources == []
    candidate_search.search_multiple.assert_called_once()
