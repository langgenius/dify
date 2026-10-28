from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import override

import pytest
from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent, TraceParent, WorkflowRunCompleted
from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import SpanRef, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from dify_trace_sdk.testing import RecordingEgress, response
from pydantic import ValidationError

from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.delivery import (
    CollectedTrace,
    ExportJob,
    ExportRetryQueue,
    OuterRunQuery,
    OuterRunRoot,
    StoredTraceDestination,
    TraceCollector,
    TraceDeliveryService,
    TraceDestinationQuery,
    TraceRecordSource,
    retry_delay_seconds,
)
from services.tracing.errors import SourceNotReadyError, TraceCollectorUnavailableError, TracingStoreUnavailableError
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import BaseTraceInfo, MessageTraceInfo, TraceMessage, WorkflowTraceInfo
from tests.helpers.unit.services.tracing_ports import InstalledTraceProviders, WorkspaceBoundCipher

STARTED_AT = datetime(2026, 1, 1, 8, 0, 0)
MESSAGE_ID = "6f1c0b52-6ad4-4c4e-9d7c-2a3f0d0c7a11"
TENANT_ID = "tenant-1"
APP_ID = "app-1"
NESTED_RUN_ID = "nested-run"
TOOL_STARTED_AT = STARTED_AT + timedelta(seconds=2)
SAME_DESTINATION = StoredTraceDestination(provider_id="langfuse", config={"endpoint": "https://collector.example"})


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


class _OuterRuns(OuterRunQuery):
    """Outer run roots by (tenant, app, run) and node starts by (tenant, app, run, node)."""

    def __init__(self) -> None:
        self.roots: dict[tuple[str, str, str], OuterRunRoot] = {}
        self.node_starts: dict[tuple[str, str, str, str], datetime] = {}
        self.unreadable = False

    @override
    def root(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> OuterRunRoot | None:
        if self.unreadable:
            raise TracingStoreUnavailableError
        return self.roots.get((tenant_id, app_id, workflow_run_id))

    @override
    def node_started_at(
        self, *, tenant_id: str, app_id: str, workflow_run_id: str, node_execution_id: str
    ) -> datetime | None:
        return self.node_starts.get((tenant_id, app_id, workflow_run_id, node_execution_id))

    def add(self, link: TraceParent, root: OuterRunRoot) -> None:
        assert link.app_id is not None
        assert link.node_execution_id is not None
        self.roots[(TENANT_ID, link.app_id, link.workflow_run_id)] = root
        self.node_starts[(TENANT_ID, link.app_id, link.workflow_run_id, link.node_execution_id)] = TOOL_STARTED_AT


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
        self.collected: dict[str, CollectedTrace] = {}

    @override
    def capture_terminal(self, *, tenant_id: str, info: BaseTraceInfo) -> bool:
        if self.fails:
            raise RuntimeError("ledger unavailable")
        self.seen.append((tenant_id, info))
        return self.captures

    @override
    def collected_trace(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> CollectedTrace | None:
        return self.collected.get(workflow_run_id)


@dataclass
class _Delivery:
    records: _Records
    egress: RecordingEgress
    destinations: _Destinations
    retries: _Retries = field(default_factory=_Retries)
    outer_runs: _OuterRuns = field(default_factory=_OuterRuns)
    enterprise: list[BaseTraceInfo] = field(default_factory=list)

    def service(self, *, enterprise: bool, collector: _Collector | None) -> TraceDeliveryService:
        return TraceDeliveryService(
            records=self.records,
            outer_runs=self.outer_runs,
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
        correlation=TraceCorrelation(external_trace_id=None, session_id=None, parent=None),
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


def _workflow_event() -> TraceEvent:
    return _event().model_copy(
        update={"payload": WorkflowRunCompleted(workflow_run_id=NESTED_RUN_ID, conversation_id=None, total_tokens=None)}
    )


def _nested_record(parent: TraceParent) -> WorkflowTraceInfo:
    return WorkflowTraceInfo(
        node_executions=[],
        conversation_id=None,
        message_started_at=None,
        workflow_app_log_id=None,
        workflow_id="workflow-1",
        tenant_id=TENANT_ID,
        workflow_run_id=NESTED_RUN_ID,
        workflow_run_elapsed_time=1,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        error=None,
        total_tokens=0,
        prompt_tokens=None,
        completion_tokens=None,
        file_list=[],
        invoked_by=None,
        query="",
        parent=parent,
        start_time=STARTED_AT + timedelta(seconds=3),
        end_time=STARTED_AT + timedelta(seconds=4),
        metadata={},
    )


def _link(run_id: str, *, external_trace_id: str | None, parent: TraceParent | None) -> TraceParent:
    return TraceParent(
        workflow_run_id=run_id,
        app_id=f"{run_id}-app",
        node_execution_id=f"{run_id}-tool-node",
        external_trace_id=external_trace_id,
        parent=parent,
    )


def _nested_delivery(parent: TraceParent) -> _Delivery:
    """A nested run whose outer runs are all persisted and trace where it does."""
    delivery = _delivery(_nested_record(parent), [response(200, {})])
    link: TraceParent | None = parent
    while link is not None:
        assert link.app_id is not None
        delivery.destinations.destinations[(TENANT_ID, link.app_id)] = SAME_DESTINATION
        delivery.outer_runs.add(link, OuterRunRoot(root_id=link.workflow_run_id, started_at=STARTED_AT))
        link = link.parent
    return delivery


def _tool_node(run_id: str) -> SpanRef:
    return SpanRef(span_id=span_id_for(f"{run_id}-tool-node"), start_time=TOOL_STARTED_AT)


def _delivery(record: BaseTraceInfo | Exception, outcomes: list[EgressResponse | Exception]) -> _Delivery:
    return _Delivery(
        records=_Records(record),
        egress=RecordingEgress(outcomes, grpc_target=None),
        destinations=_Destinations({(TENANT_ID, APP_ID): SAME_DESTINATION}),
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


def test_nested_run_hangs_from_the_tool_node_in_the_trace_of_its_outer_run() -> None:
    delivery = _nested_delivery(_link("outer-run", external_trace_id=None, parent=None))

    delivery.service(enterprise=False, collector=None).deliver(_workflow_event(), enterprise_delivered=False)

    (trace,) = delivery.sent()
    assert trace.trace_id == trace_id_for("outer-run")
    assert trace.external_trace_id is None
    assert trace.parent == _tool_node("outer-run")
    assert trace.trace_root == SpanRef(span_id=span_id_for("outer-run"), start_time=STARTED_AT)
    assert trace.root.span_id == span_id_for(NESTED_RUN_ID)
    assert trace.root.parent_span_id == span_id_for("outer-run-tool-node")


def test_outer_runs_sharing_the_destination_join_the_trace_of_the_outermost_one() -> None:
    chatflow = _link("chatflow-run", external_trace_id="caller-trace", parent=None)
    delivery = _nested_delivery(_link("outer-run", external_trace_id=None, parent=chatflow))
    message_started_at = STARTED_AT - timedelta(seconds=1)
    delivery.outer_runs.roots[(TENANT_ID, "chatflow-run-app", "chatflow-run")] = OuterRunRoot(
        root_id="chatflow-message", started_at=message_started_at
    )

    delivery.service(enterprise=False, collector=None).deliver(_workflow_event(), enterprise_delivered=False)

    (trace,) = delivery.sent()
    assert (trace.trace_id, trace.external_trace_id) == (trace_id_for("caller-trace"), "caller-trace")
    assert trace.parent == _tool_node("outer-run")
    assert trace.trace_root == SpanRef(span_id=span_id_for("chatflow-message"), start_time=message_started_at)


def test_a_nested_run_starts_its_own_trace_below_an_outer_run_tracing_elsewhere() -> None:
    delivery = _nested_delivery(_link("outer-run", external_trace_id=None, parent=None))
    delivery.destinations.destinations[(TENANT_ID, "outer-run-app")] = StoredTraceDestination(
        provider_id="langfuse", config={"endpoint": "https://elsewhere.example"}
    )

    delivery.service(enterprise=False, collector=None).deliver(_workflow_event(), enterprise_delivered=False)

    (trace,) = delivery.sent()
    assert (trace.trace_id, trace.parent, trace.trace_root) == (trace_id_for(NESTED_RUN_ID), None, None)


def test_a_collected_outer_run_lends_its_agent_trace_once_collection_starts() -> None:
    collector = _Collector(captures=False, fails=False)
    agent_trace = CollectedTrace(trace_id=trace_id_for("agent-trace"), destination=SAME_DESTINATION)
    collector.collected["outer-run"] = agent_trace
    delivery = _nested_delivery(_link("outer-run", external_trace_id="caller-trace", parent=None))

    delivery.service(enterprise=False, collector=collector).deliver(_workflow_event(), enterprise_delivered=False)

    (trace,) = delivery.sent()
    assert (trace.trace_id, trace.external_trace_id) == (trace_id_for("agent-trace"), None)
    assert trace.parent == _tool_node("outer-run")


def test_a_collected_outer_run_lends_no_trace_before_collection_starts() -> None:
    collector = _Collector(captures=False, fails=False)
    collector.collected["outer-run"] = CollectedTrace(trace_id=None, destination=None)
    delivery = _nested_delivery(_link("outer-run", external_trace_id=None, parent=None))

    delivery.service(enterprise=False, collector=collector).deliver(_workflow_event(), enterprise_delivered=False)

    (trace,) = delivery.sent()
    assert (trace.trace_id, trace.parent) == (trace_id_for(NESTED_RUN_ID), None)


def test_a_nested_run_starts_its_own_trace_while_its_outer_records_are_unavailable() -> None:
    unpersisted = _nested_delivery(_link("outer-run", external_trace_id=None, parent=None))
    unpersisted.outer_runs.node_starts.clear()
    unreadable = _nested_delivery(_link("outer-run", external_trace_id=None, parent=None))
    unreadable.outer_runs.unreadable = True

    for delivery in (unpersisted, unreadable):
        delivery.service(enterprise=False, collector=None).deliver(_workflow_event(), enterprise_delivered=False)

        (trace,) = delivery.sent()
        assert (trace.trace_id, trace.parent) == (trace_id_for(NESTED_RUN_ID), None)
