"""Parse frontend workflow markers shared by Agent tasks and route validation.

These helpers distinguish previous-node references from reserved workflow
namespaces without depending on application services or resolving values.
"""

from __future__ import annotations

import re

from models.agent_config_entities import WorkflowPreviousNodeOutputRef

WORKFLOW_VARIABLE_PATTERN = re.compile(r"\{\{#([^{}#]+?\.[^{}#]+?)#\}\}")
WORKFLOW_NODE_OUTPUT_RESERVED_PREFIXES = frozenset(
    {"sys", "env", "conversation", "rag", "current", "last_run", "error_message", "$output"}
)


def extract_workflow_variable_selectors(prompt: str) -> list[tuple[str, ...]]:
    """Extract ``{{#node.output#}}``-style selectors from workflow prompts."""
    selectors: list[tuple[str, ...]] = []
    for match in WORKFLOW_VARIABLE_PATTERN.finditer(prompt or ""):
        parts = tuple(part.strip() for part in match.group(1).split(".") if part.strip())
        if len(parts) >= 2:
            selectors.append(parts)
    return selectors


def extract_workflow_node_output_selectors(prompt: str) -> list[tuple[str, ...]]:
    """Extract previous-node selectors from frontend workflow variable markers.

    Reserved Dify namespaces such as ``sys`` are excluded because they are not
    previous nodes.
    """
    selectors: list[tuple[str, ...]] = []
    seen: set[tuple[str, ...]] = set()
    for selector in extract_workflow_variable_selectors(prompt):
        if selector[0] in WORKFLOW_NODE_OUTPUT_RESERVED_PREFIXES:
            continue
        if selector in seen:
            continue
        selectors.append(selector)
        seen.add(selector)
    return selectors


def workflow_previous_node_output_refs_from_selectors(
    selectors: list[tuple[str, ...]],
) -> list[WorkflowPreviousNodeOutputRef]:
    """Materialize persisted previous-node refs from parsed frontend selectors."""
    return [
        WorkflowPreviousNodeOutputRef(
            selector=list(selector),
            node_id=selector[0],
            output=selector[1],
        )
        for selector in selectors
    ]
