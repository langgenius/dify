"""Metadata-filter planning for knowledge retrieval."""

import json
import logging
import re
from collections.abc import Generator, Sequence
from dataclasses import dataclass
from typing import Any, cast

from core.entities.model_entities import ModelStatus
from core.model_manager import ModelInstance, ModelManager
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMUsage
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.nodes.llm.entities import ModelConfig
from libs.json_in_md_parser import parse_and_check_json_markdown
from services.errors.knowledge_retrieval import (
    InvalidModelTypeError,
    ModelCredentialsNotInitializedError,
    ModelNotExistError,
    ModelNotSupportedError,
    ModelQuotaExceededError,
)
from services.knowledge.entities.metadata import Condition, MetadataFilteringCondition
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest
from services.knowledge.retrieval.retrieval import RetrievalRepository
from services.knowledge.retrieval.routing_model import RoutingModelConfig
from services.knowledge.retrieval.template_prompts import (
    METADATA_FILTER_ASSISTANT_PROMPT_1,
    METADATA_FILTER_ASSISTANT_PROMPT_2,
    METADATA_FILTER_COMPLETION_PROMPT,
    METADATA_FILTER_SYSTEM_PROMPT,
    METADATA_FILTER_USER_PROMPT_1,
    METADATA_FILTER_USER_PROMPT_2,
    METADATA_FILTER_USER_PROMPT_3,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class MetadataFilterPlan:
    document_ids: dict[str, list[str]] | None
    condition: MetadataFilteringCondition | None
    usage: LLMUsage


class MetadataFilterPlanner:
    """Resolve manual or model-generated filters, delegating all reads to the repository."""

    def __init__(self, *, repository: RetrievalRepository) -> None:
        self._repository = repository

    def plan(self, *, request: KnowledgeRetrievalRequest, dataset_ids: Sequence[str]) -> MetadataFilterPlan:
        if request.metadata_filtering_mode == "disabled":
            return MetadataFilterPlan(None, None, LLMUsage.empty_usage())
        condition: MetadataFilteringCondition | None = None
        usage = LLMUsage.empty_usage()
        if request.metadata_filtering_mode == "automatic":
            if request.metadata_model_config is None:
                raise ValueError("metadata_model_config is required for this method")
            filters, usage = self._automatic_filters(
                dataset_ids=dataset_ids,
                query=request.query or "",
                tenant_id=request.tenant_id,
                user_id=request.user_id,
                model=request.metadata_model_config,
            )
            if filters:
                condition = MetadataFilteringCondition(
                    logical_operator=(
                        request.metadata_filtering_conditions.logical_operator
                        if request.metadata_filtering_conditions
                        else "or"
                    ),
                    conditions=[
                        Condition(
                            name=cast(str, item.get("metadata_name")),
                            comparison_operator=cast(Any, item.get("condition")),
                            value=item.get("value"),
                        )
                        for item in filters
                    ],
                )
        elif request.metadata_filtering_mode == "manual":
            configured = request.metadata_filtering_conditions
            if configured:
                conditions: list[Condition] = []
                for item in configured.conditions or []:
                    value = item.value
                    if isinstance(value, str) and item.comparison_operator not in ("empty", "not empty"):
                        value = self._replace_value(value, request.metadata_inputs)
                    conditions.append(
                        Condition(name=item.name, comparison_operator=item.comparison_operator, value=value)
                    )
                condition = MetadataFilteringCondition(
                    logical_operator=configured.logical_operator,
                    conditions=conditions,
                )
        else:
            raise ValueError("Invalid metadata filtering mode")

        document_ids = self._repository.filter_document_ids(
            tenant_id=request.tenant_id,
            dataset_ids=dataset_ids,
            logical_operator=(condition.logical_operator or "and") if condition else "and",
            conditions=condition.conditions if condition else None,
        )
        return MetadataFilterPlan(document_ids or None, condition, usage)

    @staticmethod
    def _replace_value(text: str, inputs: dict[str, str]) -> str:
        if not inputs:
            return text

        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            return str(inputs.get(key, f"{{{{{key}}}}}"))

        return re.sub(r"[\r\n\t]+", " ", re.sub(r"\{\{(\w+)\}\}", replace, text)).strip()

    def _automatic_filters(
        self,
        *,
        dataset_ids: Sequence[str],
        query: str,
        tenant_id: str,
        user_id: str,
        model: ModelConfig,
    ) -> tuple[list[dict[str, Any]] | None, LLMUsage]:
        fields = self._repository.list_metadata_field_names(tenant_id=tenant_id, dataset_ids=dataset_ids)
        model_instance, model_config = self._fetch_model_config(tenant_id, model, user_id=user_id)
        prompt_messages, stop = self._prompt(
            model_config=model_config,
            mode=model_config.mode,
            metadata_fields=fields,
            query=query,
        )
        usage = LLMUsage.empty_usage()
        try:
            result = cast(
                Generator[LLMResultChunk],
                model_instance.invoke_llm(
                    prompt_messages=prompt_messages,
                    model_parameters=model_config.parameters,
                    stop=stop,
                    stream=True,
                ),
            )
            text, usage = self._invoke_result(result)
            value = parse_and_check_json_markdown(text, [])
            filters = [
                {
                    "metadata_name": item.get("metadata_field_name"),
                    "value": item.get("metadata_field_value"),
                    "condition": item.get("comparison_operator"),
                }
                for item in value.get("metadata_map", [])
                if item.get("metadata_field_name") in fields
            ]
            return filters, usage
        except Exception as error:
            logger.warning(error, exc_info=True)
            return None, usage

    @staticmethod
    def _fetch_model_config(
        tenant_id: str, model: ModelConfig, *, user_id: str
    ) -> tuple[ModelInstance, RoutingModelConfig]:
        model_instance = ModelManager.for_tenant(tenant_id=tenant_id, user_id=user_id).get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model.provider,
            model=model.name,
        )
        model_type_instance = cast(LargeLanguageModel, model_instance.model_type_instance)
        provider_model = model_instance.provider_model_bundle.configuration.get_provider_model(
            model=model.name, model_type=ModelType.LLM
        )
        if provider_model is None:
            raise ModelNotExistError(f"Model {model.name} not exist.")
        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ModelCredentialsNotInitializedError(f"Model {model.name} credentials is not initialized.")
        if provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelNotSupportedError(f"Dify Hosted OpenAI {model.name} currently not support.")
        if provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise ModelQuotaExceededError(f"Model provider {model.provider} quota exceeded.")

        completion_params = model.completion_params.copy()
        raw_stop = completion_params.pop("stop", [])
        stop = (
            [raw_stop]
            if isinstance(raw_stop, str)
            else [str(item) for item in raw_stop]
            if isinstance(raw_stop, list)
            else []
        )
        if not model.mode:
            raise InvalidModelTypeError("LLM mode is required.")
        if not model_type_instance.get_model_schema(model.name, model_instance.credentials):
            raise ModelNotExistError(f"Model {model.name} not exist.")
        return model_instance, RoutingModelConfig(mode=str(model.mode), parameters=completion_params, stop=stop)

    @staticmethod
    def _prompt(
        *, model_config: RoutingModelConfig, mode: str, metadata_fields: list[str], query: str
    ) -> tuple[list[PromptMessage], list[str]]:
        try:
            model_mode = ModelMode(mode)
        except ValueError as error:
            raise InvalidModelTypeError(f"Model mode {mode} not support.") from error
        if model_mode == ModelMode.CHAT:
            prompt_template: CompletionModelPromptTemplate | list[ChatModelMessage] = [
                ChatModelMessage(role=PromptMessageRole.SYSTEM, text=METADATA_FILTER_SYSTEM_PROMPT),
                ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_1),
                ChatModelMessage(role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_1),
                ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_2),
                ChatModelMessage(role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_2),
                ChatModelMessage(
                    role=PromptMessageRole.USER,
                    text=METADATA_FILTER_USER_PROMPT_3.format(
                        input_text=query,
                        metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                    ),
                ),
            ]
        elif model_mode == ModelMode.COMPLETION:
            prompt_template = CompletionModelPromptTemplate(
                text=METADATA_FILTER_COMPLETION_PROMPT.format(
                    input_text=query,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                )
            )
        else:
            raise InvalidModelTypeError(f"Model mode {model_mode} not support.")
        messages = AdvancedPromptTransform().get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query=query,
            files=[],
            context=None,
            memory_config=None,
            memory=None,
        )
        return messages, model_config.stop

    @staticmethod
    def _invoke_result(invoke_result: Generator[LLMResultChunk]) -> tuple[str, LLMUsage]:
        text = ""
        usage: LLMUsage | None = None
        for result in invoke_result:
            content = result.delta.message.content
            if isinstance(content, str):
                text += content
            elif isinstance(content, list):
                text += "".join(item.data for item in content if item.data)
            if usage is None and result.delta.usage:
                usage = result.delta.usage
        return text, usage or LLMUsage.empty_usage()
