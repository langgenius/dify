"""Client-safe DTOs for the Dify ask-human layer.

The public config controls only stable model-facing tool identity and guardrails.
Delivery, recipient selection, timeout policy, and other operational behavior are
intentionally out of scope for this layer and must stay outside the model-facing
tool contract. Setting ``enabled=False`` disables both ask-human tool exposure
and the prompt guidance that tells the model about these limits. Caller-provided
limits are additionally capped by small server hard limits so one composition
cannot widen the public deferred-tool surface arbitrarily. File field variants
are part of the schema vocabulary for forward compatibility, but they remain
invalid unless ``allow_file_fields=True`` and the allowed field-type list also
permits them.
"""

from __future__ import annotations

import re
from typing import ClassVar, Final

from pydantic import ConfigDict, Field, field_validator, model_validator

from agenton.layers import LayerConfig
from dify_agent.layers.ask_human.schema import AskHumanFieldType


DIFY_ASK_HUMAN_LAYER_TYPE_ID: Final[str] = "dify.ask_human"
DEFAULT_ASK_HUMAN_TOOL_DESCRIPTION: Final[str] = (
    "Ask a human for missing information or a decision that is required to continue. "
    "Use this only when the answer cannot be inferred from the conversation, available tools, or current context. "
    "Provide concise instructions, structured fields, and clear actions for the human."
)

_TOOL_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_HARD_MAX_FIELDS = 16
_HARD_MAX_ACTIONS = 8
_HARD_MAX_MARKDOWN_CHARS = 20_000
_HARD_MAX_QUESTION_CHARS = 4_000
_HARD_MAX_FIELD_LABEL_CHARS = 200
_HARD_MAX_ACTION_LABEL_CHARS = 120
_FILE_FIELD_TYPES: Final[frozenset[AskHumanFieldType]] = frozenset({"file", "file-list"})


class DifyAskHumanLayerConfig(LayerConfig):
    """Public config for the optional ask-human deferred tool layer.

    This DTO describes the exact model-facing guardrail surface that the runtime
    will both validate and surface back to the model through prompt guidance.
    ``enabled=False`` means callers keep the layer in composition data without
    exposing either the tool or its instructions for that run. Numeric limits are
    caller-configurable only within the server's hard caps, and file field types
    are rejected unless callers opt in with ``allow_file_fields=True``.
    """

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    enabled: bool = True
    tool_name: str = "ask_human"
    tool_description: str | None = None
    max_fields: int = Field(default=8, ge=0)
    max_actions: int = Field(default=4, ge=1)
    allowed_field_types: list[AskHumanFieldType] = Field(default_factory=lambda: ["paragraph", "select"])
    allow_file_fields: bool = False
    max_markdown_chars: int = Field(default=8_000, ge=0)
    max_question_chars: int = Field(default=1_000, ge=1)
    max_field_label_chars: int = Field(default=120, ge=1)
    max_action_label_chars: int = Field(default=80, ge=1)

    @property
    def effective_tool_description(self) -> str:
        """Return the configured description or the proposal default text."""
        return self.tool_description or DEFAULT_ASK_HUMAN_TOOL_DESCRIPTION

    @field_validator("tool_name")
    @classmethod
    def _validate_tool_name(cls, value: str) -> str:
        if not _TOOL_NAME_PATTERN.fullmatch(value):
            raise ValueError("tool_name must be a valid tool identifier")
        return value

    @field_validator("tool_description")
    @classmethod
    def _normalize_tool_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("allowed_field_types")
    @classmethod
    def _validate_allowed_field_types(cls, value: list[AskHumanFieldType]) -> list[AskHumanFieldType]:
        if len(set(value)) != len(value):
            raise ValueError("allowed_field_types must not contain duplicates")
        return value

    @field_validator(
        "max_fields",
        "max_actions",
        "max_markdown_chars",
        "max_question_chars",
        "max_field_label_chars",
        "max_action_label_chars",
        mode="after",
    )
    @classmethod
    def _validate_hard_limits(cls, value: int, info: object) -> int:
        field_name = getattr(info, "field_name", "value")
        hard_limits = {
            "max_fields": _HARD_MAX_FIELDS,
            "max_actions": _HARD_MAX_ACTIONS,
            "max_markdown_chars": _HARD_MAX_MARKDOWN_CHARS,
            "max_question_chars": _HARD_MAX_QUESTION_CHARS,
            "max_field_label_chars": _HARD_MAX_FIELD_LABEL_CHARS,
            "max_action_label_chars": _HARD_MAX_ACTION_LABEL_CHARS,
        }
        hard_limit = hard_limits[field_name]
        if value > hard_limit:
            raise ValueError(f"{field_name} must be <= {hard_limit}")
        return value

    @model_validator(mode="after")
    def _validate_file_field_policy(self) -> DifyAskHumanLayerConfig:
        if not self.allow_file_fields:
            forbidden = [field_type for field_type in self.allowed_field_types if field_type in _FILE_FIELD_TYPES]
            if forbidden:
                joined = ", ".join(forbidden)
                raise ValueError(
                    f"allowed_field_types cannot include file field types when allow_file_fields is false: {joined}"
                )
        return self


__all__ = [
    "DEFAULT_ASK_HUMAN_TOOL_DESCRIPTION",
    "DIFY_ASK_HUMAN_LAYER_TYPE_ID",
    "DifyAskHumanLayerConfig",
]
