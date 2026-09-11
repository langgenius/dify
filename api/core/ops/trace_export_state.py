"""Delivery-owned export progress and durable cumulative OTLP measurements."""

from __future__ import annotations

import json
from hashlib import sha256
from typing import TYPE_CHECKING

from opentelemetry.proto.common.v1.common_pb2 import AnyValue, InstrumentationScope, KeyValue
from opentelemetry.proto.metrics.v1.metrics_pb2 import AggregationTemporality, Metric, ResourceMetrics, ScopeMetrics
from opentelemetry.proto.resource.v1.resource_pb2 import Resource

from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace, TraceProviderSettings

if TYPE_CHECKING:
    from models.ops_trace import OpsTraceDelivery
    from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository


def metric_destination_key(settings: TraceProviderSettings) -> str:
    return sha256(json.dumps(settings.model_dump(), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _metric_kind(metric: Metric) -> str:
    kind = metric.WhichOneof("data")
    if kind not in {"sum", "histogram"} or (kind == "sum" and not metric.sum.is_monotonic):
        raise TraceExportError("unsupported_metric_type")
    return kind


def _add_metric_values(total: Metric, increment: Metric) -> None:
    kind = _metric_kind(total)
    if _metric_kind(increment) != kind:
        raise TraceExportError("metric_type_changed")
    if kind == "sum":
        previous_sum, incoming_sum = total.sum.data_points[0], increment.sum.data_points[0]
        if previous_sum.HasField("as_int") and incoming_sum.HasField("as_int"):
            previous_sum.as_int += incoming_sum.as_int
        else:
            previous_sum.as_double = (
                previous_sum.as_int if previous_sum.HasField("as_int") else previous_sum.as_double
            ) + (incoming_sum.as_int if incoming_sum.HasField("as_int") else incoming_sum.as_double)
        return
    previous, incoming = total.histogram.data_points[0], increment.histogram.data_points[0]
    if previous.explicit_bounds != incoming.explicit_bounds or len(previous.bucket_counts) != len(
        incoming.bucket_counts
    ):
        raise TraceExportError("metric_histogram_bounds_changed")
    previous.count += incoming.count
    previous.bucket_counts[:] = [
        left + right for left, right in zip(previous.bucket_counts, incoming.bucket_counts, strict=True)
    ]
    if previous.HasField("sum") and incoming.HasField("sum"):
        previous.sum += incoming.sum
    else:
        previous.ClearField("sum")
    if previous.HasField("min") and incoming.HasField("min"):
        previous.min = min(previous.min, incoming.min)
    else:
        previous.ClearField("min")
    if previous.HasField("max") and incoming.HasField("max"):
        previous.max = max(previous.max, incoming.max)
    else:
        previous.ClearField("max")


def accumulate_metric(previous: bytes | None, increment: bytes, observed_at_ns: int) -> bytes:
    """Merge one delivery exactly once; execution duration is unrelated to the collection interval."""
    delta = Metric.FromString(increment)
    total = Metric.FromString(previous) if previous is not None else delta
    if previous is not None:
        _add_metric_values(total, delta)
    data = total.sum if _metric_kind(total) == "sum" else total.histogram
    point = data.data_points[0]
    # The first point has a known, non-zero start strictly before its observation.
    # Equal timestamps denote an unknown-start reset and can discard the initial value.
    point.time_unix_nano = max(observed_at_ns, point.time_unix_nano + 1, 2)
    if previous is None:
        point.start_time_unix_nano = point.time_unix_nano - 1
    data.aggregation_temporality = AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE
    return total.SerializeToString(deterministic=True)


def serialize_metric_snapshot(resource: bytes, scope_name: str, metrics: list[bytes]) -> bytes:
    """Group attribute series into one OTLP Metric for each instrument identity."""
    instruments: dict[tuple[str, str, str, bool], Metric] = {}
    for serialized in metrics:
        metric = Metric.FromString(serialized)
        kind = _metric_kind(metric)
        key = (metric.name, metric.unit, kind, metric.sum.is_monotonic if kind == "sum" else False)
        if key not in instruments:
            instruments[key] = metric
        elif kind == "sum":
            instruments[key].sum.data_points.extend(metric.sum.data_points)
        else:
            instruments[key].histogram.data_points.extend(metric.histogram.data_points)
    return ResourceMetrics(
        resource=Resource.FromString(resource),
        scope_metrics=[ScopeMetrics(scope=InstrumentationScope(name=scope_name), metrics=list(instruments.values()))],
    ).SerializeToString(deterministic=True)


class TraceExportState:
    def __init__(self, repository: OpsTraceDeliveryRepository, delivery: OpsTraceDelivery):
        self.repository = repository
        self.delivery = delivery

    def validate_owner(self, trace: CompletedTrace, settings: TraceProviderSettings) -> None:
        source = trace.source
        if (
            self.repository.provider_settings(self.delivery) != settings
            or source.tenant_id != self.delivery.tenant_id
            or source.app_id != self.delivery.app_id
            or source.pipeline_id != self.delivery.pipeline_id
            or source.operation_id != self.delivery.operation_id
            or source.message_id != self.delivery.message_id
            or source.conversation_id != self.delivery.conversation_id
            or source.workflow_run_id != self.delivery.workflow_run_id
            or trace.trace_id != self.delivery.trace_id
            or trace.root_span_id != self.delivery.root_span_id
        ):
            raise TraceExportError("trace_export_state_owner_mismatch")

    def has_completed_signal(self, name: str) -> bool:
        return name in self.repository.completed_export_signals(self.delivery)

    def complete_signal(self, name: str) -> None:
        self.repository.complete_export_signal(self.delivery, name)

    def prepare_metrics(self, metrics: list[Metric], resource: Resource, scope_name: str) -> list[Metric]:
        """Prepare one immutable snapshot and restore its resource on another worker's retry.

        ``resource`` is an operation-owned metrics copy; trace resources are never changed.
        The writer identity distinguishes otherwise identical streams belonging to different
        tenants, destination revisions, or worker resources.
        """
        destination_key = metric_destination_key(self.repository.provider_settings(self.delivery))
        ordered_resource = Resource(attributes=sorted(resource.attributes, key=lambda attribute: attribute.key))
        resource_key = sha256(ordered_resource.SerializeToString(deterministic=True)).hexdigest()
        writer_id = sha256(f"{destination_key}:{resource_key}".encode()).hexdigest()
        resource.CopyFrom(ordered_resource)
        attributes = [attribute for attribute in resource.attributes if attribute.key != "service.instance.id"]
        attributes.append(KeyValue(key="service.instance.id", value=AnyValue(string_value=f"dify-ops-{writer_id}")))
        del resource.attributes[:]
        resource.attributes.extend(sorted(attributes, key=lambda attribute: attribute.key))
        increments: dict[str, Metric] = {}
        for metric in metrics:
            kind = _metric_kind(metric)
            data = metric.sum if kind == "sum" else metric.histogram
            if data.aggregation_temporality != AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA:
                raise TraceExportError("metric_measurements_must_be_delta")
            for point_index in range(len(data.data_points)):
                observation = Metric()
                observation.CopyFrom(metric)
                values = observation.sum if kind == "sum" else observation.histogram
                del values.data_points[point_index + 1 :]
                del values.data_points[:point_index]
                copied = values.data_points[0]
                copied.start_time_unix_nano = copied.time_unix_nano = 0
                ordered_attributes = sorted(copied.attributes, key=lambda attribute: attribute.key)
                del copied.attributes[:]
                copied.attributes.extend(ordered_attributes)
                identity = [
                    resource_key,
                    scope_name,
                    metric.name,
                    metric.unit,
                    kind,
                    metric.sum.is_monotonic if kind == "sum" else None,
                    [attribute.SerializeToString(deterministic=True).hex() for attribute in copied.attributes],
                ]
                series_key = sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
                if series_key in increments:
                    _add_metric_values(increments[series_key], observation)
                else:
                    increments[series_key] = observation
        snapshot = self.repository.prepare_metric_snapshot(
            self.delivery,
            resource=resource.SerializeToString(deterministic=True),
            scope_name=scope_name,
            increments={key: value.SerializeToString(deterministic=True) for key, value in increments.items()},
        )
        restored = ResourceMetrics.FromString(snapshot)
        resource.CopyFrom(restored.resource)
        return list(restored.scope_metrics[0].metrics)
