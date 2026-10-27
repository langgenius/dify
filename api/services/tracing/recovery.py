"""Recover dropped in-memory terminal events from committed business records.

Runtime finalization can precede the API's final answer transaction. In particular,
AgentAppRunner persists usage independently, so usage alone is not proof that a
Message is complete. Recovery never invents answers, usage, or success states.
"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent, TracePayload, WorkflowRunCompleted

from graphon.enums import WorkflowExecutionStatus
from services.tracing.collection import ApplicationTraceStore, TraceRun, TraceRunState
from services.tracing.delivery import TraceCollector, TraceRecordSource
from services.tracing.errors import (
    SourceNotFoundError,
    SourceNotReadyError,
    TraceCollectionError,
    TraceCollectionNotFoundError,
    TracingStoreUnavailableError,
)
from services.tracing.records import MessageTraceInfo, WorkflowTraceInfo

logger = logging.getLogger(__name__)
_SETTLE_SECONDS = 5
_WORKFLOW_TERMINAL = {
    WorkflowExecutionStatus.SUCCEEDED,
    WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
    WorkflowExecutionStatus.FAILED,
    WorkflowExecutionStatus.STOPPED,
}


def _event(run: TraceRun, payload: TracePayload, user_id: str | None) -> TraceEvent:
    return TraceEvent(
        event_id=uuid4().hex,
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        user_id=user_id,
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id=None,
            session_id=run.session_id,
            parent_workflow_run_id=None,
            parent_node_execution_id=None,
        ),
        payload=payload,
    )


def _message_event(
    traces: ApplicationTraceStore, run: TraceRun, now: datetime, collection_timeout: int
) -> TraceEvent | None:
    progress = traces.message_progress(tenant_id=run.tenant_id, app_id=run.app_id, message_id=run.source_id)
    if progress is None:
        raise TraceCollectionNotFoundError("tracing_source_not_found")
    pending_agent_stop = progress.agent_app and progress.agent_stop_requested
    if progress.paused and not pending_agent_stop:
        return None
    invocations = traces.invocations(run.id)
    if any(not invocation.finalized or invocation.finalized_at is None for invocation in invocations):
        if (progress.explicit_error or pending_agent_stop) and progress.updated_at + timedelta(
            seconds=collection_timeout
        ) < now:
            raise TraceCollectionError("agent_trace_collection_incomplete")
        return None
    finalized = [invocation.finalized_at for invocation in invocations if invocation.finalized_at is not None]
    anchor = max([progress.updated_at, *finalized])
    if pending_agent_stop:
        # Even a fully saved partial answer/usage cannot establish which
        # runtime terminal won the stop race. Wait for the existing worker
        # handoff, or converge to incomplete delivery after its deadline.
        if anchor + timedelta(seconds=collection_timeout) < now:
            raise TraceCollectionError("business_terminal_not_persisted")
        return None
    if run.capture_agent and not invocations:
        return None
    if anchor + timedelta(seconds=_SETTLE_SECONDS) > now:
        return None
    if not (progress.explicit_error or progress.answer_saved):
        if finalized and max(finalized) + timedelta(seconds=collection_timeout) < now:
            raise TraceCollectionError("business_terminal_not_persisted")
        return None
    return _event(run, MessageCompleted(message_id=progress.message_id, conversation_id=progress.conversation_id), None)


def _workflow_event(traces: ApplicationTraceStore, run: TraceRun, now: datetime) -> TraceEvent | None:
    workflow = traces.workflow_run(tenant_id=run.tenant_id, app_id=run.app_id, workflow_run_id=run.source_id)
    # An asynchronous workflow repository may not have saved the reserved run yet.
    if workflow is None or workflow.status not in _WORKFLOW_TERMINAL or workflow.finished_at is None:
        return None
    if workflow.finished_at + timedelta(seconds=_SETTLE_SECONDS) > now:
        return None
    conversation_id = traces.workflow_run_conversation_id(
        tenant_id=run.tenant_id, app_id=run.app_id, workflow_run_id=workflow.id
    )
    return _event(
        run,
        WorkflowRunCompleted(workflow_run_id=workflow.id, conversation_id=conversation_id, total_tokens=None),
        workflow.created_by,
    )


def recover_terminal(
    run: TraceRun,
    *,
    traces: ApplicationTraceStore,
    records: TraceRecordSource,
    collector: TraceCollector,
    collection_timeout: int,
    now: datetime,
) -> bool:
    """Attempt one bounded recovery and rotate unresolved work behind other runs.

    ``now`` is naive UTC, like the ledger's timestamps.
    """
    if (
        run.outer_trace is not None
        or run.state not in {TraceRunState.COLLECTING, TraceRunState.READY}
        or run.source_kind not in {"message", "workflow"}
    ):
        return False
    error_code: str | None = None
    try:
        event = (
            _message_event(traces, run, now, collection_timeout)
            if run.source_kind == "message"
            else _workflow_event(traces, run, now)
        )
        if event is None:
            return False
        try:
            info = records.assemble(event)
        except SourceNotReadyError:
            return False
        except SourceNotFoundError:
            raise TraceCollectionError("business_terminal_recovery_incomplete") from None
        if not isinstance(info, (MessageTraceInfo, WorkflowTraceInfo)):
            raise TraceCollectionError("business_terminal_recovery_incomplete")
        if not collector.capture_terminal(tenant_id=run.tenant_id, info=info):
            raise TraceCollectionError("business_terminal_recovery_unclaimed")
        return True
    except TraceCollectionError as error:
        error_code = error.code
        return False
    except TracingStoreUnavailableError:
        # Leave the durable source intact. The next reconciler pass can retry.
        logger.warning("Application trace recovery database unavailable: run_id=%s", run.id)
        return False
    except Exception as error:
        error_code = "business_terminal_recovery_failed"
        logger.warning("Application trace recovery failed: run_id=%s error_type=%s", run.id, type(error).__name__)
        return False
    finally:
        traces.recovery_checked(run.id, error_code=error_code)
