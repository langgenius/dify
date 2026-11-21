from __future__ import annotations

from collections.abc import Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, field_validator


class VariableSelector(BaseModel):
    """Variable Selector."""

    variable: str
    value_selector: Sequence[str]


class OutputVariableType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    INTEGER = "integer"
    SECRET = "secret"  # ruff:ignore[hardcoded-password-string]
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
    """Output Variable Entity."""

    variable: str
    value_type: OutputVariableType = OutputVariableType.ANY
    value_selector: Sequence[str]

    @field_validator("value_type", mode="before")
    @classmethod
    def normalize_value_type(cls, v: Any) -> Any:
        """Normalize `Array[...]` literals to lowercase for backward compatibility."""
        if isinstance(v, str) and v.startswith("Array["):
            return v.lower()
        return v
