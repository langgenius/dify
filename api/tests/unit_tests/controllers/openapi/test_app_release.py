import json
from datetime import datetime, timedelta

import pytest

from controllers.openapi.app_release import passed_on_draft
from graphon.enums import WorkflowExecutionStatus
from models.workflow import WorkflowRun
from services.workflow.contracts import WorkflowRecord

_GRAPH = '{"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []}'
_OTHER_GRAPH = '{"nodes": [{"id": "llm", "data": {"type": "llm"}}], "edges": []}'
_RUN_STARTED = datetime(2026, 10, 15, 12, 0, 0)


def _draft(*, saved_at: datetime, graph: str = _GRAPH) -> WorkflowRecord:
    return WorkflowRecord(
        id="draft-1",
        graph=json.loads(graph),
        features={},
        hash="draft-hash",
        version="draft",
        version_number=None,
        marked_name="",
        marked_comment="",
        created_by=None,
        created_at=saved_at,
        updated_by=None,
        updated_at=saved_at,
        tool_published=False,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _run(*, status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED, graph: str = _GRAPH) -> WorkflowRun:
    return WorkflowRun(status=status, graph=graph, created_at=_RUN_STARTED)


def test_a_passing_run_on_the_unchanged_draft_counts() -> None:
    assert passed_on_draft(_run(), _draft(saved_at=_RUN_STARTED - timedelta(minutes=1))) is True


def test_a_draft_saved_after_the_run_started_needs_a_new_test() -> None:
    """Environment variables, conversation variables and features live outside the run's graph."""
    assert passed_on_draft(_run(), _draft(saved_at=_RUN_STARTED + timedelta(seconds=1))) is False


@pytest.mark.parametrize(
    "run",
    [
        pytest.param(None, id="no-run"),
        pytest.param(_run(status=WorkflowExecutionStatus.FAILED), id="failed"),
        pytest.param(_run(graph=_OTHER_GRAPH), id="other-graph"),
    ],
)
def test_no_passing_run_on_this_graph_does_not_count(run: WorkflowRun | None) -> None:
    assert passed_on_draft(run, _draft(saved_at=_RUN_STARTED - timedelta(minutes=1))) is False
