"""Defaults every node needs so the workflow editor can open it; shared by DSL import and describe.node_type."""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from types import UnionType
from typing import Any, Final, Union, get_args, get_origin

from pydantic import BaseModel, Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from core.human_input_v2.entities import DebugChannel
from core.workflow.human_input_adapter import DeliveryChannelConfig, EmailDeliveryConfig
from core.workflow.node_factory import resolve_workflow_node_class
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.entities import (
    HUMAN_INPUT_V2_VERSION,
    DebugModeConfig,
    MessageTemplateConfig,
    RecipientConfig,
)
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData as HumanInputV2NodeData
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.base.node import Node

# Only empty containers: values the editor reads without a guard and that mean "none yet".
EDITOR_EMPTY: Final[Mapping[str, Mapping[str, object]]] = {
    BuiltinNodeTypes.START: {"variables": []},
    BuiltinNodeTypes.END: {"outputs": []},
    BuiltinNodeTypes.IF_ELSE: {"cases": []},
    BuiltinNodeTypes.CODE: {"variables": []},
    BuiltinNodeTypes.TEMPLATE_TRANSFORM: {"variables": []},
    BuiltinNodeTypes.HTTP_REQUEST: {"body": {"type": "none", "data": []}},
    BuiltinNodeTypes.TOOL: {"tool_parameters": {}, "tool_configurations": {}},
    BuiltinNodeTypes.LOOP: {"break_conditions": []},
    BuiltinNodeTypes.HUMAN_INPUT: {"delivery_methods": [], "user_actions": [], "inputs": []},
    BuiltinNodeTypes.DATASOURCE: {"datasource_parameters": {}},
}


class HumanInputNodeSpec(HumanInputNodeData):
    """Human-input data as the editor saves it; the run parses delivery methods beside the node data."""

    delivery_methods: list[DeliveryChannelConfig] = Field(default_factory=list)


class _HumanInputV2MessageTemplate(MessageTemplateConfig):
    @field_validator("subject")
    @classmethod
    def _require_subject(cls, subject: str) -> str:
        """Reject blank authoring input without normalizing the saved subject."""
        if not subject.strip():
            raise PydanticCustomError("subject_required", "Message subject must not be blank")
        return subject

    @field_validator("body")
    @classmethod
    def _require_request_url(cls, body: str) -> str:
        """Preserve valid bodies and reject missing or repeated Request URL slots."""
        if body.count(EmailDeliveryConfig.URL_PLACEHOLDER) != 1:
            raise PydanticCustomError("request_url_required", "Message body must contain exactly one Request URL")
        return body


class _HumanInputV2DebugMode(DebugModeConfig):
    @field_validator("channels")
    @classmethod
    def _require_enabled_channels(
        cls, channels: Sequence[DebugChannel], info: ValidationInfo
    ) -> Sequence[DebugChannel]:
        """Reject enabled debug drafts without a channel; leave disabled drafts intact."""
        if info.data.get("enabled") and not channels:
            raise PydanticCustomError("debug_channel_required", "Enabled debug mode requires at least one channel")
        return channels


class _HumanInputV2NodeSpec(HumanInputV2NodeData):
    """Validate complete CLI-authored configuration without activating runtime delivery."""

    recipients_spec: list[RecipientConfig] = Field(min_length=1)
    message_template: _HumanInputV2MessageTemplate
    debug_mode: _HumanInputV2DebugMode


# The v1 runtime parses delivery methods separately; v2 has its own authoring contract.
_DIFY_NODE_DATA: Final[Mapping[tuple[str, str], type[BaseModel]]] = {
    (BuiltinNodeTypes.HUMAN_INPUT, "1"): HumanInputNodeSpec,
    (BuiltinNodeTypes.HUMAN_INPUT, HUMAN_INPUT_V2_VERSION): _HumanInputV2NodeSpec,
}


def node_data_type(node_type: str, node_class: type[Node]) -> type[BaseModel]:
    """Return the requested runtime version's authoring schema, preserving legacy contracts."""
    return _DIFY_NODE_DATA.get((node_type, node_class.version())) or node_class._get_node_data_type()


_LEGACY_IF_CASE_ID: Final = "true"
_DEFAULT_LOGICAL_OPERATOR: Final = "and"


def _cases_from_legacy_conditions(data: Mapping[str, Any]) -> Mapping[str, Any]:
    """Old if-else nodes keep one condition list and branch on "true"; the editor reads them as one case."""
    if "cases" in data or "conditions" not in data:
        return data
    case = {
        "case_id": _LEGACY_IF_CASE_ID,
        "logical_operator": data.get("logical_operator") or _DEFAULT_LOGICAL_OPERATOR,
        "conditions": data["conditions"],
    }
    return {**data, "cases": [case]}


# Rewrites of old shapes to the one the editor reads, applied before the empty defaults.
_NORMALIZERS: Final[Mapping[str, Callable[[Mapping[str, Any]], Mapping[str, Any]]]] = {
    BuiltinNodeTypes.IF_ELSE: _cases_from_legacy_conditions,
}


def _single_model(candidates: Iterable[object]) -> type[BaseModel] | None:
    models = [c for c in candidates if isinstance(c, type) and issubclass(c, BaseModel)]
    return models[0] if len(models) == 1 else None


@dataclass(frozen=True)
class _SubModels:
    """The model of a field's mapping value (direct or optional), and of each mapping in its list value."""

    value: type[BaseModel] | None
    item: type[BaseModel] | None


def _sub_models(annotation: object) -> _SubModels:
    arms = get_args(annotation) if get_origin(annotation) in (Union, UnionType) else (annotation,)
    is_sequence = get_origin(annotation) in (list, Sequence)
    return _SubModels(value=_single_model(arms), item=_single_model(get_args(annotation)) if is_sequence else None)


def _fill(model: type[BaseModel], value: Mapping[str, Any]) -> dict[str, Any]:
    # graph_diff fills stored graphs that were never validated, and some graphon validators raise KeyError and the
    # like on bad data instead of a ValidationError; a sub-object its model refuses is kept as it is.
    try:
        filled = model.model_validate(value).model_dump(mode="json")
    except Exception:
        return dict(value)
    return {**filled, **value}


def complete_sub_models(model: type[BaseModel], data: Mapping[str, Any]) -> dict[str, Any]:
    """Add the keys each sub-object's model defaults; keys already present win."""
    fields = model.model_fields
    completed = dict(data)
    for key, value in data.items():
        field = fields.get(key)
        if field is None:
            continue
        models = _sub_models(field.annotation)
        if isinstance(value, Mapping) and models.value:
            completed[key] = _fill(models.value, value)
        elif isinstance(value, list) and models.item:
            item_model = models.item
            completed[key] = [_fill(item_model, item) if isinstance(item, Mapping) else item for item in value]
    return completed


def editor_defaults(data: Mapping[str, Any]) -> dict[str, Any]:
    """Old shapes rewritten and the empty containers the editor reads added; keys already present win."""
    node_type = data.get("type")
    if not isinstance(node_type, str):
        return dict(data)
    normalize = _NORMALIZERS.get(node_type)
    if normalize is not None:
        data = normalize(data)
    empty = EDITOR_EMPTY.get(node_type, {})
    if node_type == BuiltinNodeTypes.HUMAN_INPUT and data.get("version") == HUMAN_INPUT_V2_VERSION:
        empty = {"user_actions": [], "inputs": []}
    return {**copy.deepcopy(dict(empty)), **data}


# Extra scaffolding for newly generated nodes. Values such as End outputs,
# a condition, a tool identity, or a retrieval dataset must come from the caller.
_MODEL_SCAFFOLD: Final = {
    "provider": "",
    "name": "",
    "mode": "chat",
    "completion_params": {"temperature": 0.7},
}
_CREATION_SCAFFOLD: Final[Mapping[str, Mapping[str, Any]]] = {
    BuiltinNodeTypes.ANSWER: {
        "variables": [],
    },
    BuiltinNodeTypes.LLM: {
        "model": _MODEL_SCAFFOLD,
        "prompt_template": [{"role": "system", "text": ""}],
        "context": {"enabled": False, "variable_selector": []},
        "vision": {"enabled": False},
    },
    BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: {
        "query_variable_selector": [],
        "query_attachment_selector": [],
        "retrieval_mode": "multiple",
        "multiple_retrieval_config": {
            "top_k": 4,
            "score_threshold": None,
            "reranking_enable": False,
        },
    },
    BuiltinNodeTypes.CODE: {
        "code": "",
        "code_language": "python3",
        "outputs": {},
    },
    BuiltinNodeTypes.QUESTION_CLASSIFIER: {
        "model": _MODEL_SCAFFOLD,
        "vision": {"enabled": False},
    },
    BuiltinNodeTypes.HTTP_REQUEST: {
        "variables": [],
        "method": "get",
        "url": "",
        "authorization": {
            "type": "no-auth",
            "config": None,
        },
        "headers": "",
        "params": "",
        "ssl_verify": True,
        "timeout": {
            "max_connect_timeout": 0,
            "max_read_timeout": 0,
            "max_write_timeout": 0,
        },
        "retry_config": {
            "retry_enabled": True,
            "max_retries": 3,
            "retry_interval": 100,
        },
    },
    BuiltinNodeTypes.VARIABLE_AGGREGATOR: {
        "output_type": "any",
    },
    BuiltinNodeTypes.TOOL: {
        "tool_node_version": "2",
    },
}


def generated_node_defaults(node_type: str) -> dict[str, Any]:
    """Reuse editor defaults where they do not supply a generated node's purpose."""
    if node_type not in _CREATION_SCAFFOLD and node_type not in {
        BuiltinNodeTypes.START,
        BuiltinNodeTypes.TEMPLATE_TRANSFORM,
    }:
        return {}
    scaffold = copy.deepcopy(dict(_CREATION_SCAFFOLD.get(node_type, {})))
    defaults = editor_defaults({"type": node_type, **scaffold})
    defaults.pop("type")
    return defaults


def fill_node_data(data: Mapping[str, Any]) -> dict[str, Any]:
    filled = editor_defaults(data)
    node_type = filled.get("type")
    if not isinstance(node_type, str):
        return filled
    try:
        node_class = resolve_workflow_node_class(
            node_type=node_type, node_version=str(filled.get("version", "1")), node_data=filled
        )
    except ValueError:
        return filled
    return complete_sub_models(node_data_type(node_type, node_class), filled)


def fill_graph(graph: Mapping[str, Any]) -> dict[str, Any]:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return dict(graph)
    return {
        **graph,
        "nodes": [
            {**node, "data": fill_node_data(node["data"])}
            if isinstance(node, Mapping) and isinstance(node.get("data"), Mapping)
            else node
            for node in nodes
        ],
    }
