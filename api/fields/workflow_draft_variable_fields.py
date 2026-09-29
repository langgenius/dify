from __future__ import annotations

from typing import Any, override

from pydantic import model_validator
from sqlalchemy.orm import Session

from fields.base import ResponseModel, SessionResponseSource
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


class WorkflowDraftVariableResponseSource(SessionResponseSource[WorkflowDraftVariable]):
    """Expose the session-backed value decoding during response validation."""

    def get_value(self) -> Segment:
        return self._source.get_value(session=self._session)


def draft_variable_response_source(
    variable: WorkflowDraftVariable, *, session: Session
) -> WorkflowDraftVariableResponseSource:
    return WorkflowDraftVariableResponseSource(variable, session=session)


def draft_variable_list_response_source(variable_list: Any, *, session: Session) -> dict[str, Any]:
    """Wrap each variable in a list payload so value decoding resolves via the session."""
    return {
        "items": [draft_variable_response_source(variable, session=session) for variable in variable_list.variables],
    }


def _serialize_var_value(variable: WorkflowDraftVariableResponseSource) -> JSONValue:
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
    variable: WorkflowDraftVariable | WorkflowDraftVariableResponseSource,
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


def _serialize_without_value(variable: WorkflowDraftVariable | WorkflowDraftVariableResponseSource) -> dict[str, Any]:
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
        if isinstance(value, WorkflowDraftVariableResponseSource):
            return {
                **_serialize_without_value(value),
                "value": _serialize_var_value(value),
                "full_content": _serialize_full_content(value),
            }
        if isinstance(value, WorkflowDraftVariable):
            # Decoding the value needs a database session; a bare model would fall through to
            # from_attributes and expose the raw serialized JSON string instead of the decoded value.
            raise TypeError(
                "WorkflowDraftVariableResponse requires draft_variable_response_source(variable, session=...)"
            )
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
