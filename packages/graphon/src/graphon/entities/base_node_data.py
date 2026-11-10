from __future__ import annotations

import json
from abc import ABC
from builtins import type as type_
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from graphon.entities.exc import DefaultValueTypeError
from graphon.enums import ErrorStrategy, NodeType

_NumberType = int | float


class RetryConfig(BaseModel):
    """node retry config"""

    max_retries: int = 0  # max retry times
    retry_interval: int = 0  # retry interval in milliseconds
    retry_enabled: bool = False  # whether retry is enabled

    @property
    def retry_interval_seconds(self) -> float:
        return self.retry_interval / 1000


class DefaultValueType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    OBJECT = "object"
    ARRAY_NUMBER = "array[number]"
    ARRAY_STRING = "array[string]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_BOOLEAN = "array[boolean]"
    ARRAY_FILES = "array[file]"


class DefaultValue(BaseModel):
    value: Any = None
    type: DefaultValueType
    key: str

    @staticmethod
    def _parse_json(value: str) -> Any:
        """Unified JSON parsing handler"""
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            msg = f"Invalid JSON format for value: {value}"
            raise DefaultValueTypeError(msg) from error

    @staticmethod
    def _validate_array(value: Any, element_type: type_ | tuple[type_, ...]) -> bool:
        """Unified array type validation"""
        return isinstance(value, list) and all(
            isinstance(x, element_type) for x in value
        )

    @staticmethod
    def _convert_number(value: str) -> float:
        """Unified number conversion handler"""
        try:
            return float(value)
        except ValueError as error:
            msg = f"Cannot convert to number: {value}"
            raise DefaultValueTypeError(msg) from error

    @model_validator(mode="after")
    def validate_value_type(self) -> DefaultValue:
        # Type validation configuration
        type_validators: dict[DefaultValueType, dict[str, Any]] = {
            DefaultValueType.STRING: {
                "type": str,
                "converter": lambda x: x,
            },
            DefaultValueType.NUMBER: {
                "type": _NumberType,
                "converter": self._convert_number,
            },
            DefaultValueType.BOOLEAN: {
                "type": bool,
                "converter": lambda value: value,
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
            DefaultValueType.ARRAY_BOOLEAN: {
                "type": list,
                "element_type": bool,
                "converter": self._parse_json,
            },
        }

        validator: dict[str, Any] = type_validators.get(self.type, {})
        if not validator:
            if self.type == DefaultValueType.ARRAY_FILES:
                # Handle files type
                return self
            msg = f"Unsupported type: {self.type}"
            raise DefaultValueTypeError(msg)

        # Handle string input cases
        if isinstance(self.value, str) and self.type != DefaultValueType.STRING:
            self.value = validator["converter"](self.value)

        # Validate base type
        if not isinstance(self.value, validator["type"]):
            msg = f"Value must be {validator['type'].__name__} type for {self.value}"
            raise DefaultValueTypeError(msg)

        # Validate array element types
        if validator["type"] is list and not self._validate_array(
            self.value,
            validator["element_type"],
        ):
            msg = (
                f"All elements must be {validator['element_type'].__name__} "
                f"for {self.value}"
            )
            raise DefaultValueTypeError(msg)

        return self


class BaseNodeData(ABC, BaseModel):
    # Raw graph payloads are first validated through `NodeConfigDictAdapter`, where
    # `node["data"]` is typed as `BaseNodeData` before the concrete node class is
    # known. `type` therefore accepts downstream string node kinds; unknown
    # implementations are rejected later when the node factory resolves the node
    # registry. At that boundary, node-specific fields are still "extra" relative
    # to this shared DTO, and persisted templates/workflows also carry undeclared
    # compatibility keys such as `selected`, `params`, `paramSchemas`, and
    # `datasource_label`. Keep extras permissive here until graph parsing becomes
    # discriminated by node type or legacy payloads are normalized.
    model_config = ConfigDict(extra="allow")

    type: NodeType
    title: str = ""
    desc: str | None = None
    version: str = "1"
    error_strategy: ErrorStrategy | None = None
    default_value: list[DefaultValue] | None = None
    retry_config: RetryConfig = Field(default_factory=RetryConfig)

    @property
    def default_value_dict(self) -> dict[str, Any]:
        if self.default_value:
            return {item.key: item.value for item in self.default_value}
        return {}

    def __getitem__(self, key: str) -> Any:
        """Dict-style access without calling model_dump() on every lookup.
        Prefer using model fields and Pydantic's extra storage.

        Returns:
            The declared field value or compatibility extra stored under `key`.

        Raises:
            KeyError: If `key` is neither a declared field nor a stored extra.

        """
        # First, check declared model fields
        if key in self.__class__.model_fields:
            return getattr(  # guard-ignore: no-new-getattr -- upstream dynamic field
                self, key
            )

        # Then, check undeclared compatibility fields stored in Pydantic's extra dict.
        extras = getattr(  # guard-ignore: no-new-getattr -- upstream dynamic field
            self, "__pydantic_extra__", None
        )
        if extras is None:
            extras = getattr(  # guard-ignore: no-new-getattr -- upstream dynamic field
                self, "model_extra", None
            )
        if extras is not None and key in extras:
            return extras[key]

        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        """Dict-style .get() without calling model_dump() on every lookup."""
        if key in self.__class__.model_fields:
            return getattr(  # guard-ignore: no-new-getattr -- upstream dynamic field
                self, key
            )

        extras = getattr(  # guard-ignore: no-new-getattr -- upstream dynamic field
            self, "__pydantic_extra__", None
        )
        if extras is None:
            extras = getattr(  # guard-ignore: no-new-getattr -- upstream dynamic field
                self, "model_extra", None
            )
        if extras is not None and key in extras:
            return extras.get(key, default)

        return default
