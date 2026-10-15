"""Application tracing orchestration; secrets and vendor I/O stay in the API worker."""

import logging
import threading
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, timedelta
from typing import Any, Literal

from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_agent.protocol.tracing import AgentTraceBatch
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.ops.entities.trace_entity import BaseTraceInfo, MessageTraceInfo, WorkflowTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.ops_trace_manager import OpsTraceManager
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder, RepositoryWorkflowExecutionLoader
from extensions.ext_database import db
from models import Account, App, AppMode, Conversation, Message, Workflow, WorkflowNodeExecutionModel, WorkflowRun
from models.application_trace import ApplicationTraceRun
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.tracing.normalization import normalize_agent_span, order_spans, remap_outer_trace, sanitize
from services.tracing.provider_dispatch import TraceExportUncertainError, export_trace, provider_capabilities
from services.tracing.runtime_bridge import workflow_has_agent_v2

logger = logging.getLogger(__name__)


class ApplicationTracingService:
    def __init__(self, repository: ApplicationTraceRepository) -> None:
        self.repository = repository

    def start(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: Literal["message", "workflow", "node"],
        source_id: str,
        session_id: str,
        workflow_id: str | None = None,
    ) -> ApplicationTraceRun | None:
        if not dify_config.OPS_AGENT_TRACE_ENABLED:
            return None
        run = self.repository.start(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            session_id=session_id,
            workflow_id=workflow_id,
        )
        return run if run is not None and run.state != "not_collected" else None

    def prepare_invocation(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        source_kind: Literal["message", "workflow", "node"],
        source_id: str,
        session_id: str,
        node_execution_id: str | None,
        attempt: int,
        call_key: str,
        workflow_id: str | None = None,
    ) -> ApplicationTracingContext | None:
        run = self.start(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            session_id=session_id,
            workflow_id=workflow_id,
        )
        if run is None or not run.capture_agent:
            return None
        invocation = self.repository.invocation(
            run_id=run.id, agent_id=agent_id, node_execution_id=node_execution_id, attempt=attempt, call_key=call_key
        )
        return ApplicationTracingContext(
            run_id=run.id,
            invocation_id=invocation.id,
            trace_id=run.trace_id,
            parent_span_id=invocation.span_id,
            session_id=run.session_id,
            capture_content=run.capture_content,
        )

    def ingest(self, batch: AgentTraceBatch) -> int:
        accepted, run_id = self.repository.ingest(
            batch,
            max_spans=dify_config.OPS_AGENT_TRACE_MAX_SPANS,
            max_bytes=dify_config.OPS_AGENT_TRACE_MAX_BYTES,
        )
        # Persistence commits before scheduling. Beat reconciles a broker outage.
        self.schedule(run_id)
        return accepted

    @staticmethod
    def schedule(run_id: str) -> None:
        from tasks.application_trace_task import export_application_trace

        try:
            export_application_trace.delay(run_id)
        except Exception:
            logger.warning("Application trace is persisted; scheduling deferred: run_id=%s", run_id)

    def _service_account(self, run: ApplicationTraceRun, app_id: str) -> Account:
        with self.repository.sessions() as session:
            app = session.scalar(
                select(App).where(App.id == app_id, App.id == run.app_id, App.tenant_id == run.tenant_id)
            )
            if app is None or not app.created_by:
                raise TraceCollectionError("tracing_owner_not_found", 404)
            account = session.get(Account, app.created_by)
            if account is None:
                raise TraceCollectionError("tracing_owner_not_found", 404)
            account.set_tenant_id_with_session(run.tenant_id, session=session)
            return account

    def _run_for_source(
        self, *, tenant_id: str, app_id: str, source_kind: str, source_id: str
    ) -> ApplicationTraceRun | None:
        run = self.repository.source_run(
            tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id
        )
        if run is None and source_kind == "message":
            with self.repository.sessions() as session:
                workflow_run_id = session.scalar(
                    select(Message.workflow_run_id)
                    .join(App, App.id == Message.app_id)
                    .where(
                        Message.id == source_id,
                        Message.app_id == app_id,
                        App.tenant_id == tenant_id,
                    )
                )
            if workflow_run_id:
                run = self.repository.source_run(
                    tenant_id=tenant_id, app_id=app_id, source_kind="workflow", source_id=workflow_run_id
                )
        return run

    def _managed_owner(
        self, session: Session, app: App, message: Message | None = None, workflow_run_id: str | None = None
    ) -> bool:
        """Honor frozen owners first; ordinary workflows retain legacy tracing."""
        if message is not None:
            if self._run_for_source(
                tenant_id=app.tenant_id, app_id=app.id, source_kind="message", source_id=message.id
            ):
                return True
            workflow_run_id = message.workflow_run_id or workflow_run_id
        if app.mode == AppMode.AGENT:
            return True
        if workflow_run_id:
            workflow = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == workflow_run_id,
                    WorkflowRun.app_id == app.id,
                    WorkflowRun.tenant_id == app.tenant_id,
                )
            )
            if workflow is not None:
                if self.repository.source_run(
                    tenant_id=app.tenant_id, app_id=app.id, source_kind="workflow", source_id=workflow.id
                ):
                    return True
                return workflow_has_agent_v2(workflow.graph)
        if app.mode == AppMode.ADVANCED_CHAT:
            # Naming may run before Message.workflow_run_id is populated. Use
            # the owned app workflow; an unknown snapshot fails closed.
            workflow = (
                session.scalar(
                    select(Workflow).where(
                        Workflow.id == app.workflow_id, Workflow.app_id == app.id, Workflow.tenant_id == app.tenant_id
                    )
                )
                if app.workflow_id
                else None
            )
            return workflow is None or workflow_has_agent_v2(workflow.graph)
        return False

    def _capture_auxiliary(self, info: BaseTraceInfo) -> bool:
        """Resolve real business owners even when message_id is a workflow-log ID."""
        actual_message_id = info.message_data.id if isinstance(info.message_data, Message) else None
        message_ids = [actual_message_id, info.metadata.get("message_id"), info.message_id]
        with self.repository.sessions() as session:
            for message_id in message_ids:
                if not isinstance(message_id, str):
                    continue
                owner = session.execute(
                    select(Message, App).join(App, App.id == Message.app_id).where(Message.id == message_id)
                ).first()
                if owner is not None:
                    message, app = owner
                    return self._managed_owner(session, app, message)
            conversation_id = info.metadata.get("conversation_id")
            if isinstance(conversation_id, str):
                app = session.scalar(
                    select(App)
                    .join(Conversation, Conversation.app_id == App.id)
                    .where(Conversation.id == conversation_id)
                )
                if app is not None:
                    message = session.scalar(
                        select(Message)
                        .where(Message.conversation_id == conversation_id, Message.app_id == app.id)
                        .order_by(Message.created_at.desc())
                        .limit(1)
                    )
                    return self._managed_owner(session, app, message)
            workflow_run_id = info.metadata.get("workflow_run_id")
            if isinstance(workflow_run_id, str):
                app = session.scalar(
                    select(App)
                    .join(WorkflowRun, WorkflowRun.app_id == App.id)
                    .where(WorkflowRun.id == workflow_run_id, WorkflowRun.tenant_id == App.tenant_id)
                )
                if app is not None:
                    return self._managed_owner(session, app, workflow_run_id=workflow_run_id)
        return False

    def _link_managed_parent(self, info: WorkflowTraceInfo, tenant_id: str) -> None:
        """A legacy child cannot await a parent exported by a different pipeline."""
        parent_run_id, parent_node_id = info.resolved_parent_context
        if not parent_run_id:
            return
        with self.repository.sessions() as session:
            parent = session.scalar(
                select(ApplicationTraceRun)
                .join(WorkflowRun, WorkflowRun.id == ApplicationTraceRun.source_id)
                .join(App, App.id == WorkflowRun.app_id)
                .where(
                    ApplicationTraceRun.source_kind == "workflow",
                    ApplicationTraceRun.source_id == parent_run_id,
                    ApplicationTraceRun.app_id == WorkflowRun.app_id,
                    ApplicationTraceRun.tenant_id == tenant_id,
                    WorkflowRun.tenant_id == tenant_id,
                    App.tenant_id == tenant_id,
                )
            )
        if parent is None:
            return
        metadata = dict(info.metadata)
        metadata.pop("parent_trace_context", None)
        metadata["linked_parent_workflow_run_id"] = parent_run_id
        if parent_node_id:
            metadata["linked_parent_node_execution_id"] = parent_node_id
        metadata["linked_parent_application_trace_id"] = parent.id
        metadata["linked_parent_trace_id"] = parent.trace_id
        info.metadata = metadata

    def capture_terminal(self, info: BaseTraceInfo) -> bool:
        """Hand managed traces to durable collection while preserving legacy scope."""
        if isinstance(info, WorkflowTraceInfo):
            app_id = str(info.metadata.get("app_id", ""))
            source_id, source_kind = info.workflow_run_id, "workflow"
        elif isinstance(info, MessageTraceInfo) and isinstance(info.message_data, Message):
            app_id = info.message_data.app_id
            source_id, source_kind = info.message_data.id, "message"
        else:
            return self._capture_auxiliary(info)
        with self.repository.sessions() as session:
            app = session.scalar(select(App).where(App.id == app_id))
            if app is None:
                return False
            message = (
                session.scalar(select(Message).where(Message.id == source_id, Message.app_id == app_id))
                if source_kind == "message"
                else None
            )
            managed = self._managed_owner(session, app, message, source_id if source_kind == "workflow" else None)
        run = self._run_for_source(tenant_id=app.tenant_id, app_id=app.id, source_kind=source_kind, source_id=source_id)
        if run is not None and source_kind == "message" and run.source_kind == "workflow":
            # Chatflow emits both events; the message is already in the workflow tree.
            return True
        if run is None:
            if not managed:
                if isinstance(info, WorkflowTraceInfo):
                    self._link_managed_parent(info, app.tenant_id)
                return False
            run = self.repository.record_initialization_failure(
                tenant_id=app.tenant_id,
                app_id=app.id,
                source_kind=source_kind,
                source_id=source_id,
            )
            logger.warning(
                "Application trace snapshot missing; legacy export suppressed: app_id=%s source_id=%s",
                app_id,
                source_id,
            )
            if run is None:
                return True
        if run.state in {"not_collected", "failed", "uncertain", "accepted", "exporting"}:
            return True
        loader = RepositoryWorkflowExecutionLoader(lambda requested_app: self._service_account(run, requested_app))
        trace = CanonicalTraceBuilder(loader).build(info)
        if trace is None:
            raise TraceCollectionError("tracing_terminal_not_supported")
        trace = remap_outer_trace(
            trace, trace_id=run.trace_id, capture_content=run.capture_content, agent_message=source_kind == "message"
        )
        trace = trace.model_copy(update={"session_id": run.session_id})
        self.repository.terminal(run.id, trace.model_dump(mode="json"), trace.root_span_id)
        self.schedule(run.id)
        return True

    def settle_preview(self, run: ApplicationTraceRun) -> None:
        if run.source_kind != "node" or run.outer_trace is not None:
            return
        with self.repository.sessions() as session:
            node = session.scalar(
                select(WorkflowNodeExecutionModel).where(
                    WorkflowNodeExecutionModel.id == run.source_id,
                    WorkflowNodeExecutionModel.app_id == run.app_id,
                    WorkflowNodeExecutionModel.tenant_id == run.tenant_id,
                )
            )
            if node is None or str(node.status) in {"running", "pending", "paused"}:
                return
            error = node.error
            started_at = node.created_at.replace(tzinfo=UTC)
            ended_at = started_at + timedelta(seconds=node.elapsed_time or 0)
            span = CanonicalSpan(
                id=run.root_span_id,
                parent_id=None,
                name=node.title or "Agent preview",
                kind=CanonicalSpanKind.AGENT,
                start_time=started_at,
                end_time=ended_at,
                inputs=sanitize(node.inputs) if run.capture_content else None,
                outputs=sanitize(node.outputs) if run.capture_content else None,
                status=CanonicalSpanStatus.ERROR if error else CanonicalSpanStatus.OK,
                error=error if run.capture_content else "Node execution failed" if error else None,
                metadata={"node_execution_id": node.id, "node_id": node.node_id, "source": "single_step"},
            )
        trace = CanonicalTrace(
            trace_id=run.trace_id, session_id=run.session_id, root_span_id=run.root_span_id, spans=(span,)
        )
        self.repository.terminal(run.id, trace.model_dump(mode="json"), run.root_span_id)

    def assemble(self, run: ApplicationTraceRun) -> CanonicalTrace:
        if run.outer_trace is None:
            raise TraceCollectionError("tracing_terminal_missing")
        outer = CanonicalTrace.model_validate(run.outer_trace)
        invocations, batches = self.repository.collected(run.id)
        invocation_by_id = {inv.id: inv for inv in invocations}
        spans = list(outer.spans)
        internal_by_invocation: dict[str, dict[str, CanonicalSpan]] = {inv.id: {} for inv in invocations}
        for batch in batches:
            if batch.invocation_id not in invocation_by_id:
                raise TraceCollectionError("tracing_invocation_not_found")
            for data in batch.spans:
                span = normalize_agent_span(data, capture_content=run.capture_content)
                current = internal_by_invocation[batch.invocation_id].get(span.id)
                if current is not None and current != span:
                    raise TraceCollectionError("tracing_span_conflict")
                internal_by_invocation[batch.invocation_id][span.id] = span
        for invocation in invocations:
            children = list(internal_by_invocation[invocation.id].values())
            if not children:
                raise TraceCollectionError("tracing_invocation_empty")
            valid_ids = {child.id for child in children}
            if any(child.parent_id not in valid_ids and child.parent_id != invocation.span_id for child in children):
                raise TraceCollectionError("tracing_invocation_parent_invalid")
            root_children = [child for child in children if child.parent_id == invocation.span_id]
            if not root_children:
                raise TraceCollectionError("tracing_invocation_root_missing")
            errors = [child.error for child in root_children if child.status == CanonicalSpanStatus.ERROR]
            spans.append(
                CanonicalSpan(
                    id=invocation.span_id,
                    parent_id=invocation.parent_span_id,
                    name=f"Agent attempt {invocation.attempt + 1}",
                    kind=CanonicalSpanKind.AGENT,
                    start_time=min(child.start_time for child in children),
                    end_time=max(child.end_time or child.start_time for child in children),
                    status=CanonicalSpanStatus.ERROR if errors else CanonicalSpanStatus.OK,
                    error=errors[0] if errors else None,
                    metadata={
                        "agent_id": invocation.agent_id,
                        "attempt": invocation.attempt,
                        "node_execution_id": invocation.node_execution_id,
                        "invocation_id": invocation.id,
                    },
                )
            )
            spans.extend(children)
        trusted = {
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "session_id": run.session_id,
            "dify.tenant_id": run.tenant_id,
            "dify.app_id": run.app_id,
            "dify.tracing.run_id": run.id,
            "dify.source.id": run.source_id,
        }
        spans = [span.model_copy(update={"metadata": {**span.metadata, **trusted}}) for span in spans]
        return CanonicalTrace(
            trace_id=run.trace_id,
            session_id=run.session_id,
            root_span_id=outer.root_span_id,
            spans=order_spans(outer.root_span_id, spans),
        )

    @contextmanager
    def _export_lease_heartbeat(self, run_id: str, token: str) -> Generator[None]:
        """Keep slow exporters leased without holding a transaction across vendor I/O.

        A lost database connection is not proof that the exporter stopped. The
        attempt continues; the token-checked completion can reconcile a late ACK
        after lease expiry unless a manual retry has already replaced its token.
        """
        stopped = threading.Event()
        interval = dify_config.OPS_AGENT_TRACE_EXPORT_LEASE_SECONDS / 3

        def heartbeat() -> None:
            while not stopped.wait(interval):
                try:
                    if not self.repository.renew_export_lease(run_id, token):
                        return
                except Exception as error:
                    logger.warning(
                        "Application trace heartbeat failed: run_id=%s error_type=%s", run_id, type(error).__name__
                    )

        worker = threading.Thread(target=heartbeat, name=f"application-trace-lease-{run_id}", daemon=True)
        started = False
        try:
            worker.start()
            started = True
        except Exception as error:
            logger.warning(
                "Application trace heartbeat unavailable: run_id=%s error_type=%s", run_id, type(error).__name__
            )
        try:
            yield
        finally:
            stopped.set()
            # A wedged DB request must not hold the vendor completion path open.
            # When it returns, the event stops the loop; renew is also token/state guarded.
            if started:
                worker.join(timeout=1.0)
                if worker.is_alive():
                    logger.warning("Application trace heartbeat shutdown pending: run_id=%s", run_id)

    def deliver(self, run_id: str) -> None:
        record = self.repository.get(run_id)
        if record is None:
            return
        from services.tracing.recovery import recover_terminal

        recover_terminal(self, record)
        record = self.repository.get(run_id)
        if record is None:
            return
        self.settle_preview(record)
        claim = self.repository.claim(
            run_id,
            collection_timeout=dify_config.OPS_AGENT_TRACE_COLLECTION_TIMEOUT,
            lease_seconds=dify_config.OPS_AGENT_TRACE_EXPORT_LEASE_SECONDS,
        )
        if claim is None:
            return
        run, token = claim
        with self._export_lease_heartbeat(run_id, token):
            try:
                try:
                    trace = self.assemble(run)
                except ValueError as error:
                    # Invalid persisted trees cannot be repaired by retrying a
                    # provider request. ValidationError also inherits ValueError.
                    raise TraceCollectionError("tracing_payload_invalid") from error
                config = dict(run.provider_config)
                config.update(OpsTraceManager.decrypt_tracing_config(run.tenant_id, run.provider, run.provider_config))
                result = export_trace(run.provider, config, trace)
            except TraceExportUncertainError:
                self.repository.complete(run_id, token, state="uncertain", error_code="provider_acceptance_unknown")
            except RetryableTraceDispatchError:
                if run.attempts >= dify_config.OPS_AGENT_TRACE_MAX_ATTEMPTS:
                    self.repository.complete(run_id, token, state="failed", error_code="provider_retry_exhausted")
                else:
                    self.repository.complete(
                        run_id,
                        token,
                        state="retrying",
                        error_code="provider_temporarily_unavailable",
                        retry_delay=min(300, 5 * 2 ** min(run.attempts - 1, 6)),
                    )
            except TraceCollectionError as error:
                self.repository.complete(run_id, token, state="failed", error_code=error.code)
            except Exception as error:
                logger.warning(
                    "Application trace export failed: run_id=%s provider=%s error_type=%s",
                    run_id,
                    run.provider,
                    type(error).__name__,
                )
                self.repository.complete(run_id, token, state="failed", error_code="provider_export_rejected")
            else:
                self.repository.complete(run_id, token, state="accepted", result=result)

    def status(
        self, *, tenant_id: str, app_id: str, source_kind: str, source_id: str, node_execution_id: str | None = None
    ) -> dict[str, Any]:
        with self.repository.sessions() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
            if (
                app is None
                or self.repository._source(
                    session, tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id
                )
                is None
            ):
                raise TraceCollectionError("tracing_source_not_found", 404)
        run = self._run_for_source(tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id)
        if run is None or run.state == "not_collected":
            return {"status": "not_collected", "source_kind": source_kind, "source_id": source_id}
        invocations, _ = self.repository.collected(run.id)
        selected = (
            [inv for inv in invocations if inv.node_execution_id == node_execution_id] if node_execution_id else []
        )
        if node_execution_id and not selected:
            raise TraceCollectionError("tracing_node_not_found", 404)
        return {
            "status": run.state,
            "source_kind": source_kind,
            "source_id": source_id,
            "provider": run.provider or None,
            "trace_id": run.provider_trace_id or run.trace_id,
            "trace_url": run.trace_url,
            "span_url": run.span_urls.get(selected[-1].span_id) if selected else None,
            "config_revision": run.config_revision or None,
            "capture_content": run.capture_content,
            "capture_agent": run.capture_agent,
            "span_count": run.span_count,
            "attempts": run.attempts,
            "error_code": run.error_code,
            "accepted_at": run.accepted_at,
            "queryable": None,
            "capabilities": provider_capabilities(run.provider) if run.provider else None,
        }

    def retry(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: str,
        source_id: str,
        acknowledge_possible_duplicates: bool,
        node_execution_id: str | None = None,
    ) -> dict[str, Any]:
        # Reuse source/node owner validation before obtaining the durable ID.
        self.status(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            node_execution_id=node_execution_id,
        )
        run = self._run_for_source(tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id)
        if run is None:
            raise TraceCollectionError("tracing_run_not_found", 404)
        self.repository.retry(run_id=run.id, acknowledge_possible_duplicates=acknowledge_possible_duplicates)
        self.schedule(run.id)
        return self.status(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            node_execution_id=node_execution_id,
        )


def application_tracing_service() -> ApplicationTracingService:
    return ApplicationTracingService(ApplicationTraceRepository(sessionmaker(bind=db.engine, expire_on_commit=False)))
