"""Deliver trace events to every sink that consumes them.

Sinks are independent: enterprise telemetry receives every record, the Agent
trace collector owns records of Agent-managed executions, and the app's
tracing provider receives the rest. Only a provider send is retried: a
retryable failure persists the canonical trace (never the record) and
schedules that send alone. The configuration is read when sending, so a
rotated or removed credential takes effect immediately.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from celery import current_app as celery_app
from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import TraceEvent
from dify_trace_sdk.model import Trace
from dify_trace_sdk.provider import TraceProvider
from opentelemetry import metrics
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace
from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import App, TraceAppConfig
from services.tracing.assembly import TraceAssembler
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.egress import SSRFEgress
from services.tracing.emitter import TRACE_QUEUE, payload_key
from services.tracing.provider_configs import ProviderConfigUnreadableError, decode_config
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, WorkflowTraceInfo
from services.tracing.registry import TraceProviderUnavailableError, UnknownTraceProviderError, provider_class
from services.tracing.service import application_tracing_service

logger = logging.getLogger(__name__)

RETRY_TASK = "tasks.trace_delivery_task.retry_trace_export"

_meter = metrics.get_meter(__name__)
_event_counter = _meter.create_counter("dify.tracing.events", description="Trace events by kind and outcome")
_export_counter = _meter.create_counter("dify.tracing.exports", description="Provider sends by provider and outcome")


class RecordAssembler(Protocol):
    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        """Raises SourceNotFoundError, or SourceNotReadyError while the source is not persisted yet."""
        ...


class TraceCollector(Protocol):
    def capture_terminal(self, info: BaseTraceInfo) -> bool:
        """Take ownership of a record of an Agent-managed execution; ``False`` leaves it to the provider."""
        ...

    def link_managed_parent(self, info: WorkflowTraceInfo) -> WorkflowTraceInfo:
        """Name the Agent-collected parent that a provider-exported nested workflow cannot attach to."""
        ...


class TraceCollectorUnavailableError(Exception):
    """The Agent trace collector could not decide ownership; the event must be redelivered."""


@dataclass(frozen=True)
class Destination:
    provider: TraceProvider[Any]
    config: ProviderConfig


class ExportJob(BaseModel):
    """A provider send waiting for its next attempt."""

    tenant_id: str
    app_id: str
    provider_id: str
    attempt: int
    trace: Trace

    model_config = ConfigDict(extra="forbid", frozen=True)


def retry_delay_seconds(attempt: int) -> int:
    return min(600, 10 * 2 ** (attempt - 1))


class TraceDeliveryService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        assembler: RecordAssembler,
        builder: CanonicalTraceBuilder,
        egress: Egress,
        enterprise_sink: Callable[[BaseTraceInfo], None] | None,
        collector: TraceCollector | None,
        max_export_attempts: int,
    ) -> None:
        self._sessions = session_factory
        self._assembler = assembler
        self._builder = builder
        self._egress = egress
        self._enterprise_sink = enterprise_sink
        self._collector = collector
        self._max_export_attempts = max_export_attempts

    def deliver(self, event: TraceEvent, *, enterprise_delivered: bool) -> None:
        """Raises SourceNotReadyError (redeliver later) or TraceCollectorUnavailableError."""
        kind = event.payload.kind
        try:
            record = self._assembler.assemble(event)
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
                if self._collector.capture_terminal(record):
                    _event_counter.add(1, {"kind": kind, "outcome": "collected"})
                    return
                if isinstance(record, WorkflowTraceInfo):
                    record = self._collector.link_managed_parent(record)
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
            self._schedule_retry(job.model_copy(update={"attempt": job.attempt + 1}))
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
        with self._sessions() as session:
            app_tracing = session.scalar(select(App.tracing).where(App.id == app_id, App.tenant_id == tenant_id))
            provider_id = self._enabled_provider(app_tracing)
            if provider_id is None:
                return None
            stored = session.scalar(
                select(TraceAppConfig.tracing_config).where(
                    TraceAppConfig.app_id == app_id,
                    TraceAppConfig.tracing_provider == provider_id,
                    TraceAppConfig.is_active.is_(True),
                )
            )
        if not isinstance(stored, dict):
            return None
        try:
            provider = provider_class(provider_id)
            config = decode_config(tenant_id, provider, stored)
        except (UnknownTraceProviderError, TraceProviderUnavailableError):
            logger.warning("Tracing provider unavailable: provider=%s app_id=%s", provider_id, app_id)
            return None
        except ProviderConfigUnreadableError:
            logger.warning("Tracing configuration unreadable: provider=%s app_id=%s", provider_id, app_id)
            return None
        return Destination(provider=provider(self._egress), config=config)

    @staticmethod
    def _enabled_provider(app_tracing: str | None) -> str | None:
        if not app_tracing:
            return None
        try:
            policy = json.loads(app_tracing)
        except ValueError:
            return None
        if not isinstance(policy, dict) or policy.get("enabled") is not True:
            return None
        provider_id = policy.get("tracing_provider")
        return provider_id if isinstance(provider_id, str) else None

    @staticmethod
    def _schedule_retry(job: ExportJob) -> None:
        key = payload_key(datetime.now(UTC), "exports", uuid4().hex)
        storage.save(key, job.model_dump_json().encode())
        celery_app.send_task(RETRY_TASK, args=(key,), queue=TRACE_QUEUE, countdown=retry_delay_seconds(job.attempt - 1))


def _enterprise_sink(record: BaseTraceInfo) -> None:
    EnterpriseOtelTrace().trace(record)


def trace_delivery_service() -> TraceDeliveryService:
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    enterprise = is_enterprise_telemetry_enabled()
    return TraceDeliveryService(
        session_factory=sessions,
        assembler=TraceAssembler(sessions, files_url=dify_config.FILES_URL, enterprise_details=enterprise),
        builder=CanonicalTraceBuilder(),
        egress=SSRFEgress(),
        enterprise_sink=_enterprise_sink if enterprise else None,
        collector=application_tracing_service() if dify_config.OPS_AGENT_TRACE_ENABLED else None,
        max_export_attempts=dify_config.OPS_TRACE_EXPORT_MAX_ATTEMPTS,
    )
