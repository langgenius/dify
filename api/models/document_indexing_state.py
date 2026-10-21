"""Effective document indexing state and its supported recovery command."""

from dataclasses import dataclass
from typing import Literal

from enums.knowledge import DocumentIndexRetryAction


@dataclass(frozen=True)
class EffectiveDocumentIndexingState:
    indexing_status: str
    display_status: str | None
    indexing_state: Literal["pending", "completed", "failed"] | None
    indexing_retry_action: DocumentIndexRetryAction | None
    error: str | None


def resolve_document_indexing_state(
    *,
    raw_status: str,
    is_paused: bool,
    enabled: bool,
    archived: bool,
    task_status: str | None,
    task_action: str | None,
    raw_error: str | None = None,
    task_error: str | None = None,
) -> EffectiveDocumentIndexingState:
    """Apply one current generation's task outcome to the stored processing phase.

    A failed add/remove intent retries the desired-state command, preserving
    completed source material. The body retry command is reserved for enabled,
    non-archived documents whose stored processing phase failed.
    """

    retry_action: DocumentIndexRetryAction | None = None
    indexing_state: Literal["pending", "completed", "failed"] | None = None
    status = raw_status
    if task_status == "failed":
        indexing_state = "failed"
        status = "error"
        if task_action == "remove":
            retry_action = "archive" if archived else "disable"
        elif task_action == "add" and enabled and not archived:
            retry_action = "enable"
    elif task_status == "completed":
        indexing_state = "completed"
    elif task_status in {"pending", "processing", "dispatched", "executing"}:
        indexing_state = "pending"
        if raw_status in {"completed", "error"}:
            status = "indexing"

    if indexing_state != "pending" and status == "error" and retry_action is None and enabled and not archived:
        retry_action = "retry"

    if status not in {"completed", "error"} and is_paused:
        status = "paused"
        display_status = "paused"
    elif status == "waiting":
        display_status = "queuing"
    elif status in {"parsing", "cleaning", "splitting", "indexing"}:
        display_status = "indexing"
    elif status == "error":
        display_status = "error"
    elif status == "completed":
        display_status = "archived" if archived else "available" if enabled else "disabled"
    else:
        display_status = None
    error = task_error if indexing_state == "failed" else None if indexing_state == "pending" else raw_error
    return EffectiveDocumentIndexingState(status, display_status, indexing_state, retry_action, error)
