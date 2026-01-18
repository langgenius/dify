from enum import StrEnum


class WorkflowStartReason(StrEnum):
    """Reason for workflow start events across graph/queue/SSE layers."""

    INITIAL = "initial"  # First start of a workflow run.
    RESUMPTION = "resumption"  # Start triggered after resuming a paused run.
