import hashlib
import random
import socket
import uuid
from collections.abc import Generator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Final

from opentelemetry import trace as trace_api
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.semconv._incubating.attributes.deployment_attributes import (  # type: ignore[import-untyped]
    DEPLOYMENT_ENVIRONMENT,
)
from opentelemetry.semconv._incubating.attributes.host_attributes import (  # type: ignore[import-untyped]
    HOST_NAME,
)
from opentelemetry.semconv.attributes import service_attributes
from opentelemetry.trace import Link, SpanContext, TraceFlags

from configs import dify_config
from dify_trace_aliyun.configuration import ingestion_url
from dify_trace_aliyun.entities.aliyun_trace_entity import SpanData
from dify_trace_aliyun.entities.semconv import ACS_ARMS_SERVICE_FEATURE
from services.tracing.otlp_export import export_http

INVALID_SPAN_ID: Final[int] = 0x0000000000000000
INVALID_TRACE_ID: Final[int] = 0x00000000000000000000000000000000


class TraceClient:
    """Collect one dispatch locally and synchronously acknowledge its exact batch.

    Instances are cached, so pending spans belong to the current context rather
    than the client. A mapper failure discards only that dispatch; an uncertain
    response propagates to the durable task instead of silently retrying a batch.
    No SDK exporter, process-global configuration or background queue is created.
    """

    def __init__(self, service_name: str, endpoint: str) -> None:
        self.endpoint = endpoint
        self.resource = Resource(
            attributes={
                service_attributes.SERVICE_NAME: service_name,
                service_attributes.SERVICE_VERSION: f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
                DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.DEPLOYMENT_EDITION.value}",
                HOST_NAME: socket.gethostname(),
                ACS_ARMS_SERVICE_FEATURE: "genai_app",
            }
        )
        self.span_builder = SpanBuilder(self.resource)
        self._dispatch_spans: ContextVar[list[ReadableSpan] | None] = ContextVar("aliyun_dispatch_spans", default=None)

    @contextmanager
    def batch(self) -> Generator[None]:
        """Export only after the whole mapper succeeds, and always restore context."""
        spans: list[ReadableSpan] = []
        token = self._dispatch_spans.set(spans)
        try:
            yield
            if spans:
                self.export(spans)
        finally:
            self._dispatch_spans.reset(token)

    def export(self, spans: Sequence[ReadableSpan]) -> None:
        if spans:
            export_http("aliyun", self.endpoint, {}, encode_spans(spans))

    def add_span(self, span_data: SpanData | None) -> None:
        if span_data is None:
            return
        spans = self._dispatch_spans.get()
        if spans is None:
            raise RuntimeError("Aliyun spans require an active trace dispatch")
        spans.append(self.span_builder.build_span(span_data))


class SpanBuilder:
    def __init__(self, resource: Resource) -> None:
        self.resource = resource
        self.instrumentation_scope = InstrumentationScope(
            __name__,
            "",
            None,
            None,
        )

    def build_span(self, span_data: SpanData) -> ReadableSpan:
        span_context = trace_api.SpanContext(
            trace_id=span_data.trace_id,
            span_id=span_data.span_id,
            is_remote=False,
            trace_flags=trace_api.TraceFlags(trace_api.TraceFlags.SAMPLED),
            trace_state=None,
        )

        parent_span_context = None
        if span_data.parent_span_id is not None:
            parent_span_context = trace_api.SpanContext(
                trace_id=span_data.trace_id,
                span_id=span_data.parent_span_id,
                is_remote=False,
                trace_flags=trace_api.TraceFlags(trace_api.TraceFlags.SAMPLED),
                trace_state=None,
            )

        span = ReadableSpan(
            name=span_data.name,
            context=span_context,
            parent=parent_span_context,
            resource=self.resource,
            attributes=span_data.attributes,
            events=span_data.events,
            links=span_data.links,
            kind=span_data.span_kind,
            status=span_data.status,
            start_time=span_data.start_time,
            end_time=span_data.end_time,
            instrumentation_scope=self.instrumentation_scope,
        )
        return span


def create_link(trace_id_str: str) -> Link:
    placeholder_span_id = INVALID_SPAN_ID
    try:
        trace_id = int(trace_id_str, 16)
    except ValueError as e:
        raise ValueError(f"Invalid trace ID format: {trace_id_str}") from e

    span_context = SpanContext(
        trace_id=trace_id, span_id=placeholder_span_id, is_remote=False, trace_flags=TraceFlags(TraceFlags.SAMPLED)
    )

    return Link(span_context)


def generate_span_id() -> int:
    span_id = random.getrandbits(64)
    while span_id == INVALID_SPAN_ID:
        span_id = random.getrandbits(64)
    return span_id


def convert_to_trace_id(uuid_v4: str | None) -> int:
    if uuid_v4 is None:
        raise ValueError("UUID cannot be None")
    try:
        uuid_obj = uuid.UUID(uuid_v4)
        return uuid_obj.int
    except ValueError as e:
        raise ValueError(f"Invalid UUID input: {uuid_v4}") from e


def convert_string_to_id(string: str | None) -> int:
    if not string:
        return generate_span_id()
    hash_bytes = hashlib.sha256(string.encode("utf-8")).digest()
    return int.from_bytes(hash_bytes[:8], byteorder="big", signed=False)


def convert_to_span_id(uuid_v4: str | None, span_type: str) -> int:
    if uuid_v4 is None:
        raise ValueError("UUID cannot be None")
    try:
        uuid_obj = uuid.UUID(uuid_v4)
    except ValueError as e:
        raise ValueError(f"Invalid UUID input: {uuid_v4}") from e
    combined_key = f"{uuid_obj.hex}-{span_type}"
    return convert_string_to_id(combined_key)


def convert_datetime_to_nanoseconds(start_time_a: datetime | None) -> int | None:
    if start_time_a is None:
        return None
    timestamp_in_seconds = start_time_a.timestamp()
    return int(timestamp_in_seconds * 1e9)


def build_endpoint(base_url: str, license_key: str) -> str:
    """Compatibility wrapper around the shared, credential-safe URL builder."""
    return ingestion_url({"endpoint": base_url, "license_key": license_key})
