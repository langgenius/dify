import datetime
import socket
import uuid
from collections.abc import Sequence
from typing import Optional

from opentelemetry import trace as trace_api
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.semconv.resource import ResourceAttributes

from configs import dify_config
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData
from core.rag.models.document import Document


class TraceClient:
    def __init__(self, service_name, endpoint):
        self.endpoint = endpoint
        self.resource = Resource(
            attributes={
                ResourceAttributes.SERVICE_NAME: service_name,
                ResourceAttributes.SERVICE_VERSION: f"dify-{dify_config.CURRENT_VERSION}-{dify_config.COMMIT_SHA}",
                ResourceAttributes.DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
                ResourceAttributes.HOST_NAME: socket.gethostname(),
            }
        )
        self.span_builder = SpanBuilder(self.resource)
        self.exporter = OTLPSpanExporter(endpoint=endpoint)

    def add_span(self, span_data: SpanData):
        span: ReadableSpan = self.span_builder.build_span(span_data)
        self.export([span])

    def export(self, spans: Sequence[ReadableSpan]):
        self.exporter.export(spans)


class SpanBuilder:
    def __init__(self, resource):
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


def convert_to_trace_id(uuid_v4: str) -> int:
    try:
        uuid_obj = uuid.UUID(uuid_v4)
        return uuid_obj.int
    except Exception as e:
        raise ValueError(f"Invalid UUID input: {e}")


def convert_to_span_id(uuid_v4: str, span_type: str) -> int:
    try:
        uuid_obj = uuid.UUID(uuid_v4)
    except Exception as e:
        raise ValueError(f"Invalid UUID input: {e}")

    type_hash = hash(span_type) & 0xFFFFFFFFFFFFFFFF
    span_id = (uuid_obj.int & 0xFFFFFFFFFFFFFFFF) ^ type_hash
    return span_id


def convert_datetime_to_nanoseconds(start_time_a: Optional[datetime]) -> Optional[int]:
    if start_time_a is None:
        return None
    timestamp_in_seconds = start_time_a.timestamp()
    timestamp_in_nanoseconds = int(timestamp_in_seconds * 1e9)
    return timestamp_in_nanoseconds


def extract_retrieval_documents(documents: list[Document]):
    documents_data = []
    for document in documents:
        document_data = {
            "content": document.page_content,
            "metadata": {
                "dataset_id": document.metadata.get('dataset_id'),
                "doc_id": document.metadata.get('doc_id'),
                "document_id": document.metadata.get('document_id'),
            },
            "score": document.metadata.get('score'),
        }
        documents_data.append(document_data)
    return documents_data
