from collections.abc import Iterator
from concurrent import futures

import grpc  # type: ignore[import-untyped]
import pytest
from dify_trace_arize_phoenix.config import ArizeConfig
from dify_trace_arize_phoenix.provider import ArizeProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.model import SpanStatus, Trace
from dify_trace_sdk.testing import RecordingEgress, message_trace, response, tool_fragment, workflow_trace
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import add_TraceServiceServicer_to_server
from opentelemetry.proto.trace.v1.trace_pb2 import Status

SPACE = "U3BhY2U6dGVzdA=="
ORGANIZATION = "T3JnOnRlc3Q="
PROJECT_ID = "UHJvamVjdDovKz0="
CONFIG = ArizeConfig(api_key="ak-secret-key", space_id=SPACE, project="exact")
DESTINATION = {
    "endpoint": "https://otlp.arize.com",
    "space_id": SPACE,
    "project": "exact",
    "organization_id": ORGANIZATION,
    "project_id": PROJECT_ID,
}
URL = "https://app.arize.com/organizations/T3JnOnRlc3Q%3D/spaces/U3BhY2U6dGVzdA%3D%3D/projects/UHJvamVjdDovKz0%3D"


class _Collector:
    """An in-process OTLP collector; gRPC dispatches to ``Export`` by name."""

    def __init__(self) -> None:
        self.target = ""
        self.status = grpc.StatusCode.OK
        self.ack = ExportTraceServiceResponse()
        self.received: list[tuple[ExportTraceServiceRequest, dict[str, str | bytes]]] = []

    def Export(  # noqa: N802 - gRPC method name
        self, request: ExportTraceServiceRequest, context: grpc.ServicerContext
    ) -> ExportTraceServiceResponse:
        self.received.append((request, dict(context.invocation_metadata())))
        if self.status != grpc.StatusCode.OK:
            context.abort(self.status, "vendor detail about ak-secret-key")
        return self.ack


@pytest.fixture
def collector() -> Iterator[_Collector]:
    collector = _Collector()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    add_TraceServiceServicer_to_server(collector, server)
    collector.target = f"127.0.0.1:{server.add_insecure_port('127.0.0.1:0')}"
    server.start()
    try:
        yield collector
    finally:
        server.stop(None)


def _provider(grpc_target: str | None, *responses: EgressResponse | Exception) -> tuple[ArizeProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=grpc_target)
    return ArizeProvider(egress), egress


def _config(**changes: object) -> ArizeConfig:
    return ArizeConfig.model_validate({**CONFIG.model_dump(), **changes})


def _ack(rejected_spans: int, error_message: str) -> ExportTraceServiceResponse:
    ack = ExportTraceServiceResponse()
    ack.partial_success.rejected_spans = rejected_spans
    ack.partial_success.error_message = error_message
    return ack


def _space() -> EgressResponse:
    return response(200, {"id": SPACE, "organization_id": ORGANIZATION})


def _page(projects: list[dict[str, str]], cursor: str | None) -> EgressResponse:
    return response(200, {"projects": projects, "pagination": {"has_more": cursor is not None, "next_cursor": cursor}})


def _project(name: str, project_id: str) -> dict[str, str]:
    return {"id": project_id, "name": name, "space_id": SPACE}


def test_verify_requires_an_empty_export_ack_and_resolves_the_project_link(collector: _Collector) -> None:
    provider, egress = _provider(
        collector.target,
        _space(),
        _page([_project("exact-substring", "UHJvamVjdDoy")], "next"),
        _page([_project("exact", PROJECT_ID)], None),
    )
    verified = provider.verify(CONFIG)

    assert verified.arize_project_destination == DESTINATION
    assert provider.project_url(verified) == URL
    assert egress.grpc_endpoints == ["https://otlp.arize.com"]
    ((probe, metadata),) = collector.received
    (resource_spans,) = probe.resource_spans
    assert {item.key: item.value.string_value for item in resource_spans.resource.attributes} == {
        "model_id": "exact",
        "openinference.project.name": "exact",
    }
    assert len(resource_spans.scope_spans) == 0
    assert (metadata["api_key"], metadata["space_id"], metadata["authorization"]) == (
        "ak-secret-key",
        SPACE,
        "Bearer ak-secret-key",
    )
    lookup = "https://api.arize.com/v2/projects?space_id=U3BhY2U6dGVzdA%3D%3D&name=exact&limit=100"
    assert [request.url for request in egress.requests] == [
        "https://api.arize.com/v2/spaces/U3BhY2U6dGVzdA%3D%3D",
        lookup,
        lookup + "&cursor=next",
    ]
    for request in egress.requests:
        assert request.method == "GET"
        assert request.headers == {"Authorization": "Bearer ak-secret-key", "Accept": "application/json"}
        assert request.sensitive_url is True


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (grpc.StatusCode.UNAUTHENTICATED, "authentication_failed"),
        (grpc.StatusCode.PERMISSION_DENIED, "permission_denied"),
        (grpc.StatusCode.UNAVAILABLE, "connection_failed"),
        (grpc.StatusCode.RESOURCE_EXHAUSTED, "connection_failed"),
    ],
)
def test_rejected_probe_has_a_stable_code(collector: _Collector, status: grpc.StatusCode, code: str) -> None:
    collector.status = status
    provider, egress = _provider(collector.target)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code
    assert caught.value.__suppress_context__
    assert "ak-secret-key" not in str(caught.value)
    assert len(collector.received) == 1
    assert egress.requests == []


@pytest.mark.parametrize("ack", [_ack(1, ""), _ack(0, "vendor detail")])
def test_partial_probe_ack_is_unexpected(collector: _Collector, ack: ExportTraceServiceResponse) -> None:
    collector.ack = ack
    provider, egress = _provider(collector.target)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "unexpected_response"
    assert egress.requests == []


@pytest.mark.parametrize(
    "changes",
    [
        {"api_key": ""},
        {"api_key": "******"},
        {"api_key": "key\nheader"},
        {"api_key": "ключ"},
        {"space_id": " "},
        {"space_id": "******"},
        {"endpoint": "https://otlp.arize.com:0"},
        {"endpoint": "https://otlp.arize.com:99999"},
    ],
)
def test_invalid_values_never_open_a_channel(changes: dict[str, str]) -> None:
    provider, egress = _provider(None)
    with pytest.raises(VerificationError) as caught:
        provider.verify(_config(**changes))
    assert caught.value.code == "invalid_configuration"
    assert egress.grpc_endpoints == []


def test_disallowed_collector_is_a_connection_failure() -> None:
    provider, egress = _provider(None)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "connection_failed"
    assert egress.grpc_endpoints == ["https://otlp.arize.com"]


@pytest.mark.parametrize(
    "lookups",
    [
        [response(403, {"message": "denied"})],
        [EgressError("read timeout", request_sent=True)],
        [response(200, b"not json")],
        [response(200, {"id": "U3BhY2U6b3RoZXI=", "organization_id": ORGANIZATION})],
        [response(200, {"id": SPACE, "organization_id": "../escape"})],
        [_space(), _page([_project("exact", PROJECT_ID), _project("exact", "UHJvamVjdDoy")], None)],
        [_space(), _page([_project("EXACT", PROJECT_ID)], None)],
        [_space(), _page([{**_project("exact", PROJECT_ID), "space_id": "U3BhY2U6b3RoZXI="}], None)],
        [_space(), response(200, {"projects": [_project("exact", PROJECT_ID)], "pagination": {"has_more": True}})],
        [_space(), *(_page([_project("other", PROJECT_ID)], str(index)) for index in range(3))],
        [_space(), _page([], "same"), _page([], "same")],
    ],
)
def test_project_link_is_optional(collector: _Collector, lookups: list[EgressResponse | Exception]) -> None:
    provider, egress = _provider(collector.target, *lookups)
    verified = provider.verify(CONFIG)
    assert verified.arize_project_destination is None
    assert provider.project_url(verified) is None
    assert len(egress.requests) == len(lookups)


@pytest.mark.parametrize(
    "endpoint", ["https://otlp.eu-west-1a.arize.com", "http://otlp.arize.com", "https://otlp.arize.com:4317"]
)
def test_other_collectors_never_send_credentials_to_arize_cloud(collector: _Collector, endpoint: str) -> None:
    provider, egress = _provider(collector.target)
    verified = provider.verify(_config(endpoint=endpoint))
    assert verified.arize_project_destination is None
    assert egress.grpc_endpoints == [endpoint]
    assert egress.requests == []


def test_project_url_reads_a_stored_destination_without_io() -> None:
    provider, egress = _provider(None)
    stored = _config(arize_project_destination={**DESTINATION, "source_digest": "0" * 64})
    assert provider.project_url(stored) == URL
    assert (egress.requests, egress.grpc_endpoints) == ([], [])


def test_project_url_needs_no_decrypted_space_id() -> None:
    provider, _ = _provider(None)
    stored = _config(arize_project_destination=DESTINATION, space_id="ZW5jcnlwdGVkLXNwYWNlLWlkLWNpcGhlcnRleHQ=")
    assert provider.project_url(stored) == URL


@pytest.mark.parametrize(
    "changes",
    [
        {"project": "renamed"},
        {"endpoint": "https://otlp.arize.com:443"},
        {"arize_project_destination": {**DESTINATION, "organization_id": "bad?query"}},
        {"arize_project_destination": {**DESTINATION, "project_id": "../escape"}},
        {"arize_project_destination": None},
    ],
)
def test_project_url_refuses_stale_or_forged_destinations(changes: dict[str, object]) -> None:
    provider, _ = _provider(None)
    assert provider.project_url(_config(**{"arize_project_destination": DESTINATION, **changes})) is None


def test_send_exports_openinference_spans_with_arize_metadata(collector: _Collector) -> None:
    provider, egress = _provider(collector.target)
    trace = message_trace()
    result = provider.send(CONFIG, trace)

    assert egress.grpc_endpoints == ["https://otlp.arize.com"]
    ((request, metadata),) = collector.received
    assert (metadata["api_key"], metadata["space_id"], metadata["authorization"]) == (
        "ak-secret-key",
        SPACE,
        "Bearer ak-secret-key",
    )
    (resource_spans,) = request.resource_spans
    assert {item.key: item.value.string_value for item in resource_spans.resource.attributes} == {
        "service.name": "dify-application",
        "openinference.project.name": "exact",
        "model_id": "exact",
    }
    _, llm = resource_spans.scope_spans[0].spans
    llm_attributes = {item.key: item.value for item in llm.attributes}
    assert llm_attributes["openinference.span.kind"].string_value == "LLM"
    assert llm_attributes["llm.model_name"].string_value == "gpt-4o"
    assert llm_attributes["llm.token_count.total"].int_value == 20
    assert llm_attributes["session.id"].string_value == "conversation-1"
    assert (result.trace_id, result.trace_url, result.span_urls) == (trace.trace_id, None, {})


@pytest.mark.parametrize("trace", [message_trace(), workflow_trace(), tool_fragment()])
def test_send_keeps_ids_parents_and_status(collector: _Collector, trace: Trace) -> None:
    provider, _ = _provider(collector.target)
    provider.send(CONFIG, trace)

    ((request, _),) = collector.received
    spans = request.resource_spans[0].scope_spans[0].spans
    sent = [(span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex(), span.status.code) for span in spans]
    assert sent == [
        (
            trace.trace_id,
            span.span_id,
            span.parent_span_id or "",
            Status.STATUS_CODE_ERROR if span.status is SpanStatus.ERROR else Status.STATUS_CODE_OK,
        )
        for span in trace.spans
    ]


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
def test_send_failures_are_classified(
    collector: _Collector, status: grpc.StatusCode, expected: type[Exception]
) -> None:
    collector.status = status
    provider, _ = _provider(collector.target)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert "ak-secret-key" not in str(caught.value)


def test_partial_acceptance_is_outcome_unknown(collector: _Collector) -> None:
    collector.ack = _ack(1, "")
    provider, _ = _provider(collector.target)
    with pytest.raises(ExportOutcomeUnknownError):
        provider.send(CONFIG, message_trace())


def test_disallowed_collector_rejects_the_export() -> None:
    provider, _ = _provider(None)
    with pytest.raises(ExportRejectedError):
        provider.send(CONFIG, message_trace())


@pytest.mark.parametrize("changes", [{"api_key": "ключ"}, {"space_id": "line\nbreak"}])
def test_credentials_grpc_cannot_carry_are_rejected_before_export(
    collector: _Collector, changes: dict[str, str]
) -> None:
    provider, egress = _provider(collector.target)
    with pytest.raises(ExportRejectedError) as caught:
        provider.send(_config(**changes), message_trace())
    assert "ключ" not in str(caught.value)
    assert (egress.grpc_endpoints, collector.received) == ([], [])
