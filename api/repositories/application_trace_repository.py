"""Bounded transactions for Agent trace collection and delivery leases.

Rows become collection records before their session closes. Every database
failure is reported as TracingStoreUnavailableError.
"""

import hashlib
import json
import math
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from datetime import timedelta
from typing import Any, override
from uuid import UUID, uuid5

from dify_agent.protocol.tracing import AgentTraceBatch
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.provider import SendResult
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import MessageStatus
from models.model import App, AppMode, Conversation, Message, TraceAppConfig
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.tracing_store_errors import tracing_store_errors
from services.tracing.collection import (
    CLOSED_STATES,
    ApplicationTraceStore,
    MessageProgress,
    SourceMessage,
    SourceNodeExecution,
    SourceWorkflowRun,
    TraceApp,
    TraceAppMode,
    TraceBatch,
    TraceInvocation,
    TraceRun,
    TraceRunState,
    TraceSourceKind,
)
from services.tracing.errors import (
    TraceCollectionConflictError,
    TraceCollectionLimitError,
    TraceCollectionNotFoundError,
)
from services.tracing.normalization import safe_attributes

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


class ApplicationTraceRepository(ApplicationTraceStore):
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
    def start(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        session_id: str,
        workflow_id: str | None,
    ) -> TraceRun | None:
        # Re-entry uses the already validated, frozen source. It must not depend
        # on LogStore availability or indexing latency after collection began.
        with self._read() as session:
            if self._owned_app_id(session, tenant_id=tenant_id, app_id=app_id) is None:
                return None
            existing = session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )
            if existing is not None:
                return _run(existing)
        source = self._source_row(tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id)
        with self._write() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
            if app is None:
                return None
            existing = session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )
            if existing is not None:
                return _run(existing)
            if source is None:
                # A single-node preview allocates its execution ID before the
                # node row is saved. Only the trusted workflow builder may reserve
                # it, after checking its persisted owner workflow here.
                if source_kind not in {"node", "workflow"} or workflow_id is None:
                    return None
                workflow = session.scalar(
                    select(Workflow).where(
                        Workflow.id == workflow_id, Workflow.app_id == app_id, Workflow.tenant_id == tenant_id
                    )
                )
                if workflow is None:
                    return None
            try:
                policy = json.loads(app.tracing) if app.tracing else {}
            except (TypeError, ValueError):
                policy = {}
            if not isinstance(policy, dict):
                policy = {}
            provider = policy.get("tracing_provider")
            config = (
                session.scalar(
                    select(TraceAppConfig).where(
                        TraceAppConfig.app_id == app_id,
                        TraceAppConfig.tracing_provider == provider,
                    )
                )
                if isinstance(provider, str) and policy.get("enabled") is True
                else None
            )
            enabled = config is not None and isinstance(config.tracing_config, dict)
            frozen = (
                dict(config.tracing_config) if config is not None and isinstance(config.tracing_config, dict) else {}
            )
            revision = hashlib.sha256(
                json.dumps({"config": frozen, "policy": policy}, sort_keys=True, default=str).encode()
            ).hexdigest()
            record = ApplicationTraceRun(
                id=str(uuidv7()),
                tenant_id=tenant_id,
                app_id=app_id,
                source_kind=source_kind,
                source_id=source_id,
                provider=provider if enabled and isinstance(provider, str) else "",
                config_revision=revision,
                provider_config=frozen,
                trace_id=uuidv7().hex,
                root_span_id=span_id_for(source_id),
                session_id=session_id[:255] or source_id,
                capture_content=enabled and policy.get("capture_content", False) is True,
                capture_agent=enabled and policy.get("capture_agent", True) is True,
                state=TraceRunState.COLLECTING if enabled else TraceRunState.NOT_COLLECTED,
            )
            return _run(self._insert_or_get(session, record))

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
    def record_initialization_failure(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None:
        """A missing start snapshot must never fall back to an unmasked exporter."""
        source = self._source_row(tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id)
        if source is None:
            return None
        with self._write() as session:
            if self._owned_app_id(session, tenant_id=tenant_id, app_id=app_id) is None:
                return None
            current = session.scalar(
                select(ApplicationTraceRun).where(
                    ApplicationTraceRun.tenant_id == tenant_id,
                    ApplicationTraceRun.app_id == app_id,
                    ApplicationTraceRun.source_kind == source_kind,
                    ApplicationTraceRun.source_id == source_id,
                )
            )
            if current is not None:
                return _run(current)
            current = ApplicationTraceRun(
                id=str(uuidv7()),
                tenant_id=tenant_id,
                app_id=app_id,
                source_kind=source_kind,
                source_id=source_id,
                provider="",
                config_revision="",
                provider_config={},
                trace_id=uuidv7().hex,
                root_span_id=span_id_for(source_id),
                session_id=source_id,
                capture_content=False,
                capture_agent=False,
                state=TraceRunState.FAILED,
                error_code="tracing_initialization_failed",
                terminal_at=naive_utc_now(),
            )
            return _run(self._insert_or_get(session, current))

    @staticmethod
    def _insert_or_get(session: Session, record: ApplicationTraceRun) -> ApplicationTraceRun:
        """Insert a run; when a concurrent start won the unique source key, return its run instead.

        The first frozen destination wins, so one execution never exports to two providers.
        """
        try:
            with session.begin_nested():
                session.add(record)
        except IntegrityError:
            # A locking read sees the committed winner even under MySQL's REPEATABLE READ snapshot.
            existing = session.scalar(
                select(ApplicationTraceRun)
                .where(
                    ApplicationTraceRun.tenant_id == record.tenant_id,
                    ApplicationTraceRun.app_id == record.app_id,
                    ApplicationTraceRun.source_kind == record.source_kind,
                    ApplicationTraceRun.source_id == record.source_id,
                )
                .with_for_update()
            )
            if existing is None:
                raise
            return existing
        return record

    @staticmethod
    def _locked_run(session: Session, run_id: str) -> ApplicationTraceRun | None:
        return session.scalar(select(ApplicationTraceRun).where(ApplicationTraceRun.id == run_id).with_for_update())

    @override
    def invocation(
        self, *, run_id: str, agent_id: str, node_execution_id: str | None, attempt: int, call_key: str
    ) -> TraceInvocation:
        identifier = str(uuid5(UUID(run_id), call_key))
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if run is None or run.state not in {TraceRunState.COLLECTING, TraceRunState.READY}:
                raise TraceCollectionConflictError("tracing_run_not_collecting")
            invocation = session.get(ApplicationTraceInvocation, identifier)
            if invocation is not None and (
                invocation.agent_id != agent_id
                or invocation.node_execution_id != node_execution_id
                or invocation.attempt != attempt
            ):
                raise TraceCollectionConflictError("tracing_invocation_conflict")
            if invocation is None:
                invocation = ApplicationTraceInvocation(
                    id=identifier,
                    run_id=run_id,
                    agent_id=agent_id,
                    parent_span_id=span_id_for(node_execution_id) if node_execution_id else run.root_span_id,
                    span_id=span_id_for(f"agent-attempt:{identifier}"),
                    node_execution_id=node_execution_id,
                    attempt=attempt,
                )
                session.add(invocation)
            return _invocation(invocation)

    @override
    def ingest(self, batch: AgentTraceBatch, *, max_spans: int, max_bytes: int) -> tuple[int, str]:
        # Hash the original validated payload. Sanitization cannot turn two
        # conflicting producer payloads into a falsely successful replay.
        data = batch.model_dump(mode="json")
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(canonical).hexdigest()
        with self._write() as session:
            run = self._locked_run(session, str(batch.run_id))
            if run is None:
                raise TraceCollectionNotFoundError("tracing_run_not_found")
            if self._owned_app_id(session, tenant_id=run.tenant_id, app_id=run.app_id) is None:
                raise TraceCollectionNotFoundError("tracing_owner_not_found")
            invocation = session.scalar(
                select(ApplicationTraceInvocation).where(
                    ApplicationTraceInvocation.id == str(batch.invocation_id),
                    ApplicationTraceInvocation.run_id == run.id,
                )
            )
            if invocation is None:
                raise TraceCollectionNotFoundError("tracing_invocation_not_found")
            previous = session.get(ApplicationTraceBatch, str(batch.batch_id))
            if previous is not None:
                if (
                    previous.run_id != run.id
                    or previous.invocation_id != invocation.id
                    or previous.payload_hash != digest
                ):
                    raise TraceCollectionConflictError("tracing_batch_conflict")
                return len(previous.spans), run.id
            if run.state in CLOSED_STATES or invocation.finalized:
                raise TraceCollectionConflictError("tracing_collection_closed")
            if any(span.trace_id != run.trace_id for span in batch.spans):
                raise TraceCollectionConflictError("tracing_trace_id_mismatch")
            if run.span_count + len(batch.spans) > max_spans or run.payload_bytes + len(canonical) > max_bytes:
                raise TraceCollectionLimitError("tracing_payload_limit")
            spans: list[dict[str, Any]] = []
            for value in batch.spans:
                span = value.model_dump(mode="json")
                span["attributes"] = safe_attributes(span["attributes"], capture_content=run.capture_content)
                if not run.capture_content:
                    span["events"] = []
                    span["status_message"] = "Agent operation failed" if span["status"] == "error" else None
                spans.append(span)
            session.add(
                ApplicationTraceBatch(
                    id=str(batch.batch_id),
                    run_id=run.id,
                    invocation_id=invocation.id,
                    payload_hash=digest,
                    spans=spans,
                    final=batch.final,
                )
            )
            run.span_count += len(spans)
            run.payload_bytes += len(canonical)
            run.updated_at = naive_utc_now()
            if batch.final:
                invocation.finalized = True
                invocation.finalized_at = naive_utc_now()
            return len(spans), run.id

    @override
    def terminal(self, run_id: str, trace: Mapping[str, Any], root_span_id: str) -> None:
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if run is None or run.state in CLOSED_STATES:
                return
            if run.outer_trace is not None and run.outer_trace != trace:
                # A duplicate terminal task must not rewrite a completed immutable
                # span. The first persisted terminal envelope owns the export.
                return
            run.outer_trace = dict(trace)
            run.root_span_id = root_span_id
            run.terminal_at = run.terminal_at or naive_utc_now()
            run.updated_at = naive_utc_now()

    @override
    def get(self, run_id: str) -> TraceRun | None:
        with self._read() as session:
            run = session.get(ApplicationTraceRun, run_id)
            return _run(run) if run is not None else None

    @staticmethod
    def _invocation_rows(session: Session, run_id: str) -> list[TraceInvocation]:
        return [
            _invocation(row)
            for row in session.scalars(
                select(ApplicationTraceInvocation)
                .where(ApplicationTraceInvocation.run_id == run_id)
                .order_by(
                    ApplicationTraceInvocation.attempt,
                    ApplicationTraceInvocation.created_at,
                    ApplicationTraceInvocation.id,
                )
            )
        ]

    @override
    def invocations(self, run_id: str) -> list[TraceInvocation]:
        with self._read() as session:
            return self._invocation_rows(session, run_id)

    @override
    def collected(self, run_id: str) -> tuple[list[TraceInvocation], list[TraceBatch]]:
        with self._read() as session:
            batches = [
                TraceBatch(invocation_id=row.invocation_id, spans=list(row.spans))
                for row in session.scalars(
                    select(ApplicationTraceBatch)
                    .where(ApplicationTraceBatch.run_id == run_id)
                    .order_by(ApplicationTraceBatch.created_at)
                )
            ]
            return self._invocation_rows(session, run_id), batches

    @override
    def claim(self, run_id: str, *, collection_timeout: int, lease_seconds: int) -> tuple[TraceRun, str] | None:
        now = naive_utc_now()
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if run is None or run.state in {
                TraceRunState.NOT_COLLECTED,
                TraceRunState.ACCEPTED,
                TraceRunState.FAILED,
                TraceRunState.UNCERTAIN,
            }:
                return None
            if run.state == TraceRunState.EXPORTING:
                last_heartbeat = run.export_heartbeat_at or run.export_started_at
                if last_heartbeat and last_heartbeat + timedelta(seconds=lease_seconds) < now:
                    run.state, run.error_code = TraceRunState.UNCERTAIN, "export_lease_expired"
                    run.updated_at = now
                return None
            if run.outer_trace is None:
                return None
            incomplete = session.scalar(
                select(ApplicationTraceInvocation.id)
                .where(ApplicationTraceInvocation.run_id == run_id, ApplicationTraceInvocation.finalized.is_(False))
                .limit(1)
            )
            if incomplete:
                if run.terminal_at and run.terminal_at + timedelta(seconds=collection_timeout) < now:
                    run.state, run.error_code = TraceRunState.FAILED, "agent_trace_collection_incomplete"
                    run.updated_at = now
                return None
            if run.next_attempt_at and run.next_attempt_at > now:
                return None
            if self._owned_app_id(session, tenant_id=run.tenant_id, app_id=run.app_id) is None:
                run.state, run.error_code = TraceRunState.FAILED, "tracing_owner_not_found"
                return None
            token = str(uuidv7())
            run.state = TraceRunState.EXPORTING
            run.export_token = token
            run.export_started_at = now
            run.export_heartbeat_at = now
            run.updated_at = now
            run.attempts += 1
            return _run(run), token

    @override
    def renew_export_lease(self, run_id: str, token: str) -> bool:
        """Renew only the current export attempt, in a short independent transaction."""
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if run is None or run.state != TraceRunState.EXPORTING or run.export_token != token:
                return False
            heartbeat_at = naive_utc_now()
            run.export_heartbeat_at = heartbeat_at
            run.updated_at = heartbeat_at
            return True

    @override
    def complete(
        self,
        run_id: str,
        token: str,
        *,
        state: TraceRunState,
        error_code: str | None,
        result: SendResult | None,
        retry_delay: int | None,
    ) -> None:
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if run is None or run.export_token != token:
                return
            late_acceptance = (
                state is TraceRunState.ACCEPTED
                and result is not None
                and run.state == TraceRunState.UNCERTAIN
                and run.error_code == "export_lease_expired"
            )
            if run.state != TraceRunState.EXPORTING and not late_acceptance:
                return
            run.state, run.error_code = state, error_code
            run.updated_at = naive_utc_now()
            run.export_token = None
            if result is not None:
                run.provider_trace_id, run.trace_url, run.span_urls = (
                    result.trace_id,
                    result.trace_url,
                    dict(result.span_urls),
                )
                run.accepted_at = naive_utc_now()
            run.next_attempt_at = naive_utc_now() + timedelta(seconds=retry_delay) if retry_delay is not None else None

    @override
    def recovery_checked(self, run_id: str, *, error_code: str | None) -> None:
        """Rotate checked incomplete work without changing a concurrent export."""
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if (
                run is None
                or run.outer_trace is not None
                or run.state not in {TraceRunState.COLLECTING, TraceRunState.READY}
            ):
                return
            run.updated_at = naive_utc_now()
            if error_code is not None:
                run.state, run.error_code = TraceRunState.FAILED, error_code

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
    def retry(self, *, run_id: str, acknowledge_possible_duplicates: bool) -> None:
        with self._write() as session:
            run = self._locked_run(session, run_id)
            if run is None or run.state == TraceRunState.NOT_COLLECTED:
                raise TraceCollectionNotFoundError("tracing_run_not_found")
            if run.state == TraceRunState.ACCEPTED:
                raise TraceCollectionConflictError("tracing_already_accepted")
            if run.state not in {TraceRunState.FAILED, TraceRunState.UNCERTAIN} or run.outer_trace is None:
                raise TraceCollectionConflictError("tracing_retry_not_allowed")
            incomplete = session.scalar(
                select(ApplicationTraceInvocation.id)
                .where(
                    ApplicationTraceInvocation.run_id == run.id,
                    ApplicationTraceInvocation.finalized.is_(False),
                )
                .limit(1)
            )
            if incomplete or (run.error_code or "").startswith("tracing_"):
                raise TraceCollectionConflictError("tracing_retry_not_allowed")
            if run.state == TraceRunState.UNCERTAIN and not acknowledge_possible_duplicates:
                raise TraceCollectionConflictError("tracing_duplicate_acknowledgement_required")
            run.state, run.error_code, run.export_token = TraceRunState.READY, None, None
            run.next_attempt_at = None
            run.updated_at = naive_utc_now()

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
