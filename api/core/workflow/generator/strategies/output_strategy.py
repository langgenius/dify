"""
Structured Output Strategy for LLM responses.

Implements a fallback chain:
1. Tool Use / Function Calling (most reliable)
2. JSON Mode (guaranteed JSON, not guaranteed schema)
3. Raw + Strict Pydantic Validation (fallback)
"""

import json
import logging
import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from core.workflow.generator.types.constants import INTENT_GENERATE, INTENT_OFF_TOPIC

logger = logging.getLogger(__name__)


class OutputMethod(StrEnum):
    """Available methods for structured output."""

    TOOL_USE = "tool_use"
    JSON_MODE = "json_mode"
    RAW_WITH_VALIDATION = "raw_with_validation"


class WorkflowOutput(BaseModel):
    """Expected structure of workflow generation output."""

    intent: str = Field(default=INTENT_GENERATE)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    message: str = Field(default="")
    warnings: list[str] = Field(default_factory=list)
    thinking: str = Field(default="")

    # For off_topic intent
    suggestions: list[str] = Field(default_factory=list)


# JSON Schema for Tool Use
WORKFLOW_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {
            "type": "string",
            "enum": [INTENT_GENERATE, INTENT_OFF_TOPIC],
            "description": "The intent of the response",
        },
        "nodes": {"type": "array", "items": {"type": "object"}, "description": "Workflow nodes"},
        "edges": {"type": "array", "items": {"type": "object"}, "description": "Workflow edges"},
        "message": {"type": "string", "description": "User-friendly message"},
        "warnings": {"type": "array", "items": {"type": "string"}, "description": "Warnings about the generation"},
    },
    "required": ["intent", "nodes", "edges"],
}


def parse_structured_output(content: str) -> dict[str, Any]:
    """
    Parse LLM response into structured dict.

    Handles:
    - Raw JSON
    - JSON in markdown code blocks (including nested ``` in content)
    - Minor JSON syntax issues (trailing commas)

    Raises:
        ValueError: If parsing fails after all attempts
    """
    # Strip whitespace
    content = content.strip()

    # Extract from markdown code block if present
    # Use GREEDY match to handle nested ``` in JSON strings (e.g., prompt templates with code blocks)
    # Find the LAST ``` to properly close the markdown block
    json_match = re.search(r"```(?:json)?\s*([\s\S]+)```", content)
    if json_match:
        extracted = json_match.group(1).strip()
        # If extracted content doesn't look like valid JSON structure, try non-greedy as fallback
        if not (extracted.startswith("{") and extracted.rstrip().endswith("}")):
            # Fallback to non-greedy for simple cases
            json_match_simple = re.search(r"```(?:json)?\s*([\s\S]+?)```", content)
            if json_match_simple:
                extracted = json_match_simple.group(1).strip()
        content = extracted

    last_error: json.JSONDecodeError | None = None

    # Try direct parse
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        last_error = e
        logger.debug("Direct JSON parse failed at pos %d: %s", e.pos, e.msg)

    # Try fixing trailing commas
    cleaned = re.sub(r",\s*([}\]])", r"\1", content)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        last_error = e
        logger.debug("Trailing comma fix parse failed at pos %d: %s", e.pos, e.msg)

    # All attempts failed - log detailed diagnostics
    content_len = len(content)
    content_start = content[:200]
    content_end = content[-200:] if content_len > 200 else content

    error_details = ""
    if last_error:
        error_details = f" JSONDecodeError at pos {last_error.pos}/{content_len}: {last_error.msg}"

    logger.error(
        "JSON parse failed.%s Content length: %d, Start: %s... End: ...%s",
        error_details,
        content_len,
        content_start[:100],
        content_end[-100:],
    )

    raise ValueError(
        f"Failed to parse LLM response as JSON.{error_details} "
        f"Content length: {content_len}, preview: {content_start}"
    )


def validate_workflow_output(data: dict[str, Any]) -> WorkflowOutput:
    """
    Validate parsed data against expected schema.

    Raises:
        ValueError: If validation fails
    """
    try:
        return WorkflowOutput.model_validate(data)
    except ValidationError as e:
        raise ValueError(f"Workflow output validation failed: {e}")


class StructuredOutputStrategy:
    """
    Strategy for obtaining structured output from LLM.

    Detects model capabilities and uses the most reliable method available.
    """

    def __init__(self, model_instance: Any):
        self.model_instance = model_instance
        self._preferred_method: OutputMethod | None = None

    @property
    def preferred_method(self) -> OutputMethod:
        """Detect and cache the preferred output method."""
        if self._preferred_method is not None:
            return self._preferred_method

        # Check if model supports tool use
        try:
            if self._supports_tool_use():
                self._preferred_method = OutputMethod.TOOL_USE
            elif self._supports_json_mode():
                self._preferred_method = OutputMethod.JSON_MODE
            else:
                self._preferred_method = OutputMethod.RAW_WITH_VALIDATION
        except Exception:
            # Default to raw if detection fails
            self._preferred_method = OutputMethod.RAW_WITH_VALIDATION

        logger.info("Using output method: %s", self._preferred_method.value)
        return self._preferred_method

    def _supports_tool_use(self) -> bool:
        """Check if model supports tool/function calling."""
        try:
            # Check model properties for tool support
            props = self.model_instance.model_type_instance.model_properties()
            return props.get("tool_call", False) or props.get("function_call", False)
        except Exception:
            return False

    def _supports_json_mode(self) -> bool:
        """Check if model supports JSON mode."""
        try:
            props = self.model_instance.model_type_instance.model_properties()
            return props.get("json_mode", False)
        except Exception:
            return False

    def build_tool_definition(self) -> dict[str, Any]:
        """Build tool definition for tool use mode."""
        return {
            "type": "function",
            "function": {
                "name": "generate_workflow",
                "description": "Generate a Dify workflow configuration",
                "parameters": WORKFLOW_OUTPUT_SCHEMA,
            },
        }

    def parse_response(self, response: Any, method: OutputMethod) -> WorkflowOutput:
        """
        Parse LLM response based on the method used.

        Args:
            response: Raw LLM response
            method: The output method that was used

        Returns:
            Validated WorkflowOutput

        Raises:
            ValueError: If parsing or validation fails
        """
        if method == OutputMethod.TOOL_USE:
            # Extract from tool call result
            tool_calls = getattr(response.message, "tool_calls", None)
            if tool_calls and len(tool_calls) > 0:
                data = tool_calls[0].function.arguments
                if isinstance(data, str):
                    data = json.loads(data)
                return validate_workflow_output(data)
            # Fallback to content if no tool call
            content = response.message.content
        else:
            content = response.message.content

        # Parse and validate
        data = parse_structured_output(content)
        return validate_workflow_output(data)
