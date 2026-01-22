from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from core.variables.types import SegmentType


class SuggestedQuestionsOutput(BaseModel):
    """Output model for suggested questions generation."""

    model_config = ConfigDict(extra="forbid")

    questions: list[str] = Field(
        min_length=3,
        max_length=3,
        description="Exactly 3 suggested follow-up questions for the user",
    )


class VariableSelectorOutput(BaseModel):
    """Variable selector mapping code variable to upstream node output.

    Note: Separate from VariableSelector to ensure 'additionalProperties: false'
    in JSON schema for OpenAI/Azure strict mode.
    """

    model_config = ConfigDict(extra="forbid")

    variable: str = Field(description="Variable name used in the generated code")
    value_selector: list[str] = Field(description="Path to upstream node output, format: [node_id, output_name]")


class CodeNodeOutputItem(BaseModel):
    """Single output variable definition.

    Note: OpenAI/Azure strict mode requires 'additionalProperties: false' and
    does not support dynamic object keys, so outputs use array format.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="Output variable name returned by the main function")
    type: SegmentType = Field(description="Data type of the output variable")


class CodeNodeStructuredOutput(BaseModel):
    """Structured output for code node generation."""

    model_config = ConfigDict(extra="forbid")

    variables: list[VariableSelectorOutput] = Field(
        description="Input variables mapping code variables to upstream node outputs"
    )
    code: str = Field(description="Generated code with a main function that processes inputs and returns outputs")
    outputs: list[CodeNodeOutputItem] = Field(
        description="Output variable definitions specifying name and type for each return value"
    )
    explanation: str = Field(description="Brief explanation of what the generated code does")


class InstructionModifyOutput(BaseModel):
    """Output model for instruction-based prompt modification."""

    model_config = ConfigDict(extra="forbid")

    modified: str = Field(description="The modified prompt content after applying the instruction")
    message: str = Field(description="Brief explanation of what changes were made")
