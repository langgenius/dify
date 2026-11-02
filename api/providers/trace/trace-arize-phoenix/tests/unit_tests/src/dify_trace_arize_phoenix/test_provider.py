from collections.abc import Iterable, Iterator
from concurrent import futures

import grpc  # type: ignore[import-untyped]
import pytest
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from dify_trace_arize_phoenix.provider import ArizeProvider, PhoenixProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.exporting import json_value
from dify_trace_sdk.model import SpanStatus, Trace
from dify_trace_sdk.testing import (
    WORKFLOW_RUN_ID,
    RecordingEgress,
    message_trace,
    response,
    tool_fragment,
    workflow_trace,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import add_TraceServiceServicer_to_server
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Status

SPACE = "U3BhY2U6dGVzdA=="
ORGANIZATION = "T3JnOnRlc3Q="
PROJECT_ID = "UHJvamVjdDovKz0="
ARIZE_CONFIG = ArizeConfig(api_key="ak-secret-key", space_id=SPACE, project="exact")
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


def _arize_provider(
    grpc_target: str | None, *responses: EgressResponse | Exception
) -> tuple[ArizeProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=grpc_target)
    return ArizeProvider(egress), egress


def _arize_config(**changes: object) -> ArizeConfig:
    return ArizeConfig.model_validate({**ARIZE_CONFIG.model_dump(), **changes})


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


class TestArizeProvider:
    @staticmethod
    def test_verify_requires_an_empty_export_ack_and_resolves_the_project_link(collector: _Collector) -> None:
        provider, egress = _arize_provider(
            collector.target,
            _space(),
            _page([_project("exact-substring", "UHJvamVjdDoy")], "next"),
            _page([_project("exact", PROJECT_ID)], None),
        )
        verified = provider.verify(ARIZE_CONFIG)

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

    @staticmethod
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
        provider, egress = _arize_provider(collector.target)
        with pytest.raises(VerificationError) as caught:
            provider.verify(ARIZE_CONFIG)
        assert caught.value.code == code
        assert caught.value.__suppress_context__
        assert "ak-secret-key" not in str(caught.value)
        assert len(collector.received) == 1
        assert egress.requests == []

    @staticmethod
    @pytest.mark.parametrize("ack", [_ack(1, ""), _ack(0, "vendor detail")])
    def test_partial_probe_ack_is_unexpected(collector: _Collector, ack: ExportTraceServiceResponse) -> None:
        collector.ack = ack
        provider, egress = _arize_provider(collector.target)
        with pytest.raises(VerificationError) as caught:
            provider.verify(ARIZE_CONFIG)
        assert caught.value.code == "unexpected_response"
        assert egress.requests == []

    @staticmethod
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
        provider, egress = _arize_provider(None)
        with pytest.raises(VerificationError) as caught:
            provider.verify(_arize_config(**changes))
        assert caught.value.code == "invalid_configuration"
        assert egress.grpc_endpoints == []

    @staticmethod
    def test_disallowed_collector_is_a_connection_failure() -> None:
        provider, egress = _arize_provider(None)
        with pytest.raises(VerificationError) as caught:
            provider.verify(ARIZE_CONFIG)
        assert caught.value.code == "connection_failed"
        assert egress.grpc_endpoints == ["https://otlp.arize.com"]

    @staticmethod
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
        provider, egress = _arize_provider(collector.target, *lookups)
        verified = provider.verify(ARIZE_CONFIG)
        assert verified.arize_project_destination is None
        assert provider.project_url(verified) is None
        assert len(egress.requests) == len(lookups)

    @staticmethod
    @pytest.mark.parametrize(
        "endpoint", ["https://otlp.eu-west-1a.arize.com", "http://otlp.arize.com", "https://otlp.arize.com:4317"]
    )
    def test_other_collectors_never_send_credentials_to_arize_cloud(collector: _Collector, endpoint: str) -> None:
        provider, egress = _arize_provider(collector.target)
        verified = provider.verify(_arize_config(endpoint=endpoint))
        assert verified.arize_project_destination is None
        assert egress.grpc_endpoints == [endpoint]
        assert egress.requests == []

    @staticmethod
    def test_project_url_reads_a_stored_destination_without_io() -> None:
        provider, egress = _arize_provider(None)
        stored = _arize_config(arize_project_destination={**DESTINATION, "source_digest": "0" * 64})
        assert provider.project_url(stored) == URL
        assert (egress.requests, egress.grpc_endpoints) == ([], [])

    @staticmethod
    def test_project_url_needs_no_decrypted_space_id() -> None:
        provider, _ = _arize_provider(None)
        stored = _arize_config(
            arize_project_destination=DESTINATION, space_id="ZW5jcnlwdGVkLXNwYWNlLWlkLWNpcGhlcnRleHQ="
        )
        assert provider.project_url(stored) == URL

    @staticmethod
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
        provider, _ = _arize_provider(None)
        assert provider.project_url(_arize_config(**{"arize_project_destination": DESTINATION, **changes})) is None

    @staticmethod
    def test_send_exports_openinference_spans_with_arize_metadata(collector: _Collector) -> None:
        provider, egress = _arize_provider(collector.target)
        trace = message_trace()
        result = provider.send(ARIZE_CONFIG, trace)

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

    @staticmethod
    @pytest.mark.parametrize("trace", [message_trace(), workflow_trace(), tool_fragment()])
    def test_send_keeps_ids_parents_and_status(collector: _Collector, trace: Trace) -> None:
        provider, _ = _arize_provider(collector.target)
        provider.send(ARIZE_CONFIG, trace)

        ((request, _),) = collector.received
        spans = request.resource_spans[0].scope_spans[0].spans
        sent = [
            (span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex(), span.status.code) for span in spans
        ]
        assert sent == [
            (
                trace.trace_id,
                span.span_id,
                span.parent_span_id or "",
                Status.STATUS_CODE_ERROR if span.status is SpanStatus.ERROR else Status.STATUS_CODE_OK,
            )
            for span in trace.spans
        ]

    @staticmethod
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
        provider, _ = _arize_provider(collector.target)
        with pytest.raises(expected) as caught:
            provider.send(ARIZE_CONFIG, message_trace())
        assert "ak-secret-key" not in str(caught.value)

    @staticmethod
    def test_partial_acceptance_is_outcome_unknown(collector: _Collector) -> None:
        collector.ack = _ack(1, "")
        provider, _ = _arize_provider(collector.target)
        with pytest.raises(ExportOutcomeUnknownError):
            provider.send(ARIZE_CONFIG, message_trace())

    @staticmethod
    def test_disallowed_collector_rejects_the_export() -> None:
        provider, _ = _arize_provider(None)
        with pytest.raises(ExportRejectedError):
            provider.send(ARIZE_CONFIG, message_trace())

    @staticmethod
    @pytest.mark.parametrize("changes", [{"api_key": "ключ"}, {"space_id": "line\nbreak"}])
    def test_credentials_grpc_cannot_carry_are_rejected_before_export(
        collector: _Collector, changes: dict[str, str]
    ) -> None:
        provider, egress = _arize_provider(collector.target)
        with pytest.raises(ExportRejectedError) as caught:
            provider.send(_arize_config(**changes), message_trace())
        assert "ключ" not in str(caught.value)
        assert (egress.grpc_endpoints, collector.received) == ([], [])


PHOENIX_CONFIG = PhoenixConfig(
    api_key="phx-secret-key", project="dify-app", endpoint="https://phoenix.example.com/s/space"
)
EMPTY_PAGE = {"data": [], "next_cursor": None}


def _phoenix_provider(*responses: EgressResponse | Exception) -> tuple[PhoenixProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return PhoenixProvider(egress), egress


def _phoenix_config(**changes: str | None) -> PhoenixConfig:
    return PhoenixConfig.model_validate({**PHOENIX_CONFIG.model_dump(), **changes})


def _value(value: AnyValue) -> object:
    match value.WhichOneof("value"):
        case "string_value":
            return value.string_value
        case "int_value":
            return value.int_value
        case "double_value":
            return value.double_value
        case "bool_value":
            return value.bool_value
        case other:
            raise AssertionError(f"unexpected attribute value type {other}")


def _attributes(attributes: Iterable[KeyValue]) -> dict[str, object]:
    return {attribute.key: _value(attribute.value) for attribute in attributes}


def _sent(egress: RecordingEgress) -> ExportTraceServiceRequest:
    (sent,) = egress.requests
    return ExportTraceServiceRequest.FromString(sent.content or b"")


def _partial_ack() -> bytes:
    ack = ExportTraceServiceResponse()
    ack.partial_success.rejected_spans = 1
    return ack.SerializeToString()


class TestPhoenixProvider:
    @staticmethod
    def test_verify_normalizes_the_destination_and_reads_one_project_page() -> None:
        provider, egress = _phoenix_provider(response(200, EMPTY_PAGE))
        verified = provider.verify(
            _phoenix_config(endpoint=" HTTP://Phoenix.EXAMPLE.com:6006/proxy/s/space/ ", project=" project name ")
        )
        assert (verified.endpoint, verified.project) == (
            "http://phoenix.example.com:6006/proxy/s/space",
            "project name",
        )
        (sent,) = egress.requests
        assert (sent.method, sent.url, sent.content) == (
            "GET",
            "http://phoenix.example.com:6006/proxy/s/space/v1/projects?limit=1",
            None,
        )
        assert sent.headers == {"Accept": "application/json", "Authorization": "Bearer phx-secret-key"}
        assert sent.sensitive_url is False

    @staticmethod
    @pytest.mark.parametrize("api_key", [None, ""])
    def test_verify_without_a_key_sends_no_authorization(api_key: str | None) -> None:
        provider, egress = _phoenix_provider(response(200, EMPTY_PAGE))
        provider.verify(PhoenixConfig(api_key=api_key))
        (sent,) = egress.requests
        assert sent.url == "https://app.phoenix.arize.com/v1/projects?limit=1"
        assert sent.headers == {"Accept": "application/json"}

    @staticmethod
    def test_verify_does_not_require_the_configured_project_or_follow_the_cursor() -> None:
        page = {"data": [{"id": "UHJvamVjdDox", "name": "other", "description": None}], "next_cursor": "opaque"}
        provider, egress = _phoenix_provider(response(200, page))
        assert provider.verify(PHOENIX_CONFIG).project == "dify-app"
        assert len(egress.requests) == 1

    @staticmethod
    @pytest.mark.parametrize(
        ("changes", "code"),
        [
            ({"endpoint": "https://phoenix.example.com/v1/traces"}, "invalid_endpoint"),
            ({"endpoint": "https://phoenix.example.com/s/../space"}, "invalid_endpoint"),
            ({"endpoint": "https://phoenix.example.com/s%2fspace"}, "invalid_endpoint"),
            ({"endpoint": "https://phoenix.example.com//space"}, "invalid_endpoint"),
            ({"endpoint": "https://phoenix.example.com/s?token=secret"}, "invalid_endpoint"),
            ({"endpoint": "https://phoenix.example.com:0"}, "invalid_endpoint"),
            ({"project": ".."}, "invalid_project"),
            ({"project": "line\nbreak"}, "invalid_project"),
            ({"api_key": "******"}, "invalid_api_key"),
            ({"api_key": "two words"}, "invalid_api_key"),
            ({"api_key": "ключ"}, "invalid_api_key"),
        ],
    )
    def test_invalid_values_fail_before_any_request(changes: dict[str, str], code: str) -> None:
        provider, egress = _phoenix_provider()
        with pytest.raises(VerificationError) as caught:
            provider.verify(_phoenix_config(**changes))
        assert caught.value.code == code
        assert egress.requests == []

    @staticmethod
    @pytest.mark.parametrize(
        ("outcome", "code"),
        [
            (response(401, {"detail": "phx-secret-key is invalid"}), "authentication_failed"),
            (response(403, {}), "permission_denied"),
            (response(404, {}), "endpoint_unavailable"),
            (response(302, {}), "endpoint_unavailable"),
            (response(500, {}), "endpoint_unavailable"),
            (response(204, b""), "endpoint_unavailable"),
            (response(200, b"<html>login</html>"), "malformed_response"),
            (response(200, []), "malformed_response"),
            (response(200, {"data": []}), "malformed_response"),
            (response(200, {"data": [], "next_cursor": 3}), "malformed_response"),
            (response(200, {"data": [{"id": "1"}], "next_cursor": None}), "malformed_response"),
            (response(200, {"data": [{"id": "1", "name": ""}], "next_cursor": None}), "malformed_response"),
            (
                response(200, {"data": [{"id": "1", "name": "p", "description": {}}], "next_cursor": None}),
                "malformed_response",
            ),
            (response(200, {**EMPTY_PAGE, "padding": "x" * 1024 * 1024}), "malformed_response"),
            (EgressError("connect timeout", request_sent=False), "connection_failed"),
            (EgressBlockedError("private address"), "connection_failed"),
        ],
    )
    def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
        provider, egress = _phoenix_provider(outcome)
        with pytest.raises(VerificationError) as caught:
            provider.verify(PHOENIX_CONFIG)
        assert caught.value.code == code
        assert "phx-secret-key" not in str(caught.value)
        assert caught.value.__context__ is None or caught.value.__suppress_context__
        assert len(egress.requests) == 1

    @staticmethod
    def test_project_url_redirects_by_name_without_io() -> None:
        provider, egress = _phoenix_provider()
        config = PhoenixConfig(endpoint="https://Phoenix.example.com:8443/s/space/", project="A /? & #中文")
        assert provider.project_url(config) == (
            "https://phoenix.example.com:8443/s/space/redirects/projects/A%20%2F%3F%20%26%20%23%E4%B8%AD%E6%96%87"
        )
        assert provider.project_url(PhoenixConfig()) == "https://app.phoenix.arize.com/redirects/projects/default"
        assert provider.project_url(PhoenixConfig(endpoint="https://phoenix.example.com/v1/traces")) is None
        assert egress.requests == []

    @staticmethod
    def test_message_trace_becomes_openinference_spans() -> None:
        provider, egress = _phoenix_provider(response(200, ExportTraceServiceResponse().SerializeToString()))
        trace = message_trace()
        result = provider.send(PHOENIX_CONFIG, trace)

        (sent,) = egress.requests
        assert sent.url == "https://phoenix.example.com/s/space/v1/traces"
        assert sent.headers["Content-Type"] == "application/x-protobuf"
        assert (sent.headers["api_key"], sent.headers["authorization"]) == ("phx-secret-key", "Bearer phx-secret-key")
        (resource_spans,) = _sent(egress).resource_spans
        assert _attributes(resource_spans.resource.attributes) == {
            "service.name": "dify-application",
            "openinference.project.name": "dify-app",
            "model_id": "dify-app",
        }
        message, llm = resource_spans.scope_spans[0].spans
        assert [(span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex()) for span in (message, llm)] == [
            (trace.trace_id, trace.spans[0].span_id, ""),
            (trace.trace_id, trace.spans[1].span_id, trace.spans[0].span_id),
        ]
        assert (message.name, message.status.code) == ("message", Status.STATUS_CODE_OK)
        assert _attributes(message.attributes) == {
            "openinference.span.kind": "CHAIN",
            "input.value": '{"query": "What is Dify?"}',
            "input.mime_type": "application/json",
            "output.value": '"An LLM application platform."',
            "output.mime_type": "application/json",
            "metadata": json_value(trace.spans[0].attributes),
            "session.id": "conversation-1",
            "user.id": "end-user-1",
            "dify.span.id": trace.spans[0].span_id,
        }
        llm_attributes = _attributes(llm.attributes)
        assert llm_attributes["openinference.span.kind"] == "LLM"
        assert llm_attributes["input.value"] == '[{"role": "user", "content": "What is Dify?"}]'
        assert {key: value for key, value in llm_attributes.items() if key.startswith("llm.")} == {
            "llm.model_name": "gpt-4o",
            "llm.provider": "openai",
            "llm.token_count.prompt": 12,
            "llm.token_count.completion": 8,
            "llm.token_count.total": 20,
        }
        assert (result.trace_id, result.trace_url, result.span_urls) == (trace.trace_id, None, {})

    @staticmethod
    def test_workflow_spans_keep_hierarchy_errors_and_tool_fields() -> None:
        provider, egress = _phoenix_provider(response(200, b""))
        trace = workflow_trace()
        provider.send(PHOENIX_CONFIG, trace)

        run, llm, tool = _sent(egress).resource_spans[0].scope_spans[0].spans
        assert [span.parent_span_id.hex() for span in (run, llm, tool)] == [
            "",
            trace.spans[0].span_id,
            trace.spans[1].span_id,
        ]
        assert (run.status.code, run.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
        assert (llm.status.code, llm.status.message) == (Status.STATUS_CODE_OK, "")
        assert (tool.status.code, tool.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
        tool_attributes = _attributes(tool.attributes)
        assert tool_attributes["openinference.span.kind"] == "TOOL"
        assert (tool_attributes["tool.name"], tool_attributes["tool.parameters"]) == (
            "tool_Search",
            '{"query": "tracing"}',
        )
        assert (tool_attributes["session.id"], tool_attributes["user.id"]) == (WORKFLOW_RUN_ID, "account-1")
        assert not any(key.startswith("llm.") for key in tool_attributes)
        assert _attributes(llm.attributes)["llm.token_count.total"] == 40

    @staticmethod
    def test_fragment_root_points_at_the_separately_sent_parent() -> None:
        provider, egress = _phoenix_provider(response(200, b""))
        fragment = tool_fragment()
        provider.send(PHOENIX_CONFIG, fragment)

        (span,) = _sent(egress).resource_spans[0].scope_spans[0].spans
        assert fragment.parent is not None
        assert (span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex()) == (
            fragment.trace_id,
            fragment.root.span_id,
            fragment.parent.span_id,
        )
        attributes = _attributes(span.attributes)
        assert (attributes["openinference.span.kind"], attributes["tool.name"]) == ("TOOL", "weather")
        assert attributes["output.value"] == '"Sunny"'

    @staticmethod
    def test_send_without_a_key_sends_no_credentials() -> None:
        provider, egress = _phoenix_provider(response(200, b""))
        provider.send(PhoenixConfig(endpoint="http://phoenix.internal:6006/"), message_trace())
        (sent,) = egress.requests
        assert sent.url == "http://phoenix.internal:6006/v1/traces"
        assert sent.headers == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}

    @staticmethod
    @pytest.mark.parametrize(
        ("outcome", "expected"),
        [
            (response(503, {}), ExportRetryableError),
            (response(429, {}), ExportRetryableError),
            (response(401, {"detail": "phx-secret-key is invalid"}), ExportRejectedError),
            (EgressError("connection refused", request_sent=False), ExportRetryableError),
            (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
            (EgressBlockedError("private address"), ExportRejectedError),
            (response(200, _partial_ack()), ExportOutcomeUnknownError),
            (response(200, b"not-protobuf-\xff"), ExportOutcomeUnknownError),
        ],
    )
    def test_send_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
        provider, _ = _phoenix_provider(outcome)
        with pytest.raises(expected) as caught:
            provider.send(PHOENIX_CONFIG, message_trace())
        assert "phx-secret-key" not in str(caught.value)

    @staticmethod
    @pytest.mark.parametrize(
        "changes", [{"api_key": "line\nbreak"}, {"endpoint": "https://phoenix.example.com/?token=1"}]
    )
    def test_unusable_configuration_is_rejected_without_a_request(changes: dict[str, str]) -> None:
        provider, egress = _phoenix_provider()
        with pytest.raises(ExportRejectedError):
            provider.send(_phoenix_config(**changes), message_trace())
        assert egress.requests == []
