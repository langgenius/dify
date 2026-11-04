"""What the web canvas gives a new node of each block type.

The values are generated from the web's `default.ts` files (web/scripts/generate-node-defaults.ts). An empty value
in a field the engine requires is left out, so check reports the field as missing.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from functools import cached_property
from importlib import resources
from typing import Final, Self

from pydantic import BaseModel, TypeAdapter
from pydantic.fields import FieldInfo

from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE, TRIGGER_WEBHOOK_NODE_TYPE
from core.workflow.node_factory import LATEST_VERSION
from graphon.enums import BuiltinNodeTypes
from services.knowledge_fs.knowledge_retrieval_v2.entities import KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE
from services.workflow.node_defaults import data_model_of, rewrite_sub_objects

_TYPE_KEY: Final = "type"
_VERSION_KEY: Final = "version"
_HUMAN_INPUT_V2_ENTRY: Final = "human-input-v2"
_DEFAULTS_FILE: Final = "canvas_defaults.json"
_DEFAULTS: Final = TypeAdapter(dict[str, dict[str, object]]).validate_json(
    resources.files(__package__).joinpath(_DEFAULTS_FILE).read_text(encoding="utf-8")
)


def _is_required_empty(field: FieldInfo | None, value: object) -> bool:
    if field is None:
        return False
    if not field.is_required():
        return False
    return isinstance(value, str | list | dict) and not value


def _without_required_empties(model: type[BaseModel], data: Mapping[str, object]) -> dict[str, object]:
    """`data` less each empty value in a field `model` requires, at any depth its sub-models reach.

    A sub-object is pruned first, so one left empty goes too when its own field is required.
    """
    pruned = rewrite_sub_objects(model, data, _without_required_empties)
    fields = model.model_fields
    return {key: value for key, value in pruned.items() if not _is_required_empty(fields.get(key), value)}


@dataclass(frozen=True)
class CanvasEdition:
    """What the canvas gives a node of one version of a block type, from the web entry `entry`.

    A `version` of None stands for every version; the latest one's model decides what is required.
    """

    node_type: str
    version: str | None
    entry: str

    @cached_property
    def data(self) -> Mapping[str, object]:
        canvas = _DEFAULTS.get(self.entry, {})
        version = LATEST_VERSION if self.version is None else self.version
        model = data_model_of({_TYPE_KEY: self.node_type, _VERSION_KEY: version})
        if model is None:
            return canvas
        return _without_required_empties(model, canvas)


class CanvasNode(StrEnum):
    """A block type the canvas adds. `data` is what the canvas gives a new node of it, as generated from the web.

    A member is given one `CanvasEdition` per version when the versions differ. `data` is that of the first edition,
    which is the version a node without one has. `edition` picks by a node's version.
    """

    editions: Mapping[str | None, CanvasEdition]

    def __new__(cls, value: str, *editions: CanvasEdition) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.editions = {edition.version: edition for edition in editions or (CanvasEdition(value, None, value),)}
        return member

    @property
    def data(self) -> Mapping[str, object]:
        return next(iter(self.editions.values())).data

    def edition(self, version: object = None) -> CanvasEdition | None:
        """The edition for a node's version; None when this type has editions and the version is not one of them."""
        if None in self.editions:
            return self.editions[None]
        key = next(iter(self.editions)) if version is None else version
        if not isinstance(key, str):
            return None
        return self.editions.get(key)

    ANSWER = (BuiltinNodeTypes.ANSWER,)
    ASSIGNER = (BuiltinNodeTypes.VARIABLE_ASSIGNER,)
    CODE = (BuiltinNodeTypes.CODE,)
    DOCUMENT_EXTRACTOR = (BuiltinNodeTypes.DOCUMENT_EXTRACTOR,)
    END = (BuiltinNodeTypes.END,)
    HTTP_REQUEST = (BuiltinNodeTypes.HTTP_REQUEST,)
    HUMAN_INPUT = (
        BuiltinNodeTypes.HUMAN_INPUT,
        CanvasEdition(BuiltinNodeTypes.HUMAN_INPUT, "1", BuiltinNodeTypes.HUMAN_INPUT),
        # the table keeps the v2 defaults under their own entry
        CanvasEdition(BuiltinNodeTypes.HUMAN_INPUT, "2", _HUMAN_INPUT_V2_ENTRY),
    )
    IF_ELSE = (BuiltinNodeTypes.IF_ELSE,)
    ITERATION = (BuiltinNodeTypes.ITERATION,)
    KNOWLEDGE_RETRIEVAL = (BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,)
    KNOWLEDGE_RETRIEVAL_V2 = (KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE,)
    LIST_OPERATOR = (BuiltinNodeTypes.LIST_OPERATOR,)
    LLM = (BuiltinNodeTypes.LLM,)
    LOOP = (BuiltinNodeTypes.LOOP,)
    LOOP_END = (BuiltinNodeTypes.LOOP_END,)
    PARAMETER_EXTRACTOR = (BuiltinNodeTypes.PARAMETER_EXTRACTOR,)
    QUESTION_CLASSIFIER = (BuiltinNodeTypes.QUESTION_CLASSIFIER,)
    START = (BuiltinNodeTypes.START,)
    TEMPLATE_TRANSFORM = (BuiltinNodeTypes.TEMPLATE_TRANSFORM,)
    TRIGGER_SCHEDULE = (TRIGGER_SCHEDULE_NODE_TYPE,)
    TRIGGER_WEBHOOK = (TRIGGER_WEBHOOK_NODE_TYPE,)
    VARIABLE_AGGREGATOR = (BuiltinNodeTypes.VARIABLE_AGGREGATOR,)


def canvas_node(node_type: str) -> CanvasNode | None:
    """The canvas node of a block type; None for a type the canvas gives no defaults (tool, agent, unknown)."""
    try:
        return CanvasNode(node_type)
    except ValueError:
        return None


def _merged(written: Mapping[str, object], canvas: Mapping[str, object]) -> Mapping[str, object]:
    """A block the node wrote, plus the canvas block's missing keys; as written when it is another kind of block."""
    if _TYPE_KEY in canvas and written.get(_TYPE_KEY) != canvas[_TYPE_KEY]:
        return written
    return {**copy.deepcopy(dict(canvas)), **written}


def _edition_of(data: Mapping[str, object]) -> CanvasEdition | None:
    """The edition of the canvas node `data` is, by its type and version; None for a type or version without one."""
    node_type = data.get(_TYPE_KEY)
    if not isinstance(node_type, str):
        return None
    node = canvas_node(node_type)
    if node is None:
        return None
    return node.edition(data.get(_VERSION_KEY))


def with_canvas_defaults(data: Mapping[str, object]) -> dict[str, object]:
    """`data` plus what the canvas gives a node of its type; what `data` holds always wins.

    A missing key gets the canvas value. A dict that is there gets the canvas dict's missing keys, one level deep,
    unless the canvas dict names a `type` that the written one lacks or contradicts. Lists and scalars are never
    merged, and nothing is written as null. Data of a type the canvas gives no defaults, or of a version it does
    not know, is returned as it is.
    """
    filled = dict(data)
    edition = _edition_of(data)
    if edition is None:
        return filled
    for key, canvas in edition.data.items():
        if key not in filled:
            filled[key] = copy.deepcopy(canvas)
            continue
        written = filled[key]
        if isinstance(written, dict) and isinstance(canvas, dict):
            filled[key] = _merged(written, canvas)
    return filled
