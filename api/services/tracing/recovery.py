"""Recover dropped in-memory terminal events from committed business records.

Runtime finalization can precede the API's final answer transaction. In particular,
AgentAppRunner persists usage independently, so usage alone is not proof that a
Message is complete. Recovery never invents answers, usage, or success states.
"""

import json
import logging
import math
from datetime import datetime, timedelta
from typing import Protocol, cast

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from configs import dify_config
from core.ops.entities.trace_entity import BaseTraceInfo, MessageTraceInfo, TraceTaskName, WorkflowTraceInfo
from core.ops.ops_trace_manager import TraceTask
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import MessageStatus
from models.model import App, AppMode, Conversation, Message, MessageDict
from models.workflow import WorkflowRun
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError

logger = logging.getLogger(__name__)
_SETTLE_SECONDS = 5
_WORKFLOW_TERMINAL = {
    WorkflowExecutionStatus.SUCCEEDED,
    WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
    WorkflowExecutionStatus.FAILED,
    WorkflowExecutionStatus.STOPPED,
}


class RecoveryTarget(Protocol):
    repository: ApplicationTraceRepository

    def capture_terminal(self, info: BaseTraceInfo) -> bool: ...


def agent_stop_requested(message: Message) -> bool:
    """Read the consumer's stop intent without inferring cancellation success."""
    try:
        metadata = json.loads(message.message_metadata) if message.message_metadata else {}
    except (ValueError, TypeError):
        return False
    return isinstance(metadata, dict) and metadata.get("agent_stop_requested") is True


def _complete_message_metadata(message: Message) -> bool:
    """Recognize the EasyUI _save_message transaction, not an early usage flush."""
    try:
        metadata = json.loads(message.message_metadata) if message.message_metadata else {}
    except (ValueError, TypeError):
        return False
    if (
        not isinstance(metadata, dict)
        or not {"annotation_reply", "retriever_resources", "reasoning"} <= metadata.keys()
    ):
        return False
    usage = metadata.get("usage")
    if not isinstance(usage, dict):
        return False
    for name in ("prompt_tokens", "completion_tokens"):
        value = usage.get(name)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
            return False
    latency = message.provider_response_latency
    return isinstance(latency, (int, float)) and math.isfinite(latency) and latency >= 0


def _message_task(repository: ApplicationTraceRepository, run: ApplicationTraceRun, now: datetime) -> TraceTask | None:
    with repository.sessions() as session:
        source = session.execute(
            select(Message, App.mode)
            .join(App, App.id == Message.app_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.id == run.source_id,
                Message.app_id == run.app_id,
                App.tenant_id == run.tenant_id,
                Conversation.app_id == run.app_id,
            )
        ).one_or_none()
        if source is None:
            raise TraceCollectionError("tracing_source_not_found", 404)
        message, app_mode = source
        pending_agent_stop = app_mode == AppMode.AGENT and agent_stop_requested(message)
        if message.status is MessageStatus.PAUSED and not pending_agent_stop:
            return None
        invocations = list(
            session.scalars(select(ApplicationTraceInvocation).where(ApplicationTraceInvocation.run_id == run.id))
        )
        explicit_error = message.status is MessageStatus.ERROR and bool(message.error)
        if any(not invocation.finalized or invocation.finalized_at is None for invocation in invocations):
            if (explicit_error or pending_agent_stop) and message.updated_at + timedelta(
                seconds=dify_config.OPS_AGENT_TRACE_COLLECTION_TIMEOUT
            ) < now:
                raise TraceCollectionError("agent_trace_collection_incomplete")
            return None
        finalized = [invocation.finalized_at for invocation in invocations if invocation.finalized_at is not None]
        anchor = max([message.updated_at, *finalized])
        if pending_agent_stop:
            # Even a fully saved partial answer/usage cannot establish which
            # runtime terminal won the stop race. Wait for the existing worker
            # handoff, or converge to incomplete delivery after its deadline.
            if anchor + timedelta(seconds=dify_config.OPS_AGENT_TRACE_COLLECTION_TIMEOUT) < now:
                raise TraceCollectionError("business_terminal_not_persisted")
            return None
        if run.capture_agent and not invocations:
            return None
        if anchor + timedelta(seconds=_SETTLE_SECONDS) > now:
            return None
        complete = explicit_error or (
            message.status is MessageStatus.NORMAL
            and message.updated_at > message.created_at
            and _complete_message_metadata(message)
        )
        if not complete:
            if finalized and max(finalized) + timedelta(seconds=dify_config.OPS_AGENT_TRACE_COLLECTION_TIMEOUT) < now:
                raise TraceCollectionError("business_terminal_not_persisted")
            return None
        return TraceTask(
            TraceTaskName.MESSAGE_TRACE,
            message_id=message.id,
            conversation_id=message.conversation_id,
            trace_session_id=run.session_id,
        )


def _workflow_task(repository: ApplicationTraceRepository, run: ApplicationTraceRun, now: datetime) -> TraceTask | None:
    workflow = repository._source(tenant_id=run.tenant_id, app_id=run.app_id, kind="workflow", source_id=run.source_id)
    # An asynchronous workflow repository may not have saved the reserved run yet.
    if (
        not isinstance(workflow, WorkflowRun)
        or workflow.status not in _WORKFLOW_TERMINAL
        or workflow.finished_at is None
    ):
        return None
    if workflow.finished_at + timedelta(seconds=_SETTLE_SECONDS) > now:
        return None
    with repository.sessions() as session:
        conversation_id = session.scalar(
            select(Message.conversation_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.app_id == run.app_id, Message.workflow_run_id == workflow.id, Conversation.app_id == run.app_id
            )
            .limit(1)
        )
        return TraceTask(
            TraceTaskName.WORKFLOW_TRACE,
            workflow_run_id=workflow.id,
            conversation_id=conversation_id,
            trace_session_id=run.session_id,
            user_id=workflow.created_by,
        )


def recover_terminal(target: RecoveryTarget, run: ApplicationTraceRun) -> bool:
    """Attempt one bounded recovery and rotate unresolved work behind other runs."""
    if (
        run.outer_trace is not None
        or run.state not in {"collecting", "ready"}
        or run.source_kind not in {"message", "workflow"}
    ):
        return False
    error_code: str | None = None
    try:
        task = (_message_task if run.source_kind == "message" else _workflow_task)(
            target.repository, run, naive_utc_now()
        )
        if task is None:
            return False
        info = task.execute()
        if isinstance(info, MessageTraceInfo) and isinstance(info.message_data, dict):
            info = info.model_copy(update={"message_data": Message.from_dict(cast(MessageDict, info.message_data))})
        if isinstance(info, WorkflowTraceInfo) and isinstance(info.workflow_data, dict):
            info = info.model_copy(update={"workflow_data": WorkflowRun.from_dict(info.workflow_data)})
        if not isinstance(info, (MessageTraceInfo, WorkflowTraceInfo)):
            raise TraceCollectionError("business_terminal_recovery_incomplete")
        if not target.capture_terminal(info):
            raise TraceCollectionError("business_terminal_recovery_unclaimed")
        return True
    except TraceCollectionError as error:
        error_code = error.code
        return False
    except SQLAlchemyError:
        # Leave the durable source intact. The next reconciler pass can retry.
        logger.warning("Application trace recovery database unavailable: run_id=%s", run.id)
        return False
    except Exception as error:
        error_code = "business_terminal_recovery_failed"
        logger.warning("Application trace recovery failed: run_id=%s error_type=%s", run.id, type(error).__name__)
        return False
    finally:
        target.repository.recovery_checked(run.id, error_code=error_code)
