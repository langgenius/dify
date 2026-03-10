"""
Helpers for normalizing workflow run trigger source filters across repositories.
"""

from collections.abc import Sequence

from models.enums import WorkflowRunTriggeredFrom


def normalize_workflow_run_triggered_from_values(
    triggered_from: WorkflowRunTriggeredFrom | Sequence[WorkflowRunTriggeredFrom] | str,
) -> list[str]:
    """
    Normalize `triggered_from` filters into a string list.

    Supports single enum/string values and sequences of enum/string values.
    """
    if isinstance(triggered_from, WorkflowRunTriggeredFrom):
        return [triggered_from.value]
    if isinstance(triggered_from, str):
        return [triggered_from]

    values: list[str] = []
    for item in triggered_from:
        if isinstance(item, WorkflowRunTriggeredFrom):
            values.append(item.value)
        elif isinstance(item, str):
            values.append(item)
    return values
