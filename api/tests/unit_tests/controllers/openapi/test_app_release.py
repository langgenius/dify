from datetime import datetime, timedelta
from typing import cast

import pytest

from controllers.openapi.app_release import DraftTestOutcome, draft_test_outcome
from graphon.enums import WorkflowExecutionStatus
from models.workflow import Workflow, WorkflowRun, WorkflowType

_GRAPH = '{"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []}'
_OTHER_GRAPH = '{"nodes": [{"id": "llm", "data": {"type": "llm"}}], "edges": []}'
_RUN_STARTED = datetime(2026, 10, 15, 12, 0, 0)


def _draft(*, saved_at: datetime, graph: str = _GRAPH) -> Workflow:
    draft = Workflow(
        tenant_id="workspace-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=graph,
        features="{}",
        created_by="account-1",
    )
    draft.updated_at = saved_at
    return draft


def _run(*, status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED, graph: str = _GRAPH) -> WorkflowRun:
    return WorkflowRun(status=status, graph=graph, created_at=_RUN_STARTED)


_BEFORE = _RUN_STARTED - timedelta(minutes=1)


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        pytest.param(WorkflowExecutionStatus.SUCCEEDED, DraftTestOutcome.PASSED, id="succeeded"),
        pytest.param(
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            DraftTestOutcome.PASSED_WITH_HANDLED_ERRORS,
            id="partial-succeeded",
        ),
    ],
)
def test_a_finished_run_on_the_unchanged_draft_counts(
    status: WorkflowExecutionStatus, expected: DraftTestOutcome
) -> None:
    outcome = draft_test_outcome(_run(status=status), _draft(saved_at=_BEFORE))
    assert outcome is expected
    assert outcome.passed is True


@pytest.mark.parametrize(
    "status",
    [WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.PARTIAL_SUCCEEDED],
)
def test_a_draft_saved_after_the_run_started_needs_a_new_test(status: WorkflowExecutionStatus) -> None:
    """Environment variables, conversation variables and features live outside the run's graph."""
    run = _run(status=status)
    assert draft_test_outcome(run, _draft(saved_at=_RUN_STARTED + timedelta(seconds=1))) is DraftTestOutcome.UNTESTED


@pytest.mark.parametrize(
    "run",
    [
        pytest.param(None, id="no-run"),
        pytest.param(_run(status=WorkflowExecutionStatus.FAILED), id="failed"),
        pytest.param(_run(status=WorkflowExecutionStatus.STOPPED), id="stopped"),
        pytest.param(_run(status=WorkflowExecutionStatus.RUNNING), id="running"),
        pytest.param(_run(status=WorkflowExecutionStatus.PAUSED), id="paused"),
        pytest.param(_run(graph=_OTHER_GRAPH), id="other-graph"),
        pytest.param(
            _run(status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED, graph=_OTHER_GRAPH),
            id="partial-succeeded-other-graph",
        ),
        pytest.param(_run(status=cast(WorkflowExecutionStatus, "a-future-status")), id="unknown-status"),
    ],
)
def test_no_passing_run_on_this_graph_does_not_count(run: WorkflowRun | None) -> None:
    outcome = draft_test_outcome(run, _draft(saved_at=_BEFORE))
    assert outcome is DraftTestOutcome.UNTESTED
    assert outcome.passed is False


def test_each_outcome_has_its_own_detail() -> None:
    assert DraftTestOutcome.PASSED.detail == "The last draft test passed on this draft"
    assert DraftTestOutcome.PASSED_WITH_HANDLED_ERRORS.detail == (
        "The last draft test passed on this draft; some node errors were handled by their error strategy"
    )
    assert DraftTestOutcome.UNTESTED.detail == "No passing draft test on the current draft"
