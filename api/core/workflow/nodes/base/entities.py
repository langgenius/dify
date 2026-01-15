from __future__ import annotations

import json
from abc import ABC
from builtins import type as type_
from collections.abc import Sequence
from enum import StrEnum
from typing import Any, Union

from pydantic import BaseModel, field_validator, model_validator

from core.workflow.enums import ErrorStrategy

from .exc import DefaultValueTypeError

_NumberType = Union[int, float]


class RetryConfig(BaseModel):
    """node retry config"""

    max_retries: int = 0  # max retry times
    retry_interval: int = 0  # retry interval in milliseconds
    retry_enabled: bool = False  # whether retry is enabled

    @property
    def retry_interval_seconds(self) -> float:
        return self.retry_interval / 1000


class VariableSelector(BaseModel):
    """
    Variable Selector.
    """

    variable: str
    value_selector: Sequence[str]


class OutputVariableType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    INTEGER = "integer"
    SECRET = "secret"
    BOOLEAN = "boolean"
    OBJECT = "object"
    FILE = "file"
    ARRAY = "array"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_BOOLEAN = "array[boolean]"
    ARRAY_FILE = "array[file]"
    ANY = "any"
    ARRAY_ANY = "array[any]"


class OutputVariableEntity(BaseModel):
    """
    Output Variable Entity.
    """

    variable: str
    value_type: OutputVariableType = OutputVariableType.ANY
    value_selector: Sequence[str]

    @field_validator("value_type", mode="before")
    @classmethod
    def normalize_value_type(cls, v: Any) -> Any:
        """
        Normalize value_type to handle case-insensitive array types.
        Converts 'Array[...]' to 'array[...]' for backward compatibility.
        """
        if isinstance(v, str) and v.startswith("Array["):
            return v.lower()
        return v


class DefaultValueType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    OBJECT = "object"
    ARRAY_NUMBER = "array[number]"
    ARRAY_STRING = "array[string]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_FILES = "array[file]"


class DefaultValue(BaseModel):
    value: Any = None
    type: DefaultValueType
    key: str

    @staticmethod
    def _parse_json(value: str):
        """Unified JSON parsing handler"""
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            raise DefaultValueTypeError(f"Invalid JSON format for value: {value}")

    @staticmethod
    def _validate_array(value: Any, element_type: type_ | tuple[type_, ...]) -> bool:
        """Unified array type validation"""
        return isinstance(value, list) and all(isinstance(x, element_type) for x in value)

    @staticmethod
    def _convert_number(value: str) -> float:
        """Unified number conversion handler"""
        try:
            return float(value)
        except ValueError:
            raise DefaultValueTypeError(f"Cannot convert to number: {value}")

    @model_validator(mode="after")
    def validate_value_type(self) -> DefaultValue:
        # Type validation configuration
        type_validators = {
            DefaultValueType.STRING: {
                "type": str,
                "converter": lambda x: x,
            },
            DefaultValueType.NUMBER: {
                "type": _NumberType,
                "converter": self._convert_number,
            },
            DefaultValueType.OBJECT: {
                "type": dict,
                "converter": self._parse_json,
            },
            DefaultValueType.ARRAY_NUMBER: {
                "type": list,
                "element_type": _NumberType,
                "converter": self._parse_json,
            },
            DefaultValueType.ARRAY_STRING: {
                "type": list,
                "element_type": str,
                "converter": self._parse_json,
            },
            DefaultValueType.ARRAY_OBJECT: {
                "type": list,
                "element_type": dict,
                "converter": self._parse_json,
            },
        }

        validator: dict[str, Any] = type_validators.get(self.type, {})
        if not validator:
            if self.type == DefaultValueType.ARRAY_FILES:
                # Handle files type
                return self
            raise DefaultValueTypeError(f"Unsupported type: {self.type}")

        # Handle string input cases
        if isinstance(self.value, str) and self.type != DefaultValueType.STRING:
            self.value = validator["converter"](self.value)

        # Validate base type
        if not isinstance(self.value, validator["type"]):
            raise DefaultValueTypeError(f"Value must be {validator['type'].__name__} type for {self.value}")

        # Validate array element types
        if validator["type"] == list and not self._validate_array(self.value, validator["element_type"]):
            raise DefaultValueTypeError(f"All elements must be {validator['element_type'].__name__} for {self.value}")

        return self


class BaseNodeData(ABC, BaseModel):
    title: str
    desc: str | None = None
    version: str = "1"
    error_strategy: ErrorStrategy | None = None
    default_value: list[DefaultValue] | None = None
    retry_config: RetryConfig = RetryConfig()

    @property
    def default_value_dict(self) -> dict[str, Any]:
        if self.default_value:
            return {item.key: item.value for item in self.default_value}
        return {}


class BaseIterationNodeData(BaseNodeData):
    start_node_id: str | None = None


class BaseIterationState(BaseModel):
    iteration_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData


class BaseLoopNodeData(BaseNodeData):
    start_node_id: str | None = None


class BaseLoopState(BaseModel):
    loop_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData
