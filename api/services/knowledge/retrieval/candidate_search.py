"""Candidate planning, concurrent search, and reranking for knowledge retrieval."""

import logging
import math
import threading
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from flask import Flask, current_app
from opentelemetry.trace import get_current_span

from core.entities.model_entities import ModelStatus
from core.model_manager import ModelManager
from core.ops.utils import measure_time
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.otel import propagate_context, trace_span
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import PromptMessageTool
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from services.errors.knowledge_retrieval import (
    ModelCredentialsNotInitializedError,
    ModelNotExistError,
    ModelNotSupportedError,
    ModelQuotaExceededError,
)
from services.knowledge.entities.external import ExternalRetrievalConfig
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest
from services.knowledge.entities.retrieval_settings import RerankingModelDict, WeightsDict
from services.knowledge.retrieval.multi_dataset_function_call_router import FunctionCallMultiDatasetRouter
from services.knowledge.retrieval.multi_dataset_react_route import ReactMultiDatasetRouter
from services.knowledge.retrieval.retrieval import ExternalDatasetRetriever, RetrievalDatasetSnapshot
from services.knowledge.retrieval.routing_model import RoutingModelConfig

logger = logging.getLogger(__name__)

default_retrieval_model: DefaultRetrievalModelDict = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


@dataclass(frozen=True, slots=True)
class DatasetDocumentFilter:
    """Logical authorization scope and provider-facing physical identities."""

    physical_document_ids: tuple[str, ...] | None
    allowed_document_ids: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class RoutedDataset:
    dataset_id: str | None
    usage: LLMUsage


@dataclass(frozen=True, slots=True)
class CandidateSearchResult:
    candidates: tuple[Document, ...]
    top_k: int
    queried_dataset_ids: tuple[str, ...]
    timer: Mapping[str, Any]
    usage: LLMUsage


class InternalDatasetCandidateRetriever(Protocol):
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
    ) -> list[Document]: ...


class CandidateReranker(Protocol):
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
    ) -> tuple[list[Document], bool]: ...


class CandidateSearch:
    """Own the provider search plan without owning database sessions or response publication."""

    def __init__(
        self,
        *,
        internal_retrieval: InternalDatasetCandidateRetriever,
        external_retrieval: ExternalDatasetRetriever,
        reranker: CandidateReranker,
    ) -> None:
        self._internal_retrieval = internal_retrieval
        self._external_retrieval = external_retrieval
        self._reranker = reranker

    @staticmethod
    def _has_effective_reranker(
        *,
        reranking_enable: bool,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None,
        weights: WeightsDict | None,
    ) -> bool:
        if not reranking_enable:
            return False
        if reranking_mode == RerankMode.RERANKING_MODEL:
            return bool(
                reranking_model
                and reranking_model.get("reranking_provider_name")
                and reranking_model.get("reranking_model_name")
            )
        if reranking_mode == RerankMode.WEIGHTED_SCORE:
            return weights is not None
        return False

    @staticmethod
    def _retrieval_model(dataset: RetrievalDatasetSnapshot) -> DefaultRetrievalModelDict:
        return cast(DefaultRetrievalModelDict, dataset.retrieval_model or default_retrieval_model)

    def route_dataset(
        self,
        *,
        request: KnowledgeRetrievalRequest,
        datasets: Sequence[RetrievalDatasetSnapshot],
    ) -> RoutedDataset:
        if request.model_provider is None or request.model_name is None or request.query is None:
            raise ValueError("model_provider, model_name, and query are required for single retrieval mode")

        model_manager = ModelManager.for_tenant(tenant_id=request.tenant_id, user_id=request.user_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=request.tenant_id,
            model_type=ModelType.LLM,
            provider=request.model_provider,
            model=request.model_name,
        )
        provider_model_bundle = model_instance.provider_model_bundle
        model_type_instance = cast(LargeLanguageModel, model_instance.model_type_instance)
        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=request.model_name, model_type=ModelType.LLM
        )
        if provider_model is None:
            raise ModelNotExistError(f"Model {request.model_name} not exist.")
        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ModelCredentialsNotInitializedError(f"Model {request.model_name} credentials is not initialized.")
        if provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelNotSupportedError(f"Dify Hosted OpenAI {request.model_name} currently not support.")
        if provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise ModelQuotaExceededError(f"Model provider {request.model_provider} quota exceeded.")

        completion_params = (request.completion_params or {}).copy()
        raw_stop = completion_params.pop("stop", [])
        stop = (
            [raw_stop]
            if isinstance(raw_stop, str)
            else [str(item) for item in raw_stop]
            if isinstance(raw_stop, list)
            else []
        )
        model_schema = model_type_instance.get_model_schema(request.model_name, model_instance.credentials)
        if not model_schema:
            raise ModelNotExistError(f"Model {request.model_name} not exist.")
        strategy: Literal["react", "function_call"] = "react"
        if (
            request.routing_strategy == "auto"
            and model_schema.features
            and (
                ModelFeature.TOOL_CALL in model_schema.features or ModelFeature.MULTI_TOOL_CALL in model_schema.features
            )
        ):
            strategy = "function_call"

        tools = [self._dataset_tool(dataset) for dataset in datasets]
        if strategy == "function_call":
            dataset_id, usage = FunctionCallMultiDatasetRouter().invoke(request.query, tools, model_instance)
        else:
            dataset_id, usage = ReactMultiDatasetRouter().invoke(
                request.query,
                tools,
                RoutingModelConfig(
                    mode=request.model_mode or "chat",
                    parameters=completion_params,
                    stop=stop,
                ),
                model_instance,
                request.user_id,
                request.tenant_id,
            )
        return RoutedDataset(dataset_id=dataset_id, usage=usage)

    @staticmethod
    def _dataset_tool(dataset: RetrievalDatasetSnapshot) -> PromptMessageTool:
        description = dataset.description or f"useful for when you want to answer queries about the {dataset.name}"
        return PromptMessageTool(
            name=dataset.id,
            description=description.replace("\n", "").replace("\r", ""),
            parameters={"type": "object", "properties": {}, "required": []},
        )

    def search_direct(
        self,
        *,
        request: KnowledgeRetrievalRequest,
        dataset: RetrievalDatasetSnapshot,
        document_filter: DatasetDocumentFilter | None,
        metadata_condition: MetadataFilteringCondition | None,
    ) -> CandidateSearchResult:
        if request.metadata_filtering_mode != "disabled" and dataset.provider != "external" and document_filter is None:
            return self._result([], request.top_k, (), {}, LLMUsage.empty_usage())
        model = self._retrieval_model(dataset)
        top_k = request.top_k if request.top_k > 0 else model.get("top_k") or 4
        with measure_time() as timer:
            documents = self._retrieve_dataset(
                dataset=dataset,
                query=request.query or "",
                top_k=top_k,
                document_filter=document_filter,
                metadata_condition=metadata_condition,
                attachment_ids=request.attachment_ids,
                override_top_k=request.top_k > 0,
            )
        return self._result(documents, top_k, (dataset.id,), timer, LLMUsage.empty_usage())

    def search_selected(
        self,
        *,
        request: KnowledgeRetrievalRequest,
        dataset: RetrievalDatasetSnapshot,
        document_filter: DatasetDocumentFilter | None,
        metadata_condition: MetadataFilteringCondition | None,
        routing_usage: LLMUsage,
    ) -> CandidateSearchResult:
        if request.metadata_filtering_mode != "disabled" and dataset.provider != "external" and document_filter is None:
            return self._result([], 0, (), {}, routing_usage)
        model = self._retrieval_model(dataset)
        if dataset.provider == "external":
            config = ExternalRetrievalConfig.from_mapping(dataset.retrieval_model)
            top_k = config.top_k if config and config.top_k else 0
        else:
            top_k = model["top_k"]
        with measure_time() as timer:
            documents = self._retrieve_dataset(
                dataset=dataset,
                query=request.query or "",
                top_k=top_k,
                document_filter=document_filter,
                metadata_condition=metadata_condition,
                attachment_ids=None,
                configure_economy_reranking=True,
            )
        return self._result(documents, top_k, (dataset.id,), timer, routing_usage)

    @trace_span()
    def search_multiple(
        self,
        *,
        request: KnowledgeRetrievalRequest,
        datasets: Sequence[RetrievalDatasetSnapshot],
        document_filters: Mapping[str, DatasetDocumentFilter],
        metadata_condition: MetadataFilteringCondition | None,
    ) -> CandidateSearchResult:
        if not datasets:
            return self._result([], request.top_k, (), {}, LLMUsage.empty_usage())
        weights = request.weights
        if request.reranking_enable and request.reranking_mode == RerankMode.WEIGHTED_SCORE and weights is None:
            raise ValueError("weights is required for weighted score reranking")
        effective_reranker = self._has_effective_reranker(
            reranking_enable=request.reranking_enable,
            reranking_mode=request.reranking_mode,
            reranking_model=request.reranking_model,
            weights=weights,
        )
        same_index_type = all(dataset.indexing_technique == datasets[0].indexing_technique for dataset in datasets)
        if not same_index_type and not (effective_reranker and request.reranking_mode == RerankMode.RERANKING_MODEL):
            raise ValueError(
                "The configured knowledge base list have different indexing technique, please set reranking model."
            )
        if datasets[0].indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            same_embedding = all(
                dataset.embedding_model == datasets[0].embedding_model
                and dataset.embedding_model_provider == datasets[0].embedding_model_provider
                for dataset in datasets
            )
            if request.reranking_enable and request.reranking_mode == RerankMode.WEIGHTED_SCORE and not same_embedding:
                raise ValueError(
                    "The configured knowledge base list have different embedding model, please set reranking model."
                )
            if weights is not None and request.reranking_mode == RerankMode.WEIGHTED_SCORE:
                weights = cast(WeightsDict, {**weights, "vector_setting": dict(weights["vector_setting"])})
                embedding_provider = datasets[0].embedding_model_provider
                embedding_model = datasets[0].embedding_model
                if not embedding_provider or not embedding_model:
                    raise ValueError("The configured knowledge base has no available embedding model.")
                weights["vector_setting"]["embedding_provider_name"] = embedding_provider
                weights["vector_setting"]["embedding_model_name"] = embedding_model

        all_documents: list[Document] = []
        threads: list[threading.Thread] = []
        exceptions: list[Exception] = []
        cancel = threading.Event()
        flask_app = current_app._get_current_object()  # type: ignore
        with measure_time() as timer:
            for query, attachment_id in self._queries(request.query, request.attachment_ids):
                thread = threading.Thread(
                    target=propagate_context(self._search_across_datasets_safely),
                    kwargs={
                        "flask_app": flask_app,
                        "datasets": tuple(datasets),
                        "document_filters": document_filters,
                        "metadata_condition": metadata_condition,
                        "all_documents": all_documents,
                        "request": request,
                        "weights": weights,
                        "query": query,
                        "attachment_id": attachment_id,
                        "cancel_event": cancel,
                        "exceptions": exceptions,
                    },
                )
                threads.append(thread)
                thread.start()
            self._join_threads(threads, cancel, exceptions)
        if exceptions:
            raise exceptions[0]

        deduplicated: list[Document] = []
        keys: set[tuple[str | None, str]] = set()
        for document in all_documents:
            if document.provider == "external":
                deduplicated.append(document)
                continue
            metadata = document.metadata or {}
            doc_id = metadata.get("doc_id")
            source_dataset_id = metadata.get("_retrieval_source_dataset_id")
            key = (str(source_dataset_id) if source_dataset_id is not None else None, str(doc_id))
            if doc_id and key not in keys:
                keys.add(key)
                deduplicated.append(document)
        candidates = self.calculate_vector_score(deduplicated, 0, request.score_threshold)
        return self._result(
            candidates,
            request.top_k,
            tuple(dataset.id for dataset in datasets),
            timer,
            LLMUsage.empty_usage(),
        )

    @staticmethod
    def _queries(query: str | None, attachment_ids: Sequence[str] | None):
        if query:
            yield query, None
        for attachment_id in attachment_ids or ():
            yield None, attachment_id

    @staticmethod
    def _join_threads(
        threads: Sequence[threading.Thread], cancel_event: threading.Event, exceptions: list[Exception]
    ) -> None:
        while any(thread.is_alive() for thread in threads):
            for thread in threads:
                thread.join(timeout=0.1)
                if exceptions:
                    cancel_event.set()
                    return

    def _search_across_datasets_safely(
        self,
        *,
        flask_app: Flask,
        datasets: Sequence[RetrievalDatasetSnapshot],
        document_filters: Mapping[str, DatasetDocumentFilter],
        metadata_condition: MetadataFilteringCondition | None,
        all_documents: list[Document],
        request: KnowledgeRetrievalRequest,
        weights: WeightsDict | None,
        query: str | None,
        attachment_id: str | None,
        cancel_event: threading.Event,
        exceptions: list[Exception],
    ) -> None:
        try:
            self._search_across_datasets(
                flask_app=flask_app,
                datasets=datasets,
                document_filters=document_filters,
                metadata_condition=metadata_condition,
                all_documents=all_documents,
                request=request,
                weights=weights,
                query=query,
                attachment_id=attachment_id,
                cancel_event=cancel_event,
            )
        except Exception as exc:
            cancel_event.set()
            exceptions.append(exc)

    @trace_span()
    def _search_across_datasets(
        self,
        *,
        flask_app: Flask,
        datasets: Sequence[RetrievalDatasetSnapshot],
        document_filters: Mapping[str, DatasetDocumentFilter],
        metadata_condition: MetadataFilteringCondition | None,
        all_documents: list[Document],
        request: KnowledgeRetrievalRequest,
        weights: WeightsDict | None,
        query: str | None,
        attachment_id: str | None,
        cancel_event: threading.Event,
    ) -> None:
        with flask_app.app_context():
            documents: list[Document] = []
            filter_scope: dict[str, tuple[str, ...] | None] = {}
            threads: list[threading.Thread] = []
            for dataset in datasets:
                if cancel_event.is_set():
                    break
                document_filter = document_filters.get(dataset.id)
                if dataset.provider != "external":
                    if request.metadata_filtering_mode != "disabled" and document_filter is None:
                        continue
                    filter_scope[dataset.id] = document_filter.allowed_document_ids if document_filter else None
                thread = threading.Thread(
                    target=propagate_context(self._retrieve_dataset_safely),
                    kwargs={
                        "flask_app": flask_app,
                        "dataset": dataset,
                        "query": query or "",
                        "top_k": request.top_k,
                        "document_filter": document_filter,
                        "metadata_condition": metadata_condition,
                        "attachment_ids": [attachment_id] if attachment_id else None,
                        "all_documents": documents,
                    },
                )
                threads.append(thread)
                thread.start()
            self._join_threads(threads, cancel_event, [])

            reranked = False
            if len(datasets) > 1 and self._has_effective_reranker(
                reranking_enable=request.reranking_enable,
                reranking_mode=request.reranking_mode,
                reranking_model=request.reranking_model,
                weights=weights,
            ):
                documents, reranked = self._reranker.rerank(
                    tenant_id=request.tenant_id,
                    reranking_mode=request.reranking_mode,
                    reranking_model=request.reranking_model,
                    weights=weights,
                    dataset_document_filters=filter_scope,
                    documents=documents,
                    query=query or attachment_id or "",
                    query_type=QueryType.TEXT_QUERY if query else QueryType.IMAGE_QUERY,
                    score_threshold=request.score_threshold,
                )
            if not reranked:
                if any(dataset.indexing_technique != datasets[0].indexing_technique for dataset in datasets):
                    raise ValueError(
                        "The configured reranking model is unavailable for knowledge bases with different "
                        "indexing techniques."
                    )
                if datasets[0].indexing_technique == IndexTechniqueType.ECONOMY:
                    documents = self.calculate_keyword_score(query or "", documents, 0) if query else []
                documents = self.calculate_vector_score(documents, 0, request.score_threshold)
            all_documents.extend(documents)

    def _retrieve_dataset_safely(
        self,
        *,
        flask_app: Flask,
        dataset: RetrievalDatasetSnapshot,
        query: str,
        top_k: int,
        document_filter: DatasetDocumentFilter | None,
        metadata_condition: MetadataFilteringCondition | None,
        attachment_ids: list[str] | None,
        all_documents: list[Document],
    ) -> None:
        try:
            with flask_app.app_context():
                all_documents.extend(
                    self._retrieve_dataset(
                        dataset=dataset,
                        query=query,
                        top_k=top_k,
                        document_filter=document_filter,
                        metadata_condition=metadata_condition,
                        attachment_ids=attachment_ids,
                    )
                )
        except Exception as exc:
            logger.warning(
                "Skipping dataset retrieval because retriever failed, dataset_id=%s, error_type=%s, error=%s",
                dataset.id,
                type(exc).__name__,
                str(exc),
            )
            span = get_current_span()
            if span and span.is_recording():
                span.add_event(
                    "dataset_retrieval.skipped",
                    attributes={"dataset_id": dataset.id, "error.type": type(exc).__name__, "error.message": str(exc)},
                )

    def _retrieve_dataset(
        self,
        *,
        dataset: RetrievalDatasetSnapshot,
        query: str,
        top_k: int,
        document_filter: DatasetDocumentFilter | None,
        metadata_condition: MetadataFilteringCondition | None,
        attachment_ids: list[str] | None,
        override_top_k: bool = False,
        configure_economy_reranking: bool = False,
    ) -> list[Document]:
        if dataset.provider == "external" and query:
            config = ExternalRetrievalConfig.from_mapping(dataset.retrieval_model)
            if override_top_k:
                config = ExternalRetrievalConfig(
                    top_k=top_k,
                    score_threshold=config.score_threshold if config else 0.0,
                    score_threshold_enabled=config.score_threshold_enabled if config else False,
                )
            external_documents = self._external_retrieval.retrieve(
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                query=query,
                retrieval_model=config,
                metadata_filters=metadata_condition,
            )
            results: list[Document] = []
            for external_document in external_documents:
                metadata = dict(external_document.metadata)
                metadata.update(
                    score=external_document.score,
                    title=external_document.title,
                    dataset_id=dataset.id,
                    dataset_name=dataset.name,
                )
                results.append(Document(page_content=external_document.content, metadata=metadata, provider="external"))
            return results
        if dataset.provider == "external":
            return []

        model = self._retrieval_model(dataset)
        method = (
            RetrievalMethod.KEYWORD_SEARCH
            if dataset.indexing_technique == IndexTechniqueType.ECONOMY
            else model["search_method"]
        )
        if top_k <= 0:
            return []
        effective_top_k = (
            top_k
            if override_top_k or dataset.indexing_technique == IndexTechniqueType.ECONOMY
            else model.get("top_k") or 4
        )
        physical_document_ids = (
            list(document_filter.physical_document_ids)
            if document_filter and document_filter.physical_document_ids is not None
            else None
        )
        allowed_document_ids = document_filter.allowed_document_ids if document_filter else None
        if dataset.indexing_technique == IndexTechniqueType.ECONOMY and not configure_economy_reranking:
            return self._internal_retrieval.retrieve(
                retrieval_method=method,
                dataset_id=dataset.id,
                query=query,
                top_k=effective_top_k,
                document_ids_filter=physical_document_ids,
                allowed_document_ids_filter=allowed_document_ids,
            )
        return self._internal_retrieval.retrieve(
            retrieval_method=method,
            dataset_id=dataset.id,
            query=query,
            top_k=effective_top_k,
            score_threshold=model.get("score_threshold", 0.0) if model["score_threshold_enabled"] else 0.0,
            reranking_model=model.get("reranking_model") if model["reranking_enable"] else None,
            reranking_mode=model.get("reranking_mode") or "reranking_model",
            weights=model.get("weights"),
            document_ids_filter=physical_document_ids,
            allowed_document_ids_filter=allowed_document_ids,
            attachment_ids=attachment_ids,
        )

    @staticmethod
    def calculate_keyword_score(query: str, documents: list[Document], top_k: int) -> list[Document]:
        from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler

        keyword_table_handler = JiebaKeywordTableHandler()
        query_keywords = keyword_table_handler.extract_keywords(query, None)
        documents_keywords = []
        for document in documents:
            if document.metadata is not None:
                document_keywords = keyword_table_handler.extract_keywords(document.page_content, None)
                document.metadata["keywords"] = document_keywords
                documents_keywords.append(document_keywords)

        query_keyword_counts = Counter(query_keywords)
        total_documents = len(documents)
        all_keywords = set()
        for document_keywords in documents_keywords:
            all_keywords.update(document_keywords)

        keyword_idf = {}
        for keyword in all_keywords:
            doc_count_containing_keyword = sum(1 for doc_keywords in documents_keywords if keyword in doc_keywords)
            keyword_idf[keyword] = math.log((1 + total_documents) / (1 + doc_count_containing_keyword)) + 1

        query_tfidf = {}
        for keyword, count in query_keyword_counts.items():
            tf = count
            idf = keyword_idf.get(keyword, 0)
            query_tfidf[keyword] = tf * idf

        documents_tfidf = []
        for document_keywords in documents_keywords:
            document_keyword_counts = Counter(document_keywords)
            document_tfidf = {}
            for keyword, count in document_keyword_counts.items():
                tf = count
                idf = keyword_idf.get(keyword, 0)
                document_tfidf[keyword] = tf * idf
            documents_tfidf.append(document_tfidf)

        def cosine_similarity(vec1, vec2):
            intersection = set(vec1.keys()) & set(vec2.keys())
            numerator = sum(vec1[x] * vec2[x] for x in intersection)
            sum1 = sum(vec1[x] ** 2 for x in vec1)
            sum2 = sum(vec2[x] ** 2 for x in vec2)
            denominator = math.sqrt(sum1) * math.sqrt(sum2)
            if not denominator:
                return 0.0
            return float(numerator) / denominator

        similarities = []
        for document_tfidf in documents_tfidf:
            similarities.append(cosine_similarity(query_tfidf, document_tfidf))

        for document, score in zip(documents, similarities, strict=False):
            if document.metadata is not None:
                document.metadata["score"] = score
        documents = sorted(documents, key=lambda x: x.metadata.get("score", 0) if x.metadata else 0, reverse=True)
        return documents[:top_k] if top_k else documents

    @staticmethod
    def calculate_vector_score(documents: list[Document], top_k: int, threshold: float) -> list[Document]:
        filtered = [
            document
            for document in documents
            if threshold is None or (document.metadata and document.metadata.get("score", 0) >= threshold)
        ]
        filtered.sort(key=lambda item: (item.metadata or {}).get("score", 0), reverse=True)
        return filtered[:top_k] if top_k else filtered

    @staticmethod
    def _result(
        documents: Sequence[Document],
        top_k: int,
        queried_dataset_ids: Sequence[str],
        timer: Mapping[str, Any],
        usage: LLMUsage,
    ) -> CandidateSearchResult:
        return CandidateSearchResult(
            candidates=tuple(documents),
            top_k=top_k,
            queried_dataset_ids=tuple(queried_dataset_ids),
            timer=dict(timer),
            usage=usage,
        )
