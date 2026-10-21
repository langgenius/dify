from dataclasses import dataclass
from typing import Literal

import pytest

from enums.knowledge import DocumentIndexRetryAction
from models.document_indexing_state import resolve_document_indexing_state
from models.enums import IndexingStatus


@dataclass(frozen=True)
class _StateCase:
    name: str
    raw_status: IndexingStatus
    expected_indexing_status: str
    expected_display_status: str
    expected_indexing_state: Literal["pending", "completed", "failed"] | None = None
    expected_retry_action: DocumentIndexRetryAction | None = None
    expected_error: str | None = None
    enabled: bool = True
    archived: bool = False
    paused: bool = False
    task_status: str | None = None
    task_action: str | None = None


_STATE_CASES = (
    _StateCase("raw-completed", IndexingStatus.COMPLETED, "completed", "available"),
    _StateCase("raw-waiting", IndexingStatus.WAITING, "waiting", "queuing"),
    _StateCase("raw-parsing", IndexingStatus.PARSING, "parsing", "indexing"),
    _StateCase("raw-paused", IndexingStatus.PARSING, "paused", "paused", paused=True),
    _StateCase(
        "raw-error-active",
        IndexingStatus.ERROR,
        "error",
        "error",
        expected_retry_action="retry",
        expected_error="body failed",
    ),
    _StateCase(
        "raw-error-disabled",
        IndexingStatus.ERROR,
        "error",
        "error",
        expected_error="body failed",
        enabled=False,
    ),
    _StateCase(
        "raw-error-archived",
        IndexingStatus.ERROR,
        "error",
        "error",
        expected_error="body failed",
        archived=True,
    ),
    _StateCase(
        "failed-add-from-completed",
        IndexingStatus.COMPLETED,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="enable",
        expected_error="state failed",
        task_status="failed",
        task_action="add",
    ),
    _StateCase(
        "failed-add-from-processing",
        IndexingStatus.INDEXING,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="enable",
        expected_error="state failed",
        task_status="failed",
        task_action="add",
    ),
    _StateCase(
        "failed-remove-disabled",
        IndexingStatus.COMPLETED,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="disable",
        expected_error="state failed",
        enabled=False,
        task_status="failed",
        task_action="remove",
    ),
    _StateCase(
        "failed-remove-archived",
        IndexingStatus.PARSING,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="archive",
        expected_error="state failed",
        archived=True,
        task_status="failed",
        task_action="remove",
    ),
    _StateCase(
        "completed-state",
        IndexingStatus.COMPLETED,
        "completed",
        "available",
        expected_indexing_state="completed",
        task_status="completed",
        task_action="add",
    ),
    *(
        _StateCase(
            f"{task_status}-from-completed",
            IndexingStatus.COMPLETED,
            "indexing",
            "indexing",
            expected_indexing_state="pending",
            task_status=task_status,
            task_action="add",
        )
        for task_status in ("pending", "processing", "dispatched", "executing")
    ),
    _StateCase(
        "pending-hides-raw-error",
        IndexingStatus.ERROR,
        "indexing",
        "indexing",
        expected_indexing_state="pending",
        task_status="pending",
        task_action="add",
    ),
)


@pytest.mark.parametrize("case", _STATE_CASES, ids=lambda case: case.name)
def test_resolve_document_indexing_state_projects_current_task_outcome(case: _StateCase) -> None:
    effective = resolve_document_indexing_state(
        raw_status=str(case.raw_status),
        is_paused=case.paused,
        enabled=case.enabled,
        archived=case.archived,
        task_status=case.task_status,
        task_action=case.task_action,
        raw_error="body failed" if case.raw_status == IndexingStatus.ERROR else None,
        task_error="state failed" if case.task_status == "failed" else None,
    )

    assert effective.indexing_status == case.expected_indexing_status
    assert effective.display_status == case.expected_display_status
    assert effective.indexing_state == case.expected_indexing_state
    assert effective.indexing_retry_action == case.expected_retry_action
    assert effective.error == case.expected_error
