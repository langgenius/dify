import traceback
from collections.abc import Iterable, Iterator
from concurrent import futures

import grpc  # type: ignore[import-untyped]
import pytest
from dify_trace_sdk.errors import (
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import MESSAGE_ID, RecordingEgress, message_trace, tool_fragment, workflow_trace
from dify_trace_tencent.config import TencentConfig
from dify_trace_tencent.provider import TencentProvider
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import add_TraceServiceServicer_to_server
from opentelemetry.proto.common.v1.common_pb2 import KeyValue
from opentelemetry.proto.resource.v1.resource_pb2 import Resource
from opentelemetry.proto.trace.v1.trace_pb2 import Span as OtlpSpan
from opentelemetry.proto.trace.v1.trace_pb2 import Status

TOKEN = "synthetic-token"
UNSENDABLE_TOKEN = "synthetic\ntoken"
CONFIG = TencentConfig(token=TOKEN, endpoint="https://apm.example.com", service_name="dify-app")


class _Collector:
    """An in-process OTLP/gRPC collector; gRPC dispatches to ``Export`` by name."""

    def __init__(self, target: str) -> None:
        self.target = target
        self.received: list[tuple[ExportTraceServiceRequest, dict[str, str | bytes]]] = []
        self.response = ExportTraceServiceResponse()
        self.abort_with: grpc.StatusCode | None = None

    def Export(  # noqa: N802 - gRPC method name
        self, request: ExportTraceServiceRequest, context: grpc.ServicerContext
    ) -> ExportTraceServiceResponse:
        self.received.append((request, dict(context.invocation_metadata())))
        if self.abort_with is not None:
            context.abort(self.abort_with, "scripted failure")
        return self.response


@pytest.fixture
def collector() -> Iterator[_Collector]:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    collector = _Collector(target=f"127.0.0.1:{server.add_insecure_port('127.0.0.1:0')}")
    add_TraceServiceServicer_to_server(collector, server)
    server.start()
    yield collector
    server.stop(None)


def _provider(grpc_target: str | None) -> tuple[TencentProvider, RecordingEgress]:
    egress = RecordingEgress([], grpc_target=grpc_target)
    return TencentProvider(egress), egress


def _config(**overrides: object) -> TencentConfig:
    return TencentConfig.model_validate(
        {"endpoint": "https://collector.example:4320", "service_name": "dify-agent", "token": TOKEN, **overrides}
    )


def _attributes(values: Iterable[KeyValue]) -> dict[str, object]:
    decoded: dict[str, object] = {}
    for item in values:
        match item.value.WhichOneof("value"):
            case "string_value":
                decoded[item.key] = item.value.string_value
            case "int_value":
                decoded[item.key] = item.value.int_value
            case "bool_value":
                decoded[item.key] = item.value.bool_value
            case "double_value":
                decoded[item.key] = item.value.double_value
            case other:
                raise AssertionError(f"unexpected attribute type: {other}")
    return decoded


def _exported(collector: _Collector) -> tuple[Resource, list[OtlpSpan]]:
    ((request, metadata),) = collector.received
    assert metadata["authorization"] == f"Bearer {TOKEN}"
    (resource_spans,) = request.resource_spans
    (scope_spans,) = resource_spans.scope_spans
    return resource_spans.resource, list(scope_spans.spans)


def _rendered(error: Exception) -> str:
    return str(error) + repr(error) + "".join(traceback.format_exception(error))


def test_verify_exchanges_one_empty_export_with_the_bearer_token(collector: _Collector) -> None:
    provider, egress = _provider(collector.target)
    assert provider.verify(CONFIG) == CONFIG
    assert egress.grpc_endpoints == ["https://apm.example.com:4317"]
    assert egress.requests == []
    ((request, metadata),) = collector.received
    assert request == ExportTraceServiceRequest()
    assert metadata["authorization"] == f"Bearer {TOKEN}"


@pytest.mark.parametrize(
    ("endpoint", "dialed"),
    [
        ("https://apm.example.com", "https://apm.example.com:4317"),
        ("http://apm.example.com", "http://apm.example.com:4317"),
        ("http://[2001:db8::1]", "http://[2001:db8::1]:4317"),
        ("https://apm.example.com:4320", "https://apm.example.com:4320"),
        ("https://apm.example.com:443", "https://apm.example.com:443"),
    ],
)
def test_the_otlp_grpc_port_is_added_only_when_the_endpoint_names_none(
    collector: _Collector, endpoint: str, dialed: str
) -> None:
    provider, egress = _provider(collector.target)
    config = TencentConfig(token=TOKEN, endpoint=endpoint, service_name="dify-app")
    provider.verify(config)
    provider.send(config, message_trace())
    assert egress.grpc_endpoints == [dialed, dialed]


@pytest.mark.parametrize(
    "status", [grpc.StatusCode.UNAUTHENTICATED, grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.UNIMPLEMENTED]
)
def test_verify_rpc_failures_are_connection_failures(collector: _Collector, status: grpc.StatusCode) -> None:
    collector.abort_with = status
    provider, _ = _provider(collector.target)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "connection_failed"
    assert TOKEN not in _rendered(caught.value)


@pytest.mark.parametrize(("rejected_spans", "error_message"), [(1, ""), (0, f"private-collector-detail {TOKEN}")])
def test_verify_partial_acknowledgments_are_unexpected(
    collector: _Collector, rejected_spans: int, error_message: str
) -> None:
    collector.response.partial_success.rejected_spans = rejected_spans
    collector.response.partial_success.error_message = error_message
    provider, _ = _provider(collector.target)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "unexpected_response"
    rendered = _rendered(caught.value)
    assert "private-collector-detail" not in rendered
    assert TOKEN not in rendered


def test_metadata_grpc_cannot_send_never_leaks_the_token(collector: _Collector) -> None:
    # Validation rejects such tokens; this covers a configuration that bypassed it.
    unsendable = TencentConfig.model_construct(
        token=UNSENDABLE_TOKEN, endpoint="https://apm.example.com", service_name="dify-app"
    )
    provider, _ = _provider(collector.target)
    with pytest.raises(VerificationError) as verify_error:
        provider.verify(unsendable)
    assert verify_error.value.code == "connection_failed"
    with pytest.raises(ExportRejectedError) as send_error:
        provider.send(unsendable, message_trace())
    for error in (verify_error.value, send_error.value):
        assert "synthetic" not in _rendered(error)
    assert collector.received == []


def test_verify_endpoint_refused_by_the_egress_is_a_connection_failure() -> None:
    provider, egress = _provider(None)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "connection_failed"
    assert egress.grpc_endpoints == ["https://apm.example.com:4317"]


@pytest.mark.parametrize(
    "service_name",
    ["", "   ", "dify_app", "Dify", "1app", "-app", "app-", "a" * 64, "应用", "a.b", "a/b", "a b", "a\nb"],
)
def test_verification_rejects_service_names_outside_the_documented_pattern(service_name: str) -> None:
    egress = RecordingEgress([], grpc_target=None)
    with pytest.raises(VerificationError) as raised:
        TencentProvider(egress).verify(_config(service_name=service_name))
    assert raised.value.code == "invalid_service_name"
    assert egress.grpc_endpoints == []


def test_project_url_is_the_apm_console() -> None:
    provider, _ = _provider(None)
    assert provider.project_url(CONFIG) == "https://console.cloud.tencent.com/apm"


def test_message_trace_is_exported_with_tencent_genai_attributes(collector: _Collector) -> None:
    provider, _ = _provider(collector.target)
    trace = message_trace()
    assert provider.send(CONFIG, trace) == SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})

    resource, (root, llm) = _exported(collector)
    assert _attributes(resource.attributes) == {"service.name": "dify-app"}
    assert root.trace_id.hex() == llm.trace_id.hex() == trace.trace_id == MESSAGE_ID.replace("-", "")
    assert (root.span_id.hex(), root.parent_span_id) == (trace.spans[0].span_id, b"")
    assert (llm.span_id.hex(), llm.parent_span_id.hex()) == (trace.spans[1].span_id, trace.spans[0].span_id)
    assert (root.name, llm.name) == ("message", "llm")
    assert root.status.code == llm.status.code == Status.STATUS_CODE_OK
    root_attributes = _attributes(root.attributes)
    assert (
        root_attributes.items()
        >= {
            "gen_ai.span.kind": "WORKFLOW",
            "gen_ai.is_entry": "true",
            "gen_ai.framework": "dify",
            "gen_ai.session.id": "conversation-1",
            "gen_ai.user.id": "end-user-1",
            "gen_ai.entity.input": '{"query": "What is Dify?"}',
            "gen_ai.entity.output": '"An LLM application platform."',
            "dify.app_id": "app-1",
            "dify.message_id": MESSAGE_ID,
        }.items()
    )
    assert "input.value" not in root_attributes
    llm_attributes = _attributes(llm.attributes)
    assert (
        llm_attributes.items()
        >= {
            "gen_ai.span.kind": "GENERATION",
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.provider.name": "openai",
            "gen_ai.usage.input_tokens": 12,
            "gen_ai.usage.output_tokens": 8,
            "gen_ai.usage.total_tokens": 20,
            "gen_ai.response.time_to_first_token": 250_000_000,
        }.items()
    )
    assert "gen_ai.is_entry" not in llm_attributes


def test_workflow_trace_marks_only_its_root_as_the_entry(collector: _Collector) -> None:
    provider, _ = _provider(collector.target)
    trace = workflow_trace()
    provider.send(CONFIG, trace)

    _, (run, llm, tool) = _exported(collector)
    assert (llm.parent_span_id.hex(), tool.parent_span_id.hex()) == (run.span_id.hex(), llm.span_id.hex())
    attributes = [_attributes(span.attributes) for span in (run, llm, tool)]
    assert [values["gen_ai.span.kind"] for values in attributes] == ["WORKFLOW", "GENERATION", "TOOL"]
    assert [values.get("gen_ai.is_entry") for values in attributes] == ["true", None, None]
    assert (run.status.code, run.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
    assert (tool.status.code, tool.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")


def test_fragment_joins_the_message_without_claiming_the_entry(collector: _Collector) -> None:
    provider, _ = _provider(collector.target)
    fragment = tool_fragment()
    provider.send(CONFIG, fragment)

    _, (tool,) = _exported(collector)
    assert fragment.parent is not None
    assert tool.trace_id.hex() == message_trace().trace_id
    assert tool.parent_span_id.hex() == fragment.parent.span_id == message_trace().root.span_id
    tool_attributes = _attributes(tool.attributes)
    assert tool_attributes["gen_ai.span.kind"] == "TOOL"
    assert "gen_ai.is_entry" not in tool_attributes


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (grpc.StatusCode.UNAVAILABLE, ExportRetryableError),
        (grpc.StatusCode.RESOURCE_EXHAUSTED, ExportRetryableError),
        (grpc.StatusCode.DEADLINE_EXCEEDED, ExportOutcomeUnknownError),
        (grpc.StatusCode.UNAUTHENTICATED, ExportRejectedError),
        (grpc.StatusCode.INVALID_ARGUMENT, ExportRejectedError),
    ],
)
def test_send_rpc_failures_are_classified_without_exposing_the_token(
    collector: _Collector, status: grpc.StatusCode, expected: type[Exception]
) -> None:
    collector.abort_with = status
    provider, _ = _provider(collector.target)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert TOKEN not in _rendered(caught.value)


def test_partial_acceptance_is_an_unknown_outcome(collector: _Collector) -> None:
    collector.response.partial_success.rejected_spans = 1
    provider, _ = _provider(collector.target)
    with pytest.raises(ExportOutcomeUnknownError):
        provider.send(CONFIG, message_trace())


def test_endpoint_refused_by_the_egress_is_rejected() -> None:
    provider, egress = _provider(None)
    with pytest.raises(ExportRejectedError):
        provider.send(CONFIG, message_trace())
    assert egress.grpc_endpoints == ["https://apm.example.com:4317"]
