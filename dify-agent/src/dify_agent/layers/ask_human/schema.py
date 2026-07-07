"""Product-neutral schemas for the Dify ask-human deferred tool contract.

These models describe the model-facing tool arguments and the later human result
payload expected by resumed runs. Config-specific guardrails such as maximum
counts, allowed field types, or per-install length limits are enforced by
``dify_agent.layers.ask_human.layer`` so this module stays import-safe for
client code that only needs the stable wire/schema shapes.
"""

from __future__ import annotations

import re
from typing import Annotated, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationInfo, field_validator, model_validator


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

type AskHumanFieldType = Literal["paragraph", "select", "file", "file-list"]
type AskHumanActionStyle = Literal["default", "primary", "destructive"]
type AskHumanUrgency = Literal["normal", "high"]
type AskHumanResultStatus = Literal["submitted", "timeout", "cancelled", "unavailable"]


def is_valid_identifier(value: str) -> bool:
    """Return whether ``value`` matches the stable ask-human identifier rules."""
    return bool(_IDENTIFIER_PATTERN.fullmatch(value))


def _require_non_blank(value: str, *, label: str) -> str:
    if not value.strip():
        raise ValueError(f"{label} must not be blank")
    return value


class AskHumanSelectOption(BaseModel):
    """One selectable option for an ask-human select field."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    value: str = Field(min_length=1)
    label: str = Field(min_length=1)

    @field_validator("value", "label")
    @classmethod
    def _validate_non_blank(cls, value: str, info: ValidationInfo) -> str:
        return _require_non_blank(value, label=f"select option {info.field_name}")


class AskHumanFieldBase(BaseModel):
    """Shared field properties for ask-human form fields."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    label: str = Field(min_length=1)
    required: bool = False

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        if not is_valid_identifier(value):
            raise ValueError("field name must be a valid identifier")
        return value

    @field_validator("label")
    @classmethod
    def _validate_label(cls, value: str) -> str:
        return _require_non_blank(value, label="field label")


class AskHumanParagraphField(AskHumanFieldBase):
    """Free-text paragraph field."""

    type: Literal["paragraph"] = "paragraph"
    placeholder: str | None = None
    default: str | None = None


class AskHumanSelectField(AskHumanFieldBase):
    """Single-choice select field."""

    type: Literal["select"] = "select"
    options: list[AskHumanSelectOption] = Field(default_factory=list)
    default: str | None = None

    @model_validator(mode="after")
    def _validate_options(self) -> AskHumanSelectField:
        if not self.options:
            raise ValueError("select fields must define at least one option")

        seen_values: set[str] = set()
        for option in self.options:
            if option.value in seen_values:
                raise ValueError(f"select field '{self.name}' contains duplicate option value '{option.value}'")
            seen_values.add(option.value)

        if self.default is not None and self.default not in seen_values:
            raise ValueError(f"select field '{self.name}' default must match one of its option values")
        return self


class AskHumanFileField(AskHumanFieldBase):
    """Single-file upload field."""

    type: Literal["file"] = "file"


class AskHumanFileListField(AskHumanFieldBase):
    """Multi-file upload field."""

    type: Literal["file-list"] = "file-list"
    max_files: int | None = Field(default=None, ge=1)


type AskHumanField = Annotated[
    AskHumanParagraphField | AskHumanSelectField | AskHumanFileField | AskHumanFileListField,
    Field(discriminator="type"),
]


class AskHumanAction(BaseModel):
    """One human-visible action rendered with an ask-human request."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    style: AskHumanActionStyle = "default"

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not is_valid_identifier(value):
            raise ValueError("action id must be a valid identifier")
        return value

    @field_validator("label")
    @classmethod
    def _validate_label(cls, value: str) -> str:
        return _require_non_blank(value, label="action label")


class AskHumanSelectedAction(BaseModel):
    """Action metadata returned with a human-submitted result."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not is_valid_identifier(value):
            raise ValueError("selected action id must be a valid identifier")
        return value

    @field_validator("label")
    @classmethod
    def _validate_label(cls, value: str) -> str:
        return _require_non_blank(value, label="selected action label")


class AskHumanToolArgs(BaseModel):
    """Arguments accepted by the ask-human external deferred tool."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    title: str | None = None
    question: str = Field(min_length=1)
    markdown: str | None = None
    fields: list[AskHumanField] = Field(default_factory=list)
    actions: list[AskHumanAction] = Field(default_factory=list)
    urgency: AskHumanUrgency = "normal"

    @field_validator("question")
    @classmethod
    def _validate_question(cls, value: str) -> str:
        return _require_non_blank(value, label="question")

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _require_non_blank(value, label="title")

    @model_validator(mode="after")
    def _validate_unique_ids(self) -> AskHumanToolArgs:
        field_names: set[str] = set()
        for field in self.fields:
            if field.name in field_names:
                raise ValueError(f"field name '{field.name}' must be unique")
            field_names.add(field.name)

        action_ids: set[str] = set()
        for action in self.actions:
            if action.id in action_ids:
                raise ValueError(f"action id '{action.id}' must be unique")
            action_ids.add(action.id)
        return self


class AskHumanToolResult(BaseModel):
    """Expected value shape for a later deferred ask-human tool result."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    status: AskHumanResultStatus
    action: AskHumanSelectedAction | None = None
    values: dict[str, JsonValue] = Field(default_factory=dict)
    message: str | None = None
    rendered_content: str | None = None


__all__ = [
    "AskHumanAction",
    "AskHumanActionStyle",
    "AskHumanField",
    "AskHumanFieldType",
    "AskHumanFileField",
    "AskHumanFileListField",
    "AskHumanParagraphField",
    "AskHumanResultStatus",
    "AskHumanSelectField",
    "AskHumanSelectOption",
    "AskHumanSelectedAction",
    "AskHumanToolArgs",
    "AskHumanToolResult",
    "AskHumanUrgency",
    "is_valid_identifier",
]
