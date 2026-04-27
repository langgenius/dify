from opentelemetry.metrics import Histogram, get_meter

from configs import dify_config

_event_delivery_latency_histogram: Histogram | None = None

METRIC_EVENT_DELIVERY_LATENCY = "dify.event_stream.delivery_latency"


def _get_delivery_latency_histogram() -> Histogram:
    global _event_delivery_latency_histogram
    if _event_delivery_latency_histogram is None:
        meter = get_meter("dify.event_stream", version=dify_config.project.version)
        _event_delivery_latency_histogram = meter.create_histogram(
            name=METRIC_EVENT_DELIVERY_LATENCY,
            description="End-to-end delivery latency of streaming events from publish to receive",
            unit="s",
        )
    return _event_delivery_latency_histogram


def record_delivery_latency(
    latency_seconds: float,
    *,
    topic: str = "",
    event_type: str = "",
    additional_attributes: dict[str, str] = {},
) -> None:
    histogram = _get_delivery_latency_histogram()
    attrs: dict[str, str] = {}
    if topic:
        attrs["topic"] = topic
    if event_type:
        attrs["event_type"] = event_type
    attrs.update(additional_attributes)
    histogram.record(latency_seconds, attrs)
