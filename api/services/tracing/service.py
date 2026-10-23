"""Agent trace collection for Agent-managed executions.

Agent apps and workflows with Agent nodes produce spans that the Dify Agent
runtime reports separately. Their traces freeze a destination and a capture
policy when they start, collect runtime batches in a ledger, and are sent
once complete through the same provider interface as every other trace.
"""

import json
import logging
import threading
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import uuid4

from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_agent.protocol.tracing import AgentTraceBatch
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import TraceProvider
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from extensions.ext_database import db
from models import App, AppMode, Message, Workflow, WorkflowNodeExecutionModel, WorkflowRun
from models.application_trace import ApplicationTraceRun
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.app_tracing_config_service import (
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProviderUnavailableError,
)
from services.tracing.assembly import TraceAssembler
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.egress import SSRFEgress
from services.tracing.normalization import (
    legacy_outer_trace,
    normalize_agent_span,
    order_spans,
    remap_outer_trace,
    sanitize,
)
from services.tracing.provider_configs import ProviderConfigUnreadableError, capabilities_payload, decode_config
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, WorkflowTraceInfo
from services.tracing.recovery import agent_stop_requested, recover_terminal
from services.tracing.registry import TraceProviderUnavailableError, UnknownTraceProviderError, provider_class
from services.tracing.runtime_bridge import workflow_has_agent_v2

logger = logging.getLogger(__name__)


def _message_inputs_are_empty(inputs: object) -> bool:
    if isinstance(inputs, str):
        if not inputs.strip():
            return True
        try:
            inputs = json.loads(inputs)
        except ValueError:
            return False
    return inputs is None or isinstance(inputs, (str, dict, list)) and not inputs


class ApplicationTracingService:
    def __init__(
        self,
        repository: ApplicationTraceRepository,
        *,
        assembler: TraceAssembler,
        builder: CanonicalTraceBuilder,
        egress: Egress,
    ) -> None:
        self.repository = repository
        self.assembler = assembler
        self._builder = builder
        self._egress = egress

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

    def capture_agent_app_terminal(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        outcome: Literal["succeeded", "failed", "cancelled"],
        output: str | None,
    ) -> None:
        """Persist a worker-observed terminal even after its SSE consumer closes.

        Usage-only Message writes are intentionally insufficient for recovery.
        This handoff is made only after the runner observes a terminal result or
        finishes handling an explicit stop, and it does not rewrite Message data.
        """
        source = self.repository._source(tenant_id=tenant_id, app_id=app_id, kind="message", source_id=message_id)
        if not isinstance(source, Message):
            raise TraceCollectionError("tracing_source_not_found", 404)
        run = self.repository.source_run(
            tenant_id=tenant_id, app_id=app_id, source_kind="message", source_id=message_id
        )
        if run is not None and run.state == "not_collected":
            return
        info = self.assembler.assemble(
            TraceEvent(
                event_id=uuid4().hex,
                tenant_id=tenant_id,
                app_id=app_id,
                user_id=None,
                occurred_at=datetime.now(UTC),
                correlation=TraceCorrelation(
                    external_trace_id=None,
                    session_id=run.session_id if run else source.conversation_id,
                    parent_workflow_run_id=None,
                    parent_node_execution_id=None,
                ),
                payload=MessageCompleted(message_id=message_id, conversation_id=source.conversation_id),
            )
        )
        if not isinstance(info, MessageTraceInfo):
            raise TraceCollectionError("tracing_terminal_not_supported")
        inputs = info.inputs
        if _message_inputs_are_empty(inputs) and info.message_data.query:
            # Early errors may precede formatted-message persistence. Preserve only
            # the known user query on the root; this is not an inferred LLM prompt.
            inputs = {"query": info.message_data.query}
        if output is not None:
            # This is a detached trace snapshot, not a write to the business row.
            info.message_data.answer = output
        self.capture_terminal(
            info.model_copy(
                update={
                    "inputs": inputs,
                    "outputs": output if output is not None else info.outputs,
                    "end_time": datetime.now(UTC).replace(tzinfo=None),
                    "metadata": {**info.metadata, "message_execution_state": outcome},
                    "error": info.error if outcome == "succeeded" else f"Agent message {outcome}",
                }
            )
        )

    @staticmethod
    def schedule(run_id: str) -> None:
        from tasks.application_trace_task import export_application_trace

        try:
            export_application_trace.delay(run_id)
        except Exception:
            logger.warning("Application trace is persisted; scheduling deferred: run_id=%s", run_id)

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

    def _managed_owner(self, app: App, message: Message | None = None, workflow_run_id: str | None = None) -> bool:
        """Agent apps and workflows with Agent nodes are collected here; frozen runs win."""
        if message is not None:
            if self._run_for_source(
                tenant_id=app.tenant_id, app_id=app.id, source_kind="message", source_id=message.id
            ):
                return True
            workflow_run_id = message.workflow_run_id or workflow_run_id
        if app.mode == AppMode.AGENT:
            return True
        if workflow_run_id:
            if self.repository.source_run(
                tenant_id=app.tenant_id, app_id=app.id, source_kind="workflow", source_id=workflow_run_id
            ):
                return True
            workflow = self.repository._source(
                tenant_id=app.tenant_id, app_id=app.id, kind="workflow", source_id=workflow_run_id
            )
            if isinstance(workflow, WorkflowRun):
                return workflow_has_agent_v2(workflow.graph)
        if app.mode == AppMode.ADVANCED_CHAT or (app.mode == AppMode.WORKFLOW and workflow_run_id):
            # Naming may run before Message.workflow_run_id is populated. Use
            # the owned app workflow; an unknown snapshot fails closed. The same
            # applies to a Workflow whose run is not yet indexed by LogStore.
            with self.repository.sessions() as session:
                definition = (
                    session.scalar(
                        select(Workflow).where(
                            Workflow.id == app.workflow_id,
                            Workflow.app_id == app.id,
                            Workflow.tenant_id == app.tenant_id,
                        )
                    )
                    if app.workflow_id
                    else None
                )
                return definition is None or workflow_has_agent_v2(definition.graph)
        return False

    def _app(self, app_id: str) -> App | None:
        with self.repository.sessions() as session:
            return session.scalar(select(App).where(App.id == app_id))

    def link_managed_parent(self, info: WorkflowTraceInfo) -> WorkflowTraceInfo:
        """A provider-exported nested workflow names the Agent-collected parent it cannot attach to."""
        tenant_id = info.tenant_id
        parent_run_id, parent_node_id = info.resolved_parent_context
        if not parent_run_id:
            return info
        with self.repository.sessions() as session:
            parent = session.scalar(
                select(ApplicationTraceRun)
                .join(App, App.id == ApplicationTraceRun.app_id)
                .where(
                    ApplicationTraceRun.source_kind == "workflow",
                    ApplicationTraceRun.source_id == parent_run_id,
                    ApplicationTraceRun.tenant_id == tenant_id,
                    App.tenant_id == tenant_id,
                )
            )
        if parent is None:
            return info
        if (
            self.repository._source(tenant_id=tenant_id, app_id=parent.app_id, kind="workflow", source_id=parent_run_id)
            is None
        ):
            return info
        metadata = dict(info.metadata)
        metadata.pop("parent_trace_context", None)
        metadata["linked_parent_workflow_run_id"] = parent_run_id
        if parent_node_id:
            metadata["linked_parent_node_execution_id"] = parent_node_id
        metadata["linked_parent_application_trace_id"] = parent.id
        metadata["linked_parent_trace_id"] = parent.trace_id
        return info.model_copy(update={"metadata": metadata})

    def capture_terminal(self, info: BaseTraceInfo) -> bool:
        """Take records of Agent-managed executions; ``False`` leaves the record to its provider."""
        if isinstance(info, WorkflowTraceInfo):
            app_id = str(info.metadata.get("app_id", ""))
            source_id, source_kind = info.workflow_run_id, "workflow"
        elif isinstance(info, MessageTraceInfo):
            app_id = info.message_data.app_id
            source_id, source_kind = info.message_data.id, "message"
        else:
            # Auxiliary operations of a managed execution belong to its Agent trace. Naming may
            # report no message, so the record's own app decides then.
            message = info.message_data
            owner_app_id = message.app_id if message is not None else info.metadata.get("app_id")
            app = self._app(owner_app_id) if isinstance(owner_app_id, str) and owner_app_id else None
            return app is not None and self._managed_owner(app, message)
        with self.repository.sessions() as session:
            app = session.scalar(select(App).where(App.id == app_id))
            if app is None:
                return False
            message = (
                session.scalar(select(Message).where(Message.id == source_id, Message.app_id == app_id))
                if source_kind == "message"
                else None
            )
        managed = self._managed_owner(app, message, source_id if source_kind == "workflow" else None)
        run = self._run_for_source(tenant_id=app.tenant_id, app_id=app.id, source_kind=source_kind, source_id=source_id)
        if run is not None and source_kind == "message" and run.source_kind == "workflow":
            # Chatflow emits both events; the message is already in the workflow tree.
            return True
        if run is None:
            if not managed:
                return False
            run = self.repository.record_initialization_failure(
                tenant_id=app.tenant_id,
                app_id=app.id,
                source_kind=source_kind,
                source_id=source_id,
            )
            # A missing start snapshot must never fall back to an exporter without its capture policy.
            logger.warning(
                "Application trace snapshot missing; export suppressed: app_id=%s source_id=%s", app_id, source_id
            )
            if run is None:
                return True
        if run.state in {"not_collected", "failed", "uncertain", "accepted", "exporting"}:
            return True
        if (
            app.mode == AppMode.AGENT
            and message is not None
            and info.metadata.get("message_execution_state") not in ("succeeded", "failed", "cancelled")
            and agent_stop_requested(message)
        ):
            # An already queued consumer notification may arrive after a
            # stop. Its ordinary Message snapshot cannot own the runtime
            # outcome, even if span finalization has already completed.
            return True
        trace = self._builder.build(info)
        if trace is None:
            raise TraceCollectionError("tracing_terminal_not_supported")
        synthetic = frozenset({span_id_for(f"{source_id}:llm")}) if source_kind == "message" else frozenset()
        trace = remap_outer_trace(
            trace, trace_id=run.trace_id, capture_content=run.capture_content, synthetic_span_ids=synthetic
        )
        trace = trace.model_copy(update={"session_id": run.session_id})
        self.repository.terminal(run.id, trace.model_dump(mode="json"), trace.root.span_id)
        self.schedule(run.id)
        return True

    def settle_preview(self, run: ApplicationTraceRun) -> None:
        if run.source_kind != "node" or run.outer_trace is not None:
            return
        node = self.repository._source(tenant_id=run.tenant_id, app_id=run.app_id, kind="node", source_id=run.source_id)
        if not isinstance(node, WorkflowNodeExecutionModel) or str(node.status) in {"running", "pending", "paused"}:
            return
        error = node.error
        started_at = node.created_at.replace(tzinfo=UTC)
        ended_at = started_at + timedelta(seconds=node.elapsed_time or 0)
        span = Span(
            span_id=run.root_span_id,
            parent_span_id=None,
            name=node.title or "Agent preview",
            kind=SpanKind.AGENT,
            start_time=started_at,
            end_time=ended_at,
            status=SpanStatus.ERROR if error else SpanStatus.OK,
            error=error if run.capture_content else "Node execution failed" if error else None,
            inputs=sanitize(node.inputs) if run.capture_content else None,
            outputs=sanitize(node.outputs) if run.capture_content else None,
            attributes={"node_execution_id": node.id, "node_id": node.node_id, "source": "single_step"},
        )
        trace = Trace(
            trace_id=run.trace_id,
            external_trace_id=None,
            session_id=run.session_id,
            user_id=None,
            parent=None,
            spans=(span,),
        )
        self.repository.terminal(run.id, trace.model_dump(mode="json"), run.root_span_id)

    def assemble(self, run: ApplicationTraceRun) -> Trace:
        if run.outer_trace is None:
            raise TraceCollectionError("tracing_terminal_missing")
        # Runs captured before the upgrade stored the previous trace shape, named by its root span.
        outer = (
            legacy_outer_trace(run.outer_trace)
            if "root_span_id" in run.outer_trace
            else Trace.model_validate(run.outer_trace)
        )
        invocations, batches = self.repository.collected(run.id)
        invocation_by_id = {inv.id: inv for inv in invocations}
        spans = list(outer.spans)
        internal_by_invocation: dict[str, dict[str, Span]] = {inv.id: {} for inv in invocations}
        for batch in batches:
            if batch.invocation_id not in invocation_by_id:
                raise TraceCollectionError("tracing_invocation_not_found")
            for data in batch.spans:
                span = normalize_agent_span(data, capture_content=run.capture_content)
                current = internal_by_invocation[batch.invocation_id].get(span.span_id)
                if current is not None and current != span:
                    raise TraceCollectionError("tracing_span_conflict")
                internal_by_invocation[batch.invocation_id][span.span_id] = span
        for invocation in invocations:
            children = list(internal_by_invocation[invocation.id].values())
            if not children:
                raise TraceCollectionError("tracing_invocation_empty")
            valid_ids = {child.span_id for child in children}
            if any(
                child.parent_span_id not in valid_ids and child.parent_span_id != invocation.span_id
                for child in children
            ):
                raise TraceCollectionError("tracing_invocation_parent_invalid")
            root_children = [child for child in children if child.parent_span_id == invocation.span_id]
            if not root_children:
                raise TraceCollectionError("tracing_invocation_root_missing")
            errors = [child.error for child in root_children if child.status is SpanStatus.ERROR]
            spans.append(
                Span(
                    span_id=invocation.span_id,
                    parent_span_id=invocation.parent_span_id,
                    name=f"Agent attempt {invocation.attempt + 1}",
                    kind=SpanKind.AGENT,
                    start_time=min(child.start_time for child in children),
                    end_time=max(child.end_time for child in children),
                    status=SpanStatus.ERROR if errors else SpanStatus.OK,
                    error=errors[0] if errors else None,
                    attributes={
                        "agent_id": invocation.agent_id,
                        "attempt": invocation.attempt,
                        "node_execution_id": invocation.node_execution_id,
                        "invocation_id": invocation.id,
                    },
                )
            )
            spans.extend(children)
        trusted: dict[str, Any] = {
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "session_id": run.session_id,
            "dify.tenant_id": run.tenant_id,
            "dify.app_id": run.app_id,
            "dify.tracing.run_id": run.id,
            "dify.source.id": run.source_id,
        }
        spans = [span.model_copy(update={"attributes": {**span.attributes, **trusted}}) for span in spans]
        return Trace(
            trace_id=run.trace_id,
            external_trace_id=None,
            session_id=run.session_id,
            user_id=outer.user_id,
            parent=None,
            spans=order_spans(outer.root.span_id, spans),
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
                except (ValueError, KeyError, TypeError) as error:
                    # Invalid persisted trees cannot be repaired by retrying a
                    # provider request. ValidationError also inherits ValueError.
                    raise TraceCollectionError("tracing_payload_invalid") from error
                provider = self._frozen_provider(run)
                result = provider.send(decode_config(run.tenant_id, type(provider), run.provider_config), trace)
            except ExportOutcomeUnknownError:
                self.repository.complete(run_id, token, state="uncertain", error_code="provider_acceptance_unknown")
            except ExportRetryableError:
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
            except ProviderConfigUnreadableError:
                self.repository.complete(run_id, token, state="failed", error_code="tracing_config_unreadable")
            except ExportRejectedError:
                self.repository.complete(run_id, token, state="failed", error_code="provider_export_rejected")
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

    def _frozen_provider(self, run: ApplicationTraceRun) -> TraceProvider[Any]:
        try:
            return provider_class(run.provider)(self._egress)
        except (UnknownTraceProviderError, TraceProviderUnavailableError):
            raise TraceCollectionError("tracing_provider_unavailable") from None

    @staticmethod
    def _frozen_capabilities(provider_id: str) -> dict[str, bool | str] | None:
        try:
            return capabilities_payload(provider_id)
        except (AppTracingConfigInvalidProviderError, AppTracingConfigProviderUnavailableError):
            return None

    def _frozen_project_url(self, run: ApplicationTraceRun) -> str | None:
        """Present the run's own destination, never the app's current one."""
        try:
            provider = provider_class(run.provider)
            return provider(self._egress).project_url(provider.config_model.model_validate(run.provider_config))
        except (UnknownTraceProviderError, TraceProviderUnavailableError, ValidationError):
            return None

    def status(
        self, *, tenant_id: str, app_id: str, source_kind: str, source_id: str, node_execution_id: str | None = None
    ) -> dict[str, Any]:
        run, node_execution_id = self._resolve_status_source(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            node_execution_id=node_execution_id,
        )
        return self._status_for_run(run, source_kind, source_id, node_execution_id)

    def _resolve_status_source(
        self, *, tenant_id: str, app_id: str, source_kind: str, source_id: str, node_execution_id: str | None
    ) -> tuple[ApplicationTraceRun | None, str | None]:
        """Resolve node log aliases through their owned workflow, outside SQL transactions."""
        source = self.repository._source(tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id)
        if source is None:
            raise TraceCollectionError("tracing_source_not_found", 404)
        if source_kind == "node" and node_execution_id is not None and node_execution_id != source_id:
            raise TraceCollectionError("tracing_node_not_found", 404)
        run = self._run_for_source(tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id)
        # A standalone preview (including a frozen disabled decision) owns its
        # status even if its source later carries a workflow run reference.
        if run is None and isinstance(source, WorkflowNodeExecutionModel) and source.workflow_run_id:
            workflow = self.repository._source(
                tenant_id=tenant_id, app_id=app_id, kind="workflow", source_id=source.workflow_run_id
            )
            if (
                not isinstance(workflow, WorkflowRun)
                or not source.workflow_id
                or workflow.workflow_id != source.workflow_id
            ):
                raise TraceCollectionError("tracing_source_not_found", 404)
            run = self.repository.source_run(
                tenant_id=tenant_id, app_id=app_id, source_kind="workflow", source_id=workflow.id
            )
            node_execution_id = source.id
        return run, node_execution_id

    def _status_for_run(
        self, run: ApplicationTraceRun | None, source_kind: str, source_id: str, node_execution_id: str | None
    ) -> dict[str, Any]:
        if run is None or run.state == "not_collected":
            return {"status": "not_collected", "source_kind": source_kind, "source_id": source_id}
        invocations, _ = self.repository.collected(run.id)
        selected = (
            [inv for inv in invocations if inv.node_execution_id == node_execution_id] if node_execution_id else []
        )
        if node_execution_id and not selected and not (source_kind == "node" and run.source_kind == "workflow"):
            raise TraceCollectionError("tracing_node_not_found", 404)
        return {
            "status": run.state,
            "source_kind": source_kind,
            "source_id": source_id,
            "provider": run.provider or None,
            "trace_id": run.provider_trace_id or run.trace_id,
            "trace_url": run.trace_url,
            "span_url": run.span_urls.get(selected[-1].span_id) if selected else None,
            "project_url": self._frozen_project_url(run) if run.provider else None,
            "config_revision": run.config_revision or None,
            "capture_content": run.capture_content,
            "capture_agent": run.capture_agent,
            "span_count": run.span_count,
            "attempts": run.attempts,
            "error_code": run.error_code,
            "accepted_at": run.accepted_at,
            "queryable": None,
            "capabilities": self._frozen_capabilities(run.provider) if run.provider else None,
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
        run, node_execution_id = self._resolve_status_source(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            node_execution_id=node_execution_id,
        )
        if run is None:
            raise TraceCollectionError("tracing_run_not_found", 404)
        self._status_for_run(run, source_kind, source_id, node_execution_id)
        self.repository.retry(run_id=run.id, acknowledge_possible_duplicates=acknowledge_possible_duplicates)
        self.schedule(run.id)
        return self._status_for_run(self.repository.get(run.id), source_kind, source_id, node_execution_id)


def application_tracing_service() -> ApplicationTracingService:
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    return ApplicationTracingService(
        ApplicationTraceRepository(sessions),
        assembler=TraceAssembler(sessions, files_url=dify_config.FILES_URL, enterprise_details=False),
        builder=CanonicalTraceBuilder(),
        egress=SSRFEgress(),
    )
