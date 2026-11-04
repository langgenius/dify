"""Agent trace collection for Agent-managed executions.

Agent apps and workflows with Agent nodes produce spans that the Dify Agent
runtime reports separately. Their traces freeze a destination and a capture
policy when they start, collect runtime batches in a ledger, and are sent
once complete through the same provider interface as every other trace.
"""

import json
import logging
import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, Literal, override
from uuid import uuid4

from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_agent.protocol.tracing import AgentTraceBatch
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.provider import TraceProvider
from pydantic import ValidationError

from domain.tracing.errors import TraceRunConflictError, TraceRunError, TraceRunLimitError, TraceRunNotFoundError
from domain.tracing.sources import SourceNodeExecution
from domain.tracing.trace_run_agg import TraceRunAgg, TraceRunState, TraceSourceKind
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import (
    AgentTraceSettings,
    SourceMessage,
    TraceApp,
    TraceAppMode,
    TraceRun,
    TraceRunStatus,
    TraceSource,
    workflow_has_agent_v2,
)
from services.tracing.collection_ports import ScheduleTraceExport, TraceRunQuery, TraceRunRepository, TraceSourceQuery
from services.tracing.delivery import TraceCollector, TraceRecordSource
from services.tracing.errors import (
    ProviderConfigUnreadableError,
    TraceCollectionConflictError,
    TraceCollectionError,
    TraceCollectionLimitError,
    TraceCollectionNotFoundError,
    TraceProviderUnavailableError,
    UnknownTraceProviderError,
)
from services.tracing.providers import ProviderConfigCodec, TraceProviderCatalog, TraceProviderSupport, support_of
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, TraceMessage, WorkflowTraceInfo
from services.tracing.recovery import recover_terminal

logger = logging.getLogger(__name__)

_RECONCILE_BATCH = 100


def _message_inputs_are_empty(inputs: object) -> bool:
    if isinstance(inputs, str):
        if not inputs.strip():
            return True
        try:
            inputs = json.loads(inputs)
        except ValueError:
            return False
    return inputs is None or isinstance(inputs, (str, dict, list)) and not inputs


@contextmanager
def _collection_errors() -> Generator[None]:
    """Report a run's rejection as the collection error its handlers map."""
    try:
        yield
    except TraceRunNotFoundError as error:
        raise TraceCollectionNotFoundError(error.code) from error
    except TraceRunConflictError as error:
        raise TraceCollectionConflictError(error.code) from error
    except TraceRunLimitError as error:
        raise TraceCollectionLimitError(error.code) from error
    except TraceRunError as error:
        raise TraceCollectionError(error.code) from error


def _record(run: TraceRunAgg) -> TraceRun:
    return TraceRun(
        id=run.id,
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        source_kind=run.source_kind,
        source_id=run.source_id,
        provider=run.provider,
        config_revision=run.config_revision,
        provider_config=run.provider_config,
        trace_id=run.trace_id,
        root_span_id=run.root_span_id,
        session_id=run.session_id,
        capture_content=run.capture_content,
        capture_agent=run.capture_agent,
        state=run.state,
        outer_trace=run.outer_trace,
        span_count=run.span_count,
        attempts=run.attempts,
        error_code=run.error_code,
        trace_url=run.trace_url,
        provider_trace_id=run.provider_trace_id,
        span_urls=run.span_urls,
        accepted_at=run.accepted_at,
    )


class ApplicationTracingService(TraceCollector):
    def __init__(
        self,
        *,
        runs: TraceRunRepository,
        run_query: TraceRunQuery,
        sources: TraceSourceQuery,
        records: TraceRecordSource,
        builder: CanonicalTraceBuilder,
        providers: TraceProviderCatalog,
        codec: ProviderConfigCodec,
        egress: Egress,
        schedule_export: ScheduleTraceExport,
        settings: AgentTraceSettings,
    ) -> None:
        self._runs = runs
        self._run_query = run_query
        self._sources = sources
        self._records = records
        self._builder = builder
        self._providers = providers
        self._codec = codec
        self._egress = egress
        self._schedule_export = schedule_export
        self._settings = settings

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
        """Freeze collection for a source once; ``None`` when the source is not collected.

        ``workflow_id`` lets a trusted workflow builder reserve a run before its source row is saved.
        """
        if not self._settings.enabled:
            return None
        run = self._freeze(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            session_id=session_id,
            workflow_id=workflow_id,
        )
        return run if run is not None and run.state is not TraceRunState.NOT_COLLECTED else None

    def _freeze(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        session_id: str,
        workflow_id: str | None,
    ) -> TraceRun | None:
        """The source's frozen run; ``None`` when the source or its owner does not exist."""
        # Re-entry uses the already validated, frozen source. It must not depend
        # on LogStore availability or indexing latency after collection began.
        if self._sources.app(tenant_id=tenant_id, app_id=app_id) is None:
            return None
        frozen = self._run_query.source_run(
            tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id
        )
        if frozen is not None:
            return frozen
        if self._source(tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id) is None:
            # A single-node preview allocates its execution ID before the node row
            # is saved. Only the trusted workflow builder may reserve it, after
            # its persisted owner workflow is checked.
            if source_kind not in {"node", "workflow"} or workflow_id is None:
                return None
            if self._sources.app_workflow_graph(tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id) is None:
                return None
        tracing = self._sources.app_tracing(tenant_id=tenant_id, app_id=app_id)
        if tracing is None:
            return None
        return self._add(
            TraceRunAgg.freeze(
                run_id=str(uuidv7()),
                trace_id=uuidv7().hex,
                tenant_id=tenant_id,
                app_id=app_id,
                source_kind=source_kind,
                source_id=source_id,
                session_id=session_id,
                policy=tracing.policy,
                stored_config=tracing.config,
                now=naive_utc_now(),
            )
        )

    def _add(self, run: TraceRunAgg) -> TraceRun | None:
        if self._runs.add(run):
            return _record(run)
        # The first frozen destination wins, so one execution never exports to two providers.
        return self._run_query.source_run(
            tenant_id=run.tenant_id, app_id=run.app_id, source_kind=run.source_kind, source_id=run.source_id
        )

    def _fail_initialization(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None:
        """Close a source whose start snapshot is missing; ``None`` when the source does not exist."""
        if self._source(tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id) is None:
            return None
        frozen = self._run_query.source_run(
            tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id
        )
        if frozen is not None:
            return frozen
        return self._add(
            TraceRunAgg.initialization_failed(
                run_id=str(uuidv7()),
                trace_id=uuidv7().hex,
                tenant_id=tenant_id,
                app_id=app_id,
                source_kind=source_kind,
                source_id=source_id,
                now=naive_utc_now(),
            )
        )

    def prepare_invocation(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        session_id: str,
        node_execution_id: str | None,
        attempt: int,
        call_key: str,
        workflow_id: str | None,
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
        with _collection_errors(), self._runs.change(run.id, tenant_id=tenant_id) as locked:
            if locked is None:
                raise TraceCollectionConflictError("tracing_run_not_collecting")
            invocation = locked.run.open_invocation(
                agent_id=agent_id, node_execution_id=node_execution_id, attempt=attempt, call_key=call_key
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
        """Store a runtime batch and return how many spans the run accepted.

        Raises:
            TraceCollectionNotFoundError: The run, its owner, or the invocation does not exist.
            TraceCollectionConflictError: The batch conflicts with the run or the run stopped collecting.
            TraceCollectionLimitError: The batch exceeds the run's limits.
        """
        run_id = str(batch.run_id)
        run = self._run_query.get(run_id)
        if run is None:
            raise TraceCollectionNotFoundError("tracing_run_not_found")
        with _collection_errors(), self._runs.change(run_id, tenant_id=run.tenant_id) as locked:
            if locked is None:
                raise TraceCollectionNotFoundError("tracing_run_not_found")
            if not locked.owner_exists:
                raise TraceCollectionNotFoundError("tracing_owner_not_found")
            accepted = locked.run.ingest(
                batch,
                max_spans=self._settings.max_spans,
                max_bytes=self._settings.max_bytes,
                now=naive_utc_now(),
            )
        # Persistence commits before scheduling. Beat reconciles a broker outage.
        self._schedule(run_id)
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
        source = self._sources.message(tenant_id=tenant_id, app_id=app_id, message_id=message_id)
        if source is None:
            raise TraceCollectionNotFoundError("tracing_source_not_found")
        run = self._run_query.source_run(
            tenant_id=tenant_id, app_id=app_id, source_kind="message", source_id=message_id
        )
        if run is not None and run.state is TraceRunState.NOT_COLLECTED:
            return
        info = self._records.assemble(
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
        message = info.message_data if output is None else info.message_data.model_copy(update={"answer": output})
        self.capture_terminal(
            tenant_id=tenant_id,
            info=info.model_copy(
                update={
                    "message_data": message,
                    "inputs": inputs,
                    "outputs": output if output is not None else info.outputs,
                    "end_time": datetime.now(UTC).replace(tzinfo=None),
                    "metadata": {**info.metadata, "message_execution_state": outcome},
                    "error": info.error if outcome == "succeeded" else f"Agent message {outcome}",
                }
            ),
        )

    def reconcile(self) -> None:
        """Schedule unfinished runs again, behind a broker outage, and purge runs past their retention."""
        for run_id in self._run_query.pending_ids(_RECONCILE_BATCH):
            self._schedule(run_id)
        self._runs.purge(retention_days=self._settings.retention_days, limit=_RECONCILE_BATCH)

    def _schedule(self, run_id: str) -> None:
        try:
            self._schedule_export(run_id)
        except Exception:
            logger.warning("Application trace is persisted; scheduling deferred: run_id=%s", run_id)

    def _change(self, run: TraceRun | TraceRunAgg, change: Callable[[TraceRunAgg], object]) -> None:
        """Apply ``change`` to a run that may have been purged since it was read."""
        with self._runs.change(run.id, tenant_id=run.tenant_id) as locked:
            if locked is not None:
                change(locked.run)

    def _run_for_source(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None:
        run = self._run_query.source_run(
            tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id
        )
        if run is None and source_kind == "message":
            message = self._sources.message(tenant_id=tenant_id, app_id=app_id, message_id=source_id)
            if message is not None and message.workflow_run_id:
                run = self._run_query.source_run(
                    tenant_id=tenant_id, app_id=app_id, source_kind="workflow", source_id=message.workflow_run_id
                )
        return run

    def _managed_owner(
        self, app: TraceApp, message: SourceMessage | TraceMessage | None, workflow_run_id: str | None
    ) -> bool:
        """Agent apps and workflows with Agent nodes are collected here; frozen runs win."""
        if message is not None:
            if self._run_for_source(
                tenant_id=app.tenant_id, app_id=app.id, source_kind="message", source_id=message.id
            ):
                return True
            workflow_run_id = message.workflow_run_id or workflow_run_id
        if app.mode is TraceAppMode.AGENT:
            return True
        if workflow_run_id:
            if self._run_query.source_run(
                tenant_id=app.tenant_id, app_id=app.id, source_kind="workflow", source_id=workflow_run_id
            ):
                return True
            workflow = self._sources.workflow_run(
                tenant_id=app.tenant_id, app_id=app.id, workflow_run_id=workflow_run_id
            )
            if workflow is not None:
                return workflow_has_agent_v2(workflow.graph)
        if app.mode is TraceAppMode.ADVANCED_CHAT or (app.mode is TraceAppMode.WORKFLOW and workflow_run_id):
            # Naming may run before Message.workflow_run_id is populated. Use
            # the owned app workflow; an unknown snapshot fails closed. The same
            # applies to a Workflow whose run is not yet indexed by LogStore.
            graph = (
                self._sources.app_workflow_graph(tenant_id=app.tenant_id, app_id=app.id, workflow_id=app.workflow_id)
                if app.workflow_id
                else None
            )
            return graph is None or workflow_has_agent_v2(graph)
        return False

    @override
    def link_managed_parent(self, *, tenant_id: str, info: WorkflowTraceInfo) -> WorkflowTraceInfo:
        """A provider-exported nested workflow names the Agent-collected parent it cannot attach to."""
        parent_run_id, parent_node_id = info.resolved_parent_context
        if not parent_run_id:
            return info
        parent = self._run_query.workflow_run_trace(tenant_id=tenant_id, workflow_run_id=parent_run_id)
        if parent is None:
            return info
        if self._sources.workflow_run(tenant_id=tenant_id, app_id=parent.app_id, workflow_run_id=parent_run_id) is None:
            return info
        metadata = dict(info.metadata)
        metadata.pop("parent_trace_context", None)
        metadata["linked_parent_workflow_run_id"] = parent_run_id
        if parent_node_id:
            metadata["linked_parent_node_execution_id"] = parent_node_id
        metadata["linked_parent_application_trace_id"] = parent.id
        metadata["linked_parent_trace_id"] = parent.trace_id
        return info.model_copy(update={"metadata": metadata})

    @override
    def capture_terminal(self, *, tenant_id: str, info: BaseTraceInfo) -> bool:
        """Take records of Agent-managed executions; ``False`` leaves the record to its provider."""
        source_kind: TraceSourceKind
        if isinstance(info, WorkflowTraceInfo):
            app_id = str(info.metadata.get("app_id", ""))
            source_id, source_kind = info.workflow_run_id, "workflow"
        elif isinstance(info, MessageTraceInfo):
            app_id = info.message_data.app_id
            source_id, source_kind = info.message_data.id, "message"
        else:
            # Auxiliary operations of a managed execution belong to its Agent trace. Naming may
            # report no message, so the record's own app decides then.
            message_data = info.message_data
            owner_app_id = message_data.app_id if message_data is not None else info.metadata.get("app_id")
            owner = (
                self._sources.app(tenant_id=tenant_id, app_id=owner_app_id)
                if isinstance(owner_app_id, str) and owner_app_id
                else None
            )
            return owner is not None and self._managed_owner(owner, message_data, None)
        app = self._sources.app(tenant_id=tenant_id, app_id=app_id)
        if app is None:
            return False
        message = (
            self._sources.message(tenant_id=tenant_id, app_id=app_id, message_id=source_id)
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
            run = self._fail_initialization(
                tenant_id=app.tenant_id, app_id=app.id, source_kind=source_kind, source_id=source_id
            )
            # A missing start snapshot must never fall back to an exporter without its capture policy.
            logger.warning(
                "Application trace snapshot missing; export suppressed: app_id=%s source_id=%s", app_id, source_id
            )
            if run is None:
                return True
        if not run.state.accepts_terminal:
            return True
        if (
            app.mode is TraceAppMode.AGENT
            and message is not None
            and info.metadata.get("message_execution_state") not in ("succeeded", "failed", "cancelled")
            and message.agent_stop_requested
        ):
            # An already queued consumer notification may arrive after a
            # stop. Its ordinary Message snapshot cannot own the runtime
            # outcome, even if span finalization has already completed.
            return True
        trace = self._builder.build(info)
        if trace is None:
            raise TraceCollectionError("tracing_terminal_not_supported")
        self._change(run, lambda current: current.capture_terminal(trace, now=naive_utc_now()))
        self._schedule(run.id)
        return True

    def _settle_preview(self, run: TraceRunAgg) -> None:
        if run.source_kind != "node" or not run.awaits_terminal:
            return
        node = self._sources.node_execution(tenant_id=run.tenant_id, app_id=run.app_id, node_execution_id=run.source_id)
        if node is not None:
            self._change(run, lambda current: current.settle_preview(node, now=naive_utc_now()))

    def _claim(self, run: TraceRunAgg) -> tuple[TraceRunAgg, str] | None:
        token = str(uuidv7())
        with self._runs.change(run.id, tenant_id=run.tenant_id) as locked:
            if locked is None or not locked.run.claim_export(
                token=token,
                owner_exists=locked.owner_exists,
                collection_timeout=self._settings.collection_timeout_seconds,
                lease_seconds=self._settings.export_lease_seconds,
                now=naive_utc_now(),
            ):
                return None
            return locked.run, token

    def _renew_export_lease(self, run: TraceRunAgg, token: str) -> bool:
        with self._runs.change(run.id, tenant_id=run.tenant_id) as locked:
            return locked is not None and locked.run.renew_export_lease(token, now=naive_utc_now())

    @contextmanager
    def _export_lease_heartbeat(self, run: TraceRunAgg, token: str) -> Generator[None]:
        """Keep slow exporters leased without holding a transaction across vendor I/O.

        A lost database connection is not proof that the exporter stopped. The
        attempt continues; the token-checked completion can reconcile a late ACK
        after lease expiry unless a manual retry has already replaced its token.
        """
        run_id = run.id
        stopped = threading.Event()
        interval = self._settings.export_lease_seconds / 3

        def heartbeat() -> None:
            while not stopped.wait(interval):
                try:
                    if not self._renew_export_lease(run, token):
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
        run = self._runs.load(run_id)
        if run is None:
            return
        recover_terminal(
            run,
            runs=self._runs,
            sources=self._sources,
            records=self._records,
            collector=self,
            collection_timeout=self._settings.collection_timeout_seconds,
            now=naive_utc_now(),
        )
        run = self._runs.load(run_id)
        if run is None:
            return
        self._settle_preview(run)
        claim = self._claim(run)
        if claim is None:
            return
        run, token = claim
        with self._export_lease_heartbeat(run, token):
            try:
                try:
                    trace = run.exported_trace(self._run_query.batches(run.id))
                except (ValueError, KeyError, TypeError) as error:
                    # Invalid persisted trees cannot be repaired by retrying a
                    # provider request. ValidationError also inherits ValueError.
                    raise TraceCollectionError("tracing_payload_invalid") from error
                provider = self._frozen_provider(run.provider)
                result = provider.send(self._codec.decode(run.tenant_id, type(provider), run.provider_config), trace)
            except ExportOutcomeUnknownError:
                self._change(run, lambda current: current.export_uncertain(token, now=naive_utc_now()))
            except ExportRetryableError:
                self._change(
                    run,
                    lambda current: current.export_deferred(
                        token, max_attempts=self._settings.max_export_attempts, now=naive_utc_now()
                    ),
                )
            except (TraceCollectionError, TraceRunError) as error:
                self._export_failed(run, token, error.code)
            except ProviderConfigUnreadableError:
                self._export_failed(run, token, "tracing_config_unreadable")
            except ExportRejectedError:
                self._export_failed(run, token, "provider_export_rejected")
            except Exception as error:
                logger.warning(
                    "Application trace export failed: run_id=%s provider=%s error_type=%s",
                    run_id,
                    run.provider,
                    type(error).__name__,
                )
                self._export_failed(run, token, "provider_export_rejected")
            else:
                self._change(
                    run,
                    lambda current: current.export_accepted(
                        token,
                        provider_trace_id=result.trace_id,
                        trace_url=result.trace_url,
                        span_urls=result.span_urls,
                        now=naive_utc_now(),
                    ),
                )

    def _export_failed(self, run: TraceRunAgg, token: str, error_code: str) -> None:
        self._change(run, lambda current: current.export_failed(token, error_code, now=naive_utc_now()))

    def _frozen_provider(self, provider_id: str) -> TraceProvider[Any]:
        try:
            return self._providers.resolve(provider_id)(self._egress)
        except (UnknownTraceProviderError, TraceProviderUnavailableError):
            raise TraceCollectionError("tracing_provider_unavailable") from None

    def _frozen_capabilities(self, provider_id: str) -> TraceProviderSupport | None:
        try:
            return support_of(self._providers.resolve(provider_id))
        except (UnknownTraceProviderError, TraceProviderUnavailableError):
            return None

    def _frozen_project_url(self, run: TraceRun) -> str | None:
        """Present the run's own destination, never the app's current one."""
        try:
            provider = self._providers.resolve(run.provider)
            return provider(self._egress).project_url(provider.config_model.model_validate(run.provider_config))
        except (UnknownTraceProviderError, TraceProviderUnavailableError, ValidationError):
            return None

    def status(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        node_execution_id: str | None,
    ) -> TraceRunStatus:
        run, node_execution_id = self._resolve_status_source(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            node_execution_id=node_execution_id,
        )
        return self._status_for_run(run, source_kind, source_id, node_execution_id)

    def _source(self, *, tenant_id: str, app_id: str, kind: TraceSourceKind, source_id: str) -> TraceSource | None:
        match kind:
            case "message":
                return self._sources.message(tenant_id=tenant_id, app_id=app_id, message_id=source_id)
            case "workflow":
                return self._sources.workflow_run(tenant_id=tenant_id, app_id=app_id, workflow_run_id=source_id)
            case "node":
                return self._sources.node_execution(tenant_id=tenant_id, app_id=app_id, node_execution_id=source_id)

    def _resolve_status_source(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        node_execution_id: str | None,
    ) -> tuple[TraceRun | None, str | None]:
        """Resolve node log aliases through their owned workflow, outside SQL transactions."""
        source = self._source(tenant_id=tenant_id, app_id=app_id, kind=source_kind, source_id=source_id)
        if source is None:
            raise TraceCollectionNotFoundError("tracing_source_not_found")
        if source_kind == "node" and node_execution_id is not None and node_execution_id != source_id:
            raise TraceCollectionNotFoundError("tracing_node_not_found")
        run = self._run_for_source(tenant_id=tenant_id, app_id=app_id, source_kind=source_kind, source_id=source_id)
        # A standalone preview (including a frozen disabled decision) owns its
        # status even if its source later carries a workflow run reference.
        if run is None and isinstance(source, SourceNodeExecution) and source.workflow_run_id:
            workflow = self._sources.workflow_run(
                tenant_id=tenant_id, app_id=app_id, workflow_run_id=source.workflow_run_id
            )
            if workflow is None or not source.workflow_id or workflow.workflow_id != source.workflow_id:
                raise TraceCollectionNotFoundError("tracing_source_not_found")
            run = self._run_query.source_run(
                tenant_id=tenant_id, app_id=app_id, source_kind="workflow", source_id=workflow.id
            )
            node_execution_id = source.id
        return run, node_execution_id

    def _status_for_run(
        self, run: TraceRun | None, source_kind: TraceSourceKind, source_id: str, node_execution_id: str | None
    ) -> TraceRunStatus:
        if run is None or run.state is TraceRunState.NOT_COLLECTED:
            return TraceRunStatus(
                status=TraceRunState.NOT_COLLECTED,
                source_kind=source_kind,
                source_id=source_id,
                provider=None,
                trace_id=None,
                trace_url=None,
                span_url=None,
                project_url=None,
                config_revision=None,
                capture_content=None,
                capture_agent=None,
                span_count=None,
                attempts=None,
                error_code=None,
                accepted_at=None,
                capabilities=None,
            )
        invocations = self._run_query.invocations(run.id)
        selected = (
            [inv for inv in invocations if inv.node_execution_id == node_execution_id] if node_execution_id else []
        )
        if node_execution_id and not selected and not (source_kind == "node" and run.source_kind == "workflow"):
            raise TraceCollectionNotFoundError("tracing_node_not_found")
        return TraceRunStatus(
            status=run.state,
            source_kind=source_kind,
            source_id=source_id,
            provider=run.provider or None,
            trace_id=run.provider_trace_id or run.trace_id,
            trace_url=run.trace_url,
            span_url=run.span_urls.get(selected[-1].span_id) if selected else None,
            project_url=self._frozen_project_url(run) if run.provider else None,
            config_revision=run.config_revision or None,
            capture_content=run.capture_content,
            capture_agent=run.capture_agent,
            span_count=run.span_count,
            attempts=run.attempts,
            error_code=run.error_code,
            accepted_at=run.accepted_at,
            capabilities=self._frozen_capabilities(run.provider) if run.provider else None,
        )

    def retry(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        acknowledge_possible_duplicates: bool,
        node_execution_id: str | None,
    ) -> TraceRunStatus:
        run, node_execution_id = self._resolve_status_source(
            tenant_id=tenant_id,
            app_id=app_id,
            source_kind=source_kind,
            source_id=source_id,
            node_execution_id=node_execution_id,
        )
        if run is None:
            raise TraceCollectionNotFoundError("tracing_run_not_found")
        self._status_for_run(run, source_kind, source_id, node_execution_id)
        with _collection_errors(), self._runs.change(run.id, tenant_id=tenant_id) as locked:
            if locked is None:
                raise TraceCollectionNotFoundError("tracing_run_not_found")
            locked.run.release_for_retry(
                acknowledge_possible_duplicates=acknowledge_possible_duplicates, now=naive_utc_now()
            )
        self._schedule(run.id)
        return self._status_for_run(self._run_query.get(run.id), source_kind, source_id, node_execution_id)
