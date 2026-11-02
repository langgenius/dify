"""Persistence of Agent trace runs and reads of the sources they are collected for.

Runs load and save as whole aggregates under their row lock; reads return
records. Rows become aggregates or records before their session closes. Every
database failure is reported as TracingStoreUnavailableError.
"""

import json
import math
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from datetime import timedelta
from typing import Any, override

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from domain.tracing.sources import MessageProgress, SourceNodeExecution, SourceWorkflowRun
from domain.tracing.trace_run_agg import (
    TraceBatch,
    TraceBatchReceipt,
    TraceInvocation,
    TraceRunAgg,
    TraceRunState,
    TraceSourceKind,
)
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import MessageStatus
from models.model import App, AppMode, Conversation, Message, TraceAppConfig
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.tracing_store_errors import tracing_store_errors
from services.tracing.collection import AppTracingSnapshot, SourceMessage, TraceApp, TraceAppMode, TraceRun
from services.tracing.collection_ports import LockedTraceRun, TraceRunQuery, TraceRunRepository, TraceSourceQuery
from services.tracing.errors import TraceCollectionConflictError

_SOURCE_KINDS: dict[str, TraceSourceKind] = {"message": "message", "workflow": "workflow", "node": "node"}
_APP_MODES = {
    AppMode.AGENT: TraceAppMode.AGENT,
    AppMode.ADVANCED_CHAT: TraceAppMode.ADVANCED_CHAT,
    AppMode.WORKFLOW: TraceAppMode.WORKFLOW,
}


def _message_metadata(message: Message) -> Mapping[str, Any]:
    try:
        metadata = json.loads(message.message_metadata) if message.message_metadata else {}
    except (ValueError, TypeError):
        return {}
    return metadata if isinstance(metadata, dict) else {}


def _agent_stop_requested(message: Message) -> bool:
    """Read the consumer's stop intent without inferring cancellation success."""
    return _message_metadata(message).get("agent_stop_requested") is True


def _answer_saved(message: Message) -> bool:
    """Recognize the EasyUI _save_message transaction, not an early usage flush."""
    if message.status is not MessageStatus.NORMAL or message.updated_at <= message.created_at:
        return False
    metadata = _message_metadata(message)
    if not {"annotation_reply", "retriever_resources", "reasoning"} <= metadata.keys():
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


def _stored_policy(raw: str | None) -> Mapping[str, Any]:
    """``App.tracing`` as written; a policy that cannot be read is empty."""
    try:
        policy = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return policy if isinstance(policy, dict) else {}


def _run(row: ApplicationTraceRun) -> TraceRun:
    return TraceRun(
        id=row.id,
        tenant_id=row.tenant_id,
        app_id=row.app_id,
        source_kind=_SOURCE_KINDS[row.source_kind],
        source_id=row.source_id,
        provider=row.provider,
        config_revision=row.config_revision,
        provider_config=dict(row.provider_config),
        trace_id=row.trace_id,
        root_span_id=row.root_span_id,
        session_id=row.session_id,
        capture_content=row.capture_content,
        capture_agent=row.capture_agent,
        state=TraceRunState(row.state),
        outer_trace=dict(row.outer_trace) if row.outer_trace is not None else None,
        span_count=row.span_count,
        attempts=row.attempts,
        error_code=row.error_code,
        trace_url=row.trace_url,
        provider_trace_id=row.provider_trace_id,
        span_urls=dict(row.span_urls),
        accepted_at=row.accepted_at,
    )


def _aggregate(
    row: ApplicationTraceRun,
    invocations: list[ApplicationTraceInvocation],
    receipts: list[tuple[str, str, str]],
) -> TraceRunAgg:
    return TraceRunAgg(
        id=row.id,
        tenant_id=row.tenant_id,
        app_id=row.app_id,
        source_kind=_SOURCE_KINDS[row.source_kind],
        source_id=row.source_id,
        provider=row.provider,
        config_revision=row.config_revision,
        provider_config=dict(row.provider_config),
        trace_id=row.trace_id,
        root_span_id=row.root_span_id,
        session_id=row.session_id,
        capture_content=row.capture_content,
        capture_agent=row.capture_agent,
        state=TraceRunState(row.state),
        outer_trace=dict(row.outer_trace) if row.outer_trace is not None else None,
        span_count=row.span_count,
        payload_bytes=row.payload_bytes,
        attempts=row.attempts,
        error_code=row.error_code,
        trace_url=row.trace_url,
        provider_trace_id=row.provider_trace_id,
        span_urls=dict(row.span_urls),
        export_token=row.export_token,
        export_started_at=row.export_started_at,
        export_heartbeat_at=row.export_heartbeat_at,
        next_attempt_at=row.next_attempt_at,
        accepted_at=row.accepted_at,
        terminal_at=row.terminal_at,
        updated_at=row.updated_at,
        invocations={invocation.id: _invocation(invocation) for invocation in invocations},
        receipts={
            batch_id: TraceBatchReceipt(id=batch_id, invocation_id=invocation_id, payload_hash=payload_hash)
            for batch_id, invocation_id, payload_hash in receipts
        },
    )


def _new_row(run: TraceRunAgg) -> ApplicationTraceRun:
    return ApplicationTraceRun(
        id=run.id,
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        source_kind=run.source_kind,
        source_id=run.source_id,
        provider=run.provider,
        config_revision=run.config_revision,
        provider_config=dict(run.provider_config),
        trace_id=run.trace_id,
        root_span_id=run.root_span_id,
        session_id=run.session_id,
        capture_content=run.capture_content,
        capture_agent=run.capture_agent,
        state=run.state,
        error_code=run.error_code,
        terminal_at=run.terminal_at,
        updated_at=run.updated_at,
    )


def _save(row: ApplicationTraceRun, run: TraceRunAgg) -> None:
    """Copy the fields a run's transitions change; its source, destination, and policy stay frozen."""
    row.state = run.state
    row.outer_trace = dict(run.outer_trace) if run.outer_trace is not None else None
    row.root_span_id = run.root_span_id
    row.span_count = run.span_count
    row.payload_bytes = run.payload_bytes
    row.attempts = run.attempts
    row.error_code = run.error_code
    row.trace_url = run.trace_url
    row.provider_trace_id = run.provider_trace_id
    row.span_urls = dict(run.span_urls)
    row.export_token = run.export_token
    row.export_started_at = run.export_started_at
    row.export_heartbeat_at = run.export_heartbeat_at
    row.next_attempt_at = run.next_attempt_at
    row.accepted_at = run.accepted_at
    row.terminal_at = run.terminal_at
    row.updated_at = run.updated_at


def _invocation(row: ApplicationTraceInvocation) -> TraceInvocation:
    return TraceInvocation(
        id=row.id,
        run_id=row.run_id,
        agent_id=row.agent_id,
        parent_span_id=row.parent_span_id,
        span_id=row.span_id,
        node_execution_id=row.node_execution_id,
        attempt=row.attempt,
        finalized=row.finalized,
        finalized_at=row.finalized_at,
    )


class ApplicationTraceRepository(TraceRunRepository, TraceRunQuery, TraceSourceQuery):
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @contextmanager
    def _read(self) -> Generator[Session]:
        with tracing_store_errors(), self._sessions() as session:
            yield session

    @contextmanager
    def _write(self) -> Generator[Session]:
        with tracing_store_errors(), self._sessions.begin() as session:
            yield session

    def _owned_app_id(self, session: Session, *, tenant_id: str, app_id: str) -> str | None:
        return session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id))

    def _source_row(
        self, *, tenant_id: str, app_id: str, kind: TraceSourceKind, source_id: str
    ) -> Message | WorkflowRun | WorkflowNodeExecutionModel | None:
        # Close the SQL owner read before consulting a configured backend: LogStore
        # can perform network I/O and need not have a corresponding SQL run/node row.
        with self._read() as session:
            if self._owned_app_id(session, tenant_id=tenant_id, app_id=app_id) is None:
                return None
            if kind == "message":
                return session.scalar(select(Message).where(Message.id == source_id, Message.app_id == app_id))
        source: WorkflowRun | WorkflowNodeExecutionModel | None
        with tracing_store_errors():
            if kind == "workflow":
                repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._sessions)
                source = repository.get_workflow_run_by_id(tenant_id=tenant_id, app_id=app_id, run_id=source_id)
            else:
                node_repository = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(self._sessions)
                source = node_repository.get_execution_by_id(execution_id=source_id, tenant_id=tenant_id)
        # The node reader has no app filter. Check the entire chain on either
        # backend's result before exposing a destination or authorizing a retry.
        if source is None or (source.id, source.tenant_id, source.app_id) != (source_id, tenant_id, app_id):
            return None
        return source

    @override
    def app(self, *, tenant_id: str, app_id: str) -> TraceApp | None:
        with self._read() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
            if app is None:
                return None
            return TraceApp(
                id=app.id,
                tenant_id=app.tenant_id,
                mode=_APP_MODES.get(app.mode, TraceAppMode.OTHER),
                workflow_id=app.workflow_id,
            )

    @override
    def app_workflow_graph(self, *, tenant_id: str, app_id: str, workflow_id: str) -> str | None:
        with self._read() as session:
            return session.scalar(
                select(Workflow.graph).where(
                    Workflow.id == workflow_id, Workflow.app_id == app_id, Workflow.tenant_id == tenant_id
                )
            )

    @override
    def message(self, *, tenant_id: str, app_id: str, message_id: str) -> SourceMessage | None:
        with self._read() as session:
            message = session.scalar(
                select(Message)
                .join(App, App.id == Message.app_id)
                .where(Message.id == message_id, Message.app_id == app_id, App.tenant_id == tenant_id)
            )
            if message is None:
                return None
            return SourceMessage(
                id=message.id,
                conversation_id=message.conversation_id,
                workflow_run_id=message.workflow_run_id,
                agent_stop_requested=_agent_stop_requested(message),
            )

    @override
    def workflow_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> SourceWorkflowRun | None:
        run = self._source_row(tenant_id=tenant_id, app_id=app_id, kind="workflow", source_id=workflow_run_id)
        if not isinstance(run, WorkflowRun):
            return None
        return SourceWorkflowRun(
            id=run.id,
            workflow_id=run.workflow_id,
            graph=run.graph,
            status=run.status,
            finished_at=run.finished_at,
            created_by=run.created_by,
        )

    @override
    def node_execution(self, *, tenant_id: str, app_id: str, node_execution_id: str) -> SourceNodeExecution | None:
        node = self._source_row(tenant_id=tenant_id, app_id=app_id, kind="node", source_id=node_execution_id)
        if not isinstance(node, WorkflowNodeExecutionModel):
            return None
        return SourceNodeExecution(
            id=node.id,
            node_id=node.node_id,
            workflow_id=node.workflow_id,
            workflow_run_id=node.workflow_run_id,
            title=node.title,
            status=str(node.status),
            error=node.error,
            inputs=node.inputs,
            outputs=node.outputs,
            created_at=node.created_at,
            elapsed_time=node.elapsed_time,
        )

    @override
    def workflow_run_conversation_id(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> str | None:
        with self._read() as session:
            return session.scalar(
                select(Message.conversation_id)
                .join(App, App.id == Message.app_id)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Message.app_id == app_id,
                    App.tenant_id == tenant_id,
                    Message.workflow_run_id == workflow_run_id,
                    Conversation.app_id == app_id,
                )
                .limit(1)
            )

    @override
    def message_progress(self, *, tenant_id: str, app_id: str, message_id: str) -> MessageProgress | None:
        with self._read() as session:
            source = session.execute(
                select(Message, App.mode)
                .join(App, App.id == Message.app_id)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Message.id == message_id,
                    Message.app_id == app_id,
                    App.tenant_id == tenant_id,
                    Conversation.app_id == app_id,
                )
            ).one_or_none()
            if source is None:
                return None
            message, app_mode = source
            return MessageProgress(
                message_id=message.id,
                conversation_id=message.conversation_id,
                agent_app=app_mode == AppMode.AGENT,
                paused=message.status is MessageStatus.PAUSED,
                explicit_error=message.status is MessageStatus.ERROR and bool(message.error),
                answer_saved=_answer_saved(message),
                agent_stop_requested=_agent_stop_requested(message),
                updated_at=message.updated_at,
            )

    @override
    def app_tracing(self, *, tenant_id: str, app_id: str) -> AppTracingSnapshot | None:
        with self._read() as session:
            app = session.execute(select(App.tracing).where(App.id == app_id, App.tenant_id == tenant_id)).first()
            if app is None:
                return None
            policy = _stored_policy(app.tracing)
            provider = policy.get("tracing_provider")
            config = (
                session.scalar(
                    select(TraceAppConfig.tracing_config).where(
                        TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == provider
                    )
                )
                if isinstance(provider, str)
                else None
            )
            return AppTracingSnapshot(policy=policy, config=dict(config) if isinstance(config, dict) else None)

    @override
    def add(self, run: TraceRunAgg) -> bool:
        with self._write() as session:
            try:
                with session.begin_nested():
                    session.add(_new_row(run))
            except IntegrityError:
                # A locking read sees the committed winner even under MySQL's REPEATABLE READ snapshot.
                winner = session.scalar(
                    select(ApplicationTraceRun.id)
                    .where(
                        ApplicationTraceRun.tenant_id == run.tenant_id,
                        ApplicationTraceRun.app_id == run.app_id,
                        ApplicationTraceRun.source_kind == run.source_kind,
                        ApplicationTraceRun.source_id == run.source_id,
                    )
                    .with_for_update()
                )
                if winner is None:
                    raise
                return False
            return True

    @staticmethod
    def _invocation_models(session: Session, run_id: str) -> list[ApplicationTraceInvocation]:
        return list(
            session.scalars(
                select(ApplicationTraceInvocation)
                .where(ApplicationTraceInvocation.run_id == run_id)
                .order_by(
                    ApplicationTraceInvocation.attempt,
                    ApplicationTraceInvocation.created_at,
                    ApplicationTraceInvocation.id,
                )
            )
        )

    @staticmethod
    def _load(session: Session, row: ApplicationTraceRun, invocations: list[ApplicationTraceInvocation]) -> TraceRunAgg:
        receipts = [
            (batch_id, invocation_id, payload_hash)
            for batch_id, invocation_id, payload_hash in session.execute(
                select(
                    ApplicationTraceBatch.id,
                    ApplicationTraceBatch.invocation_id,
                    ApplicationTraceBatch.payload_hash,
                ).where(ApplicationTraceBatch.run_id == row.id)
            )
        ]
        return _aggregate(row, invocations, receipts)

    @override
    def load(self, run_id: str) -> TraceRunAgg | None:
        with self._read() as session:
            row = session.get(ApplicationTraceRun, run_id)
            if row is None:
                return None
            return self._load(session, row, self._invocation_models(session, run_id))

    @override
    @contextmanager
    def change(self, run_id: str, *, tenant_id: str) -> Generator[LockedTraceRun | None]:
        with self._write() as session:
            row = session.scalar(
                select(ApplicationTraceRun)
                .where(ApplicationTraceRun.id == run_id, ApplicationTraceRun.tenant_id == tenant_id)
                .with_for_update()
            )
            if row is None:
                yield None
                return
            invocation_models = self._invocation_models(session, run_id)
            run = self._load(session, row, invocation_models)
            invocation_rows = {invocation.id: invocation for invocation in invocation_models}
            owner_exists = self._owned_app_id(session, tenant_id=row.tenant_id, app_id=row.app_id) is not None
            yield LockedTraceRun(run=run, owner_exists=owner_exists)
            _save(row, run)
            for invocation in run.invocations.values():
                stored = invocation_rows.get(invocation.id)
                if stored is None:
                    session.add(
                        ApplicationTraceInvocation(
                            id=invocation.id,
                            run_id=invocation.run_id,
                            agent_id=invocation.agent_id,
                            parent_span_id=invocation.parent_span_id,
                            span_id=invocation.span_id,
                            node_execution_id=invocation.node_execution_id,
                            attempt=invocation.attempt,
                            finalized=invocation.finalized,
                            finalized_at=invocation.finalized_at,
                        )
                    )
                elif stored.finalized != invocation.finalized:
                    stored.finalized, stored.finalized_at = invocation.finalized, invocation.finalized_at
            session.flush()
            try:
                with session.begin_nested():
                    session.add_all(
                        ApplicationTraceBatch(
                            id=batch.id,
                            run_id=run.id,
                            invocation_id=batch.invocation_id,
                            payload_hash=batch.payload_hash,
                            spans=[dict(span) for span in batch.spans],
                            final=batch.final,
                        )
                        for batch in run.new_batches
                    )
            except IntegrityError:
                # Batch IDs are unique across runs; another run already stores this one.
                raise TraceCollectionConflictError("tracing_batch_conflict") from None

    @override
    def source_run(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None:
        with self._read() as session:
            run = session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )
            return _run(run) if run is not None else None

    @override
    def workflow_run_trace(self, *, tenant_id: str, workflow_run_id: str) -> TraceRun | None:
        with self._read() as session:
            run = session.scalar(
                select(ApplicationTraceRun)
                .join(App, App.id == ApplicationTraceRun.app_id)
                .where(
                    ApplicationTraceRun.source_kind == "workflow",
                    ApplicationTraceRun.source_id == workflow_run_id,
                    ApplicationTraceRun.tenant_id == tenant_id,
                    App.tenant_id == tenant_id,
                )
            )
            return _run(run) if run is not None else None

    @override
    def get(self, run_id: str) -> TraceRun | None:
        with self._read() as session:
            run = session.get(ApplicationTraceRun, run_id)
            return _run(run) if run is not None else None

    @override
    def invocations(self, run_id: str) -> list[TraceInvocation]:
        with self._read() as session:
            return [_invocation(row) for row in self._invocation_models(session, run_id)]

    @override
    def batches(self, run_id: str) -> list[TraceBatch]:
        with self._read() as session:
            return [
                TraceBatch(
                    id=row.id,
                    invocation_id=row.invocation_id,
                    payload_hash=row.payload_hash,
                    spans=list(row.spans),
                    final=row.final,
                )
                for row in session.scalars(
                    select(ApplicationTraceBatch)
                    .where(ApplicationTraceBatch.run_id == run_id)
                    .order_by(ApplicationTraceBatch.created_at)
                )
            ]

    @override
    def pending_ids(self, limit: int) -> list[str]:
        with self._read() as session:
            return list(
                session.scalars(
                    select(ApplicationTraceRun.id)
                    .where(
                        ApplicationTraceRun.state.in_(
                            [
                                TraceRunState.COLLECTING,
                                TraceRunState.READY,
                                TraceRunState.RETRYING,
                                TraceRunState.EXPORTING,
                            ]
                        ),
                        or_(
                            ApplicationTraceRun.next_attempt_at.is_(None),
                            ApplicationTraceRun.next_attempt_at <= naive_utc_now(),
                        ),
                    )
                    .order_by(ApplicationTraceRun.terminal_at.is_(None), ApplicationTraceRun.updated_at)
                    .limit(limit)
                )
            )

    @override
    def purge(self, *, retention_days: int, limit: int) -> int:
        cutoff = naive_utc_now() - timedelta(days=retention_days)
        with self._write() as session:
            ids = list(
                session.scalars(
                    select(ApplicationTraceRun.id)
                    .where(ApplicationTraceRun.created_at < cutoff)
                    .limit(limit)
                    .with_for_update()
                )
            )
            if not ids:
                return 0
            session.execute(delete(ApplicationTraceBatch).where(ApplicationTraceBatch.run_id.in_(ids)))
            session.execute(delete(ApplicationTraceInvocation).where(ApplicationTraceInvocation.run_id.in_(ids)))
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id.in_(ids)))
            return len(ids)
