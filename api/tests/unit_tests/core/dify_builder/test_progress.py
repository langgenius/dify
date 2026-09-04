import pytest

from core.dify_builder.contract import ProgressEventData, TraceStep
from core.dify_builder.progress import ProgressReporter


def test_progress_reporter_emits_immutable_full_snapshots_with_monotonic_revisions() -> None:
    events: list[ProgressEventData] = []
    reporter = ProgressReporter(
        emit=events.append,
        session_id="session-1",
        operation_id="operation-1",
        stage_id="build.initial_plan",
        at_version=4,
        steps=[
            TraceStep(id="review", label="Review requirements", state="pending"),
            TraceStep(id="draft", label="Draft the workflow plan", state="pending"),
        ],
    )

    reporter.activate("review")
    reporter.activate("draft")
    final_trace = reporter.finish()

    assert [event.revision for event in events] == [1, 2, 3]
    assert [step.state for step in events[0].trace.steps] == ["active", "pending"]
    assert [step.state for step in events[1].trace.steps] == ["done", "active"]
    assert [step.state for step in events[2].trace.steps] == ["done", "done"]
    assert final_trace == events[2].trace
    assert events[0].trace.steps[0].state == "active"
    assert events[2].operation_id == "operation-1"
    assert events[2].at_version == 4


def test_progress_reporter_can_append_recovery_steps_after_a_failed_activity() -> None:
    events: list[ProgressEventData] = []
    reporter = ProgressReporter(
        emit=events.append,
        session_id="session-1",
        stage_id="build.test_and_repair",
        at_version=2,
        steps=[TraceStep(id="run", label="Run the workflow", state="pending")],
    )

    reporter.activate("run")
    reporter.fail_step("run")
    reporter.add_steps([("diagnose", "Diagnose the failed workflow")])
    reporter.activate("diagnose")
    final_trace = reporter.finish()

    assert [(step.id, step.state, step.tone) for step in final_trace.steps] == [
        ("run", "stopped", "error"),
        ("diagnose", "done", "neutral"),
    ]
    assert events[-1].trace.status == "completed"


def test_progress_reporter_context_closes_active_step_on_exception() -> None:
    events: list[ProgressEventData] = []

    def run_failing_reporter() -> None:
        with ProgressReporter(
            emit=events.append,
            session_id="session-1",
            operation_id="operation-1",
            stage_id="build.execution",
            at_version=2,
            steps=[TraceStep(id="apply", label="Apply changes", state="pending")],
        ) as reporter:
            reporter.activate("apply")
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        run_failing_reporter()

    assert events[-1].trace.status == "error"
    assert events[-1].trace.steps[0].state == "stopped"
    assert events[-1].trace.steps[0].tone == "error"
