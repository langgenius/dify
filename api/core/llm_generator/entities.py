"""Shared payload models for LLM generator helpers and controllers."""

from enum import StrEnum

from pydantic import BaseModel, Field, field_validator

from core.app.app_config.entities import ModelConfig


class RuleGeneratePayload(BaseModel):
    instruction: str = Field(..., description="Rule generation instruction")
    model_config_data: ModelConfig = Field(
        ...,
        alias="model_config",
        description="Model configuration",
    )
    no_variable: bool = Field(default=False, description="Whether to exclude variables")


class RuleCodeGeneratePayload(RuleGeneratePayload):
    code_language: str = Field(default="javascript", description="Programming language for code generation")


class RuleStructuredOutputPayload(BaseModel):
    instruction: str = Field(..., description="Structured output generation instruction")
    model_config_data: ModelConfig = Field(
        ...,
        alias="model_config",
        description="Model configuration",
    )


class DecisionGenerateVariable(BaseModel):
    """One variable the decision node can read from upstream nodes."""

    value_selector: list[str] = Field(..., description="Selector path of the variable, e.g. ['start', 'amount']")
    type: str = Field(
        ...,
        description="Workflow variable type the frontend uses ('string', 'number', 'boolean', 'array[string]', ...)",
    )
    description: str = Field(default="", description="Optional human description of the variable")


class DecisionGenerateOutcome(BaseModel):
    """An outcome the author already configured; the generator keeps it and only writes its 'when'."""

    id: str = Field(..., description="Existing outcome id; kept exactly")
    label: str = Field(default="", description="Existing outcome label; kept exactly")


class DecisionGenerateMode(StrEnum):
    """How the decision node should pick an outcome.

    ``decision_model`` is reserved for a later phase and is never generated, so
    it is not accepted here either.
    """

    RULES = "rules"
    LLM = "llm"


class DecisionGeneratePayload(BaseModel):
    """Payload for the decision-node configuration generator."""

    instruction: str = Field(..., description="The author's one-sentence description of the decision")
    model_config_data: ModelConfig = Field(
        ...,
        alias="model_config",
        description="Model configuration",
    )
    available_variables: list[DecisionGenerateVariable] = Field(
        default_factory=list,
        description="Variables the node can read from upstream, with their workflow types",
    )
    decide_by: DecisionGenerateMode | None = Field(
        default=None,
        description="Force the deciding mode ('rules' or 'llm'); null lets the generator recommend one",
    )
    outcomes: list[DecisionGenerateOutcome] = Field(
        default_factory=list,
        description="Existing outcomes to keep (id and label); the generator only writes their 'when'",
    )
    language: str | None = Field(
        default=None,
        description="Locale for labels and reasons; when absent the instruction's language is used",
    )

    @field_validator("instruction")
    @classmethod
    def _require_instruction(cls, value: str) -> str:
        """Reject whitespace-only instructions before a model roundtrip is spent on them."""
        if not value.strip():
            raise ValueError("Instruction must not be empty")
        return value
