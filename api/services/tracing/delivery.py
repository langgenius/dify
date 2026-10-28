"""Deliver trace events to every sink that consumes them.

Sinks are independent: enterprise telemetry receives every record, the Agent
trace collector owns records of Agent-managed executions, and the app's
tracing provider receives the rest. A nested workflow run joins the trace of
the run that started it when both go to the same destination. Only a provider
send is retried: a retryable failure persists the canonical trace (never the
record) and schedules that send alone. The configuration is read when sending,
so a rotated or removed credential takes effect immediately.
"""

import logging
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import TraceEvent, TraceParent
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import SpanRef, Trace
from dify_trace_sdk.provider import TraceProvider
from opentelemetry import metrics
from pydantic import BaseModel, ConfigDict, ValidationError

from domain.tracing.nested_workflow_trace import OuterTrace, nested_trace_placement
from services.tracing.canonical import CanonicalTraceBuilder, root_trace_id
from services.tracing.errors import (
    ProviderConfigUnreadableError,
    TraceCollectorUnavailableError,
    TraceProviderUnavailableError,
    TracingStoreUnavailableError,
    UnknownTraceProviderError,
)
from services.tracing.providers import ProviderConfigCodec, TraceProviderCatalog
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, WorkflowTraceInfo

logger = logging.getLogger(__name__)

_meter = metrics.get_meter(__name__)
_event_counter = _meter.create_counter("dify.tracing.events", description="Trace events by kind and outcome")
_export_counter = _meter.create_counter("dify.tracing.exports", description="Provider sends by provider and outcome")


class TraceRecordSource(Protocol):
    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        """Read the event's record through its tenant and app.

        Raises:
            SourceNotFoundError: The record does not exist for the event's tenant and app.
            SourceNotReadyError: The record is not persisted or not finished yet.
        """
        ...


@dataclass(frozen=True, slots=True)
class StoredTraceDestination:
    provider_id: str
    config: Mapping[str, Any]
    """The stored configuration, secrets still encrypted."""


class TraceDestinationQuery(Protocol):
    def active_destination(self, *, tenant_id: str, app_id: str) -> StoredTraceDestination | None:
        """The configuration of the provider the app traces to, read through the app's workspace.

        ``None`` when the app is not in the workspace, tracing is disabled, or the
        enabled provider has no active configuration.
        """
        ...


@dataclass(frozen=True, slots=True)
class OuterRunRoot:
    """The span a workflow run's trace starts with when that run is the root of its trace."""

    root_id: str
    """The chatflow message the run answers, otherwise the run itself."""
    started_at: datetime


class OuterRunQuery(Protocol):
    """The runs that started nested workflow runs, read through their tenant and app."""

    def root(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> OuterRunRoot | None:
        """``None`` until the run, and the message a chatflow run answers, are persisted."""
        ...

    def node_started_at(
        self, *, tenant_id: str, app_id: str, workflow_run_id: str, node_execution_id: str
    ) -> datetime | None:
        """``None`` until the node execution is persisted."""
        ...


@dataclass(frozen=True, slots=True)
class CollectedTrace:
    """How the Agent trace of a workflow run is exported."""

    trace_id: str | None
    """``None`` until collection starts and fixes it."""
    destination: StoredTraceDestination | None
    """The destination frozen when collection started; ``None`` when the run exports nowhere."""


class TraceCollector(Protocol):
    def capture_terminal(self, *, tenant_id: str, info: BaseTraceInfo) -> bool:
        """Take ownership of a record of an Agent-managed execution; ``False`` leaves it to the provider."""
        ...

    def collected_trace(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> CollectedTrace | None:
        """How the run's Agent trace is exported; ``None`` when its spans are not collected."""
        ...


type EnterpriseTraceSink = Callable[[BaseTraceInfo], None]


class ExportJob(BaseModel):
    """A provider send waiting for its next attempt."""

    tenant_id: str
    app_id: str
    provider_id: str
    attempt: int
    trace: Trace

    model_config = ConfigDict(extra="forbid", frozen=True)


class ExportRetryQueue(Protocol):
    def schedule(self, job: ExportJob, *, delay_seconds: int) -> None:
        """Persist the job and run it once the delay passes; ``TraceDeliveryService.retry`` receives it."""
        ...


@dataclass(frozen=True)
class Destination:
    provider: TraceProvider[Any]
    config: ProviderConfig

    def is_same(self, other: "Destination") -> bool:
        """Whether both send to the same provider with the same configuration."""
        return self.provider.id == other.provider.id and self.config == other.config


def retry_delay_seconds(attempt: int) -> int:
    return min(600, 10 * 2 ** (attempt - 1))


class TraceDeliveryService:
    def __init__(
        self,
        *,
        records: TraceRecordSource,
        outer_runs: OuterRunQuery,
        destinations: TraceDestinationQuery,
        providers: TraceProviderCatalog,
        codec: ProviderConfigCodec,
        builder: CanonicalTraceBuilder,
        egress: Egress,
        retries: ExportRetryQueue,
        enterprise_sink: EnterpriseTraceSink | None,
        collector: TraceCollector | None,
        max_export_attempts: int,
    ) -> None:
        """``enterprise_sink`` and ``collector`` are ``None`` when the deployment does not run that sink."""
        self._records = records
        self._outer_runs = outer_runs
        self._destinations = destinations
        self._providers = providers
        self._codec = codec
        self._builder = builder
        self._egress = egress
        self._retries = retries
        self._enterprise_sink = enterprise_sink
        self._collector = collector
        self._max_export_attempts = max_export_attempts

    def deliver(self, event: TraceEvent, *, enterprise_delivered: bool) -> None:
        """Raises SourceNotReadyError (redeliver later) or TraceCollectorUnavailableError."""
        kind = event.payload.kind
        try:
            record = self._records.assemble(event)
        except ValidationError:
            logger.warning("Trace record not assemblable: kind=%s app_id=%s", kind, event.app_id)
            _event_counter.add(1, {"kind": kind, "outcome": "invalid"})
            return
        if self._enterprise_sink is not None and not enterprise_delivered:
            try:
                self._enterprise_sink(record)
            except Exception:
                logger.exception("Enterprise trace failed: kind=%s app_id=%s", kind, event.app_id)
        if self._collector is not None:
            try:
                if self._collector.capture_terminal(tenant_id=event.tenant_id, info=record):
                    _event_counter.add(1, {"kind": kind, "outcome": "collected"})
                    return
            except Exception:
                raise TraceCollectorUnavailableError from None
        if isinstance(record, MessageTraceInfo) and record.message_data.workflow_run_id:
            # A chatflow message is the root of its workflow trace; sending it again would duplicate it.
            _event_counter.add(1, {"kind": kind, "outcome": "covered"})
            return
        if event.app_id is None:
            return
        destination = self.destination(event.tenant_id, event.app_id)
        if destination is None:
            _event_counter.add(1, {"kind": kind, "outcome": "no_destination"})
            return
        try:
            trace = self._builder.build(record)
        except ValueError:
            # A record the builder cannot represent would fail the same way on every redelivery.
            logger.warning("Trace record not buildable: kind=%s app_id=%s", kind, event.app_id, exc_info=True)
            _event_counter.add(1, {"kind": kind, "outcome": "invalid"})
            return
        if trace is None:
            _event_counter.add(1, {"kind": kind, "outcome": "not_exported"})
            return
        if isinstance(record, WorkflowTraceInfo) and record.parent is not None:
            trace = self._nested(event.tenant_id, record.parent, destination, trace)
        _event_counter.add(1, {"kind": kind, "outcome": "exported"})
        self.export(
            ExportJob(
                tenant_id=event.tenant_id,
                app_id=event.app_id,
                provider_id=destination.provider.id,
                attempt=1,
                trace=trace,
            ),
            destination,
        )

    def retry(self, job: ExportJob) -> None:
        destination = self.destination(job.tenant_id, job.app_id)
        if destination is None or destination.provider.id != job.provider_id:
            # The app now traces elsewhere or not at all; the old destination must not receive data.
            _export_counter.add(1, {"provider": job.provider_id, "outcome": "destination_changed"})
            return
        self.export(job, destination)

    def export(self, job: ExportJob, destination: Destination) -> None:
        provider_id = job.provider_id
        try:
            destination.provider.send(destination.config, job.trace)
        except ExportRetryableError as error:
            if job.attempt >= self._max_export_attempts:
                logger.warning("Trace export retries exhausted: provider=%s app_id=%s", provider_id, job.app_id)
                _export_counter.add(1, {"provider": provider_id, "outcome": "retries_exhausted"})
                return
            logger.info("Trace export will retry: provider=%s attempt=%s reason=%s", provider_id, job.attempt, error)
            _export_counter.add(1, {"provider": provider_id, "outcome": "retrying"})
            self._retries.schedule(
                job.model_copy(update={"attempt": job.attempt + 1}), delay_seconds=retry_delay_seconds(job.attempt)
            )
        except ExportOutcomeUnknownError as error:
            logger.warning(
                "Trace export outcome unknown: provider=%s app_id=%s reason=%s", provider_id, job.app_id, error
            )
            _export_counter.add(1, {"provider": provider_id, "outcome": "outcome_unknown"})
        except ExportRejectedError as error:
            logger.warning("Trace export rejected: provider=%s app_id=%s reason=%s", provider_id, job.app_id, error)
            _export_counter.add(1, {"provider": provider_id, "outcome": "rejected"})
        except Exception as error:
            # Unclassified failures may carry request details, so only their type is logged.
            logger.warning(
                "Trace export failed: provider=%s app_id=%s error=%s", provider_id, job.app_id, type(error).__name__
            )
            _export_counter.add(1, {"provider": provider_id, "outcome": "error"})
        else:
            _export_counter.add(1, {"provider": provider_id, "outcome": "accepted"})

    def destination(self, tenant_id: str, app_id: str) -> Destination | None:
        """The app's current provider destination, read through the app's workspace."""
        stored = self._destinations.active_destination(tenant_id=tenant_id, app_id=app_id)
        return self._decoded(tenant_id, app_id, stored) if stored is not None else None

    def _nested(self, tenant_id: str, parent: TraceParent, destination: Destination, trace: Trace) -> Trace:
        """Hang a nested run's trace from the tool node that started it when its outer trace goes to ``destination``.

        A nested run whose outer records cannot be read yet is sent on its own.
        """
        if parent.app_id is None or parent.node_execution_id is None:
            return trace
        try:
            started_at = self._outer_runs.node_started_at(
                tenant_id=tenant_id,
                app_id=parent.app_id,
                workflow_run_id=parent.workflow_run_id,
                node_execution_id=parent.node_execution_id,
            )
            if started_at is None:
                return trace
            placement = nested_trace_placement(
                self._outer_traces(tenant_id, parent, destination),
                tool_node=SpanRef(span_id=span_id_for(parent.node_execution_id), start_time=started_at),
            )
        except TracingStoreUnavailableError:
            logger.warning("Outer trace unreadable; nested trace sent on its own: app_id=%s", parent.app_id)
            return trace
        return placement.place(trace) if placement is not None else trace

    def _outer_traces(self, tenant_id: str, parent: TraceParent, destination: Destination) -> Iterator[OuterTrace]:
        """The traces of the runs that started a nested run, innermost first, while they are known."""
        link: TraceParent | None = parent
        while link is not None and link.app_id is not None:
            root = self._outer_runs.root(tenant_id=tenant_id, app_id=link.app_id, workflow_run_id=link.workflow_run_id)
            if root is None:
                return
            collected = (
                self._collector.collected_trace(
                    tenant_id=tenant_id, app_id=link.app_id, workflow_run_id=link.workflow_run_id
                )
                if self._collector is not None
                else None
            )
            if collected is None:
                trace_id = root_trace_id(link.external_trace_id, root.root_id)
                external_trace_id = link.external_trace_id
                outer_destination = self.destination(tenant_id, link.app_id)
            elif collected.trace_id is None:
                return
            else:
                # An Agent trace keeps a caller's trace ID only as an attribute.
                trace_id, external_trace_id = collected.trace_id, None
                outer_destination = (
                    self._decoded(tenant_id, link.app_id, collected.destination)
                    if collected.destination is not None
                    else None
                )
            yield OuterTrace(
                trace_id=trace_id,
                external_trace_id=external_trace_id,
                root=SpanRef(span_id=span_id_for(root.root_id), start_time=root.started_at),
                same_destination=outer_destination is not None and outer_destination.is_same(destination),
                collected=collected is not None,
            )
            link = link.parent

    def _decoded(self, tenant_id: str, app_id: str, stored: StoredTraceDestination) -> Destination | None:
        try:
            provider = self._providers.resolve(stored.provider_id)
            config = self._codec.decode(tenant_id, provider, stored.config)
        except (UnknownTraceProviderError, TraceProviderUnavailableError):
            logger.warning("Tracing provider unavailable: provider=%s app_id=%s", stored.provider_id, app_id)
            return None
        except ProviderConfigUnreadableError:
            logger.warning("Tracing configuration unreadable: provider=%s app_id=%s", stored.provider_id, app_id)
            return None
        return Destination(provider=provider(self._egress), config=config)
