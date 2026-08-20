from __future__ import annotations

from typing import Any, override

from pydantic import model_validator

from fields.base import ResponseModel
from graphon.file import helpers as file_helpers
from graphon.variables.segment_group import SegmentGroup
from graphon.variables.segments import ArrayFileSegment, FileSegment, Segment
from models.workflow import WorkflowDraftVariable

type JSONValue = str | int | float | bool | dict[str, "JSONValue"] | list["JSONValue"] | None


def _convert_values_to_json_serializable_object(value: Segment) -> JSONValue:
    match value:
        case FileSegment():
            return value.value.model_dump()
        case ArrayFileSegment():
            return [item.model_dump() for item in value.value]
        case SegmentGroup():
            return [_convert_values_to_json_serializable_object(item) for item in value.value]
        case _:
            return value.value


def _serialize_var_value(variable: WorkflowDraftVariable) -> JSONValue:
    value = variable.get_value()
    # Create a copy to avoid mutating the model's cached deserialized value.
    value = value.model_copy(deep=True)
    # Refresh URL signatures immediately before returning file values to the client.
    match value:
        case FileSegment():
            value.value.remote_url = value.value.generate_url()
        case ArrayFileSegment():
            for file in value.value:
                file.remote_url = file.generate_url()
    return _convert_values_to_json_serializable_object(value)


class WorkflowDraftVariableFullContentResponse(ResponseModel):
    size_bytes: int | None
    value_type: str
    length: int | None
    download_url: str


def _serialize_full_content(
    variable: WorkflowDraftVariable,
) -> WorkflowDraftVariableFullContentResponse | None:
    """Serialize metadata for a variable whose complete value was offloaded."""
    if not variable.is_truncated():
        return None

    variable_file = variable.variable_file
    assert variable_file is not None

    return WorkflowDraftVariableFullContentResponse(
        size_bytes=variable_file.size,
        value_type=str(variable_file.value_type.exposed_type()),
        length=variable_file.length,
        download_url=file_helpers.get_signed_file_url(variable_file.upload_file_id, as_attachment=True),
    )


def _serialize_without_value(variable: WorkflowDraftVariable) -> dict[str, Any]:
    return {
        "id": variable.id,
        "type": str(variable.get_variable_type()),
        "name": variable.name,
        "description": variable.description,
        "selector": variable.get_selector(),
        "value_type": str(variable.value_type.exposed_type()),
        "edited": variable.edited,
        "visible": variable.visible,
        "is_truncated": variable.is_truncated(),
    }


class WorkflowDraftVariableWithoutValueResponse(ResponseModel):
    id: str
    type: str
    name: str
    description: str
    selector: list[str]
    value_type: str
    edited: bool
    visible: bool
    is_truncated: bool

    @model_validator(mode="before")
    @classmethod
    def _from_workflow_draft_variable(cls, value: Any) -> Any:
        if isinstance(value, WorkflowDraftVariable):
            return _serialize_without_value(value)
        return value


class WorkflowDraftVariableResponse(WorkflowDraftVariableWithoutValueResponse):
    value: JSONValue
    full_content: WorkflowDraftVariableFullContentResponse | None

    @model_validator(mode="before")
    @classmethod
    @override
    def _from_workflow_draft_variable(cls, value: Any) -> Any:
        if isinstance(value, WorkflowDraftVariable):
            return {
                **_serialize_without_value(value),
                "value": _serialize_var_value(value),
                "full_content": _serialize_full_content(value),
            }
        return value


class WorkflowDraftVariableListWithoutValueResponse(ResponseModel):
    items: list[WorkflowDraftVariableWithoutValueResponse]
    total: int | None

    @model_validator(mode="before")
    @classmethod
    def _from_workflow_draft_variable_list(cls, value: Any) -> Any:
        if hasattr(value, "variables") and hasattr(value, "total"):
            return {"items": value.variables, "total": value.total}
        return value


class WorkflowDraftVariableListResponse(ResponseModel):
    items: list[WorkflowDraftVariableResponse]

    @model_validator(mode="before")
    @classmethod
    def _from_workflow_draft_variable_list(cls, value: Any) -> Any:
        if hasattr(value, "variables"):
            return {"items": value.variables}
        return value
