from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TypeAlias

from pydantic import BaseModel, ConfigDict, Field

from core.workflow.nodes.human_input.entities import FormInput, UserAction
from models.execution_extra_content import ExecutionContentType


class HumanInputFormDefinition(BaseModel):
    model_config = ConfigDict(frozen=True)

    form_id: str
    node_id: str
    node_title: str
    form_content: str
    inputs: Sequence[FormInput] = Field(default_factory=list)
    actions: Sequence[UserAction] = Field(default_factory=list)
    display_in_ui: bool = False
    form_token: str | None = None
    resolved_default_values: Mapping[str, Any] = Field(default_factory=dict)
    expiration_time: int


class HumanInputFormSubmissionData(BaseModel):
    model_config = ConfigDict(frozen=True)

    node_id: str
    node_title: str
    rendered_content: str
    action_id: str
    action_text: str


class HumanInputContent(BaseModel):
    model_config = ConfigDict(frozen=True)

    workflow_run_id: str
    submitted: bool
    form_definition: HumanInputFormDefinition | None = None
    form_submission_data: HumanInputFormSubmissionData | None = None
    type: ExecutionContentType = Field(default=ExecutionContentType.HUMAN_INPUT)


ExecutionExtraContentDomainModel: TypeAlias = HumanInputContent

__all__ = [
    "ExecutionExtraContentDomainModel",
    "HumanInputContent",
    "HumanInputFormDefinition",
    "HumanInputFormSubmissionData",
]
