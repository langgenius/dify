"""
Clarification helper for agent node human-in-the-loop support.

This module provides extensibility hooks for future HITL (Human-In-The-Loop) features.
Currently, it serves as a placeholder for clarification request extraction and handling.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .entities import AgentNodeData


def should_enable_clarification(node_data: AgentNodeData) -> bool:
    """
    Check if human clarification is enabled for this agent node.

    Args:
        node_data: The agent node data configuration.

    Returns:
        True if human clarification is enabled, False otherwise.
    """
    return node_data.enable_human_clarification


def extract_clarification_request(
    _agent_output: dict[str, Any],
    enable_clarification: bool,
) -> dict[str, Any] | None:
    """
    Extract clarification request from agent output if enabled.

    This is a placeholder for future HITL implementation.
    Currently returns None as clarification is not yet implemented.

    Args:
        _agent_output: The output from agent execution. Currently unused, reserved for future HITL expansion.
        enable_clarification: Whether clarification is enabled.

    Returns:
        Clarification request dict if found and enabled, None otherwise.
    """
    if not enable_clarification:
        return None

    # Placeholder for future clarification extraction logic
    # This will be extended when HITL feature is fully implemented
    return None
