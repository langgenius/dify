import pytest

from core.dify_builder.contract import ExecutionActivity, ProgressEventData
from core.dify_builder.models import NodeEvent
from core.dify_builder.progress import ProgressReporter


def _activity(activity_id: str, label: str) -> ExecutionActivity:
    return ExecutionActivity(id=activity_id, label=label, state="active")


def test_progress_reporter_reveals_only_started_activities_with_monotonic_revisions() -> None:
    events: list[ProgressEventData] = []
    reporter = ProgressReporter(
        emit=events.append,
        session_id="session-1",
        operation_id="operation-1",
        stage_id="build.initial_plan",
        at_version=4,
        activities=[
            _activity("review", "Review requirements"),
            _activity("draft", "Draft the workflow plan"),
        ],
    )

    reporter.activate("review")
    reporter.activate("draft")
    final_execution = reporter.finish()

    assert [event.revision for event in events] == [1, 2, 3]
    assert [(item.id, item.state) for item in events[0].execution.activities] == [("review", "active")]
    assert [(item.id, item.state) for item in events[1].execution.activities] == [
        ("review", "done"),
        ("draft", "active"),
    ]
    assert [item.state for item in events[2].execution.activities] == ["done", "done"]
    assert final_execution == events[2].execution
    assert events[0].execution.activities[0].state == "active"
    assert events[2].operation_id == "operation-1"
    assert events[2].at_version == 4


def test_progress_reporter_keeps_unselected_branch_steps_private() -> None:
    events: list[ProgressEventData] = []
    reporter = ProgressReporter(
        emit=events.append,
        session_id="session-1",
        stage_id="build.test_and_repair",
        at_version=2,
        activities=[_activity("run", "Run the workflow")],
    )

    reporter.activate("run")
    reporter.fail_step("run")
    reporter.add_steps([("diagnose", "Diagnose the failed workflow")])
    assert [item.id for item in events[-1].execution.activities] == ["run"]

    reporter.activate("diagnose")
    final_execution = reporter.finish()

    assert [(item.id, item.state) for item in final_execution.activities] == [
        ("run", "failed"),
        ("diagnose", "done"),
    ]
    assert events[-1].execution.status == "completed"


def test_progress_reporter_nests_workflow_nodes_under_the_running_stage() -> None:
    events: list[ProgressEventData] = []
    reporter = ProgressReporter(
        emit=events.append,
        session_id="session-1",
        stage_id="build.test_and_repair",
        at_version=2,
        activities=[_activity("run", "Run the workflow")],
    )

    reporter.activate("run")
    reporter.observe_node("run", NodeEvent(node_id="llm", title="Generate answer", status="running"))
    reporter.observe_node("run", NodeEvent(node_id="llm", title="Generate answer", status="succeeded"))

    node = events[-1].execution.activities[-1]
    assert (node.id, node.kind, node.parent_id, node.state) == ("node:llm", "node", "run", "done")


def test_progress_reporter_context_marks_active_activity_failed_on_exception() -> None:
    events: list[ProgressEventData] = []

    def run_failing_reporter() -> None:
        with ProgressReporter(
            emit=events.append,
            session_id="session-1",
            operation_id="operation-1",
            stage_id="build.execution",
            at_version=2,
            activities=[_activity("apply", "Apply changes")],
        ) as reporter:
            reporter.activate("apply")
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        run_failing_reporter()

    assert events[-1].execution.status == "error"
    assert events[-1].execution.activities[0].state == "failed"
