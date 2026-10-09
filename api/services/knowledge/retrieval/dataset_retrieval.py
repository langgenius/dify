import json
import logging
import math
import re
import threading
import time
from collections import Counter
from collections.abc import Generator, Mapping
from typing import Any, Union, cast

from opentelemetry.trace import get_current_span

from core.app.app_config.entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    MetadataFilteringCondition,
    ModelConfig,
)
from core.app.entities.app_invoke_entities import (
    CreditUsageCreatedBy,
    EasyUIBasedAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
    get_credit_usage_app_type,
)
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_context import with_credit_usage_created_by, with_credit_usage_metadata
from core.model_manager import ModelInstance, ModelManager
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.rag.data_post_processor.data_post_processor import RerankingModelDict, WeightsDict
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.entities import Condition, DocumentContext, RetrievalSourceMetadata
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.rag.retrieval.router.multi_dataset_function_call_router import FunctionCallMultiDatasetRouter
from core.rag.retrieval.router.multi_dataset_react_route import ReactMultiDatasetRouter
from core.rag.retrieval.template_prompts import (
    METADATA_FILTER_ASSISTANT_PROMPT_1,
    METADATA_FILTER_ASSISTANT_PROMPT_2,
    METADATA_FILTER_COMPLETION_PROMPT,
    METADATA_FILTER_SYSTEM_PROMPT,
    METADATA_FILTER_USER_PROMPT_1,
    METADATA_FILTER_USER_PROMPT_2,
    METADATA_FILTER_USER_PROMPT_3,
)
from core.workflow.nodes.knowledge_retrieval import exc
from core.workflow.nodes.knowledge_retrieval.retrieval import (
    KnowledgeRetrievalRequest,
    Source,
    SourceMetadata,
)
from extensions.ext_redis import redis_client
from extensions.otel import trace_span
from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole, PromptMessageTool
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from libs.helper import parse_uuid_str_or_none
from libs.json_in_md_parser import parse_and_check_json_markdown
from models.dataset import (
    Dataset,
)
from models.enums import CreatorUserRole
from services.feature_service import FeatureService
from services.knowledge.external.service import ExternalDatasetService
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.knowledge.retrieval.ports import KnowledgeRetrievalRecords, RetrievalReranker, RetrievalThreadFactory

default_retrieval_model: DefaultRetrievalModelDict = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}

logger = logging.getLogger(__name__)


class DatasetRetrieval:
    def __init__(
        self,
        application_generate_entity: EasyUIBasedAppGenerateEntity | None = None,
        *,
        records: KnowledgeRetrievalRecords,
        rerank: RetrievalReranker,
        thread: RetrievalThreadFactory,
    ):
        self._records = records
        self._rerank = rerank
        self._thread = thread
        self.application_generate_entity = application_generate_entity
        self._llm_usage = LLMUsage.empty_usage()
        self._request_metadata: dict[str, object] | None = None
        if application_generate_entity is not None:
            app_config = application_generate_entity.app_config
            self._request_metadata = {
                "app_type": get_credit_usage_app_type(app_config.app_mode),
                "app_id": app_config.app_id,
            }

    def set_request_metadata(self, request_metadata: Mapping[str, object] | None) -> None:
        self._request_metadata = dict(request_metadata) if request_metadata else None

    @property
    def llm_usage(self) -> LLMUsage:
        return self._llm_usage.model_copy()

    def _record_usage(self, usage: LLMUsage | None) -> None:
        if usage is None or usage.total_tokens <= 0:
            return
        if self._llm_usage.total_tokens == 0:
            self._llm_usage = usage
        else:
            self._llm_usage = self._llm_usage.plus(usage)

    @trace_span()
    @with_credit_usage_metadata
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def knowledge_retrieval(self, request: KnowledgeRetrievalRequest) -> list[Source]:
        self._check_knowledge_rate_limit(request.tenant_id)
        available_datasets = self._records.available_datasets(request.tenant_id, request.dataset_ids)
        available_datasets_ids = [i.id for i in available_datasets]
        if not available_datasets_ids:
            return []

        if not request.query and not request.attachment_ids:
            return []

        metadata_filter_document_ids, metadata_condition = None, None

        if request.metadata_filtering_mode != "disabled":
            app_metadata_model_config = ModelConfig(provider="", name="", mode=LLMMode.CHAT, completion_params={})
            if request.metadata_filtering_mode == "automatic":
                if not request.metadata_model_config:
                    raise ValueError("metadata_model_config is required for this method")

                app_metadata_model_config = ModelConfig.model_validate(request.metadata_model_config.model_dump())

            app_metadata_filtering_conditions = None
            if request.metadata_filtering_conditions is not None:
                app_metadata_filtering_conditions = MetadataFilteringCondition.model_validate(
                    request.metadata_filtering_conditions.model_dump()
                )

            query = request.query if request.query is not None else ""

            metadata_filter_document_ids, metadata_condition = self.get_metadata_filter_condition(
                dataset_ids=available_datasets_ids,
                query=query,
                tenant_id=request.tenant_id,
                user_id=request.user_id,
                metadata_filtering_mode=request.metadata_filtering_mode,
                metadata_model_config=app_metadata_model_config,
                metadata_filtering_conditions=app_metadata_filtering_conditions,
                inputs={},
            )

        if request.retrieval_mode == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE:
            planning_strategy = PlanningStrategy.REACT_ROUTER
            # Ensure required fields are not None for single retrieval mode
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
            model_type_instance = model_instance.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)

            model_credentials = model_instance.credentials

            # check model
            provider_model = provider_model_bundle.configuration.get_provider_model(
                model=request.model_name, model_type=ModelType.LLM
            )

            if provider_model is None:
                raise exc.ModelNotExistError(f"Model {request.model_name} not exist.")

            if provider_model.status == ModelStatus.NO_CONFIGURE:
                raise exc.ModelCredentialsNotInitializedError(
                    f"Model {request.model_name} credentials is not initialized."
                )
            elif provider_model.status == ModelStatus.NO_PERMISSION:
                raise exc.ModelNotSupportedError(f"Dify Hosted OpenAI {request.model_name} currently not support.")
            elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
                raise exc.ModelQuotaExceededError(f"Model provider {request.model_provider} quota exceeded.")

            stop = []
            completion_params = (request.completion_params or {}).copy()
            if "stop" in completion_params:
                stop = completion_params["stop"]
                del completion_params["stop"]

            model_schema = model_type_instance.get_model_schema(request.model_name, model_credentials)

            if not model_schema:
                raise exc.ModelNotExistError(f"Model {request.model_name} not exist.")

            model_config = ModelConfigWithCredentialsEntity(
                provider=request.model_provider,
                model=request.model_name,
                model_schema=model_schema,
                mode=request.model_mode or "chat",
                provider_model_bundle=provider_model_bundle,
                credentials=model_credentials,
                parameters=completion_params,
                stop=stop,
            )
            all_documents = self.single_retrieve(
                request.app_id,
                request.tenant_id,
                request.user_id,
                request.user_from,
                request.query,
                available_datasets,
                model_instance,
                model_config,
                planning_strategy,
                None,  # message_id
                metadata_filter_document_ids,
                metadata_condition,
            )
        else:
            all_documents = self.multiple_retrieve(
                app_id=request.app_id,
                tenant_id=request.tenant_id,
                user_id=request.user_id,
                user_from=request.user_from,
                available_datasets=available_datasets,
                query=request.query,
                top_k=request.top_k,
                score_threshold=request.score_threshold,
                reranking_mode=request.reranking_mode,
                reranking_model=request.reranking_model,
                weights=request.weights,
                reranking_enable=request.reranking_enable,
                metadata_filter_document_ids=metadata_filter_document_ids,
                metadata_condition=metadata_condition,
                attachment_ids=request.attachment_ids,
            )

        dify_documents = [item for item in all_documents if item.provider == "dify"]
        external_documents = [item for item in all_documents if item.provider == "external"]
        retrieval_resource_list = []
        # deal with external documents
        for item in external_documents:
            ext_meta = item.metadata or {}
            title = ext_meta.get("title") or ""
            doc_id = ext_meta.get("document_id") or title
            source = Source(
                metadata=SourceMetadata(
                    source="knowledge",
                    dataset_id=ext_meta.get("dataset_id") or "",
                    dataset_name=ext_meta.get("dataset_name") or "",
                    document_id=str(doc_id),
                    document_name=ext_meta.get("title") or "",
                    data_source_type="external",
                    retriever_from="workflow",
                    score=float(ext_meta.get("score") or 0.0),
                    doc_metadata=ext_meta,
                ),
                title=title,
                content=item.page_content,
            )
            retrieval_resource_list.append(source)
        # deal with dify documents
        retrieval_resource_list.extend(self._records.workflow_sources(request, dify_documents, available_datasets_ids))

        if retrieval_resource_list:

            def _score(item: Source) -> float:
                meta = item.metadata
                score = meta.score
                if isinstance(score, (int, float)):
                    return float(score)
                return 0.0

            retrieval_resource_list = sorted(
                retrieval_resource_list,
                key=_score,  # type: ignore[arg-type, return-value]
                reverse=True,
            )
            for position, item in enumerate(retrieval_resource_list, start=1):
                item.metadata.position = position  # type: ignore[index]
        return retrieval_resource_list

    @with_credit_usage_metadata
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def retrieve(
        self,
        app_id: str,
        user_id: str,
        tenant_id: str,
        model_config: ModelConfigWithCredentialsEntity,
        config: DatasetEntity,
        query: str,
        invoke_from: InvokeFrom,
        show_retrieve_source: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
        message_id: str,
        memory: TokenBufferMemory | None = None,
        inputs: Mapping[str, Any] | None = None,
        vision_enabled: bool = False,
    ) -> tuple[str | None, list[File] | None]:
        """
        Retrieve dataset.
        :param app_id: app_id
        :param user_id: user_id
        :param tenant_id: tenant id
        :param model_config: model config
        :param config: dataset config
        :param query: query
        :param invoke_from: invoke from
        :param show_retrieve_source: show retrieve source
        :param hit_callback: hit callback
        :param message_id: message id
        :param memory: memory
        :param inputs: inputs
        :return:
        """
        dataset_ids = config.dataset_ids
        if len(dataset_ids) == 0:
            return None, []
        retrieve_config = config.retrieve_config

        model_manager = ModelManager.for_tenant(tenant_id=tenant_id, user_id=user_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id, model_type=ModelType.LLM, provider=model_config.provider, model=model_config.model
        )
        model_type_instance = cast(LargeLanguageModel, model_instance.model_type_instance)

        # Reuse the caller-bound model instance for both schema resolution and
        # downstream planner/invoke calls so a single request never mixes
        # tenant-scope and request-bound runtimes.
        model_schema = model_type_instance.get_model_schema(
            model=model_instance.model_name,
            credentials=model_instance.credentials,
        )

        if not model_schema:
            return None, []

        model_config.provider_model_bundle = model_instance.provider_model_bundle
        model_config.credentials = model_instance.credentials
        model_config.model_schema = model_schema

        planning_strategy = PlanningStrategy.REACT_ROUTER
        features = model_schema.features
        if features:
            if ModelFeature.TOOL_CALL in features or ModelFeature.MULTI_TOOL_CALL in features:
                planning_strategy = PlanningStrategy.ROUTER
        available_datasets = self._records.available_datasets(tenant_id, dataset_ids)

        if inputs:
            inputs = {key: str(value) for key, value in inputs.items()}
        else:
            inputs = {}
        available_datasets_ids = [dataset.id for dataset in available_datasets]
        metadata_filter_document_ids, metadata_condition = self.get_metadata_filter_condition(
            available_datasets_ids,
            query,
            tenant_id,
            user_id,
            retrieve_config.metadata_filtering_mode,  # type: ignore
            retrieve_config.metadata_model_config,  # type: ignore
            retrieve_config.metadata_filtering_conditions,
            inputs,
        )

        all_documents = []
        user_from = "account" if invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER} else "end_user"
        if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE:
            all_documents = self.single_retrieve(
                app_id,
                tenant_id,
                user_id,
                user_from,
                query,
                available_datasets,
                model_instance,
                model_config,
                planning_strategy,
                message_id,
                metadata_filter_document_ids,
                metadata_condition,
            )
        elif retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            all_documents = self.multiple_retrieve(
                app_id,
                tenant_id,
                user_id,
                user_from,
                available_datasets,
                query,
                retrieve_config.top_k or 0,
                retrieve_config.score_threshold or 0,
                retrieve_config.rerank_mode or "reranking_model",
                retrieve_config.reranking_model,
                retrieve_config.weights,
                True if retrieve_config.reranking_enabled is None else retrieve_config.reranking_enabled,
                message_id,
                metadata_filter_document_ids,
                metadata_condition,
            )

        return self._context(
            all_documents,
            tenant_id,
            available_datasets_ids,
            show_retrieve_source,
            vision_enabled,
            invoke_from,
            hit_callback,
        )

    def _context(
        self,
        all_documents: list[Document],
        tenant_id: str,
        available_datasets_ids: list[str],
        show_retrieve_source: bool,
        vision_enabled: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
    ) -> tuple[str, list[File]]:
        dify_documents = [item for item in all_documents if item.provider == "dify"]
        external_documents = [item for item in all_documents if item.provider == "external"]
        document_context_list: list[DocumentContext] = []
        context_files: list[File] = []
        retrieval_resource_list: list[RetrievalSourceMetadata] = []
        # deal with external documents
        for item in external_documents:
            document_context_list.append(DocumentContext(content=item.page_content, score=item.metadata.get("score")))
            source = RetrievalSourceMetadata(
                dataset_id=item.metadata.get("dataset_id"),
                dataset_name=item.metadata.get("dataset_name"),
                document_id=item.metadata.get("document_id") or item.metadata.get("title"),
                document_name=item.metadata.get("title"),
                data_source_type="external",
                retriever_from=invoke_from.to_source(),
                score=item.metadata.get("score"),
                content=item.page_content,
            )
            retrieval_resource_list.append(source)
        # deal with dify documents
        if dify_documents:
            contexts, files, resources = self._records.context_records(
                tenant_id, available_datasets_ids, dify_documents, show_retrieve_source, vision_enabled, invoke_from
            )
            document_context_list.extend(contexts)
            context_files.extend(files)
            retrieval_resource_list.extend(resources)
        if hit_callback and retrieval_resource_list:
            retrieval_resource_list = sorted(retrieval_resource_list, key=lambda x: x.score or 0.0, reverse=True)
            for position, item in enumerate(retrieval_resource_list, start=1):
                item.position = position
            hit_callback.return_retriever_resource_info(retrieval_resource_list)
        if document_context_list:
            document_context_list = sorted(document_context_list, key=lambda x: x.score or 0.0, reverse=True)
            return "\n".join([document_context.content for document_context in document_context_list]), context_files
        return "", context_files

    @trace_span()
    def single_retrieve(
        self,
        app_id: str,
        tenant_id: str,
        user_id: str,
        user_from: str,
        query: str,
        available_datasets: list[Dataset],
        model_instance: ModelInstance,
        model_config: ModelConfigWithCredentialsEntity,
        planning_strategy: PlanningStrategy,
        message_id: str | None = None,
        metadata_filter_document_ids: dict[str, list[str]] | None = None,
        metadata_condition: MetadataFilteringCondition | None = None,
    ):
        tools: list[PromptMessageTool] = []
        for dataset in available_datasets:
            description = dataset.description
            if not description:
                description = "useful for when you want to answer queries about the " + dataset.name

            description = description.replace("\n", "").replace("\r", "")
            message_tool = PromptMessageTool(
                name=dataset.id,
                description=description,
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            )
            tools.append(message_tool)
        dataset_id = None
        router_usage = LLMUsage.empty_usage()
        if planning_strategy == PlanningStrategy.REACT_ROUTER:
            react_multi_dataset_router = ReactMultiDatasetRouter()
            dataset_id, router_usage = react_multi_dataset_router.invoke(
                query, tools, model_config, model_instance, user_id, tenant_id
            )

        elif planning_strategy == PlanningStrategy.ROUTER:
            function_call_router = FunctionCallMultiDatasetRouter()
            dataset_id, router_usage = function_call_router.invoke(query, tools, model_config, model_instance)

        self._record_usage(router_usage)
        timer = None
        if dataset_id:
            allowed_dataset = next((dataset for dataset in available_datasets if dataset.id == dataset_id), None)
            selected_dataset = self._records.dataset(tenant_id, allowed_dataset.id) if allowed_dataset else None
            if selected_dataset:
                results = []
                if selected_dataset.provider == "external":
                    external_documents = self._external_retrieve(
                        tenant_id=selected_dataset.tenant_id,
                        dataset_id=selected_dataset.id,
                        query=query,
                        external_retrieval_parameters=selected_dataset.retrieval_model,
                        metadata_condition=metadata_condition,
                    )
                    for external_document in external_documents:
                        document = Document(
                            page_content=external_document.get("content"),
                            metadata=external_document.get("metadata"),
                            provider="external",
                        )
                        if document.metadata is not None:
                            document.metadata["score"] = external_document.get("score")
                            document.metadata["title"] = external_document.get("title")
                            document.metadata["dataset_id"] = selected_dataset.id
                            document.metadata["dataset_name"] = selected_dataset.name
                        results.append(document)
                else:
                    if metadata_condition and not metadata_filter_document_ids:
                        return []
                    document_ids_filter = None
                    if metadata_filter_document_ids:
                        document_ids = metadata_filter_document_ids.get(selected_dataset.id, [])
                        if document_ids:
                            document_ids_filter = document_ids
                        else:
                            return []
                    retrieval_model_config: DefaultRetrievalModelDict = (
                        cast(DefaultRetrievalModelDict, selected_dataset.retrieval_model)
                        if selected_dataset.retrieval_model
                        else default_retrieval_model
                    )

                    # get top k
                    top_k = retrieval_model_config["top_k"]
                    # get retrieval method
                    if selected_dataset.indexing_technique == IndexTechniqueType.ECONOMY:
                        retrieval_method = RetrievalMethod.KEYWORD_SEARCH
                    else:
                        retrieval_method = retrieval_model_config["search_method"]
                    # get reranking model
                    reranking_model = (
                        retrieval_model_config["reranking_model"]
                        if retrieval_model_config["reranking_enable"]
                        else None
                    )
                    # get score threshold
                    score_threshold = 0.0
                    score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                    if score_threshold_enabled:
                        score_threshold = retrieval_model_config.get("score_threshold", 0.0)

                    with measure_time() as timer:
                        results = RetrievalService.retrieve(
                            retrieval_method=retrieval_method,
                            dataset_id=selected_dataset.id,
                            query=query,
                            top_k=top_k,
                            score_threshold=score_threshold,
                            reranking_model=reranking_model,
                            reranking_mode=retrieval_model_config.get("reranking_mode", "reranking_model"),
                            weights=retrieval_model_config.get("weights", None),
                            document_ids_filter=document_ids_filter,
                        )
                self._on_query(tenant_id, query, None, [selected_dataset.id], app_id, user_from, user_id)

                if results:
                    thread = self._thread(
                        target=self._on_retrieval_end,
                        kwargs={
                            "documents": results,
                            "tenant_id": tenant_id,
                            "message_id": message_id,
                            "timer": timer,
                        },
                    )
                    thread.start()

                return results
        return []

    @trace_span()
    def multiple_retrieve(
        self,
        app_id: str,
        tenant_id: str,
        user_id: str,
        user_from: str,
        available_datasets: list[Dataset],
        query: str | None,
        top_k: int,
        score_threshold: float,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None = None,
        weights: WeightsDict | None = None,
        reranking_enable: bool = True,
        message_id: str | None = None,
        metadata_filter_document_ids: dict[str, list[str]] | None = None,
        metadata_condition: MetadataFilteringCondition | None = None,
        attachment_ids: list[str] | None = None,
    ):
        if not available_datasets:
            return []
        all_threads = []
        all_documents: list[Document] = []
        dataset_ids = [dataset.id for dataset in available_datasets]
        index_type_check = all(
            item.indexing_technique == available_datasets[0].indexing_technique for item in available_datasets
        )
        if not index_type_check and (not reranking_enable or reranking_mode != RerankMode.RERANKING_MODEL):
            raise ValueError(
                "The configured knowledge base list have different indexing technique, please set reranking model."
            )
        index_type = available_datasets[0].indexing_technique
        if index_type == IndexTechniqueType.HIGH_QUALITY:
            embedding_model_check = all(
                item.embedding_model == available_datasets[0].embedding_model for item in available_datasets
            )
            embedding_model_provider_check = all(
                item.embedding_model_provider == available_datasets[0].embedding_model_provider
                for item in available_datasets
            )
            if (
                reranking_enable
                and reranking_mode == "weighted_score"
                and (not embedding_model_check or not embedding_model_provider_check)
            ):
                raise ValueError(
                    "The configured knowledge base list have different embedding model, please set reranking model."
                )
            if reranking_enable and reranking_mode == RerankMode.WEIGHTED_SCORE:
                if weights is not None:
                    weights["vector_setting"]["embedding_provider_name"] = available_datasets[
                        0
                    ].embedding_model_provider
                    weights["vector_setting"]["embedding_model_name"] = available_datasets[0].embedding_model
        dataset_count = len(available_datasets)
        with measure_time() as timer:
            cancel_event = threading.Event()
            thread_exceptions: list[Exception] = []

            if query:
                query_thread = self._thread(
                    target=self._multiple_retrieve_thread_safely,
                    kwargs={
                        "available_datasets": available_datasets,
                        "metadata_condition": metadata_condition,
                        "metadata_filter_document_ids": metadata_filter_document_ids,
                        "all_documents": all_documents,
                        "tenant_id": tenant_id,
                        "reranking_enable": reranking_enable,
                        "reranking_mode": reranking_mode,
                        "reranking_model": reranking_model,
                        "weights": weights,
                        "top_k": top_k,
                        "score_threshold": score_threshold,
                        "query": query,
                        "attachment_id": None,
                        "dataset_count": dataset_count,
                        "cancel_event": cancel_event,
                        "thread_exceptions": thread_exceptions,
                    },
                )
                all_threads.append(query_thread)
                query_thread.start()
            if attachment_ids:
                for attachment_id in attachment_ids:
                    attachment_thread = self._thread(
                        target=self._multiple_retrieve_thread_safely,
                        kwargs={
                            "available_datasets": available_datasets,
                            "metadata_condition": metadata_condition,
                            "metadata_filter_document_ids": metadata_filter_document_ids,
                            "all_documents": all_documents,
                            "tenant_id": tenant_id,
                            "reranking_enable": reranking_enable,
                            "reranking_mode": reranking_mode,
                            "reranking_model": reranking_model,
                            "weights": weights,
                            "top_k": top_k,
                            "score_threshold": score_threshold,
                            "query": None,
                            "attachment_id": attachment_id,
                            "dataset_count": dataset_count,
                            "cancel_event": cancel_event,
                            "thread_exceptions": thread_exceptions,
                        },
                    )
                    all_threads.append(attachment_thread)
                    attachment_thread.start()

            # Poll threads with short timeout to detect errors quickly (fail-fast)
            while any(t.is_alive() for t in all_threads):
                for thread in all_threads:
                    thread.join(timeout=0.1)
                    if thread_exceptions:
                        cancel_event.set()
                        break
                if thread_exceptions:
                    break

            if thread_exceptions:
                raise thread_exceptions[0]
        self._on_query(tenant_id, query, attachment_ids, dataset_ids, app_id, user_from, user_id)

        if all_documents:
            # add thread to call _on_retrieval_end
            retrieval_end_thread = self._thread(
                target=self._on_retrieval_end,
                kwargs={
                    "documents": all_documents,
                    "tenant_id": tenant_id,
                    "message_id": message_id,
                    "timer": timer,
                },
            )
            retrieval_end_thread.start()
        retrieval_resource_list = []
        doc_ids_filter = []
        for document in all_documents:
            if document.provider == "dify":
                doc_id = document.metadata.get("doc_id")
                if doc_id and doc_id not in doc_ids_filter:
                    doc_ids_filter.append(doc_id)
                    retrieval_resource_list.append(document)
            elif document.provider == "external":
                retrieval_resource_list.append(document)
        return retrieval_resource_list

    def _on_retrieval_end(self, documents, tenant_id: str, message_id=None, timer=None):
        self._records.record_hits(tenant_id, documents)
        self._send_trace_task(message_id, documents, timer)

    def _send_trace_task(self, message_id: str | None, documents: list[Document], timer: dict[str, Any] | None):
        """Send trace task if trace manager is available."""
        trace_manager: TraceQueueManager | None = (
            self.application_generate_entity.trace_manager if self.application_generate_entity else None
        )
        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.DATASET_RETRIEVAL_TRACE, message_id=message_id, documents=documents, timer=timer
                )
            )

    @staticmethod
    def _resolve_creator_user_role(user_from: str) -> CreatorUserRole | None:
        """Map runtime user source values to dataset query audit roles.

        Workflow run context uses the hyphenated ``end-user`` value, while
        ``DatasetQuery.created_by_role`` persists the underscore-based
        ``CreatorUserRole.END_USER`` enum. Query logging is a side effect, so an
        unsupported value should be skipped instead of aborting retrieval.
        """
        normalized_user_from = str(user_from).strip().lower().replace("-", "_")
        if normalized_user_from == CreatorUserRole.ACCOUNT.value:
            return CreatorUserRole.ACCOUNT
        if normalized_user_from == CreatorUserRole.END_USER.value:
            return CreatorUserRole.END_USER

        logger.warning("Skipping dataset query audit log for unsupported user_from=%r", user_from)
        return None

    def _on_query(
        self,
        tenant_id: str,
        query: str | None,
        attachment_ids: list[str] | None,
        dataset_ids: list[str],
        app_id: str,
        user_from: str,
        user_id: str,
    ):
        """
        Persist dataset query audit rows for retrieval requests.

        Query audit logging is a side effect of retrieval. Keep it in an
        independent transaction so failures or commits here do not affect the
        request/workflow transaction that called the retriever.
        """
        if not query and not attachment_ids:
            return
        created_by = parse_uuid_str_or_none(user_id)
        if created_by is None:
            logger.debug(
                "Skipping dataset query log: empty created_by user_id (user_from=%s, app_id=%s)",
                user_from,
                app_id,
            )
            return
        created_by_role = self._resolve_creator_user_role(user_from)
        if created_by_role is None:
            return
        self._records.record_queries(
            tenant_id,
            query=query,
            attachment_ids=attachment_ids,
            dataset_ids=dataset_ids,
            app_id=app_id,
            role=created_by_role,
            user_id=created_by,
        )

    def _retriever(
        self,
        tenant_id: str,
        dataset_id: str,
        query: str,
        top_k: int,
        all_documents: list[Document],
        document_ids_filter: list[str] | None = None,
        metadata_condition: MetadataFilteringCondition | None = None,
        attachment_ids: list[str] | None = None,
    ):
        dataset = self._records.dataset(tenant_id, dataset_id)

        if not dataset:
            return []

        if dataset.provider == "external" and query:
            external_documents = self._external_retrieve(
                tenant_id=dataset.tenant_id,
                dataset_id=dataset_id,
                query=query,
                external_retrieval_parameters=dataset.retrieval_model,
                metadata_condition=metadata_condition,
            )
            for external_document in external_documents:
                document = Document(
                    page_content=external_document.get("content"),
                    metadata=external_document.get("metadata"),
                    provider="external",
                )
                if document.metadata is not None:
                    document.metadata["score"] = external_document.get("score")
                    document.metadata["title"] = external_document.get("title")
                    document.metadata["dataset_id"] = dataset_id
                    document.metadata["dataset_name"] = dataset.name
                all_documents.append(document)
        else:
            # get retrieval model , if the model is not setting , using default
            retrieval_model: DefaultRetrievalModelDict = (
                cast(DefaultRetrievalModelDict, dataset.retrieval_model)
                if dataset.retrieval_model
                else default_retrieval_model
            )

            if dataset.indexing_technique == IndexTechniqueType.ECONOMY:
                # use keyword table query
                documents = RetrievalService.retrieve(
                    retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
                    dataset_id=dataset.id,
                    query=query,
                    top_k=top_k,
                    document_ids_filter=document_ids_filter,
                )
                if documents:
                    all_documents.extend(documents)
            else:
                if top_k > 0:
                    # retrieval source
                    documents = RetrievalService.retrieve(
                        retrieval_method=retrieval_model["search_method"],
                        dataset_id=dataset.id,
                        query=query,
                        top_k=retrieval_model.get("top_k") or 4,
                        score_threshold=retrieval_model.get("score_threshold", 0.0)
                        if retrieval_model["score_threshold_enabled"]
                        else 0.0,
                        reranking_model=retrieval_model.get("reranking_model", None)
                        if retrieval_model["reranking_enable"]
                        else None,
                        reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
                        weights=retrieval_model.get("weights", None),
                        document_ids_filter=document_ids_filter,
                        attachment_ids=attachment_ids,
                    )

                    all_documents.extend(documents)

    @trace_span()
    def _run_retriever_thread(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str | None,
        top_k: int,
        all_documents: list[Document],
        document_ids_filter: list[str] | None,
        metadata_condition: MetadataFilteringCondition | None,
        attachment_ids: list[str] | None,
    ) -> None:
        self._retriever(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            query=query or "",
            top_k=top_k,
            all_documents=all_documents,
            document_ids_filter=document_ids_filter,
            metadata_condition=metadata_condition,
            attachment_ids=attachment_ids,
        )

    def _run_retriever_thread_safely(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str | None,
        top_k: int,
        all_documents: list[Document],
        document_ids_filter: list[str] | None,
        metadata_condition: MetadataFilteringCondition | None,
        attachment_ids: list[str] | None,
        cancel_event: threading.Event | None,
        thread_exceptions: list[Exception] | None,
        skip_on_error: bool = False,
    ) -> None:
        """Collect errors after tracing, or skip dataset-level failures when requested."""
        try:
            self._run_retriever_thread(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                query=query,
                top_k=top_k,
                all_documents=all_documents,
                document_ids_filter=document_ids_filter,
                metadata_condition=metadata_condition,
                attachment_ids=attachment_ids,
            )
        except Exception as exc:
            if skip_on_error:
                logger.warning(
                    "Skipping dataset retrieval because retriever failed, dataset_id=%s, error_type=%s, error=%s",
                    dataset_id,
                    type(exc).__name__,
                    str(exc),
                )
                span = get_current_span()
                if span and span.is_recording():
                    span.add_event(
                        "dataset_retrieval.skipped",
                        attributes={
                            "dataset_id": dataset_id,
                            "error.type": type(exc).__name__,
                            "error.message": str(exc),
                        },
                    )
                return

            if cancel_event:
                cancel_event.set()
            if thread_exceptions is not None:
                thread_exceptions.append(exc)

    def retrieve_dataset(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str,
        dataset_id: str,
        query: str,
        config: DatasetRetrieveConfigEntity,
        top_k: int,
        inputs: dict[str, Any],
        invoke_from: InvokeFrom,
        return_resource: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
    ) -> str:
        """Run an Agent dataset tool using the same reads and writes as app retrieval."""
        dataset = self._records.dataset(tenant_id, dataset_id)
        if dataset is None:
            return ""
        document_ids, condition = self.get_metadata_filter_condition(
            [dataset_id],
            query,
            tenant_id,
            user_id,
            config.metadata_filtering_mode or "disabled",
            config.metadata_model_config,
            config.metadata_filtering_conditions,
            inputs,
        )
        documents: list[Document] = []
        self._on_query(
            tenant_id,
            query,
            None,
            [dataset_id],
            app_id,
            "account" if invoke_from.runs_as_account() else "end-user",
            user_id,
        )
        if dataset.provider != "external" and condition and not document_ids:
            return ""
        self._retriever(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            query=query,
            top_k=top_k,
            all_documents=documents,
            document_ids_filter=document_ids.get(dataset_id, []) if document_ids else None,
            metadata_condition=condition,
        )
        self._records.record_hits(tenant_id, documents)
        if dataset.indexing_technique == IndexTechniqueType.ECONOMY and dataset.provider != "external":
            return "\n".join(document.page_content for document in documents)
        context, _ = self._context(
            documents, tenant_id, [dataset_id], return_resource, False, invoke_from, hit_callback
        )
        return context

    def calculate_keyword_score(self, query: str, documents: list[Document], top_k: int) -> list[Document]:
        """
        Calculate keywords scores
        :param query: search query
        :param documents: documents for reranking
        :param top_k: top k

        :return:
        """
        keyword_table_handler = JiebaKeywordTableHandler()
        query_keywords = keyword_table_handler.extract_keywords(query, None)
        documents_keywords = []
        for document in documents:
            if document.metadata is not None:
                # get the document keywords
                document_keywords = keyword_table_handler.extract_keywords(document.page_content, None)
                document.metadata["keywords"] = document_keywords
                documents_keywords.append(document_keywords)

        # Counter query keywords(TF)
        query_keyword_counts = Counter(query_keywords)

        # total documents
        total_documents = len(documents)

        # calculate all documents' keywords IDF
        all_keywords = set()
        for document_keywords in documents_keywords:
            all_keywords.update(document_keywords)

        keyword_idf = {}
        for keyword in all_keywords:
            # calculate include query keywords' documents
            doc_count_containing_keyword = sum(1 for doc_keywords in documents_keywords if keyword in doc_keywords)
            # IDF
            keyword_idf[keyword] = math.log((1 + total_documents) / (1 + doc_count_containing_keyword)) + 1

        query_tfidf = {}

        for keyword, count in query_keyword_counts.items():
            tf = count
            idf = keyword_idf.get(keyword, 0)
            query_tfidf[keyword] = tf * idf

        # calculate all documents' TF-IDF
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
            else:
                return float(numerator) / denominator

        similarities = []
        for document_tfidf in documents_tfidf:
            similarity = cosine_similarity(query_tfidf, document_tfidf)
            similarities.append(similarity)

        for document, score in zip(documents, similarities):
            # format document
            if document.metadata is not None:
                document.metadata["score"] = score
        documents = sorted(documents, key=lambda x: x.metadata.get("score", 0) if x.metadata else 0, reverse=True)
        return documents[:top_k] if top_k else documents

    def calculate_vector_score(
        self, all_documents: list[Document], top_k: int, score_threshold: float
    ) -> list[Document]:
        filter_documents = []
        for document in all_documents:
            if score_threshold is None or (document.metadata and document.metadata.get("score", 0) >= score_threshold):
                filter_documents.append(document)

        if not filter_documents:
            return []
        filter_documents = sorted(
            filter_documents, key=lambda x: x.metadata.get("score", 0) if x.metadata else 0, reverse=True
        )
        return filter_documents[:top_k] if top_k else filter_documents

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def get_metadata_filter_condition(
        self,
        dataset_ids: list[str],
        query: str,
        tenant_id: str,
        user_id: str,
        metadata_filtering_mode: str,
        metadata_model_config: ModelConfig | None,
        metadata_filtering_conditions: MetadataFilteringCondition | None,
        inputs: dict[str, Any],
    ) -> tuple[dict[str, list[str]] | None, MetadataFilteringCondition | None]:
        metadata_condition = None
        if metadata_filtering_mode == "disabled":
            return None, None
        elif metadata_filtering_mode == "automatic":
            automatic_metadata_filters = self._automatic_metadata_filter_func(
                dataset_ids, query, tenant_id, user_id, metadata_model_config
            )
            if automatic_metadata_filters:
                conditions = []
                for filter in automatic_metadata_filters:
                    conditions.append(
                        Condition(
                            name=filter.get("metadata_name"),  # type: ignore
                            comparison_operator=filter.get("condition"),  # type: ignore
                            value=filter.get("value"),
                        )
                    )
                metadata_condition = MetadataFilteringCondition(
                    logical_operator=metadata_filtering_conditions.logical_operator
                    if metadata_filtering_conditions
                    else "or",  # type: ignore
                    conditions=conditions,
                )
        elif metadata_filtering_mode == "manual":
            if metadata_filtering_conditions:
                conditions = []
                for condition in metadata_filtering_conditions.conditions:  # type: ignore
                    metadata_name = condition.name
                    expected_value = condition.value
                    if expected_value is not None and condition.comparison_operator not in ("empty", "not empty"):
                        if isinstance(expected_value, str):
                            expected_value = self._replace_metadata_filter_value(expected_value, inputs)
                    conditions.append(
                        Condition(
                            name=metadata_name,
                            comparison_operator=condition.comparison_operator,
                            value=expected_value,
                        )
                    )
                metadata_condition = MetadataFilteringCondition(
                    logical_operator=metadata_filtering_conditions.logical_operator,
                    conditions=conditions,
                )
        else:
            raise ValueError("Invalid metadata filtering mode")
        return self._records.filter_documents(tenant_id, dataset_ids, metadata_condition), metadata_condition

    def _replace_metadata_filter_value(self, text: str, inputs: dict[str, Any]) -> str:
        if not inputs:
            return text

        def replacer(match):
            key = match.group(1)
            return str(inputs.get(key, f"{{{{{key}}}}}"))

        pattern = re.compile(r"\{\{(\w+)\}\}")
        output = pattern.sub(replacer, text)
        if isinstance(output, str):
            output = re.sub(r"[\r\n\t]+", " ", output).strip()
        return output

    def _automatic_metadata_filter_func(
        self,
        dataset_ids: list[str],
        query: str,
        tenant_id: str,
        user_id: str,
        metadata_model_config: ModelConfig | None,
    ) -> list[dict[str, Any]] | None:
        # get all metadata field
        all_metadata_fields = self._records.metadata_fields(tenant_id, dataset_ids)
        # get metadata model config
        if metadata_model_config is None:
            raise ValueError("metadata_model_config is required")
        # get metadata model instance
        # fetch model config
        model_instance, model_config = self._fetch_model_config(tenant_id, metadata_model_config, user_id=user_id)

        # fetch prompt messages
        prompt_messages, stop = self._get_prompt_template(
            model_config=model_config,
            mode=metadata_model_config.mode,
            metadata_fields=all_metadata_fields,
            query=query or "",
        )

        try:
            # handle invoke result
            invoke_result = cast(
                Generator[LLMResult, None, None],
                model_instance.invoke_llm(
                    prompt_messages=prompt_messages,
                    model_parameters=model_config.parameters,
                    stop=stop,
                    stream=True,
                ),
            )

            # handle invoke result
            result_text, usage = self._handle_invoke_result(invoke_result=invoke_result)
            self._record_usage(usage)

            result_text_json = parse_and_check_json_markdown(result_text, [])
            automatic_metadata_filters = []
            if "metadata_map" in result_text_json:
                metadata_map = result_text_json["metadata_map"]
                for item in metadata_map:
                    if item.get("metadata_field_name") in all_metadata_fields:
                        automatic_metadata_filters.append(
                            {
                                "metadata_name": item.get("metadata_field_name"),
                                "value": item.get("metadata_field_value"),
                                "condition": item.get("comparison_operator"),
                            }
                        )
        except Exception as e:
            logger.warning(e, exc_info=True)
            return None
        return automatic_metadata_filters

    def _fetch_model_config(
        self, tenant_id: str, model: ModelConfig, user_id: str | None = None
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config
        """
        if model is None:
            raise ValueError("single_retrieval_config is required")
        model_name = model.name
        provider_name = model.provider

        model_manager = ModelManager.for_tenant(tenant_id=tenant_id, user_id=user_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id, model_type=ModelType.LLM, provider=provider_name, model=model_name
        )

        provider_model_bundle = model_instance.provider_model_bundle
        model_type_instance = model_instance.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_credentials = model_instance.credentials

        # check model
        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=model_name, model_type=ModelType.LLM
        )

        if provider_model is None:
            raise ValueError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ValueError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ValueError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise ValueError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = model.completion_params.copy()
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = model.mode
        if not model_mode:
            raise ValueError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)

        if not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

        return model_instance, ModelConfigWithCredentialsEntity(
            provider=provider_name,
            model=model_name,
            model_schema=model_schema,
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )

    def _get_prompt_template(
        self, model_config: ModelConfigWithCredentialsEntity, mode: str, metadata_fields: list[str], query: str
    ):
        model_mode = ModelMode(mode)
        input_text = query

        prompt_template: Union[CompletionModelPromptTemplate, list[ChatModelMessage]]
        if model_mode == ModelMode.CHAT:
            prompt_template = []
            system_prompt_messages = ChatModelMessage(role=PromptMessageRole.SYSTEM, text=METADATA_FILTER_SYSTEM_PROMPT)
            prompt_template.append(system_prompt_messages)
            user_prompt_message_1 = ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_1)
            prompt_template.append(user_prompt_message_1)
            assistant_prompt_message_1 = ChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_1
            )
            prompt_template.append(assistant_prompt_message_1)
            user_prompt_message_2 = ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_2)
            prompt_template.append(user_prompt_message_2)
            assistant_prompt_message_2 = ChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_2
            )
            prompt_template.append(assistant_prompt_message_2)
            user_prompt_message_3 = ChatModelMessage(
                role=PromptMessageRole.USER,
                text=METADATA_FILTER_USER_PROMPT_3.format(
                    input_text=input_text,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                ),
            )
            prompt_template.append(user_prompt_message_3)
        elif model_mode == ModelMode.COMPLETION:
            prompt_template = CompletionModelPromptTemplate(
                text=METADATA_FILTER_COMPLETION_PROMPT.format(
                    input_text=input_text,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                )
            )

        else:
            raise ValueError(f"Model mode {model_mode} not support.")

        prompt_transform = AdvancedPromptTransform()
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query=query or "",
            files=[],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config,
        )
        stop = model_config.stop

        return prompt_messages, stop

    def _handle_invoke_result(self, invoke_result: Generator) -> tuple[str, LLMUsage]:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :return:
        """
        model = None
        prompt_messages: list[PromptMessage] = []
        full_text = ""
        usage = None
        for result in invoke_result:
            text = result.delta.message.content
            match text:
                case str():
                    full_text += text
                case list():
                    for i in text:
                        if i.data:
                            full_text += i.data

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = result.prompt_messages

            if not usage and result.delta.usage:
                usage = result.delta.usage

        if not usage:
            usage = LLMUsage.empty_usage()

        return full_text, usage

    @trace_span()
    def _multiple_retrieve_thread(
        self,
        available_datasets: list[Dataset],
        metadata_condition: MetadataFilteringCondition | None,
        metadata_filter_document_ids: dict[str, list[str]] | None,
        all_documents: list[Document],
        tenant_id: str,
        reranking_enable: bool,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None,
        weights: WeightsDict | None,
        top_k: int,
        score_threshold: float,
        query: str | None,
        attachment_id: str | None,
        dataset_count: int,
        cancel_event: threading.Event | None = None,
    ) -> None:
        try:
            threads = []
            retrieval_thread_exceptions: list[Exception] = []
            all_documents_item: list[Document] = []
            index_type = None
            for dataset in available_datasets:
                # Check for cancellation signal
                if cancel_event and cancel_event.is_set():
                    break
                index_type = dataset.indexing_technique
                document_ids_filter = None
                if dataset.provider != "external":
                    if metadata_condition and not metadata_filter_document_ids:
                        continue
                    if metadata_filter_document_ids:
                        document_ids = metadata_filter_document_ids.get(dataset.id, [])
                        if document_ids:
                            document_ids_filter = document_ids
                        else:
                            continue
                retrieval_thread = self._thread(
                    target=self._run_retriever_thread_safely,
                    kwargs={
                        "tenant_id": tenant_id,
                        "dataset_id": dataset.id,
                        "query": query,
                        "top_k": top_k,
                        "all_documents": all_documents_item,
                        "document_ids_filter": document_ids_filter,
                        "metadata_condition": metadata_condition,
                        "attachment_ids": [attachment_id] if attachment_id else None,
                        "cancel_event": cancel_event,
                        "thread_exceptions": retrieval_thread_exceptions,
                        "skip_on_error": True,
                    },
                )
                threads.append(retrieval_thread)
                retrieval_thread.start()

            # Poll threads with short timeout to respond quickly to cancellation
            while any(t.is_alive() for t in threads):
                for thread in threads:
                    thread.join(timeout=0.1)
                    if cancel_event and cancel_event.is_set():
                        break
                if cancel_event and cancel_event.is_set():
                    break

            if retrieval_thread_exceptions:
                raise retrieval_thread_exceptions[0]

            # Skip second reranking when there is only one dataset
            if reranking_enable and dataset_count > 1:
                # do rerank for searched documents
                all_documents_item = self._rerank(
                    tenant_id=tenant_id,
                    reranking_mode=reranking_mode,
                    reranking_model=reranking_model,
                    weights=weights,
                    documents=all_documents_item,
                    query=query,
                    attachment_id=attachment_id,
                    score_threshold=score_threshold,
                    top_k=top_k,
                )
            else:
                if index_type == IndexTechniqueType.ECONOMY:
                    if not query:
                        all_documents_item = []
                    else:
                        all_documents_item = self.calculate_keyword_score(query, all_documents_item, top_k)
                elif index_type == IndexTechniqueType.HIGH_QUALITY:
                    all_documents_item = self.calculate_vector_score(all_documents_item, top_k, score_threshold)
                else:
                    all_documents_item = all_documents_item[:top_k] if top_k else all_documents_item
            if all_documents_item:
                all_documents.extend(all_documents_item)
        except Exception:
            raise

    def _multiple_retrieve_thread_safely(
        self,
        *,
        available_datasets: list[Dataset],
        metadata_condition: MetadataFilteringCondition | None,
        metadata_filter_document_ids: dict[str, list[str]] | None,
        all_documents: list[Document],
        tenant_id: str,
        reranking_enable: bool,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None,
        weights: WeightsDict | None,
        top_k: int,
        score_threshold: float,
        query: str | None,
        attachment_id: str | None,
        dataset_count: int,
        cancel_event: threading.Event | None = None,
        thread_exceptions: list[Exception] | None = None,
    ) -> None:
        """Collect errors only after they pass through the traced multi-retrieval method."""
        try:
            self._multiple_retrieve_thread(
                available_datasets=available_datasets,
                metadata_condition=metadata_condition,
                metadata_filter_document_ids=metadata_filter_document_ids,
                all_documents=all_documents,
                tenant_id=tenant_id,
                reranking_enable=reranking_enable,
                reranking_mode=reranking_mode,
                reranking_model=reranking_model,
                weights=weights,
                top_k=top_k,
                score_threshold=score_threshold,
                query=query,
                attachment_id=attachment_id,
                dataset_count=dataset_count,
                cancel_event=cancel_event,
            )
        except Exception as exc:
            if cancel_event:
                cancel_event.set()
            if thread_exceptions is not None:
                thread_exceptions.append(exc)

    def _check_knowledge_rate_limit(self, tenant_id: str):
        knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(tenant_id)
        if knowledge_rate_limit.enabled:
            current_time = int(time.time() * 1000)
            key = f"rate_limit_{tenant_id}"
            redis_client.zadd(key, {current_time: current_time})
            redis_client.zremrangebyscore(key, 0, current_time - 60000)
            request_count = redis_client.zcard(key)
            if request_count > knowledge_rate_limit.limit:
                # The rejection must not roll back its audit record.
                self._records.record_limit(tenant_id, knowledge_rate_limit.subscription_plan)
                raise exc.RateLimitExceededError(
                    "you have reached the knowledge base request rate limit of your subscription."
                )

    def _external_retrieve(self, *, tenant_id, dataset_id, query, external_retrieval_parameters, metadata_condition):
        request = self._records.external_request(
            tenant_id, dataset_id, query, external_retrieval_parameters, metadata_condition
        )
        return ExternalDatasetService.execute_external_knowledge_retrieval(request)
