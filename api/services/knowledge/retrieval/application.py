"""Knowledge retrieval use cases for admitted callers and trusted inner requests."""

import logging
import threading
from collections.abc import Mapping, Sequence
from typing import Protocol

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import use_credit_usage_metadata, with_credit_usage_created_by
from extensions.otel import trace_span
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.nodes.llm.entities import ModelConfig
from machinery.context import RequestContext
from services.errors.knowledge_retrieval import (
    ExternalKnowledgeRetrievalError,
    InnerKnowledgeRetrieveConfigError,
    InnerKnowledgeRetrieveExternalError,
    InnerKnowledgeRetrieveRateLimitError,
    RateLimitExceededError,
)
from services.knowledge.admission.application import DatasetAdmissionLimits
from services.knowledge.admission.limits import KnowledgeApiRateLimitExceededError
from services.knowledge.entities.inner_retrieval import (
    InnerKnowledgeRetrieveRequest,
    InnerKnowledgeRetrieveResult,
    InnerKnowledgeRetrieveUsage,
)
from services.knowledge.entities.metadata import Condition, MetadataFilteringCondition
from services.knowledge.entities.retrieval import (
    KnowledgeRetrievalRequest,
    KnowledgeRetrievalResult,
    KnowledgeRetrievalTrace,
    RetrievableDataset,
)
from services.knowledge.retrieval.candidate_search import CandidateSearch, CandidateSearchResult, DatasetDocumentFilter
from services.knowledge.retrieval.metadata_filtering import MetadataFilterPlan, MetadataFilterPlanner
from services.knowledge.retrieval.records import RetrievalFinalizer
from services.knowledge.retrieval.retrieval import KnowledgeRetriever, RetrievalDatasetSnapshot, RetrievalRepository

logger = logging.getLogger(__name__)


class KnowledgeRetrievalApplicationService:
    """Coordinate one retrieval without owning persistence or provider infrastructure."""

    def __init__(
        self,
        *,
        repository: RetrievalRepository,
        candidate_search: CandidateSearch,
        metadata_filters: MetadataFilterPlanner,
        finalizer: RetrievalFinalizer,
        limits: DatasetAdmissionLimits,
    ) -> None:
        self._repository = repository
        self._candidate_search = candidate_search
        self._metadata_filters = metadata_filters
        self._finalizer = finalizer
        self._limits = limits

    def list_datasets(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[RetrievableDataset]:
        return [
            RetrievableDataset(dataset_id=dataset.id, name=dataset.name, description=dataset.description)
            for dataset in self._repository.list_available_datasets(tenant_id=tenant_id, dataset_ids=dataset_ids)
        ]

    @trace_span()
    def retrieve(
        self,
        request: KnowledgeRetrievalRequest,
        *,
        request_metadata: Mapping[str, object] | None,
    ) -> KnowledgeRetrievalResult:
        with use_credit_usage_metadata(request_metadata):
            return self._retrieve(request)

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def _retrieve(self, request: KnowledgeRetrievalRequest) -> KnowledgeRetrievalResult:
        self._check_rate_limit(request.tenant_id)
        if request.retrieval_mode == "direct" and len(request.dataset_ids) != 1:
            raise ValueError("direct retrieval requires exactly one dataset")
        datasets = self._repository.list_available_datasets(
            tenant_id=request.tenant_id,
            dataset_ids=request.dataset_ids,
        )
        if not datasets:
            return self._empty_result()
        if request.retrieval_mode == "direct" and request.top_k <= 0:
            request = request.model_copy(update={"top_k": self._dataset_top_k(datasets[0])})
        if not request.query and not request.attachment_ids:
            return self._empty_result()

        metadata_plan = self._metadata_filters.plan(
            request=request,
            dataset_ids=[dataset.id for dataset in datasets],
        )
        document_filters = self._document_filters(
            request=request,
            datasets=datasets,
            plan=metadata_plan,
        )
        search_result = self._search(
            request=request,
            datasets=datasets,
            document_filters=document_filters,
            metadata_plan=metadata_plan,
        )
        usage = self._plus_usage(metadata_plan.usage, search_result.usage)
        if search_result.queried_dataset_ids:
            self._repository.record_app_query(
                tenant_id=request.tenant_id,
                dataset_ids=search_result.queried_dataset_ids,
                query=request.query,
                attachment_ids=request.attachment_ids,
                app_id=request.app_id,
                user_from=request.user_from,
                user_id=request.user_id,
            )
        if not search_result.candidates:
            return self._empty_result(usage)

        finalized = self._finalizer.finalize_response(
            candidates=search_result.candidates,
            tenant_id=request.tenant_id,
            dataset_ids=[dataset.id for dataset in datasets],
            top_k=search_result.top_k,
            retriever_from=request.retriever_from,
        )
        self._record_hits(finalized.selected_segment_ids)
        trace = (
            KnowledgeRetrievalTrace(
                documents=finalized.trace_documents,
                timer=dict(search_result.timer),
            )
            if finalized.trace_documents
            else None
        )
        return KnowledgeRetrievalResult(
            sources=list(finalized.sources),
            usage=usage,
            context=finalized.context,
            attachments=finalized.attachments,
            trace=trace,
        )

    def _search(
        self,
        *,
        request: KnowledgeRetrievalRequest,
        datasets: Sequence[RetrievalDatasetSnapshot],
        document_filters: Mapping[str, DatasetDocumentFilter],
        metadata_plan: MetadataFilterPlan,
    ) -> CandidateSearchResult:
        if request.retrieval_mode == "direct":
            return self._candidate_search.search_direct(
                request=request,
                dataset=datasets[0],
                document_filter=document_filters.get(datasets[0].id),
                metadata_condition=metadata_plan.condition,
            )
        if request.retrieval_mode == "multiple":
            return self._candidate_search.search_multiple(
                request=request,
                datasets=datasets,
                document_filters=document_filters,
                metadata_condition=metadata_plan.condition,
            )
        if request.retrieval_mode != "single":
            raise ValueError(f"Unsupported retrieval mode: {request.retrieval_mode}")
        routed = self._candidate_search.route_dataset(request=request, datasets=datasets)
        if routed.dataset_id is None:
            return CandidateSearchResult((), 0, (), {}, routed.usage)
        selected = self._repository.get_available_dataset(
            tenant_id=request.tenant_id,
            dataset_id=routed.dataset_id,
        )
        if selected is None or all(selected.id != dataset.id for dataset in datasets):
            return CandidateSearchResult((), 0, (), {}, routed.usage)
        selected_filters = self._document_filters(
            request=request,
            datasets=(selected,),
            plan=metadata_plan,
        )
        return self._candidate_search.search_selected(
            request=request,
            dataset=selected,
            document_filter=selected_filters.get(selected.id),
            metadata_condition=metadata_plan.condition,
            routing_usage=routed.usage,
        )

    def _document_filters(
        self,
        *,
        request: KnowledgeRetrievalRequest,
        datasets: Sequence[RetrievalDatasetSnapshot],
        plan: MetadataFilterPlan,
    ) -> dict[str, DatasetDocumentFilter]:
        filters: dict[str, DatasetDocumentFilter] = {}
        for dataset in datasets:
            if dataset.provider == "external":
                continue
            if request.metadata_filtering_mode == "disabled":
                filters[dataset.id] = DatasetDocumentFilter(None, None)
                continue
            logical_ids = tuple((plan.document_ids or {}).get(dataset.id, ()))
            if not logical_ids:
                continue
            filters[dataset.id] = DatasetDocumentFilter(
                physical_document_ids=self._repository.expand_document_ids_filter(
                    tenant_id=request.tenant_id,
                    dataset_id=dataset.id,
                    document_ids=logical_ids,
                ),
                allowed_document_ids=logical_ids,
            )
        return filters

    def _check_rate_limit(self, tenant_id: str) -> None:
        try:
            self._limits.check(
                tenant_id,
                rate_limit=True,
                billing_resources=(),
                require_paid_segments=False,
            )
        except KnowledgeApiRateLimitExceededError as error:
            raise RateLimitExceededError(
                "you have reached the knowledge base request rate limit of your subscription."
            ) from error

    def _record_hits(self, segment_ids: Sequence[str]) -> None:
        if not segment_ids:
            return

        def record() -> None:
            try:
                self._repository.increment_segment_hit_counts(segment_ids)
            except Exception:
                logger.warning("Failed to record knowledge retrieval hit counts", exc_info=True)

        threading.Thread(target=record).start()

    @staticmethod
    def _dataset_top_k(dataset: RetrievalDatasetSnapshot) -> int:
        top_k = (dataset.retrieval_model or {}).get("top_k", 2)
        if isinstance(top_k, bool) or not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("Dataset retrieval top_k must be a positive integer")
        return top_k

    @staticmethod
    def _plus_usage(first: LLMUsage, second: LLMUsage) -> LLMUsage:
        if first.total_tokens <= 0:
            return second
        if second.total_tokens <= 0:
            return first
        return first.plus(second)

    @staticmethod
    def _empty_result(usage: LLMUsage | None = None) -> KnowledgeRetrievalResult:
        return KnowledgeRetrievalResult(sources=[], usage=usage or LLMUsage.empty_usage())


class InnerKnowledgeRetrievalScope(Protocol):
    def validate_inner_retrieval_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        """Validate ownership and release the read session before returning."""
        ...


class InnerKnowledgeRetrievalService:
    """Validate the caller chain and adapt a trusted inner retrieval request.

    Dataset API visibility and user permissions are outside this bridge's
    policy. The retrieval application owns dataset and document availability.
    """

    def __init__(self, *, scope: InnerKnowledgeRetrievalScope, retrieval: KnowledgeRetriever) -> None:
        self._scope = scope
        self._retrieval = retrieval

    def retrieve(self, context: RequestContext, request: InnerKnowledgeRetrieveRequest) -> InnerKnowledgeRetrieveResult:
        self._scope.validate_inner_retrieval_scope(
            tenant_id=request.caller.tenant_id,
            app_id=request.caller.app_id,
            dataset_ids=request.dataset_ids,
        )
        try:
            result = self._retrieval.retrieve(
                self._to_retrieval_request(request),
                request_metadata={
                    "app_id": request.caller.app_id,
                    "request_id": context.request_id,
                    "trace_id": context.trace_id,
                },
            )
            return InnerKnowledgeRetrieveResult(
                results=result.sources,
                usage=InnerKnowledgeRetrieveUsage.model_validate(jsonable_encoder(result.usage)),
            )
        except RateLimitExceededError as error:
            raise InnerKnowledgeRetrieveRateLimitError(str(error)) from error
        except ExternalKnowledgeRetrievalError as error:
            raise InnerKnowledgeRetrieveExternalError(str(error)) from error
        except ValueError as error:
            raise InnerKnowledgeRetrieveConfigError(str(error)) from error

    @staticmethod
    def _to_retrieval_request(request: InnerKnowledgeRetrieveRequest) -> KnowledgeRetrievalRequest:
        metadata_model_config = request.metadata_filtering.metadata_model_config
        metadata_conditions = request.metadata_filtering.conditions

        return KnowledgeRetrievalRequest(
            tenant_id=request.caller.tenant_id,
            user_id=request.caller.user_id,
            app_id=request.caller.app_id,
            user_from=request.caller.user_from,
            dataset_ids=request.dataset_ids,
            query=request.query,
            retrieval_mode=request.retrieval.mode,
            model_provider=request.retrieval.model.provider if request.retrieval.model else None,
            completion_params=request.retrieval.model.completion_params if request.retrieval.model else None,
            model_mode=request.retrieval.model.mode if request.retrieval.model else None,
            model_name=request.retrieval.model.name if request.retrieval.model else None,
            metadata_model_config=ModelConfig.model_validate(metadata_model_config, from_attributes=True)
            if metadata_model_config is not None
            else None,
            metadata_filtering_conditions=(
                MetadataFilteringCondition(
                    logical_operator=metadata_conditions.logical_operator,
                    conditions=(
                        [
                            Condition(
                                name=condition.name,
                                comparison_operator=condition.comparison_operator,
                                value=condition.value,
                            )
                            for condition in metadata_conditions.conditions
                        ]
                        if metadata_conditions.conditions is not None
                        else None
                    ),
                )
                if metadata_conditions is not None
                else None
            ),
            metadata_filtering_mode=request.metadata_filtering.mode,
            top_k=request.retrieval.top_k or 0,
            score_threshold=request.retrieval.score_threshold,
            reranking_mode=request.retrieval.reranking_mode,
            reranking_model=(
                {
                    "reranking_provider_name": request.retrieval.reranking_model.provider,
                    "reranking_model_name": request.retrieval.reranking_model.model,
                }
                if request.retrieval.reranking_model is not None
                else None
            ),
            weights=request.retrieval.weights.model_dump() if request.retrieval.weights is not None else None,
            reranking_enable=request.retrieval.reranking_enable,
            attachment_ids=request.attachment_ids or None,
        )
