import hashlib
import logging
import random
import socket
import threading
import uuid
from collections import deque
from collections.abc import Sequence
from datetime import datetime
from typing import Final, cast
from urllib.parse import urljoin

import httpx
from opentelemetry import trace as trace_api
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import Link, SpanContext, TraceFlags

from configs import dify_config
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData

INVALID_SPAN_ID: Final[int] = 0x0000000000000000
INVALID_TRACE_ID: Final[int] = 0x00000000000000000000000000000000
DEFAULT_TIMEOUT: Final[int] = 5
DEFAULT_MAX_QUEUE_SIZE: Final[int] = 1000
DEFAULT_SCHEDULE_DELAY_SEC: Final[int] = 5
DEFAULT_MAX_EXPORT_BATCH_SIZE: Final[int] = 50

logger = logging.getLogger(__name__)


class TraceClient:
    def __init__(
        self,
        service_name: str,
        endpoint: str,
        max_queue_size: int = DEFAULT_MAX_QUEUE_SIZE,
        schedule_delay_sec: int = DEFAULT_SCHEDULE_DELAY_SEC,
        max_export_batch_size: int = DEFAULT_MAX_EXPORT_BATCH_SIZE,
    ):
        self.endpoint = endpoint
        self.resource = Resource(
            attributes={
                ResourceAttributes.SERVICE_NAME: service_name,
                ResourceAttributes.SERVICE_VERSION: f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
                ResourceAttributes.DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
                ResourceAttributes.HOST_NAME: socket.gethostname(),
            }
        )
        self.span_builder = SpanBuilder(self.resource)
        self.exporter = OTLPSpanExporter(endpoint=endpoint)

        self.max_queue_size = max_queue_size
        self.schedule_delay_sec = schedule_delay_sec
        self.max_export_batch_size = max_export_batch_size

        self.queue: deque = deque(maxlen=max_queue_size)
        self.condition = threading.Condition(threading.Lock())
        self.done = False

        self.worker_thread = threading.Thread(target=self._worker, daemon=True)
        self.worker_thread.start()

        self._spans_dropped = False

    def export(self, spans: Sequence[ReadableSpan]):
        self.exporter.export(spans)

    def api_check(self) -> bool:
        try:
            response = httpx.head(self.endpoint, timeout=DEFAULT_TIMEOUT)
            if response.status_code == 405:
                return True
            else:
                logger.debug("AliyunTrace API check failed: Unexpected status code: %s", response.status_code)
                return False
        except httpx.RequestError as e:
            logger.debug("AliyunTrace API check failed: %s", str(e))
            raise ValueError(f"AliyunTrace API check failed: {str(e)}")

    def get_project_url(self) -> str:
        return "https://arms.console.aliyun.com/#/llm"

    def add_span(self, span_data: SpanData | None) -> None:
        if span_data is None:
            return

        span: ReadableSpan = self.span_builder.build_span(span_data)
        with self.condition:
            if len(self.queue) == self.max_queue_size:
                if not self._spans_dropped:
                    logger.warning("Queue is full, likely spans will be dropped.")
                    self._spans_dropped = True

            self.queue.appendleft(span)
            if len(self.queue) >= self.max_export_batch_size:
                self.condition.notify()

    def _worker(self) -> None:
        while not self.done:
            with self.condition:
                if len(self.queue) < self.max_export_batch_size and not self.done:
                    self.condition.wait(timeout=self.schedule_delay_sec)
            self._export_batch()

    def _export_batch(self) -> None:
        spans_to_export: list[ReadableSpan] = []
        with self.condition:
            while len(spans_to_export) < self.max_export_batch_size and self.queue:
                spans_to_export.append(self.queue.pop())

        if spans_to_export:
            try:
                self.exporter.export(spans_to_export)
            except Exception as e:
                logger.debug("Error exporting spans: %s", e)

    def shutdown(self) -> None:
        with self.condition:
            self.done = True
            self.condition.notify_all()
        self.worker_thread.join()
        self._export_batch()
        self.exporter.shutdown()


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
            kind=trace_api.SpanKind.INTERNAL,
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
        return cast(int, uuid_obj.int)
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
    if "log.aliyuncs.com" in base_url:  # cms2.0 endpoint
        return urljoin(base_url, f"adapt_{license_key}/api/v1/traces")
    else:  # xtrace endpoint
        return urljoin(base_url, f"adapt_{license_key}/api/otlp/traces")
