"""Shared workflow response schemas for Console, snippets and RAG pipelines."""

from datetime import datetime
from typing import Any, NotRequired, TypedDict

from pydantic import AliasChoices, Field, RootModel, field_validator

from core.helper import encrypter
from core.workflow.llm_environment_variable import LLM_ENVIRONMENT_VARIABLE_VALUE_TYPE, LLMEnvironmentVariable
from fields.base import ResponseModel
from fields.conversation_variable_fields import WorkflowConversationVariableResponse
from fields.member_fields import SimpleAccount
from graphon.variables import SecretVariable, SegmentType, VariableBase
from libs.helper import to_timestamp

ENVIRONMENT_VARIABLE_SUPPORTED_TYPES = (SegmentType.STRING, SegmentType.NUMBER, SegmentType.SECRET)


class EnvironmentVariableResponseDict(TypedDict):
    value_type: str
    id: NotRequired[str]
    name: NotRequired[str]
    value: NotRequired[Any]
    description: NotRequired[str | None]


class PipelineVariableResponse(ResponseModel):
    label: str
    variable: str
    type: str
    belong_to_node_id: str
    max_length: int | None = None
    required: bool
    unit: str | None = None
    default_value: Any = Field(default=None)
    options: list[str] | None = None
    placeholder: str | None = None
    tooltips: str | None = None
    allowed_file_types: list[str] | None = None
    allowed_file_extensions: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("allowed_file_extensions", "allow_file_extension")
    )
    allowed_file_upload_methods: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("allowed_file_upload_methods", "allow_file_upload_methods")
    )


class WorkflowEnvironmentVariableResponse(ResponseModel):
    value_type: str
    id: str
    name: str
    value: Any
    description: str


class WorkflowResponse(ResponseModel):
    id: str
    graph: dict[str, Any] = Field(
        validation_alias=AliasChoices("graph_dict", "graph"),
    )
    features: dict[str, Any] = Field(
        validation_alias=AliasChoices("features_dict", "features"),
    )
    hash: str = Field(validation_alias=AliasChoices("unique_hash", "hash"))
    version: str
    # NULL for drafts and for versions published before numbering was introduced; those
    # render as "Untitled Version" instead of `#N`. Never 0, so clients must test for null.
    version_number: int | None = None
    marked_name: str
    marked_comment: str
    created_by: SimpleAccount | None = Field(
        default=None, validation_alias=AliasChoices("created_by_account", "created_by")
    )
    created_at: int
    updated_by: SimpleAccount | None = Field(
        default=None, validation_alias=AliasChoices("updated_by_account", "updated_by")
    )
    updated_at: int
    tool_published: bool
    environment_variables: list[WorkflowEnvironmentVariableResponse]
    conversation_variables: list[WorkflowConversationVariableResponse]
    rag_pipeline_variables: list[PipelineVariableResponse]

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp

    @field_validator("environment_variables", mode="before")
    @classmethod
    def _serialize_environment_variables(cls, value: Any) -> list[Any]:
        if value is None:
            return []

        return [_serialize_environment_variable(item) for item in value]


class WorkflowPaginationResponse(ResponseModel):
    items: list[WorkflowResponse]
    page: int
    limit: int
    has_more: bool


def _serialize_environment_variable(value: Any) -> EnvironmentVariableResponseDict | Any:
    match value:
        case LLMEnvironmentVariable():
            return {
                "id": value.id,
                "name": value.name,
                "value": value.value,
                "value_type": LLM_ENVIRONMENT_VARIABLE_VALUE_TYPE,
                "description": value.description,
            }

        case SecretVariable():
            return {
                "id": value.id,
                "name": value.name,
                "value": encrypter.full_mask_token(),
                "value_type": value.value_type.value,
                "description": value.description,
            }

        case VariableBase():
            return {
                "id": value.id,
                "name": value.name,
                "value": value.value,
                "value_type": str(value.value_type.exposed_type()),
                "description": value.description,
            }

        case dict():
            value_type_str = value.get("value_type")
            if not isinstance(value_type_str, str):
                raise TypeError(
                    f"unexpected type for value_type field, value={value_type_str}, type={type(value_type_str)}"
                )
            if value_type_str == LLM_ENVIRONMENT_VARIABLE_VALUE_TYPE:
                return value
            value_type = SegmentType(value_type_str).exposed_type()
            if value_type not in ENVIRONMENT_VARIABLE_SUPPORTED_TYPES:
                raise ValueError(f"Unsupported environment variable value type: {value_type}")
            return value

        case _:
            return value


class WorkflowPublishResponse(ResponseModel):
    result: str
    created_at: int
    warning: str | None = Field(
        default=None,
        description="Advisory warning for variable references that can read a skipped branch. Publish still succeeds.",
    )


class WorkflowRestoreResponse(ResponseModel):
    result: str
    hash: str
    updated_at: int


class DefaultBlockConfigsResponse(RootModel[list[dict[str, Any]]]):
    root: list[dict[str, Any]]


class DefaultBlockConfigResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]
