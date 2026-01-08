from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeAlias

from core.workflow.nodes.human_input.entities import FormInput, UserAction
from models.execution_extra_content import ExecutionContentType


@dataclass(frozen=True, kw_only=True)
class HumanInputFormDefinition:
    form_id: str
    node_id: str
    node_title: str
    form_content: str
    inputs: Sequence[FormInput] = field(default_factory=list)
    actions: Sequence[UserAction] = field(default_factory=list)
    display_in_ui: bool = False
    form_token: str | None = None
    resolved_placeholder_values: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "form_id": self.form_id,
            "node_id": self.node_id,
            "node_title": self.node_title,
            "form_content": self.form_content,
            "inputs": [item.model_dump(mode="json") for item in self.inputs],
            "actions": [item.model_dump(mode="json") for item in self.actions],
            "display_in_ui": self.display_in_ui,
            "form_token": self.form_token,
            "resolved_placeholder_values": self.resolved_placeholder_values,
        }


@dataclass(frozen=True, kw_only=True)
class HumanInputFormSubmissionData:
    node_id: str
    node_title: str
    rendered_content: str
    action_id: str
    action_text: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "node_title": self.node_title,
            "rendered_content": self.rendered_content,
            "action_id": self.action_id,
            "action_text": self.action_text,
        }


@dataclass(frozen=True, kw_only=True)
class HumanInputContent:
    submitted: bool
    form_definition: HumanInputFormDefinition | None = None
    form_submission_data: HumanInputFormSubmissionData | None = None
    type: ExecutionContentType = field(default=ExecutionContentType.HUMAN_INPUT, init=False)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": self.type.value,
            "submitted": self.submitted,
        }
        if self.form_definition is not None:
            payload["form_definition"] = self.form_definition.to_dict()
        if self.form_submission_data is not None:
            payload["form_submission_data"] = self.form_submission_data.to_dict()
        return payload


ExecutionExtraContentDomainModel: TypeAlias = HumanInputContent

__all__ = [
    "ExecutionExtraContentDomainModel",
    "HumanInputContent",
    "HumanInputFormDefinition",
    "HumanInputFormSubmissionData",
]
