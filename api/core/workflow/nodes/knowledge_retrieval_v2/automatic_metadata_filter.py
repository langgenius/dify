"""LLM-driven custom metadata condition extraction for the KnowledgeFS retrieval node.

Mirrors the legacy Knowledge Retrieval node's automatic metadata filtering: the query is
shown to an LLM together with the metadata catalog of the selected Spaces, and the returned
``metadata_map`` is turned into typed KnowledgeFS custom metadata conditions.
"""

from __future__ import annotations

import json
import logging
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import ValidationError

from core.app.entities.app_invoke_entities import DifyRunContext, ModelConfigWithCredentialsEntity
from core.app.llm.model_access import DifyModelFactory, fetch_model_config
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.rag.retrieval.template_prompts import (
    METADATA_FILTER_ASSISTANT_PROMPT_1,
    METADATA_FILTER_ASSISTANT_PROMPT_2,
    METADATA_FILTER_COMPLETION_PROMPT,
    METADATA_FILTER_SYSTEM_PROMPT,
    METADATA_FILTER_USER_PROMPT_1,
    METADATA_FILTER_USER_PROMPT_2,
    METADATA_FILTER_USER_PROMPT_3,
)
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
)
from graphon.nodes.llm.entities import ModelConfig
from graphon.nodes.llm.protocols import CredentialsProvider
from libs.json_in_md_parser import parse_and_check_json_markdown
from services.knowledge_fs.product_dto import (
    KnowledgeFSMetadataFieldResponse,
    KnowledgeFSRetrievalCustomMetadataCondition,
)

from .exc import KnowledgeFSRetrievalConfigurationError

logger = logging.getLogger(__name__)

MetadataFieldType = Literal["string", "number", "time"]

# The extraction prompt is shared with the legacy node and lets the model answer with generic
# operators ("=", ">=", ...). KnowledgeFS validates operators per field type, so every
# extracted operator is normalised to the vocabulary of the catalog field it targets.
_OPERATOR_ALIASES: Mapping[MetadataFieldType, Mapping[str, str]] = {
    "number": {
        "=": "=",
        "==": "=",
        "is": "=",
        "≠": "≠",
        "!=": "≠",
        "is not": "≠",
        ">": ">",
        "<": "<",
        "≥": "≥",
        ">=": "≥",
        "≤": "≤",
        "<=": "≤",
        "empty": "empty",
        "not empty": "not empty",
    },
    "string": {
        "contains": "contains",
        "not contains": "not contains",
        "start with": "start with",
        "end with": "end with",
        "is": "is",
        "=": "is",
        "==": "is",
        "is not": "is not",
        "≠": "is not",
        "!=": "is not",
        "empty": "empty",
        "not empty": "not empty",
        "in": "in",
        "not in": "not in",
    },
    "time": {
        "is": "is",
        "=": "is",
        "==": "is",
        "before": "before",
        "<": "before",
        "≤": "before",
        "<=": "before",
        "after": "after",
        ">": "after",
        "≥": "after",
        ">=": "after",
        "empty": "empty",
        "not empty": "not empty",
    },
}


@dataclass(frozen=True)
class KnowledgeFSMetadataFieldRef:
    name: str
    type: MetadataFieldType


@dataclass(frozen=True)
class KnowledgeFSMetadataExtraction:
    """Raw LLM extraction output plus the usage it cost."""

    metadata_map: list[Mapping[str, Any]]
    usage: LLMUsage
    model: str
    provider: str


@dataclass(frozen=True)
class KnowledgeFSAutomaticMetadataFilterOutcome:
    conditions: list[KnowledgeFSRetrievalCustomMetadataCondition]
    usage: LLMUsage
    applied: bool
    reason: str | None = None
    field_names: list[str] = field(default_factory=list)
    extracted_count: int = 0
    model: str | None = None
    provider: str | None = None

    def as_metrics(self) -> dict[str, Any]:
        metrics: dict[str, Any] = {
            "applied": self.applied,
            "condition_count": len(self.conditions),
            "extracted_count": self.extracted_count,
            "field_names": list(self.field_names),
            "mode": "automatic",
        }
        if self.reason is not None:
            metrics["reason"] = self.reason
        if self.model is not None:
            metrics["model"] = self.model
        if self.provider is not None:
            metrics["provider"] = self.provider
        return metrics


class KnowledgeFSMetadataFilterExtractor(Protocol):
    def extract(
        self,
        *,
        run_context: DifyRunContext,
        model_config: ModelConfig,
        query: str,
        field_names: Sequence[str],
    ) -> KnowledgeFSMetadataExtraction: ...


def intersect_metadata_fields(
    catalogs: Sequence[Sequence[KnowledgeFSMetadataFieldResponse]],
) -> list[KnowledgeFSMetadataFieldRef]:
    """Keep fields that every selected Space declares with the same name and type.

    This mirrors the editor's catalog intersection so the LLM only sees fields the shared
    retrieval payload can legally filter on in every Space.
    """

    if not catalogs:
        return []
    first, *rest = catalogs
    remaining_types = [{item.name: item.type for item in group} for group in rest]
    fields: list[KnowledgeFSMetadataFieldRef] = []
    seen: set[str] = set()
    for item in first:
        if item.name in seen:
            continue
        if all(types.get(item.name) == item.type for types in remaining_types):
            seen.add(item.name)
            fields.append(KnowledgeFSMetadataFieldRef(name=item.name, type=item.type))
    return fields


def build_metadata_filter_prompt(
    *,
    model_config: ModelConfigWithCredentialsEntity,
    mode: str,
    field_names: Sequence[str],
    query: str,
) -> tuple[list[PromptMessage], list[str]]:
    model_mode = ModelMode(mode)
    metadata_fields = json.dumps(list(field_names), ensure_ascii=False)

    prompt_template: list[ChatModelMessage] | CompletionModelPromptTemplate
    if model_mode == ModelMode.CHAT:
        prompt_template = [
            ChatModelMessage(role=PromptMessageRole.SYSTEM, text=METADATA_FILTER_SYSTEM_PROMPT),
            ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_1),
            ChatModelMessage(role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_1),
            ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_2),
            ChatModelMessage(role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_2),
            ChatModelMessage(
                role=PromptMessageRole.USER,
                text=METADATA_FILTER_USER_PROMPT_3.format(input_text=query, metadata_fields=metadata_fields),
            ),
        ]
    elif model_mode == ModelMode.COMPLETION:
        prompt_template = CompletionModelPromptTemplate(
            text=METADATA_FILTER_COMPLETION_PROMPT.format(input_text=query, metadata_fields=metadata_fields)
        )
    else:
        raise ValueError(f"Model mode {model_mode} not support.")

    prompt_messages = AdvancedPromptTransform().get_prompt(
        prompt_template=prompt_template,
        inputs={},
        query=query,
        files=[],
        context=None,
        memory_config=None,
        memory=None,
        model_config=model_config,
    )
    return prompt_messages, list(model_config.stop)


def llm_result_text(result: LLMResult) -> str:
    content = result.message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(item.data for item in content if isinstance(item, TextPromptMessageContent))
    return ""


def parse_metadata_map(text: str) -> list[Mapping[str, Any]]:
    parsed = parse_and_check_json_markdown(text, [])
    if not isinstance(parsed, Mapping):
        return []
    metadata_map = parsed.get("metadata_map")
    if not isinstance(metadata_map, list):
        return []
    return [item for item in metadata_map if isinstance(item, Mapping)]


def _coerce_value(field_type: MetadataFieldType, value: object) -> str | int | float | None:
    if value is None or isinstance(value, bool):
        return None
    if field_type == "number":
        if isinstance(value, (int, float)):
            return value
        text = str(value).strip()
        try:
            return int(text)
        except ValueError:
            pass
        try:
            number = float(text)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    if field_type == "time":
        if isinstance(value, (int, float)):
            return value
        return str(value).strip()
    return value if isinstance(value, str) else str(value)


def to_custom_metadata_conditions(
    metadata_map: Sequence[Mapping[str, Any]],
    catalog: Sequence[KnowledgeFSMetadataFieldRef],
) -> list[KnowledgeFSRetrievalCustomMetadataCondition]:
    """Convert LLM output into KnowledgeFS conditions, dropping anything outside the catalog contract."""

    field_types = {item.name: item.type for item in catalog}
    conditions: list[KnowledgeFSRetrievalCustomMetadataCondition] = []
    for item in metadata_map:
        raw_name = item.get("metadata_field_name")
        raw_operator = item.get("comparison_operator")
        if not isinstance(raw_name, str) or not isinstance(raw_operator, str):
            continue
        name = raw_name.strip()
        field_type = field_types.get(name)
        if field_type is None:
            continue
        operator = _OPERATOR_ALIASES[field_type].get(raw_operator.strip().lower())
        if operator is None:
            continue
        value = None
        if operator not in {"empty", "not empty"}:
            value = _coerce_value(field_type, item.get("metadata_field_value"))
        try:
            condition = KnowledgeFSRetrievalCustomMetadataCondition.model_validate(
                {
                    "name": name,
                    "field_type": field_type,
                    "comparison_operator": operator,
                    "value": value,
                }
            )
        except ValidationError:
            logger.info("Dropping automatic metadata condition outside the KnowledgeFS contract: %s", name)
            continue
        conditions.append(condition)
    return conditions


class KnowledgeFSAutomaticMetadataFilterExtractor:
    """Runs the shared metadata extraction prompt against the node's configured LLM."""

    def __init__(
        self,
        *,
        credentials_provider: CredentialsProvider,
        model_factory: DifyModelFactory,
    ) -> None:
        self._credentials_provider = credentials_provider
        self._model_factory = model_factory

    def extract(
        self,
        *,
        run_context: DifyRunContext,
        model_config: ModelConfig,
        query: str,
        field_names: Sequence[str],
    ) -> KnowledgeFSMetadataExtraction:
        try:
            model_instance, model_config_entity = fetch_model_config(
                node_data_model=model_config,
                credentials_provider=self._credentials_provider,
                model_factory=self._model_factory,
            )
        except ValueError as exc:
            raise KnowledgeFSRetrievalConfigurationError(
                "KnowledgeFS metadata filtering model is not configured or is unavailable"
            ) from exc
        prompt_messages, stop = build_metadata_filter_prompt(
            model_config=model_config_entity,
            mode=model_config.mode,
            field_names=field_names,
            query=query,
        )
        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=model_config_entity.parameters,
            stop=stop,
            stream=False,
            request_metadata={
                "app_id": run_context.app_id,
                "app_type": run_context.app_type or CreditUsageAppType.UNKNOWN,
                "created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL,
            },
        )
        return KnowledgeFSMetadataExtraction(
            metadata_map=parse_metadata_map(llm_result_text(result)),
            usage=result.usage or LLMUsage.empty_usage(),
            model=model_instance.model_name,
            provider=model_instance.provider,
        )


__all__ = [
    "KnowledgeFSAutomaticMetadataFilterExtractor",
    "KnowledgeFSAutomaticMetadataFilterOutcome",
    "KnowledgeFSMetadataExtraction",
    "KnowledgeFSMetadataFieldRef",
    "KnowledgeFSMetadataFilterExtractor",
    "build_metadata_filter_prompt",
    "intersect_metadata_fields",
    "llm_result_text",
    "parse_metadata_map",
    "to_custom_metadata_conditions",
]
