"""Decide when a run's dropped terminal event can be recovered from its source's committed state.

The decision combines the run's invocations with what its source committed.
``now`` is naive UTC, like the run's timestamps.
"""

from datetime import datetime, timedelta

from domain.tracing.errors import TraceRunError
from domain.tracing.sources import MessageProgress, SourceWorkflowRun
from domain.tracing.trace_run_agg import TraceRunAgg
from graphon.enums import WorkflowExecutionStatus

_SETTLE_SECONDS = 5
_WORKFLOW_TERMINAL = {
    WorkflowExecutionStatus.SUCCEEDED,
    WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
    WorkflowExecutionStatus.FAILED,
    WorkflowExecutionStatus.STOPPED,
}


def message_terminal_due(
    run: TraceRunAgg, progress: MessageProgress, *, now: datetime, collection_timeout: int
) -> bool:
    """Whether the message's committed row is the run's business terminal now.

    Raises:
        TraceRunError: The terminal can no longer arrive.
    """
    invocations = list(run.invocations.values())
    pending_agent_stop = progress.agent_app and progress.agent_stop_requested
    if progress.paused and not pending_agent_stop:
        return False
    if any(not invocation.finalized or invocation.finalized_at is None for invocation in invocations):
        if (progress.explicit_error or pending_agent_stop) and progress.updated_at + timedelta(
            seconds=collection_timeout
        ) < now:
            raise TraceRunError("agent_trace_collection_incomplete")
        return False
    finalized = [invocation.finalized_at for invocation in invocations if invocation.finalized_at is not None]
    anchor = max([progress.updated_at, *finalized])
    if pending_agent_stop:
        # Even a fully saved partial answer/usage cannot establish which
        # runtime terminal won the stop race. Wait for the existing worker
        # handoff, or converge to incomplete delivery after its deadline.
        if anchor + timedelta(seconds=collection_timeout) < now:
            raise TraceRunError("business_terminal_not_persisted")
        return False
    if run.capture_agent and not invocations:
        return False
    if anchor + timedelta(seconds=_SETTLE_SECONDS) > now:
        return False
    if not (progress.explicit_error or progress.answer_saved):
        if finalized and max(finalized) + timedelta(seconds=collection_timeout) < now:
            raise TraceRunError("business_terminal_not_persisted")
        return False
    return True


def workflow_terminal_due(workflow: SourceWorkflowRun, *, now: datetime) -> bool:
    """Whether the workflow run finished long enough ago for its node executions to be saved."""
    if workflow.status not in _WORKFLOW_TERMINAL or workflow.finished_at is None:
        return False
    return workflow.finished_at + timedelta(seconds=_SETTLE_SECONDS) <= now
