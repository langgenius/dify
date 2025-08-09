"""Template structures for Response nodes (Answer and End).

This module provides a unified template structure for both Answer and End nodes,
similar to SegmentGroup but focused on template representation without values.
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Union

from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser


@dataclass(frozen=True)
class TemplateSegment(ABC):
    """Base class for template segments."""

    @abstractmethod
    def __str__(self) -> str:
        """String representation of the segment."""
        pass


@dataclass(frozen=True)
class TextSegment(TemplateSegment):
    """A text segment in a template."""

    text: str

    def __str__(self) -> str:
        return self.text


@dataclass(frozen=True)
class VariableSegment(TemplateSegment):
    """A variable reference segment in a template."""

    selector: Sequence[str]
    variable_name: str | None = None  # Optional variable name for End nodes

    def __str__(self) -> str:
        return "{{#" + ".".join(self.selector) + "#}}"


# Type alias for segments
TemplateSegmentUnion = Union[TextSegment, VariableSegment]


@dataclass(frozen=True)
class Template:
    """Unified template structure for Response nodes.

    Similar to SegmentGroup, but represents the template structure
    without variable values - only marking variable selectors.
    """

    segments: list[TemplateSegmentUnion]

    @classmethod
    def from_answer_template(cls, template_str: str) -> "Template":
        """Create a Template from an Answer node template string.

        Example:
            "Hello, {{#node1.name#}}" -> [TextSegment("Hello, "), VariableSegment(["node1", "name"])]

        Args:
            template_str: The answer template string

        Returns:
            Template instance
        """
        parser = VariableTemplateParser(template_str)
        segments: list[TemplateSegmentUnion] = []

        # Extract variable selectors to find all variables
        variable_selectors = parser.extract_variable_selectors()
        var_map = {var.variable: var.value_selector for var in variable_selectors}

        # Parse template to get ordered segments
        # We need to split the template by variable placeholders while preserving order
        import re

        # Create a regex pattern that matches variable placeholders
        pattern = r"\{\{(#[a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10}#)\}\}"

        # Split template while keeping the delimiters (variable placeholders)
        parts = re.split(pattern, template_str)

        for i, part in enumerate(parts):
            if not part:
                continue

            # Check if this part is a variable reference (odd indices after split)
            if i % 2 == 1:  # Odd indices are variable keys
                # Remove the # symbols from the variable key
                var_key = part
                if var_key in var_map:
                    segments.append(VariableSegment(selector=list(var_map[var_key])))
                else:
                    # This shouldn't happen with valid templates
                    segments.append(TextSegment(text="{{" + part + "}}"))
            else:
                # Even indices are text segments
                segments.append(TextSegment(text=part))

        return cls(segments=segments)

    @classmethod
    def from_end_outputs(cls, outputs_config: list[dict[str, Any]]) -> "Template":
        """Create a Template from an End node outputs configuration.

        End nodes are treated as templates of concatenated variables with newlines.

        Example:
            [{"variable": "text", "value_selector": ["node1", "text"]},
             {"variable": "result", "value_selector": ["node2", "result"]}]
            ->
            [VariableSegment(["node1", "text"]),
             TextSegment("\n"),
             VariableSegment(["node2", "result"])]

        Args:
            outputs_config: List of output configurations with variable and value_selector

        Returns:
            Template instance
        """
        segments: list[TemplateSegmentUnion] = []

        for i, output in enumerate(outputs_config):
            if i > 0:
                # Add newline separator between variables
                segments.append(TextSegment(text="\n"))

            value_selector = output.get("value_selector", [])
            variable_name = output.get("variable", "")
            if value_selector:
                segments.append(VariableSegment(selector=list(value_selector), variable_name=variable_name))

        if len(segments) > 0 and isinstance(segments[-1], TextSegment):
            segments = segments[:-1]

        return cls(segments=segments)

    def __str__(self) -> str:
        """String representation of the template."""
        return "".join(str(segment) for segment in self.segments)
