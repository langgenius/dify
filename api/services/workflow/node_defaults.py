"""Defaults every node needs so the workflow editor can open it; shared by DSL import and describe.node_type."""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from types import UnionType
from typing import Any, Final, Union, get_args, get_origin

from pydantic import BaseModel, Field

from core.workflow.human_input_adapter import DeliveryChannelConfig
from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping
from core.workflow.nodes.human_input.entities import HumanInputNodeData
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


# Graphon keeps these node data opaque; Dify parses them with its own model when the node runs.
_DIFY_NODE_DATA: Final[Mapping[str, type[BaseModel]]] = {
    BuiltinNodeTypes.HUMAN_INPUT: HumanInputNodeSpec,
}


def node_data_type(node_type: str, node_class: type[Node]) -> type[BaseModel]:
    return _DIFY_NODE_DATA.get(node_type) or node_class._get_node_data_type()


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
    # Some validators raise errors other than ValidationError on bad or newer values; filling must never fail an import.
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


def fill_node_data(data: Mapping[str, Any]) -> dict[str, Any]:
    node_type = data.get("type")
    if not isinstance(node_type, str):
        return dict(data)
    normalize = _NORMALIZERS.get(node_type)
    if normalize is not None:
        data = normalize(data)
    filled = {**copy.deepcopy(dict(EDITOR_EMPTY.get(node_type, {}))), **data}
    node_class = get_node_type_classes_mapping().get(node_type, {}).get(LATEST_VERSION)
    return complete_sub_models(node_data_type(node_type, node_class), filled) if node_class else filled


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
