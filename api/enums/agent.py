"""Agent ownership types shared across persistence and use cases."""

from enum import StrEnum


class WorkflowAgentBindingType(StrEnum):
    """How a workflow node is bound to an Agent."""

    # Node uses a reusable Agent from the workspace roster.
    ROSTER_AGENT = "roster_agent"
    # Node owns a workflow-only Agent that is not visible in the roster.
    INLINE_AGENT = "inline_agent"
