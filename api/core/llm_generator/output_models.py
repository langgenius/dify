from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from core.variables.types import SegmentType
from core.workflow.nodes.base.entities import VariableSelector


class SuggestedQuestionsOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questions: list[str] = Field(min_length=3, max_length=3)


class CodeNodeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: SegmentType


class CodeNodeStructuredOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variables: list[VariableSelector]
    code: str
    outputs: dict[str, CodeNodeOutput]
    explanation: str


class InstructionModifyOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modified: str
    message: str
