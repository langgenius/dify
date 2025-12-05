"""
LLM Generation Detail entities.

Defines the structure for storing and transmitting LLM generation details
including reasoning content, tool calls, and their sequence.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ContentSegment(BaseModel):
    """Represents a content segment in the generation sequence."""

    type: Literal["content"] = "content"
    start: int = Field(..., description="Start position in the text")
    end: int = Field(..., description="End position in the text")


class ReasoningSegment(BaseModel):
    """Represents a reasoning segment in the generation sequence."""

    type: Literal["reasoning"] = "reasoning"
    index: int = Field(..., description="Index into reasoning_content array")


class ToolCallSegment(BaseModel):
    """Represents a tool call segment in the generation sequence."""

    type: Literal["tool_call"] = "tool_call"
    index: int = Field(..., description="Index into tool_calls array")


SequenceSegment = ContentSegment | ReasoningSegment | ToolCallSegment


class ToolCallDetail(BaseModel):
    """Represents a tool call with its arguments and result."""

    id: str = Field(default="", description="Unique identifier for the tool call")
    name: str = Field(..., description="Name of the tool")
    arguments: str = Field(default="", description="JSON string of tool arguments")
    result: str = Field(default="", description="Result from the tool execution")


class LLMGenerationDetailData(BaseModel):
    """
    Domain model for LLM generation detail.

    Contains the structured data for reasoning content, tool calls,
    and their display sequence.
    """

    reasoning_content: list[str] = Field(default_factory=list, description="List of reasoning segments")
    tool_calls: list[ToolCallDetail] = Field(default_factory=list, description="List of tool call details")
    sequence: list[SequenceSegment] = Field(default_factory=list, description="Display order of segments")

    def is_empty(self) -> bool:
        """Check if there's any meaningful generation detail."""
        return not self.reasoning_content and not self.tool_calls

    def to_response_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "reasoning_content": self.reasoning_content,
            "tool_calls": [tc.model_dump() for tc in self.tool_calls],
            "sequence": [seg.model_dump() for seg in self.sequence],
        }
