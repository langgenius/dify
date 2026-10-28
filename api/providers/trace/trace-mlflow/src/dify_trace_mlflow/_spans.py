"""Dify spans as MLflow span entities, serialized by the MLflow SDK itself.

Building immutable ``mlflow.entities.Span`` objects reuses MLflow's attribute
encoding and its OTLP and trace-artifact serialization without a tracer, trace
manager, or exporter, so no MLflow or OpenTelemetry pipeline state is involved.
"""

import json

from dify_trace_sdk.exporting import json_value, nanos
from dify_trace_sdk.ids import trace_id_for
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from mlflow.entities import Span as MlflowSpan
from mlflow.entities import TraceData
from mlflow.tracing.constant import CostKey, GenAiSemconvKey, SpanAttributeKey, TokenUsageKey
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.trace import SpanContext, Status, StatusCode

PARENT_TRACE_ID_ATTRIBUTE = "dify.parent_trace_id"
PARENT_SPAN_ID_ATTRIBUTE = "dify.parent_span_id"
EXTERNAL_TRACE_ID_ATTRIBUTE = "dify.external_trace_id"


def standalone(trace: Trace) -> Trace:
    """Deliver a fragment as a trace of its own.

    MLflow cannot safely append spans to a trace it already stored, so a
    fragment gets a deterministic trace ID and its root records where it belongs.
    A caller's trace ID may group several runs, and MLflow keeps one root per
    trace, so such a run gets its own trace ID and keeps the caller's as an attribute.
    """
    root = trace.root
    if trace.parent is None:
        if trace.external_trace_id is None:
            return trace
        tagged = root.model_copy(
            update={"attributes": {**root.attributes, EXTERNAL_TRACE_ID_ATTRIBUTE: trace.external_trace_id}}
        )
        return trace.model_copy(
            update={"trace_id": trace_id_for(f"{trace.trace_id}:{root.span_id}"), "spans": (tagged, *trace.spans[1:])}
        )
    detached = root.model_copy(
        update={
            "parent_span_id": None,
            "attributes": {
                **root.attributes,
                PARENT_TRACE_ID_ATTRIBUTE: trace.trace_id,
                PARENT_SPAN_ID_ATTRIBUTE: trace.parent.span_id,
            },
        }
    )
    return trace.model_copy(
        update={
            "trace_id": trace_id_for(f"{trace.trace_id}:{root.span_id}"),
            "parent": None,
            "trace_root": None,
            "spans": (detached, *trace.spans[1:]),
        }
    )


def token_usage(span: Span) -> dict[str, int] | None:
    """Usage of a model call. MLflow sums span usage into the trace total, so wrappers report none."""
    if span.kind is not SpanKind.LLM or span.usage is None:
        return None
    return {
        TokenUsageKey.INPUT_TOKENS: span.usage.prompt_tokens,
        TokenUsageKey.OUTPUT_TOKENS: span.usage.completion_tokens,
        TokenUsageKey.TOTAL_TOKENS: span.usage.total_tokens,
    }


def usd_cost(span: Span) -> float | None:
    """MLflow costs are USD totals of model calls."""
    if span.kind is not SpanKind.LLM or span.cost is None or span.cost.currency.upper() != "USD":
        return None
    return span.cost.amount


def _chat_tools(value: object) -> list[dict[str, object]] | None:
    """Map OpenTelemetry's flat function definitions to MLflow's chat tool schema.

    The source attribute is kept as is. Setting the native attribute stops
    MLflow's OTLP translator from copying the incompatible flat shape. Entries
    that are not named functions are left out instead of becoming fake tools,
    and JSON Schemas are kept whole although MLflow's ChatTool model accepts
    only a subset of them.
    """
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    if not isinstance(value, list):
        return None
    tools: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict) or item.get("type") != "function":
            continue
        function = item.get("function")
        if not isinstance(function, dict):
            function = {key: item[key] for key in ("name", "description", "parameters", "strict") if key in item}
        name = function.get("name")
        parameters = function.get("parameters")
        if not isinstance(name, str) or not name.strip():
            continue
        if parameters is not None and not isinstance(parameters, dict):
            continue
        tools.append({"type": "function", "function": function})
    return tools


def _attributes(trace: Trace, span: Span, experiment_id: str, request_id: str) -> dict[str, object]:
    attributes: dict[str, object] = {
        **span.attributes,
        SpanAttributeKey.REQUEST_ID: request_id,
        SpanAttributeKey.EXPERIMENT_ID: experiment_id,
        SpanAttributeKey.SPAN_TYPE: span.kind.value.upper(),
    }
    if span.parent_span_id is None:
        # MLflow's own exporters carry trace-level user and session on the root span.
        if trace.session_id is not None:
            attributes[SpanAttributeKey.SESSION_ID] = trace.session_id
        if trace.user_id is not None:
            attributes[SpanAttributeKey.USER_ID] = trace.user_id
    if span.inputs is not None:
        attributes[SpanAttributeKey.INPUTS] = span.inputs
    if span.outputs is not None:
        attributes[SpanAttributeKey.OUTPUTS] = span.outputs
    if SpanAttributeKey.CHAT_TOOLS not in attributes:
        tools = _chat_tools(span.attributes.get(GenAiSemconvKey.TOOL_DEFINITIONS))
        if tools is not None:
            attributes[SpanAttributeKey.CHAT_TOOLS] = tools
    if (usage := token_usage(span)) is not None:
        attributes[SpanAttributeKey.CHAT_USAGE] = usage
    if (cost := usd_cost(span)) is not None:
        attributes[SpanAttributeKey.LLM_COST] = {CostKey.TOTAL_COST: cost}
    if span.model_name:
        attributes[SpanAttributeKey.MODEL] = span.model_name
    if span.model_provider:
        attributes[SpanAttributeKey.MODEL_PROVIDER] = span.model_provider
    return attributes


def mlflow_spans(trace: Trace, experiment_id: str, request_id: str) -> list[MlflowSpan]:
    """Spans of a standalone trace; ``request_id`` is MLflow's identifier of the trace.

    Raises:
        ValueError: A value cannot be encoded as JSON (e.g. NaN).
    """
    otel_trace_id = int(trace.trace_id, 16)
    spans: list[MlflowSpan] = []
    for span in trace.spans:
        end_time = nanos(span.end_time)
        parent = (
            None
            if span.parent_span_id is None
            else SpanContext(trace_id=otel_trace_id, span_id=int(span.parent_span_id, 16), is_remote=False)
        )
        status = Status(StatusCode.OK)
        events: list[Event] = []
        if span.status is SpanStatus.ERROR:
            status = Status(StatusCode.ERROR, span.error)
            if span.error:
                # MLflow's tracer records errors as exception events, which its trace UI displays.
                attributes = {"exception.type": "Error", "exception.message": span.error}
                events.append(Event(name="exception", attributes=attributes, timestamp=end_time))
        spans.append(
            MlflowSpan(
                ReadableSpan(
                    name=span.name,
                    context=SpanContext(trace_id=otel_trace_id, span_id=int(span.span_id, 16), is_remote=False),
                    parent=parent,
                    start_time=nanos(span.start_time),
                    end_time=end_time,
                    attributes={
                        key: json_value(value)
                        for key, value in _attributes(trace, span, experiment_id, request_id).items()
                    },
                    status=status,
                    events=events,
                    resource=Resource.get_empty(),
                )
            )
        )
    return spans


def otlp_request(spans: list[MlflowSpan]) -> ExportTraceServiceRequest:
    """The OTLP request MLflow's REST store sends for these spans.

    Raises:
        ValueError: An attribute does not fit its OTLP type (e.g. an integer beyond 64 bits).
    """
    request = ExportTraceServiceRequest()
    request.resource_spans.add().scope_spans.add().spans.extend(span.to_otel_proto() for span in spans)
    return request


def trace_data(spans: list[MlflowSpan]) -> bytes:
    """The trace artifact MLflow's tracing client uploads for these spans."""
    return json_value(TraceData(spans=spans).to_dict()).encode()
