"""Recover dropped in-memory terminal events from committed business records.

Runtime finalization can precede the API's final answer transaction. In particular,
AgentAppRunner persists usage independently, so usage alone is not proof that a
Message is complete. Recovery never invents answers, usage, or success states.
"""

import logging
from datetime import UTC, datetime
from uuid import uuid4

from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent, TracePayload, WorkflowRunCompleted

from domain.tracing.errors import TraceRunError
from domain.tracing.terminal_recovery import message_terminal_due, workflow_terminal_due
from domain.tracing.trace_run_agg import TraceRunAgg
from libs.datetime_utils import naive_utc_now
from services.tracing.collection_ports import TraceRunRepository, TraceSourceQuery
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


def _event(run: TraceRunAgg, payload: TracePayload, user_id: str | None) -> TraceEvent:
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
    sources: TraceSourceQuery, run: TraceRunAgg, now: datetime, collection_timeout: int
) -> TraceEvent | None:
    progress = sources.message_progress(tenant_id=run.tenant_id, app_id=run.app_id, message_id=run.source_id)
    if progress is None:
        raise TraceCollectionNotFoundError("tracing_source_not_found")
    if not message_terminal_due(run, progress, now=now, collection_timeout=collection_timeout):
        return None
    return _event(run, MessageCompleted(message_id=progress.message_id, conversation_id=progress.conversation_id), None)


def _workflow_event(sources: TraceSourceQuery, run: TraceRunAgg, now: datetime) -> TraceEvent | None:
    workflow = sources.workflow_run(tenant_id=run.tenant_id, app_id=run.app_id, workflow_run_id=run.source_id)
    # An asynchronous workflow repository may not have saved the reserved run yet.
    if workflow is None or not workflow_terminal_due(workflow, now=now):
        return None
    conversation_id = sources.workflow_run_conversation_id(
        tenant_id=run.tenant_id, app_id=run.app_id, workflow_run_id=workflow.id
    )
    return _event(
        run,
        WorkflowRunCompleted(workflow_run_id=workflow.id, conversation_id=conversation_id, total_tokens=None),
        workflow.created_by,
    )


def recover_terminal(
    run: TraceRunAgg,
    *,
    runs: TraceRunRepository,
    sources: TraceSourceQuery,
    records: TraceRecordSource,
    collector: TraceCollector,
    collection_timeout: int,
    now: datetime,
) -> bool:
    """Attempt one bounded recovery and rotate unresolved work behind other runs.

    ``now`` is naive UTC, like the ledger's timestamps.
    """
    if not run.awaits_terminal or run.source_kind not in {"message", "workflow"}:
        return False
    error_code: str | None = None
    try:
        event = (
            _message_event(sources, run, now, collection_timeout)
            if run.source_kind == "message"
            else _workflow_event(sources, run, now)
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
    except (TraceCollectionError, TraceRunError) as error:
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
        with runs.change(run.id, tenant_id=run.tenant_id) as locked:
            if locked is not None:
                locked.run.recovery_checked(error_code, now=naive_utc_now())
