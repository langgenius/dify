from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from graphon.nodes.human_input.entities import FormInputConfig, UserActionConfig
from models.execution_extra_content import ExecutionContentType


class HumanInputFormDefinition(BaseModel):
    model_config = ConfigDict(frozen=True)

    form_id: str
    node_id: str
    node_title: str
    form_content: str
    inputs: Sequence[FormInputConfig] = Field(default_factory=list)
    actions: Sequence[UserActionConfig] = Field(default_factory=list)
    display_in_ui: bool = False

    # `form_token` is `None` if the corresponding form has been submitted.
    form_token: str | None = None
    resolved_default_values: Mapping[str, Any] = Field(default_factory=dict)
    expiration_time: int


class HumanInputFormSubmissionData(BaseModel):
    model_config = ConfigDict(frozen=True)

    node_id: str
    node_title: str

    # deprecate: the rendered_content is deprecated and only for historical reasons.
    rendered_content: str

    # The identifier of action user has chosen.
    action_id: str
    # The button text of the action user has chosen.
    action_text: str

    # submitted_data records the submitted form data.
    # Keys correspond to `output_variable_name` of HumanInput inputs.
    # Values are serialized JSON forms of runtime values, including file dictionaries.
    #
    # For form submitted before this field is introduced, this field is populated from
    # the stored submission data.
    submitted_data: Mapping[str, JsonValue] | None = None


class HumanInputContent(BaseModel):
    model_config = ConfigDict(frozen=True)

    workflow_run_id: str
    submitted: bool
    # Both the form_defintion and the form_submission_data are present in
    # HumanInputContent. For historical records, the
    form_definition: HumanInputFormDefinition | None = None
    form_submission_data: HumanInputFormSubmissionData | None = None
    type: ExecutionContentType = Field(default=ExecutionContentType.HUMAN_INPUT)


# Keep a runtime alias here: callers and tests expect identity with HumanInputContent.
ExecutionExtraContentDomainModel: TypeAlias = HumanInputContent  # noqa: UP040

__all__ = [
    "ExecutionExtraContentDomainModel",
    "HumanInputContent",
    "HumanInputFormDefinition",
    "HumanInputFormSubmissionData",
]
