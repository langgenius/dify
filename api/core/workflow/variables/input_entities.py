from collections.abc import Sequence
from enum import StrEnum
from typing import Any

from jsonschema import Draft7Validator, SchemaError
from pydantic import BaseModel, Field, field_validator

from core.workflow.file import FileTransferMethod, FileType


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
    """
    Shared variable entity used by workflow runtime and app configuration.
    """

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
    allowed_file_upload_methods: Sequence[FileTransferMethod] | None = Field(default_factory=list)
    json_schema: dict[str, Any] | None = Field(default=None)

    @field_validator("description", mode="before")
    @classmethod
    def convert_none_description(cls, value: Any) -> str:
        return value or ""

    @field_validator("options", mode="before")
    @classmethod
    def convert_none_options(cls, value: Any) -> Sequence[str]:
        return value or []

    @field_validator("json_schema")
    @classmethod
    def validate_json_schema(cls, schema: dict[str, Any] | None) -> dict[str, Any] | None:
        if schema is None:
            return None
        try:
            Draft7Validator.check_schema(schema)
        except SchemaError as error:
            raise ValueError(f"Invalid JSON schema: {error.message}")
        return schema
