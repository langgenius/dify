"""Stable error types for Claude workflow schema validation.

The import controller needs machine-readable failure information so the web
flow can distinguish invalid Claude workflow files from later compiler or Dify
DSL import failures. These errors stay scoped to the Claude workflow schema
layer and do not depend on Flask or persistence concerns.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ClaudeWorkflowSchemaErrorCode(StrEnum):
    """Stable error codes returned by Claude workflow schema validation."""

    INVALID_FIELD = "invalid_field"
    UNKNOWN_EDGE_TARGET = "unknown_edge_target"
    UNKNOWN_VARIABLE_SELECTOR_SOURCE = "unknown_variable_selector_source"
    UNSUPPORTED_NODE_TYPE = "unsupported_node_type"


@dataclass(frozen=True, slots=True)
class ClaudeWorkflowValidationIssue:
    """A single schema validation problem with a precise field path."""

    code: ClaudeWorkflowSchemaErrorCode
    path: tuple[str | int, ...]
    message: str


class ClaudeWorkflowSchemaValidationError(ValueError):
    """Raised when a Claude workflow file fails schema validation."""

    errors: list[ClaudeWorkflowValidationIssue]

    def __init__(self, errors: list[ClaudeWorkflowValidationIssue]) -> None:
        self.errors = errors
        super().__init__("Claude workflow schema validation failed")


class ClaudeWorkflowCompilerError(ValueError):
    """Raised when a validated Claude workflow cannot be compiled to Dify DSL."""
