import json
import logging
import re
import time
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, cast

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.simple_prompt_transform import ModelMode
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.entities.metadata_entities import Condition, MetadataCondition
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.variables import (
    ArrayFileSegment,
    FileSegment,
    StringSegment,
)
from core.variables.segments import ArrayObjectSegment
from core.workflow.entities import GraphInitParams
from core.workflow.enums import (
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import ModelInvokeCompletedEvent, NodeRunResult
from core.workflow.nodes.base import LLMUsageTrackingMixin
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.knowledge_retrieval.template_prompts import (
    METADATA_FILTER_ASSISTANT_PROMPT_1,
    METADATA_FILTER_ASSISTANT_PROMPT_2,
    METADATA_FILTER_COMPLETION_PROMPT,
    METADATA_FILTER_SYSTEM_PROMPT,
    METADATA_FILTER_USER_PROMPT_1,
    METADATA_FILTER_USER_PROMPT_2,
    METADATA_FILTER_USER_PROMPT_3,
)
from core.workflow.nodes.llm.entities import LLMNodeChatModelMessage, LLMNodeCompletionModelPromptTemplate, ModelConfig
from core.workflow.nodes.llm.file_saver import FileSaverImpl, LLMFileSaver
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.repositories.knowledge_repository import KnowledgeRepository
from extensions.ext_redis import redis_client
from libs.json_in_md_parser import parse_and_check_json_markdown
from services.feature_service import FeatureService

from .entities import KnowledgeRetrievalNodeData
from .exc import (
    InvalidModelTypeError,
    KnowledgeRetrievalNodeError,
    ModelCredentialsNotInitializedError,
    ModelNotExistError,
    ModelNotSupportedError,
    ModelQuotaExceededError,
)

if TYPE_CHECKING:
    from core.file.models import File
    from core.workflow.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class KnowledgeRetrievalNode(LLMUsageTrackingMixin, Node[KnowledgeRetrievalNodeData]):
    node_type = NodeType.KNOWLEDGE_RETRIEVAL

    # Instance attributes specific to LLMNode.
    # Output variable for file
    _file_outputs: list["File"]

    _llm_file_saver: LLMFileSaver

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        *,
        llm_file_saver: LLMFileSaver | None = None,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        # LLM file outputs, used for MultiModal outputs.
        self._file_outputs = []

        if llm_file_saver is None:
            llm_file_saver = FileSaverImpl(
                user_id=graph_init_params.user_id,
                tenant_id=graph_init_params.tenant_id,
            )
        self._llm_file_saver = llm_file_saver

    @classmethod
    def version(cls):
        return "1"

    def _get_knowledge_repo(self) -> KnowledgeRepository:
        repositories = self.graph_init_params.repositories
        if repositories is None:
            raise KnowledgeRetrievalNodeError("Knowledge repository is not configured.")
        return repositories.knowledge_repo

    def _close_repository_session(self) -> None:
        repositories = self.graph_init_params.repositories
        if repositories is None:
            return
        try:
            repositories.knowledge_repo.close_session()
        except Exception:
            logger.exception("Failed to close knowledge repository session")

    def _run(self) -> NodeRunResult:
        if not self._node_data.query_variable_selector and not self._node_data.query_attachment_selector:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                process_data={},
                outputs={},
                metadata={},
                llm_usage=LLMUsage.empty_usage(),
            )
        variables: dict[str, Any] = {}
        # extract variables
        if self._node_data.query_variable_selector:
            variable = self.graph_runtime_state.variable_pool.get(self._node_data.query_variable_selector)
            if not isinstance(variable, StringSegment):
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error="Query variable is not string type.",
                )
            query = variable.value
            variables["query"] = query

        if self._node_data.query_attachment_selector:
            variable = self.graph_runtime_state.variable_pool.get(self._node_data.query_attachment_selector)
            if not isinstance(variable, ArrayFileSegment) and not isinstance(variable, FileSegment):
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error="Attachments variable is not array file or file type.",
                )
            if isinstance(variable, ArrayFileSegment):
                variables["attachments"] = variable.value
            else:
                variables["attachments"] = [variable.value]

        knowledge_repo = self._get_knowledge_repo()

        # TODO(-LAN-): Move this check outside.
        # check rate limit
        knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(self.tenant_id)
        if knowledge_rate_limit.enabled:
            current_time = int(time.time() * 1000)
            key = f"rate_limit_{self.tenant_id}"
            redis_client.zadd(key, {current_time: current_time})
            redis_client.zremrangebyscore(key, 0, current_time - 60000)
            request_count = redis_client.zcard(key)
            if request_count > knowledge_rate_limit.limit:
                # add ratelimit record
                try:
                    knowledge_repo.add_rate_limit_log(
                        tenant_id=self.tenant_id,
                        subscription_plan=knowledge_rate_limit.subscription_plan,
                        operation="knowledge",
                    )
                except Exception:
                    logger.exception(
                        "Failed to record knowledge rate limit log for tenant_id=%s",
                        self.tenant_id,
                    )
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=variables,
                    error="Sorry, you have reached the knowledge base request rate limit of your subscription.",
                    error_type="RateLimitExceeded",
                )

        # retrieve knowledge
        usage = LLMUsage.empty_usage()
        try:
            results, usage = self._fetch_dataset_retriever(node_data=self._node_data, variables=variables)
            outputs = {"result": ArrayObjectSegment(value=results)}
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=variables,
                process_data={"usage": jsonable_encoder(usage)},
                outputs=outputs,  # type: ignore
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
            )

        except KnowledgeRetrievalNodeError as e:
            logger.warning("Knowledge retrieval failed: %s", e, exc_info=True)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
                llm_usage=usage,
            )
        # Temporary handle all exceptions from DatasetRetrieval class here.
        except Exception as e:
            logger.exception("Unhandled error when running knowledge retrieval node")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
                llm_usage=usage,
            )
        finally:
            self._close_repository_session()

    def _fetch_dataset_retriever(
        self, node_data: KnowledgeRetrievalNodeData, variables: dict[str, Any]
    ) -> tuple[list[dict[str, Any]], LLMUsage]:
        usage = LLMUsage.empty_usage()
        available_datasets = []
        knowledge_repo = self._get_knowledge_repo()
        dataset_ids = node_data.dataset_ids
        query = variables.get("query")
        attachments = variables.get("attachments")
        metadata_filter_document_ids = None
        metadata_condition = None
        metadata_usage = LLMUsage.empty_usage()
        # Subquery: Count the number of available documents for each dataset
        results = knowledge_repo.get_datasets_with_available_documents(self.tenant_id, dataset_ids)

        for dataset in results:
            # pass if dataset is not available
            if not dataset:
                continue
            available_datasets.append(dataset)
        if query:
            metadata_filter_document_ids, metadata_condition, metadata_usage = self._get_metadata_filter_condition(
                [dataset.id for dataset in available_datasets], query, node_data
            )
            usage = self._merge_usage(usage, metadata_usage)
        all_documents = []
        dataset_retrieval = DatasetRetrieval()
        if str(node_data.retrieval_mode) == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE and query:
            # fetch model config
            if node_data.single_retrieval_config is None:
                raise ValueError("single_retrieval_config is required")
            model_instance, model_config = self.get_model_config(node_data.single_retrieval_config.model)
            # check model is support tool calling
            model_type_instance = model_config.provider_model_bundle.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)
            # get model schema
            model_schema = model_type_instance.get_model_schema(
                model=model_config.model, credentials=model_config.credentials
            )

            if model_schema:
                planning_strategy = PlanningStrategy.REACT_ROUTER
                features = model_schema.features
                if features:
                    if ModelFeature.TOOL_CALL in features or ModelFeature.MULTI_TOOL_CALL in features:
                        planning_strategy = PlanningStrategy.ROUTER
                all_documents = dataset_retrieval.single_retrieve(
                    available_datasets=available_datasets,
                    tenant_id=self.tenant_id,
                    user_id=self.user_id,
                    app_id=self.app_id,
                    user_from=self.user_from.value,
                    query=query,
                    model_config=model_config,
                    model_instance=model_instance,
                    planning_strategy=planning_strategy,
                    metadata_filter_document_ids=metadata_filter_document_ids,
                    metadata_condition=metadata_condition,
                )
        elif str(node_data.retrieval_mode) == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            if node_data.multiple_retrieval_config is None:
                raise ValueError("multiple_retrieval_config is required")
            match node_data.multiple_retrieval_config.reranking_mode:
                case "reranking_model":
                    if node_data.multiple_retrieval_config.reranking_model:
                        reranking_model = {
                            "reranking_provider_name": node_data.multiple_retrieval_config.reranking_model.provider,
                            "reranking_model_name": node_data.multiple_retrieval_config.reranking_model.model,
                        }
                    else:
                        reranking_model = None
                    weights = None
                case "weighted_score":
                    if node_data.multiple_retrieval_config.weights is None:
                        raise ValueError("weights is required")
                    reranking_model = None
                    vector_setting = node_data.multiple_retrieval_config.weights.vector_setting
                    weights = {
                        "vector_setting": {
                            "vector_weight": vector_setting.vector_weight,
                            "embedding_provider_name": vector_setting.embedding_provider_name,
                            "embedding_model_name": vector_setting.embedding_model_name,
                        },
                        "keyword_setting": {
                            "keyword_weight": node_data.multiple_retrieval_config.weights.keyword_setting.keyword_weight
                        },
                    }
                case _:
                    reranking_model = None
                    weights = None
            all_documents = dataset_retrieval.multiple_retrieve(
                app_id=self.app_id,
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                user_from=self.user_from.value,
                available_datasets=available_datasets,
                query=query,
                top_k=node_data.multiple_retrieval_config.top_k,
                score_threshold=node_data.multiple_retrieval_config.score_threshold
                if node_data.multiple_retrieval_config.score_threshold is not None
                else 0.0,
                reranking_mode=node_data.multiple_retrieval_config.reranking_mode,
                reranking_model=reranking_model,
                weights=weights,
                reranking_enable=node_data.multiple_retrieval_config.reranking_enable,
                metadata_filter_document_ids=metadata_filter_document_ids,
                metadata_condition=metadata_condition,
                attachment_ids=[attachment.related_id for attachment in attachments] if attachments else None,
            )
        usage = self._merge_usage(usage, dataset_retrieval.llm_usage)

        dify_documents = [item for item in all_documents if item.provider == "dify"]
        external_documents = [item for item in all_documents if item.provider == "external"]
        retrieval_resource_list = []
        # deal with external documents
        for item in external_documents:
            source: dict[str, dict[str, str | Any | dict[Any, Any] | None] | Any | str | None] = {
                "metadata": {
                    "_source": "knowledge",
                    "dataset_id": item.metadata.get("dataset_id"),
                    "dataset_name": item.metadata.get("dataset_name"),
                    "document_id": item.metadata.get("document_id") or item.metadata.get("title"),
                    "document_name": item.metadata.get("title"),
                    "data_source_type": "external",
                    "retriever_from": "workflow",
                    "score": item.metadata.get("score"),
                    "doc_metadata": item.metadata,
                },
                "title": item.metadata.get("title"),
                "content": item.page_content,
            }
            retrieval_resource_list.append(source)
        # deal with dify documents
        if dify_documents:
            records = RetrievalService.format_retrieval_documents(dify_documents)
            if records:
                for record in records:
                    segment = record.segment
                    dataset_entity = knowledge_repo.get_dataset(self.tenant_id, segment.dataset_id)
                    document_entity = knowledge_repo.get_document(self.tenant_id, segment.document_id)
                    if dataset_entity and document_entity:
                        source = {
                            "metadata": {
                                "_source": "knowledge",
                                "dataset_id": dataset_entity.id,
                                "dataset_name": dataset_entity.name,
                                "document_id": document_entity.id,
                                "document_name": document_entity.name,
                                "data_source_type": document_entity.data_source_type,
                                "segment_id": segment.id,
                                "retriever_from": "workflow",
                                "score": record.score or 0.0,
                                "child_chunks": [
                                    {
                                        "id": str(getattr(chunk, "id", "")),
                                        "content": str(getattr(chunk, "content", "")),
                                        "position": int(getattr(chunk, "position", 0)),
                                        "score": float(getattr(chunk, "score", 0.0)),
                                    }
                                    for chunk in (record.child_chunks or [])
                                ],
                                "segment_hit_count": segment.hit_count,
                                "segment_word_count": segment.word_count,
                                "segment_position": segment.position,
                                "segment_index_node_hash": segment.index_node_hash,
                                "doc_metadata": document_entity.doc_metadata,
                            },
                            "title": document_entity.name,
                            "files": list(record.files) if record.files else None,
                        }
                        if segment.answer:
                            source["content"] = f"question:{segment.get_sign_content()} \nanswer:{segment.answer}"
                        else:
                            source["content"] = segment.get_sign_content()
                        # Add summary if available
                        if record.summary:
                            source["summary"] = record.summary
                        retrieval_resource_list.append(source)
        if retrieval_resource_list:
            retrieval_resource_list = sorted(
                retrieval_resource_list,
                key=self._score,  # type: ignore[arg-type, return-value]
                reverse=True,
            )
            for position, item in enumerate(retrieval_resource_list, start=1):
                item["metadata"]["position"] = position  # type: ignore[index]
        return retrieval_resource_list, usage

    def _score(self, item: dict[str, Any]) -> float:
        meta = item.get("metadata")
        if isinstance(meta, dict):
            s = meta.get("score")
            if isinstance(s, (int, float)):
                return float(s)
        return 0.0

    def _get_metadata_filter_condition(
        self, dataset_ids: list, query: str, node_data: KnowledgeRetrievalNodeData
    ) -> tuple[dict[str, list[str]] | None, MetadataCondition | None, LLMUsage]:
        usage = LLMUsage.empty_usage()
        # filters logic removed
        metadata_condition = None
        match node_data.metadata_filtering_mode:
            case "disabled":
                return None, None, usage
            case "automatic":
                automatic_metadata_filters, automatic_usage = self._automatic_metadata_filter_func(
                    dataset_ids, query, node_data
                )
                usage = self._merge_usage(usage, automatic_usage)
                if automatic_metadata_filters:
                    conditions = []
                    for filter_item in automatic_metadata_filters:
                        conditions.append(
                            Condition(
                                name=filter_item.get("metadata_name"),  # type: ignore
                                comparison_operator=filter_item.get("condition"),  # type: ignore
                                value=filter_item.get("value"),
                            )
                        )
                    metadata_condition = MetadataCondition(
                        logical_operator=node_data.metadata_filtering_conditions.logical_operator
                        if node_data.metadata_filtering_conditions
                        else "or",
                        conditions=conditions,
                    )
            case "manual":
                if node_data.metadata_filtering_conditions:
                    conditions = []
                    for condition in node_data.metadata_filtering_conditions.conditions:  # type: ignore
                        metadata_name = condition.name
                        expected_value = condition.value
                        if expected_value is not None and condition.comparison_operator not in ("empty", "not empty"):
                            if isinstance(expected_value, str):
                                expected_value = self.graph_runtime_state.variable_pool.convert_template(
                                    expected_value
                                ).value[0]
                                if expected_value.value_type in {"number", "integer", "float"}:
                                    expected_value = expected_value.value
                                elif expected_value.value_type == "string":
                                    expected_value = re.sub(r"[\r\n\t]+", " ", expected_value.text).strip()
                                else:
                                    raise ValueError("Invalid expected metadata value type")
                        conditions.append(
                            Condition(
                                name=metadata_name,
                                comparison_operator=condition.comparison_operator,
                                value=expected_value,
                            )
                        )
                    metadata_condition = MetadataCondition(
                        logical_operator=node_data.metadata_filtering_conditions.logical_operator,
                        conditions=conditions,
                    )
            case _:
                raise ValueError("Invalid metadata filtering mode")
        knowledge_repo = self._get_knowledge_repo()
        metadata_filter_document_ids = knowledge_repo.get_document_ids_by_filtering(
            self.tenant_id,
            dataset_ids,
            metadata_condition,
        )
        return metadata_filter_document_ids, metadata_condition, usage

    def _automatic_metadata_filter_func(
        self, dataset_ids: list, query: str, node_data: KnowledgeRetrievalNodeData
    ) -> tuple[list[dict[str, Any]], LLMUsage]:
        usage = LLMUsage.empty_usage()
        # get all metadata field
        knowledge_repo = self._get_knowledge_repo()
        metadata_fields = knowledge_repo.get_metadata_fields(self.tenant_id, dataset_ids)
        all_metadata_fields = [metadata_field.name for metadata_field in metadata_fields]
        if node_data.metadata_model_config is None:
            raise ValueError("metadata_model_config is required")
        # get metadata model instance and fetch model config
        model_instance, model_config = self.get_model_config(node_data.metadata_model_config)
        # fetch prompt messages
        prompt_template = self._get_prompt_template(
            node_data=node_data,
            metadata_fields=all_metadata_fields,
            query=query or "",
        )
        prompt_messages, stop = LLMNode.fetch_prompt_messages(
            prompt_template=prompt_template,
            sys_query=query,
            memory=None,
            model_config=model_config,
            sys_files=[],
            vision_enabled=node_data.vision.enabled,
            vision_detail=node_data.vision.configs.detail,
            variable_pool=self.graph_runtime_state.variable_pool,
            jinja2_variables=[],
            tenant_id=self.tenant_id,
        )

        result_text = ""
        try:
            # handle invoke result
            generator = LLMNode.invoke_llm(
                node_data_model=node_data.metadata_model_config,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                stop=stop,
                user_id=self.user_id,
                structured_output_enabled=self.node_data.structured_output_enabled,
                structured_output=None,
                file_saver=self._llm_file_saver,
                file_outputs=self._file_outputs,
                node_id=self._node_id,
                node_type=self.node_type,
            )

            for event in generator:
                if isinstance(event, ModelInvokeCompletedEvent):
                    result_text = event.text
                    usage = self._merge_usage(usage, event.usage)
                    break

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
        except Exception:
            return [], usage
        return automatic_metadata_filters, usage

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # graph_config is not used in this node type
        # Create typed NodeData from dict
        typed_node_data = KnowledgeRetrievalNodeData.model_validate(node_data)

        variable_mapping = {}
        if typed_node_data.query_variable_selector:
            variable_mapping[node_id + ".query"] = typed_node_data.query_variable_selector
        if typed_node_data.query_attachment_selector:
            variable_mapping[node_id + ".queryAttachment"] = typed_node_data.query_attachment_selector
        return variable_mapping

    def get_model_config(self, model: ModelConfig) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        model_name = model.name
        provider_name = model.provider

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id, model_type=ModelType.LLM, provider=provider_name, model=model_name
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
            raise ModelNotExistError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ModelCredentialsNotInitializedError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelNotSupportedError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise ModelQuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = model.completion_params
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = model.mode
        if not model_mode:
            raise ModelNotExistError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)

        if not model_schema:
            raise ModelNotExistError(f"Model {model_name} not exist.")

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

    def _get_prompt_template(self, node_data: KnowledgeRetrievalNodeData, metadata_fields: list, query: str):
        model_mode = ModelMode(node_data.metadata_model_config.mode)  # type: ignore
        input_text = query

        prompt_messages: list[LLMNodeChatModelMessage] = []
        if model_mode == ModelMode.CHAT:
            system_prompt_messages = LLMNodeChatModelMessage(
                role=PromptMessageRole.SYSTEM, text=METADATA_FILTER_SYSTEM_PROMPT
            )
            prompt_messages.append(system_prompt_messages)
            user_prompt_message_1 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_1
            )
            prompt_messages.append(user_prompt_message_1)
            assistant_prompt_message_1 = LLMNodeChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_1
            )
            prompt_messages.append(assistant_prompt_message_1)
            user_prompt_message_2 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_2
            )
            prompt_messages.append(user_prompt_message_2)
            assistant_prompt_message_2 = LLMNodeChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_2
            )
            prompt_messages.append(assistant_prompt_message_2)
            user_prompt_message_3 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER,
                text=METADATA_FILTER_USER_PROMPT_3.format(
                    input_text=input_text,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                ),
            )
            prompt_messages.append(user_prompt_message_3)
            return prompt_messages
        elif model_mode == ModelMode.COMPLETION:
            return LLMNodeCompletionModelPromptTemplate(
                text=METADATA_FILTER_COMPLETION_PROMPT.format(
                    input_text=input_text,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                )
            )

        else:
            raise InvalidModelTypeError(f"Model mode {model_mode} not support.")
