"""Compatibility factory for non-graph variable bootstrapping.

Graph runtime segment/variable conversions live under `graphon.variables`.
This module keeps the application-layer mapping helpers and re-exports the
shared conversion functions for legacy callers and tests.
"""

from collections.abc import Mapping, Sequence
from typing import Any, cast

from graphon.variables.exc import VariableError
from graphon.variables.factory import (
    TypeMismatchError,
    UnsupportedSegmentTypeError,
    build_segment,
    build_segment_with_type,
    segment_to_variable,
)
from graphon.variables.types import SegmentType
from graphon.variables.variables import (
    ArrayBooleanVariable,
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    BooleanVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    SecretVariable,
    StringVariable,
    VariableBase,
)

from configs import dify_config
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
)

__all__ = [
    "TypeMismatchError",
    "UnsupportedSegmentTypeError",
    "build_conversation_variable_from_mapping",
    "build_environment_variable_from_mapping",
    "build_pipeline_variable_from_mapping",
    "build_segment",
    "build_segment_with_type",
    "segment_to_variable",
]


def build_conversation_variable_from_mapping(mapping: Mapping[str, Any], /) -> VariableBase:
    if not mapping.get("name"):
        raise VariableError("missing name")
    return _build_variable_from_mapping(mapping=mapping, selector=[CONVERSATION_VARIABLE_NODE_ID, mapping["name"]])


def build_environment_variable_from_mapping(mapping: Mapping[str, Any], /) -> VariableBase:
    if not mapping.get("name"):
        raise VariableError("missing name")
    return _build_variable_from_mapping(mapping=mapping, selector=[ENVIRONMENT_VARIABLE_NODE_ID, mapping["name"]])


def build_pipeline_variable_from_mapping(mapping: Mapping[str, Any], /) -> VariableBase:
    if not mapping.get("variable"):
        raise VariableError("missing variable")
    return mapping["variable"]


def _build_variable_from_mapping(*, mapping: Mapping[str, Any], selector: Sequence[str]) -> VariableBase:
    """
    This factory function is used to create the environment variable or the conversation variable,
    not support the File type.
    """
    if (value_type := mapping.get("value_type")) is None:
        raise VariableError("missing value type")
    if (value := mapping.get("value")) is None:
        raise VariableError("missing value")

    result: VariableBase
    match value_type:
        case SegmentType.STRING:
            result = StringVariable.model_validate(mapping)
        case SegmentType.SECRET:
            result = SecretVariable.model_validate(mapping)
        case SegmentType.NUMBER | SegmentType.INTEGER if isinstance(value, int):
            mapping = dict(mapping)
            mapping["value_type"] = SegmentType.INTEGER
            result = IntegerVariable.model_validate(mapping)
        case SegmentType.NUMBER | SegmentType.FLOAT if isinstance(value, float):
            mapping = dict(mapping)
            mapping["value_type"] = SegmentType.FLOAT
            result = FloatVariable.model_validate(mapping)
        case SegmentType.BOOLEAN:
            result = BooleanVariable.model_validate(mapping)
        case SegmentType.NUMBER if not isinstance(value, float | int):
            raise VariableError(f"invalid number value {value}")
        case SegmentType.OBJECT if isinstance(value, dict):
            result = ObjectVariable.model_validate(mapping)
        case SegmentType.ARRAY_STRING if isinstance(value, list):
            result = ArrayStringVariable.model_validate(mapping)
        case SegmentType.ARRAY_NUMBER if isinstance(value, list):
            result = ArrayNumberVariable.model_validate(mapping)
        case SegmentType.ARRAY_OBJECT if isinstance(value, list):
            result = ArrayObjectVariable.model_validate(mapping)
        case SegmentType.ARRAY_BOOLEAN if isinstance(value, list):
            result = ArrayBooleanVariable.model_validate(mapping)
        case _:
            raise VariableError(f"not supported value type {value_type}")
    if result.size > dify_config.MAX_VARIABLE_SIZE:
        raise VariableError(f"variable size {result.size} exceeds limit {dify_config.MAX_VARIABLE_SIZE}")
    if not result.selector:
        result = result.model_copy(update={"selector": selector})
    return cast(VariableBase, result)
