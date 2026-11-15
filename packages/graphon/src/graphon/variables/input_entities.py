import json
from collections.abc import Sequence
from enum import StrEnum
from typing import Any

from jsonschema import Draft7Validator, SchemaError
from pydantic import BaseModel, Field, field_validator

from graphon.file.enums import (
    FileTransferMethod,
    FileType,
)


def _reject_non_standard_json_constant(constant: str) -> None:
    msg = f"json_schema is not valid JSON: invalid constant {constant}"
    raise ValueError(msg)


class VariableEntityType(StrEnum):
    TEXT_INPUT = "text-input"
    SELECT = "select"
    PARAGRAPH = "paragraph"
    NUMBER = "number"
    EXTERNAL_DATA_TOOL = "external_data_tool"
    FILE = "file"
    FILE_LIST = "file-list"
    CHECKBOX = "checkbox"
    JSON_OBJECT = "json_object"


class VariableEntity(BaseModel):
    """Shared variable entity used by workflow runtime and app configuration."""

    # `variable` records the name of the variable in user inputs.
    variable: str
    label: str
    description: str = ""
    type: VariableEntityType
    required: bool = False
    hide: bool = False
    default: Any = None
    max_length: int | None = None
    options: Sequence[str] = Field(default_factory=list)
    allowed_file_types: Sequence[FileType] | None = Field(default_factory=list)
    allowed_file_extensions: Sequence[str] | None = Field(default_factory=list)
    allowed_file_upload_methods: Sequence[FileTransferMethod] | None = Field(
        default_factory=list,
    )
    json_schema: dict[str, Any] | None = Field(default=None)

    @field_validator("description", mode="before")
    @classmethod
    def convert_none_description(cls, value: Any) -> str:
        return value or ""

    @field_validator("options", mode="before")
    @classmethod
    def convert_none_options(cls, value: Any) -> Sequence[str]:
        return value or []

    @field_validator("json_schema", mode="before")
    @classmethod
    def validate_json_schema(
        cls,
        schema: str | dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        # The schema is persisted as raw editor text on the frontend, so accept
        # either a parsed object, a JSON string, or empty/None inputs.
        if schema is None:
            return None
        if isinstance(schema, str):
            schema = schema.strip()
            if not schema:
                return None
            try:
                schema = json.loads(
                    schema,
                    parse_constant=_reject_non_standard_json_constant,
                )
            except json.JSONDecodeError as error:
                msg = f"json_schema is not valid JSON: {error.msg}"
                raise ValueError(msg) from error
        if not isinstance(schema, dict):
            # Pydantic only wraps ValueError/AssertionError into ValidationError,
            # so we deliberately keep ValueError instead of TypeError here.
            msg = f"json_schema must be a JSON object, got {type(schema).__name__}"
            raise ValueError(msg)  # ruff:ignore[type-check-without-type-error]
        try:
            Draft7Validator.check_schema(schema)
        except SchemaError as error:
            msg = f"Invalid JSON schema: {error.message}"
            raise ValueError(msg) from error
        return schema
