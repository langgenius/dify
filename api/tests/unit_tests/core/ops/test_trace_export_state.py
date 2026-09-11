"""Durable metric aggregation, retry snapshots, and tenant-owned export progress."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.metrics.v1.metrics_pb2 import AggregationTemporality
from opentelemetry.proto.resource.v1.resource_pb2 import Resource

from core.ops.otlp_trace import OtlpTraceClient, counter, histogram
from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace, QueuedTrace, TraceProviderSettings, TraceSpan
from core.ops.trace_export_state import TraceExportState
from models.ops_trace import OpsTraceDelivery, OpsTraceMetricSeries
from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository
from tests.unit_tests.core.ops.test_trace_delivery import make_queued_trace, make_repository


def make_export_state(
    trace: CompletedTrace, settings: TraceProviderSettings, repository: OpsTraceDeliveryRepository | None = None
) -> TraceExportState:
    repository = repository or make_repository()
    delivery, _ = repository.reserve_delivery(QueuedTrace.from_trace(trace, settings))
    assert repository.accept_upload(delivery)
    attempt = repository.claim_delivery(delivery.tenant_id, delivery.id)
    assert attempt is not None
    return TraceExportState(repository, attempt)


def make_state(repository: OpsTraceDeliveryRepository | None = None) -> TraceExportState:
    queued = make_queued_trace()
    return make_export_state(
        CompletedTrace.model_validate_json(queued.trace_json), queued.provider_settings, repository
    )


def next_state(state: TraceExportState) -> TraceExportState:
    queued = make_queued_trace(state.delivery.tenant_id)
    trace = CompletedTrace.model_validate_json(queued.trace_json)
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"app_id": state.delivery.app_id})})
    return make_export_state(trace, state.repository.provider_settings(state.delivery), state.repository)


def test_cumulative_snapshots_batch_points_preserve_statistics_and_retry_resource() -> None:
    first = make_state()
    span = TraceSpan(span_id="measurement", span_name="measurement")
    resource = Resource(attributes=[KeyValue(key="host.name", value=AnyValue(string_value="first-worker"))])
    first.complete_signal("business_logs")
    increments = [
        counter("requests", 2**53 + 1, span, {"model": "one"}),
        counter("requests", 2, span, {"model": "one"}),
        counter("requests", 3, span, {"model": "two"}),
        histogram("duration", 5, span, {}, explicit_bounds=[5, 10]),
        histogram("duration", 10001, span, {}, explicit_bounds=[5, 10]),
    ]
    snapshot = first.prepare_metrics(increments, resource, "synthetic")
    assert first.has_completed_signal("business_logs")
    totals = next(metric for metric in snapshot if metric.name == "requests")
    assert sorted(point.as_int for point in totals.sum.data_points) == [3, 2**53 + 3]
    assert totals.sum.aggregation_temporality == AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE
    duration = next(metric for metric in snapshot if metric.name == "duration").histogram.data_points[0]
    assert (duration.count, duration.sum, duration.min, duration.max) == (2, 10006, 5, 10001)
    assert list(duration.bucket_counts) == [1, 0, 1]
    assert 0 < duration.start_time_unix_nano < duration.time_unix_nano
    saved_resource = resource.SerializeToString()
    second = next_state(first)
    later_resource = Resource(attributes=[KeyValue(key="host.name", value=AnyValue(string_value="first-worker"))])
    later = second.prepare_metrics(
        [histogram("duration", 0, span, {}, explicit_bounds=[5, 10])], later_resource, "synthetic"
    )
    point = later[0].histogram.data_points[0]
    assert (point.count, point.sum, point.min, point.max) == (3, 10006, 0, 10001)
    assert point.start_time_unix_nano == duration.start_time_unix_nano
    assert point.time_unix_nano > duration.time_unix_nano
    retry_resource = Resource(attributes=[KeyValue(key="host.name", value=AnyValue(string_value="retry-worker"))])
    retry = TraceExportState(first.repository, first.delivery).prepare_metrics(increments, retry_resource, "synthetic")
    assert retry == snapshot
    assert retry_resource.SerializeToString() == saved_resource
    first.complete_signal("metrics")
    assert first.has_completed_signal("business_logs")
    assert first.has_completed_signal("metrics")


def test_parallel_deliveries_accumulate_without_lost_updates(tmp_path: Path) -> None:
    repository = make_repository(sa.create_engine(f"sqlite:///{tmp_path}/metrics.db"))
    first = make_state(repository)
    second = next_state(first)
    span = TraceSpan(span_id="measurement", span_name="measurement")

    def prepare(state: TraceExportState) -> int:
        result = state.prepare_metrics([counter("requests", 1, span, {})], Resource(), "synthetic")
        return result[0].sum.data_points[0].as_int

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(prepare, [first, second])) == [1, 2]
    assert prepare(next_state(first)) == 3


@pytest.mark.parametrize("change", ["tenant", "destination", "resource", "scope", "labels"])
def test_metric_series_and_emitted_writer_are_isolated(change: str) -> None:
    first = make_state()
    second = make_state(first.repository) if change == "tenant" else next_state(first)
    if change == "destination":
        with first.repository.session_factory() as session:
            row = session.get(OpsTraceDelivery, second.delivery.id)
            assert row is not None
            row.destination_settings_hash = "changed"
            session.commit()
        second.delivery.destination_settings_hash = "changed"
    span = TraceSpan(span_id="measurement", span_name="measurement")
    resource = Resource()
    first.prepare_metrics([counter("requests", 1, span, {})], resource, "synthetic")
    changed_resource = (
        Resource(attributes=[KeyValue(key="host.name", value=AnyValue(string_value="other"))])
        if change == "resource"
        else Resource()
    )
    result = second.prepare_metrics(
        [counter("requests", 1, span, {"model": "other"} if change == "labels" else {})],
        changed_resource,
        "other" if change == "scope" else "synthetic",
    )
    assert result[0].sum.data_points[0].as_int == 1
    if change in {"tenant", "destination", "resource"}:
        assert resource.attributes[-1].value.string_value != changed_resource.attributes[-1].value.string_value


@pytest.mark.parametrize("lost_lease", [False, True])
def test_stale_attempt_cannot_change_metrics_or_signal_progress(lost_lease: bool) -> None:
    state = make_state()
    with state.repository.session_factory() as session:
        if lost_lease:
            session.execute(sa.update(OpsTraceDelivery).values(lease_expires_at=datetime(2000, 1, 1)))
        else:
            session.execute(sa.update(OpsTraceDelivery).values(attempt_token=str(uuid4())))
        session.commit()
    span = TraceSpan(span_id="measurement", span_name="measurement")
    with pytest.raises(TraceExportError, match="trace_attempt_expired") as failure:
        state.prepare_metrics([counter("requests", 1, span, {})], Resource(), "synthetic")
    assert failure.value.retryable
    with pytest.raises(TraceExportError, match="trace_attempt_expired") as failure:
        state.complete_signal("business_logs")
    assert failure.value.retryable
    with state.repository.session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(OpsTraceMetricSeries)) == 0


def test_reclaimed_attempt_restores_saved_snapshot_without_counting_again() -> None:
    first = make_state()
    span = TraceSpan(span_id="measurement", span_name="measurement")
    increments = [counter("requests", 1, span, {})]
    snapshot = first.prepare_metrics(increments, Resource(), "synthetic")
    first.complete_signal("business_logs")
    with first.repository.session_factory() as session:
        session.execute(sa.update(OpsTraceDelivery).values(lease_expires_at=datetime(2000, 1, 1)))
        session.commit()
    with pytest.raises(TraceExportError, match="trace_attempt_expired") as failure:
        first.has_completed_signal("business_logs")
    assert failure.value.retryable
    assert first.repository.finish_attempt(first.delivery, status="pending", retry_delay_seconds=0)
    attempt = first.repository.claim_delivery(first.delivery.tenant_id, first.delivery.id)
    assert attempt is not None
    assert attempt.attempt_token != first.delivery.attempt_token
    retry = TraceExportState(first.repository, attempt)
    assert retry.has_completed_signal("business_logs")
    assert retry.prepare_metrics(increments, Resource(), "synthetic") == snapshot
    second = next_state(retry)
    assert second.prepare_metrics(increments, Resource(), "synthetic")[0].sum.data_points[0].as_int == 2


def test_incompatible_histogram_does_not_commit_any_measurement() -> None:
    first = make_state()
    span = TraceSpan(span_id="measurement", span_name="measurement")
    increments = [counter("requests", 1, span, {}), histogram("duration", 1, span, {}, explicit_bounds=[1, 2])]
    first.prepare_metrics(increments, Resource(), "synthetic")
    second = next_state(first)
    with pytest.raises(TraceExportError, match="metric_histogram_bounds_changed"):
        second.prepare_metrics(
            [counter("requests", 1, span, {}), histogram("duration", 1, span, {}, explicit_bounds=[2, 3])],
            Resource(),
            "synthetic",
        )
    totals = next_state(first).prepare_metrics(increments, Resource(), "synthetic")
    assert next(metric for metric in totals if metric.name == "requests").sum.data_points[0].as_int == 2
    assert next(metric for metric in totals if metric.name == "duration").histogram.data_points[0].count == 2


def test_idle_series_cleanup_is_bounded_and_preserves_active_series() -> None:
    state = make_state()
    span = TraceSpan(span_id="measurement", span_name="measurement")
    state.prepare_metrics([counter("requests", 1, span, {"series": str(i)}) for i in range(3)], Resource(), "synthetic")
    with state.repository.session_factory() as session:
        rows = list(session.scalars(sa.select(OpsTraceMetricSeries)))
        for row in rows[:2]:
            row.updated_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=31)
        session.commit()
    state.repository.delete_idle_metric_series(limit=1)
    with state.repository.session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(OpsTraceMetricSeries)) == 2
    state.repository.delete_idle_metric_series()
    with state.repository.session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(OpsTraceMetricSeries)) == 1


def test_nonempty_metric_exports_require_durable_state() -> None:
    client = OtlpTraceClient("https://synthetic.example/v1/traces", {}, {}, "")
    client.send_metrics([])
    with pytest.raises(TraceExportError, match="metric_state_required"):
        client.send_metrics([counter("requests", 1, TraceSpan(span_id="one", span_name="one"), {})])
