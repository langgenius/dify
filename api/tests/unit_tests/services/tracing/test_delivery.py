from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import override

import pytest
from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.model import Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from dify_trace_sdk.testing import RecordingEgress
from pydantic import ValidationError
from sqlalchemy.orm import sessionmaker

from models.model import Message
from services.tracing.assembly import SourceNotReadyError
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.delivery import (
    Destination,
    ExportJob,
    TraceCollectorUnavailableError,
    TraceDeliveryService,
    retry_delay_seconds,
)
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, WorkflowTraceInfo

STARTED_AT = datetime(2026, 1, 1, 8, 0, 0)
MESSAGE_ID = "6f1c0b52-6ad4-4c4e-9d7c-2a3f0d0c7a11"


class _Config(ProviderConfig):
    endpoint: str


class _Provider(TraceProvider[_Config]):
    id = "scripted"
    config_model = _Config
    capabilities = ProviderCapabilities(native_cost=False, trace_url=False, span_url=False)

    def __init__(self, outcomes: list[Exception | None]) -> None:
        super().__init__(RecordingEgress([], grpc_target=None))
        self.outcomes = outcomes
        self.sent: list[Trace] = []

    @override
    def verify(self, config: _Config) -> _Config:
        return config

    @override
    def project_url(self, config: _Config) -> str | None:
        return None

    @override
    def send(self, config: _Config, trace: Trace) -> SendResult:
        self.sent.append(trace)
        outcome = self.outcomes.pop(0)
        if outcome is not None:
            raise outcome
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})


class _Assembler:
    def __init__(self, result: BaseTraceInfo | Exception) -> None:
        self.result = result
        self.events: list[TraceEvent] = []

    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        self.events.append(event)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class _Collector:
    def __init__(self, *, captures: bool, fails: bool) -> None:
        self.captures = captures
        self.fails = fails
        self.seen: list[BaseTraceInfo] = []

    def capture_terminal(self, info: BaseTraceInfo) -> bool:
        if self.fails:
            raise RuntimeError("ledger unavailable")
        self.seen.append(info)
        return self.captures

    def link_managed_parent(self, info: WorkflowTraceInfo) -> WorkflowTraceInfo:
        return info


class _Service(TraceDeliveryService):
    """Delivery with an in-memory destination and retry schedule."""

    def __init__(
        self,
        *,
        assembler: _Assembler,
        destination: Destination | None,
        enterprise_sink: Callable[[BaseTraceInfo], None] | None,
        collector: _Collector | None,
    ) -> None:
        super().__init__(
            session_factory=sessionmaker(),
            assembler=assembler,
            builder=CanonicalTraceBuilder(),
            egress=RecordingEgress([], grpc_target=None),
            enterprise_sink=enterprise_sink,
            collector=collector,
            max_export_attempts=3,
        )
        self._destination = destination
        self.scheduled: list[ExportJob] = []

    @override
    def destination(self, tenant_id: str, app_id: str) -> Destination | None:
        return self._destination

    @override
    def _schedule_retry(self, job: ExportJob) -> None:
        self.scheduled.append(job)


def _event() -> TraceEvent:
    return TraceEvent(
        event_id="event-1",
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="account-1",
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
        payload=MessageCompleted(message_id=MESSAGE_ID, conversation_id="conversation-1"),
    )


def _record(*, workflow_run_id: str | None = None) -> MessageTraceInfo:
    message = Message(
        id=MESSAGE_ID,
        app_id="app-1",
        conversation_id="conversation-1",
        answer="hello",
        workflow_run_id=workflow_run_id,
    )
    message.created_at = STARTED_AT
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


def _destination(outcomes: list[Exception | None]) -> Destination:
    return Destination(provider=_Provider(outcomes), config=_Config(endpoint="https://collector.example"))


def test_every_sink_receives_the_record_and_the_provider_gets_the_trace() -> None:
    destination = _destination([None])
    enterprise: list[BaseTraceInfo] = []
    collector = _Collector(captures=False, fails=False)
    service = _Service(
        assembler=_Assembler(_record()), destination=destination, enterprise_sink=enterprise.append, collector=collector
    )

    service.deliver(_event(), enterprise_delivered=False)

    assert len(enterprise) == 1
    assert len(collector.seen) == 1
    assert isinstance(destination.provider, _Provider)
    (trace,) = destination.provider.sent
    assert trace.root.name == "message"
    assert service.scheduled == []


def test_enterprise_sink_is_skipped_on_redelivery() -> None:
    enterprise: list[BaseTraceInfo] = []
    service = _Service(
        assembler=_Assembler(_record()),
        destination=_destination([None]),
        enterprise_sink=enterprise.append,
        collector=None,
    )

    service.deliver(_event(), enterprise_delivered=True)

    assert enterprise == []


def test_records_the_collector_owns_never_reach_the_provider() -> None:
    destination = _destination([])
    service = _Service(
        assembler=_Assembler(_record()),
        destination=destination,
        enterprise_sink=None,
        collector=_Collector(captures=True, fails=False),
    )

    service.deliver(_event(), enterprise_delivered=False)

    assert isinstance(destination.provider, _Provider)
    assert destination.provider.sent == []


def test_an_unavailable_collector_asks_for_redelivery() -> None:
    service = _Service(
        assembler=_Assembler(_record()),
        destination=_destination([]),
        enterprise_sink=None,
        collector=_Collector(captures=False, fails=True),
    )

    with pytest.raises(TraceCollectorUnavailableError):
        service.deliver(_event(), enterprise_delivered=False)


def test_chatflow_message_is_covered_by_its_workflow_trace() -> None:
    destination = _destination([])
    service = _Service(
        assembler=_Assembler(_record(workflow_run_id="run-1")),
        destination=destination,
        enterprise_sink=None,
        collector=None,
    )

    service.deliver(_event(), enterprise_delivered=False)

    assert isinstance(destination.provider, _Provider)
    assert destination.provider.sent == []


def test_source_not_ready_propagates_for_redelivery() -> None:
    service = _Service(
        assembler=_Assembler(SourceNotReadyError()), destination=_destination([]), enterprise_sink=None, collector=None
    )

    with pytest.raises(SourceNotReadyError):
        service.deliver(_event(), enterprise_delivered=False)


def test_retryable_failure_schedules_the_next_attempt_until_the_limit() -> None:
    service = _Service(
        assembler=_Assembler(_record()),
        destination=_destination([ExportRetryableError("busy"), ExportRetryableError("busy")]),
        enterprise_sink=None,
        collector=None,
    )

    service.deliver(_event(), enterprise_delivered=False)

    (job,) = service.scheduled
    assert (job.attempt, job.provider_id, job.app_id) == (2, "scripted", "app-1")
    exhausted = job.model_copy(update={"attempt": 3})
    destination = service.destination("tenant-1", "app-1")
    assert destination is not None
    service.export(exhausted, destination)
    assert len(service.scheduled) == 1


@pytest.mark.parametrize("failure", [ExportRejectedError("bad key"), ExportOutcomeUnknownError("timeout")])
def test_rejected_or_unknown_outcomes_are_never_retried(failure: Exception) -> None:
    service = _Service(
        assembler=_Assembler(_record()), destination=_destination([failure]), enterprise_sink=None, collector=None
    )

    service.deliver(_event(), enterprise_delivered=False)

    assert service.scheduled == []


def test_retry_is_dropped_when_the_app_now_traces_elsewhere() -> None:
    trace = CanonicalTraceBuilder().build(_record())
    assert trace is not None
    destination = _destination([])
    service = _Service(assembler=_Assembler(_record()), destination=destination, enterprise_sink=None, collector=None)

    service.retry(ExportJob(tenant_id="tenant-1", app_id="app-1", provider_id="langfuse", attempt=2, trace=trace))

    assert isinstance(destination.provider, _Provider)
    assert destination.provider.sent == []


def test_export_job_round_trips_through_storage_format() -> None:
    trace = CanonicalTraceBuilder().build(_record())
    assert trace is not None
    job = ExportJob(tenant_id="tenant-1", app_id="app-1", provider_id="scripted", attempt=2, trace=trace)

    assert ExportJob.model_validate_json(job.model_dump_json()) == job


def test_retry_delay_grows_and_is_capped() -> None:
    assert [retry_delay_seconds(attempt) for attempt in (1, 2, 3, 10)] == [10, 20, 40, 600]


def test_records_that_fail_validation_are_dropped_instead_of_failing_the_task() -> None:
    with pytest.raises(ValidationError) as invalid:
        MessageTraceInfo.model_validate({})
    destination = _destination([])
    service = _Service(
        assembler=_Assembler(invalid.value), destination=destination, enterprise_sink=None, collector=None
    )

    service.deliver(_event(), enterprise_delivered=False)

    assert isinstance(destination.provider, _Provider)
    assert destination.provider.sent == []


def test_unclassified_provider_failures_are_contained() -> None:
    service = _Service(
        assembler=_Assembler(_record()),
        destination=_destination([RuntimeError("provider bug with secret-detail")]),
        enterprise_sink=None,
        collector=None,
    )

    service.deliver(_event(), enterprise_delivered=False)

    assert service.scheduled == []
