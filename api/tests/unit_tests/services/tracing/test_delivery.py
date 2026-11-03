from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import override

import pytest
from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.model import Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from dify_trace_sdk.testing import RecordingEgress, response
from pydantic import ValidationError

from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.delivery import (
    ExportJob,
    ExportRetryQueue,
    StoredTraceDestination,
    TraceCollector,
    TraceDeliveryService,
    TraceDestinationQuery,
    TraceRecordSource,
    retry_delay_seconds,
)
from services.tracing.errors import SourceNotReadyError, TraceCollectorUnavailableError
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, TraceMessage, WorkflowTraceInfo
from tests.helpers.unit.services.tracing_ports import InstalledTraceProviders, WorkspaceBoundCipher

STARTED_AT = datetime(2026, 1, 1, 8, 0, 0)
MESSAGE_ID = "6f1c0b52-6ad4-4c4e-9d7c-2a3f0d0c7a11"
TENANT_ID = "tenant-1"
APP_ID = "app-1"


class _Config(ProviderConfig):
    endpoint: str


class _Provider(TraceProvider[_Config]):
    """Posts each trace to its endpoint; the egress script decides the outcome."""

    id = "langfuse"
    config_model = _Config
    capabilities = ProviderCapabilities(native_cost=False, trace_url=False, span_url=False)

    @override
    def verify(self, config: _Config) -> _Config:
        return config

    @override
    def project_url(self, config: _Config) -> str | None:
        return None

    @override
    def send(self, config: _Config, trace: Trace) -> SendResult:
        self.egress.request(
            "POST",
            f"{config.endpoint}/traces",
            headers={},
            content=trace.model_dump_json().encode(),
            timeout=30.0,
            sensitive_url=False,
        )
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})


class _Records(TraceRecordSource):
    def __init__(self, result: BaseTraceInfo | Exception) -> None:
        self.result = result
        self.events: list[TraceEvent] = []

    @override
    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        self.events.append(event)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class _Destinations(TraceDestinationQuery):
    """Stored destinations by (tenant, app); records the owner of every lookup."""

    def __init__(self, destinations: dict[tuple[str, str], StoredTraceDestination]) -> None:
        self.destinations = destinations
        self.lookups: list[tuple[str, str]] = []

    @override
    def active_destination(self, *, tenant_id: str, app_id: str) -> StoredTraceDestination | None:
        self.lookups.append((tenant_id, app_id))
        return self.destinations.get((tenant_id, app_id))


class _Retries(ExportRetryQueue):
    def __init__(self) -> None:
        self.scheduled: list[tuple[ExportJob, int]] = []

    @override
    def schedule(self, job: ExportJob, *, delay_seconds: int) -> None:
        self.scheduled.append((job, delay_seconds))


class _Collector(TraceCollector):
    def __init__(self, *, captures: bool, fails: bool) -> None:
        self.captures = captures
        self.fails = fails
        self.seen: list[tuple[str, BaseTraceInfo]] = []

    @override
    def capture_terminal(self, *, tenant_id: str, info: BaseTraceInfo) -> bool:
        if self.fails:
            raise RuntimeError("ledger unavailable")
        self.seen.append((tenant_id, info))
        return self.captures

    @override
    def link_managed_parent(self, *, tenant_id: str, info: WorkflowTraceInfo) -> WorkflowTraceInfo:
        return info


@dataclass
class _Delivery:
    records: _Records
    egress: RecordingEgress
    destinations: _Destinations
    retries: _Retries = field(default_factory=_Retries)
    enterprise: list[BaseTraceInfo] = field(default_factory=list)

    def service(self, *, enterprise: bool, collector: _Collector | None) -> TraceDeliveryService:
        return TraceDeliveryService(
            records=self.records,
            destinations=self.destinations,
            providers=InstalledTraceProviders(_Provider),
            codec=ProviderConfigCodec(WorkspaceBoundCipher()),
            builder=CanonicalTraceBuilder(),
            egress=self.egress,
            retries=self.retries,
            enterprise_sink=self.enterprise.append if enterprise else None,
            collector=collector,
            max_export_attempts=3,
        )

    def sent(self) -> list[Trace]:
        return [Trace.model_validate_json(request.content or b"") for request in self.egress.requests]


def _event() -> TraceEvent:
    return TraceEvent(
        event_id="event-1",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        user_id="account-1",
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
        payload=MessageCompleted(message_id=MESSAGE_ID, conversation_id="conversation-1"),
    )


def _record(*, workflow_run_id: str | None) -> MessageTraceInfo:
    message = TraceMessage(
        id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id="conversation-1",
        workflow_run_id=workflow_run_id,
        query="hi",
        answer="hello",
        error=None,
        created_at=STARTED_AT,
        model_provider=None,
        model_id=None,
        total_price=None,
        currency="USD",
    )
    return MessageTraceInfo(
        message_id=MESSAGE_ID,
        message_data=message,
        inputs="hi",
        outputs="hello",
        start_time=STARTED_AT,
        end_time=STARTED_AT + timedelta(seconds=1),
        metadata={},
        conversation_model="chat",
        message_tokens=1,
        answer_tokens=1,
        total_tokens=2,
        error=None,
        file_list=[],
        conversation_mode="chat",
        gen_ai_server_time_to_first_token=None,
        llm_streaming_time_to_generate=None,
        is_streaming_request=False,
    )


def _delivery(record: BaseTraceInfo | Exception, outcomes: list[EgressResponse | Exception]) -> _Delivery:
    stored = StoredTraceDestination(provider_id="langfuse", config={"endpoint": "https://collector.example"})
    return _Delivery(
        records=_Records(record),
        egress=RecordingEgress(outcomes, grpc_target=None),
        destinations=_Destinations({(TENANT_ID, APP_ID): stored}),
    )


def test_every_sink_receives_the_record_and_the_provider_gets_the_trace() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [response(200, {})])
    collector = _Collector(captures=False, fails=False)

    delivery.service(enterprise=True, collector=collector).deliver(_event(), enterprise_delivered=False)

    assert len(delivery.enterprise) == 1
    assert [tenant_id for tenant_id, _ in collector.seen] == [TENANT_ID]
    (trace,) = delivery.sent()
    assert trace.root.name == "message"
    assert delivery.destinations.lookups == [(TENANT_ID, APP_ID)]
    assert delivery.retries.scheduled == []


def test_enterprise_sink_is_skipped_on_redelivery() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [response(200, {})])

    delivery.service(enterprise=True, collector=None).deliver(_event(), enterprise_delivered=True)

    assert delivery.enterprise == []


def test_records_the_collector_owns_never_reach_the_provider() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [])

    delivery.service(enterprise=False, collector=_Collector(captures=True, fails=False)).deliver(
        _event(), enterprise_delivered=False
    )

    assert delivery.sent() == []
    assert delivery.destinations.lookups == []


def test_an_unavailable_collector_asks_for_redelivery() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [])

    with pytest.raises(TraceCollectorUnavailableError):
        delivery.service(enterprise=False, collector=_Collector(captures=False, fails=True)).deliver(
            _event(), enterprise_delivered=False
        )


def test_chatflow_message_is_covered_by_its_workflow_trace() -> None:
    delivery = _delivery(_record(workflow_run_id="run-1"), [])

    delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)

    assert delivery.sent() == []


def test_source_not_ready_propagates_for_redelivery() -> None:
    delivery = _delivery(SourceNotReadyError(), [])

    with pytest.raises(SourceNotReadyError):
        delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)


def test_an_app_without_an_active_destination_sends_nothing() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [])
    delivery.destinations.destinations.clear()

    delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)

    assert delivery.sent() == []
    assert delivery.destinations.lookups == [(TENANT_ID, APP_ID)]


def test_retryable_failure_schedules_the_next_attempt_until_the_limit() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [ExportRetryableError("busy"), ExportRetryableError("busy")])
    service = delivery.service(enterprise=False, collector=None)

    service.deliver(_event(), enterprise_delivered=False)

    ((job, delay),) = delivery.retries.scheduled
    assert (job.attempt, job.provider_id, job.tenant_id, job.app_id) == (2, "langfuse", TENANT_ID, APP_ID)
    assert delay == retry_delay_seconds(1)
    destination = service.destination(TENANT_ID, APP_ID)
    assert destination is not None
    service.export(job.model_copy(update={"attempt": 3}), destination)
    assert len(delivery.retries.scheduled) == 1


@pytest.mark.parametrize("failure", [ExportRejectedError("bad key"), ExportOutcomeUnknownError("timeout")])
def test_rejected_or_unknown_outcomes_are_never_retried(failure: Exception) -> None:
    delivery = _delivery(_record(workflow_run_id=None), [failure])

    delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)

    assert delivery.retries.scheduled == []


def test_retry_is_dropped_when_the_app_now_traces_elsewhere() -> None:
    trace = CanonicalTraceBuilder().build(_record(workflow_run_id=None))
    assert trace is not None
    delivery = _delivery(_record(workflow_run_id=None), [])

    delivery.service(enterprise=False, collector=None).retry(
        ExportJob(tenant_id=TENANT_ID, app_id=APP_ID, provider_id="opik", attempt=2, trace=trace)
    )

    assert delivery.sent() == []


def test_retry_reads_the_destination_through_the_jobs_workspace() -> None:
    trace = CanonicalTraceBuilder().build(_record(workflow_run_id=None))
    assert trace is not None
    delivery = _delivery(_record(workflow_run_id=None), [response(200, {})])

    delivery.service(enterprise=False, collector=None).retry(
        ExportJob(tenant_id=TENANT_ID, app_id=APP_ID, provider_id="langfuse", attempt=2, trace=trace)
    )

    assert delivery.sent() == [trace]
    assert delivery.destinations.lookups == [(TENANT_ID, APP_ID)]


def test_export_job_round_trips_through_storage_format() -> None:
    trace = CanonicalTraceBuilder().build(_record(workflow_run_id=None))
    assert trace is not None
    job = ExportJob(tenant_id=TENANT_ID, app_id=APP_ID, provider_id="langfuse", attempt=2, trace=trace)

    assert ExportJob.model_validate_json(job.model_dump_json()) == job


def test_retry_delay_grows_and_is_capped() -> None:
    assert [retry_delay_seconds(attempt) for attempt in (1, 2, 3, 10)] == [10, 20, 40, 600]


def test_records_that_fail_validation_are_dropped_instead_of_failing_the_task() -> None:
    with pytest.raises(ValidationError) as invalid:
        MessageTraceInfo.model_validate({})
    delivery = _delivery(invalid.value, [])

    delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)

    assert delivery.sent() == []


def test_unclassified_provider_failures_are_contained() -> None:
    delivery = _delivery(_record(workflow_run_id=None), [RuntimeError("provider bug with secret-detail")])

    delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)

    assert delivery.retries.scheduled == []


@pytest.mark.parametrize(
    "stored",
    [
        StoredTraceDestination(provider_id="opik", config={"endpoint": "https://collector.example"}),
        StoredTraceDestination(provider_id="langfuse", config={"endpoint": 1}),
    ],
    ids=["not-installed", "unreadable"],
)
def test_destinations_that_cannot_be_used_send_nothing(stored: StoredTraceDestination) -> None:
    delivery = _delivery(_record(workflow_run_id=None), [])
    delivery.destinations.destinations[(TENANT_ID, APP_ID)] = stored

    delivery.service(enterprise=False, collector=None).deliver(_event(), enterprise_delivered=False)

    assert delivery.sent() == []
