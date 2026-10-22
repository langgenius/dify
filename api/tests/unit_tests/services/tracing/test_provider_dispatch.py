"""Exercise real vendor serializers and OTLP stubs at their network boundary."""

import json
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Never, NotRequired, TypedDict, cast
from uuid import UUID

import httpx
import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.trace.v1.trace_pb2 import Span

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.normalization import remap_outer_trace
from services.tracing.provider_dispatch import (
    TraceExportRejectedError,
    TraceExportUncertainError,
    export_trace,
    provider_capabilities,
)


class HTTPArguments(TypedDict):
    content: bytes
    headers: Mapping[str, str]
    max_retries: NotRequired[int]
    follow_redirects: NotRequired[bool]


type HTTPCall = tuple[str, str, HTTPArguments]


@pytest.fixture
def trace() -> CanonicalTrace:
    start = datetime(2026, 10, 15, 1, tzinfo=UTC)
    return CanonicalTrace(
        trace_id="1" * 32,
        session_id="conversation-1",
        root_span_id="1" * 16,
        spans=(
            CanonicalSpan(
                id="1" * 16,
                parent_id=None,
                name="Agent turn",
                kind=CanonicalSpanKind.AGENT,
                start_time=start,
                end_time=start + timedelta(seconds=3),
                status=CanonicalSpanStatus.OK,
                inputs={"question": "hi"},
                outputs={"answer": "done"},
                metadata={"app_id": "app-one", "tenant_id": "tenant-one", "total_tokens": 12, "total_price": "0.03"},
            ),
            CanonicalSpan(
                id="2" * 16,
                parent_id="1" * 16,
                name="model call",
                kind=CanonicalSpanKind.LLM,
                start_time=start,
                end_time=start + timedelta(seconds=1),
                status=CanonicalSpanStatus.OK,
                inputs=[{"role": "user", "content": "hi"}],
                outputs="done",
                metadata={
                    "model": "gpt-4o-mini",
                    "model_provider": "openai",
                    "prompt_tokens": 8,
                    "completion_tokens": 4,
                    "total_tokens": 12,
                    "total_price": "0.03",
                    "currency": "USD",
                    "ttft": 0.2,
                },
            ),
            CanonicalSpan(
                id="3" * 16,
                parent_id="1" * 16,
                name="search",
                kind=CanonicalSpanKind.TOOL,
                start_time=start + timedelta(seconds=1),
                end_time=start + timedelta(seconds=2),
                status=CanonicalSpanStatus.ERROR,
                inputs={"q": "x"},
                outputs=None,
                error="tool failed",
            ),
        ),
    )


@pytest.fixture
def http_calls(monkeypatch: pytest.MonkeyPatch) -> list[HTTPCall]:
    from core.helper import ssrf_proxy

    calls: list[HTTPCall] = []

    def send(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls.append((method, url, cast(HTTPArguments, kwargs)))
        return httpx.Response(200, content=b"", request=httpx.Request(method, url))

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    return calls


def spans_from_call(call: HTTPCall) -> list[Span]:
    request = ExportTraceServiceRequest.FromString(call[2]["content"])
    return list(request.resource_spans[0].scope_spans[0].spans)


def attributes(span: Span) -> dict[str, object]:
    result: dict[str, object] = {}
    for item in span.attributes:
        kind = item.value.WhichOneof("value")
        assert kind is not None
        result[item.key] = {
            "string_value": item.value.string_value,
            "bool_value": item.value.bool_value,
            "int_value": item.value.int_value,
            "double_value": item.value.double_value,
            "array_value": item.value.array_value,
            "kvlist_value": item.value.kvlist_value,
            "bytes_value": item.value.bytes_value,
        }[kind]
    return result


def test_langfuse_v4_tree_and_native_usage(trace: CanonicalTrace, http_calls: list[HTTPCall]) -> None:
    config = {
        "host": "https://us.cloud.langfuse.com",
        "public_key": "pk-test",
        "secret_key": "sk-test",
        "project_url": "https://us.cloud.langfuse.com/project/example",
    }
    result = export_trace("langfuse", config, trace)
    assert result.status == "accepted"
    assert result.trace_id == trace.trace_id
    assert len(http_calls) == 1
    _, url, args = http_calls[0]
    assert url.endswith("/api/public/otel/v1/traces")
    assert args["headers"]["x-langfuse-ingestion-version"] == "4"
    assert args["max_retries"] == 0
    assert args["follow_redirects"] is False
    spans = spans_from_call(http_calls[0])
    assert [span.span_id.hex() for span in spans] == [s.id for s in trace.spans]
    assert spans[1].parent_span_id == spans[0].span_id
    assert spans[2].status.code == 2
    root, llm = attributes(spans[0]), attributes(spans[1])
    assert root["langfuse.observation.type"] == "agent"
    assert "langfuse.observation.usage_details" not in root
    usage_details, cost_details = llm["langfuse.observation.usage_details"], llm["langfuse.observation.cost_details"]
    assert isinstance(usage_details, str)
    assert isinstance(cost_details, str)
    assert json.loads(usage_details) == {"input": 8, "output": 4, "total": 12}
    assert json.loads(cost_details) == {"total": 0.03}
    assert all(attributes(span)["langfuse.session.id"] == trace.session_id for span in spans)
    assert result.span_urls[trace.spans[1].id].endswith(trace.spans[1].id)


@pytest.mark.parametrize(
    ("provider", "config", "suffix", "kind_key", "kind"),
    [
        (
            "phoenix",
            {"endpoint": "https://phoenix.test/proxy", "api_key": "key", "project": "one"},
            "/proxy/v1/traces",
            "openinference.span.kind",
            "AGENT",
        ),
        (
            "aliyun",
            {"endpoint": "https://region.log.aliyuncs.com", "license_key": "license", "app_name": "one"},
            "/adapt_license/api/v1/traces",
            "gen_ai.span.kind",
            "AGENT",
        ),
    ],
)
def test_other_http_providers_have_native_semantics(
    trace: CanonicalTrace,
    http_calls: list[HTTPCall],
    provider: str,
    config: dict[str, str],
    suffix: str,
    kind_key: str,
    kind: str,
) -> None:
    result = export_trace(provider, config, trace)
    assert result.status == "accepted"
    assert http_calls[0][1].endswith(suffix)
    spans = spans_from_call(http_calls[0])
    assert attributes(spans[0])[kind_key] == kind
    token_key = "llm.token_count.prompt" if provider == "phoenix" else "gen_ai.usage.input_tokens"
    assert attributes(spans[1])[token_key] == 8
    assert token_key not in attributes(spans[0])


@pytest.mark.parametrize(
    ("endpoint_url", "suffix"),
    [
        ("https://log.aliyuncs.com", "api/v1/traces"),
        ("https://cn-hangzhou.log.aliyuncs.com", "api/v1/traces"),
        ("https://project.cn-heyuan.log.aliyuncs.com/apm/trace/opentelemetry", "api/v1/traces"),
        ("https://project.cn-heyuan-intranet.log.aliyuncs.com/apm/trace/opentelemetry", "api/v1/traces"),
        ("https://cn-shanghai-share.log.aliyuncs.com", "api/v1/traces"),
        ("https://cn-beijing.dualstack.log.aliyuncs.com", "api/v1/traces"),
        ("https://cn-hangzhou.log.aliyuncs.com.:443", "api/v1/traces"),
        ("https://tracing-analysis-dc-hz.aliyuncs.com", "api/otlp/traces"),
        ("https://collector.example.test:4318/custom-prefix", "api/otlp/traces"),
        ("https://evil-log.aliyuncs.com.evil.test", "api/otlp/traces"),
        ("https://log.aliyuncs.com.evil.test", "api/otlp/traces"),
        ("https://evil-log.aliyuncs.com", "api/otlp/traces"),
        ("https://collector.example.test/log.aliyuncs.com", "api/otlp/traces"),
    ],
)
def test_aliyun_endpoint_family_uses_dns_labels_and_preserves_custom_destinations(
    trace: CanonicalTrace, http_calls: list[HTTPCall], endpoint_url: str, suffix: str
) -> None:
    result = export_trace(
        "aliyun", {"endpoint": endpoint_url, "license_key": "synthetic-license", "app_name": "test-app"}, trace
    )
    assert result.status == "accepted"
    assert len(http_calls) == 1
    assert http_calls[0][1] == f"{endpoint_url}/adapt_synthetic-license/{suffix}"
    spans = spans_from_call(http_calls[0])
    assert [span.span_id.hex() for span in spans] == [span.id for span in trace.spans]
    assert spans[1].parent_span_id == spans[0].span_id


def test_aliyun_raw_license_is_encoded_once_at_the_real_otlp_boundary(
    trace: CanonicalTrace, http_calls: list[HTTPCall]
) -> None:
    result = export_trace(
        "aliyun",
        {"endpoint": "https://COLLECTOR.test:8443/prefix/", "license_key": "raw%2F@a+b/c", "app_name": "test_app"},
        trace,
    )
    assert result.status == "accepted"
    assert len(http_calls) == 1
    assert http_calls[0][1] == "https://collector.test:8443/prefix/adapt_raw%252F@a%2Bb%2Fc/api/otlp/traces"
    assert [span.span_id.hex() for span in spans_from_call(http_calls[0])] == [span.id for span in trace.spans]


def test_aliyun_complete_token_url_is_rejected_without_any_ingestion(
    trace: CanonicalTrace, http_calls: list[HTTPCall]
) -> None:
    with pytest.raises(TraceExportRejectedError, match="Aliyun tracing configuration is invalid"):
        export_trace(
            "aliyun",
            {"endpoint": "https://collector.test/adapt_private/api/otlp/traces", "license_key": "private"},
            trace,
        )
    assert http_calls == []


@pytest.mark.parametrize(
    ("provider", "config", "header"),
    [
        (
            "arize",
            {"endpoint": "https://otlp.arize.com", "api_key": "key", "space_id": "space", "project": "one"},
            ("space_id", "space"),
        ),
        (
            "tencent",
            {"endpoint": "https://apm.test:4317", "token": "token", "service_name": "one"},
            ("authorization", "Bearer token"),
        ),
    ],
)
def test_grpc_real_stub_serialization(
    trace: CanonicalTrace,
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    config: dict[str, str],
    header: tuple[str, str],
) -> None:
    calls: list[tuple[ExportTraceServiceRequest, Sequence[tuple[str, str]]]] = []

    class Channel:
        def unary_unary(
            self,
            method: str,
            request_serializer: Callable[[ExportTraceServiceRequest], bytes],
            response_deserializer: Callable[[bytes], ExportTraceServiceResponse],
            **_kwargs: object,
        ) -> Callable[..., ExportTraceServiceResponse]:
            assert method == "/opentelemetry.proto.collector.trace.v1.TraceService/Export"

            def invoke(
                payload: ExportTraceServiceRequest, metadata: Sequence[tuple[str, str]], timeout: float
            ) -> ExportTraceServiceResponse:
                assert timeout == 30
                calls.append((ExportTraceServiceRequest.FromString(request_serializer(payload)), metadata))
                return response_deserializer(ExportTraceServiceResponse().SerializeToString())

            return invoke

        def close(self) -> None:
            pass

    monkeypatch.setattr("grpc.secure_channel", lambda *_args, **_kwargs: Channel())
    result = export_trace(provider, config, trace)
    assert result.status == "accepted"
    assert header in calls[0][1]
    spans = calls[0][0].resource_spans[0].scope_spans[0].spans
    assert spans[1].parent_span_id == spans[0].span_id


def test_langsmith_real_sdk_uses_isolated_sync_runs(trace: CanonicalTrace, http_calls: list[HTTPCall]) -> None:
    result = export_trace(
        "langsmith", {"api_key": "ls-test", "endpoint": "https://langsmith.test", "project": "one"}, trace
    )
    writes = [json.loads(call[2]["content"]) for call in http_calls if call[0] == "POST"]
    assert len(writes) == 3
    root, llm, tool = writes
    assert root["run_type"] == "chain"
    assert llm["run_type"] == "llm"
    assert llm["parent_run_id"] == root["id"]
    assert llm["dotted_order"].startswith(root["dotted_order"])
    assert llm["input_tokens"] == 8
    assert llm["output_tokens"] == 4
    assert llm["total_cost"] == 0.03
    assert "input_tokens" not in root
    assert all(write["extra"]["metadata"]["session_id"] == trace.session_id for write in writes)
    assert tool["error"] == "tool failed"
    assert UUID(result.trace_id)


def test_opik_real_sdk_preserves_tree_thread_and_native_usage(
    trace: CanonicalTrace, http_calls: list[HTTPCall]
) -> None:
    result = export_trace(
        "opik",
        {"api_key": "opik-test", "url": "https://opik.test/api", "workspace": "org-one", "project": "one"},
        trace,
    )
    assert len(http_calls) == 2
    root = json.loads(http_calls[0][2]["content"])
    batch = json.loads(http_calls[1][2]["content"])
    spans = batch["spans"]
    assert UUID(result.trace_id).version == 7
    assert root["thread_id"] == trace.session_id
    assert spans[1]["parent_span_id"] == spans[0]["id"]
    assert spans[1]["usage"]["prompt_tokens"] == 8
    assert spans[1]["total_estimated_cost"] == 0.03
    assert not spans[0].get("usage")
    assert spans[2]["error_info"]["message"] == "tool failed"
    assert http_calls[0][2]["headers"]["comet-workspace"] == "org-one"


@pytest.mark.parametrize(
    ("value", "wire_value"),
    [
        (None, None),
        ("323", "323"),
        ({"result": 323}, {"result": 323}),
        ([{"result": 323}], [{"result": 323}]),
        ([], []),
        (323, "323"),
        (0, "0"),
        (-5, "-5"),
        (3.5, "3.5"),
        (True, "true"),
        (False, "false"),
        ([1, 2], "[1, 2]"),
        (["one", "two"], '["one", "two"]'),
        ([{"result": 1}, "text"], '[{"result": 1}, "text"]'),
        ([[1], [2]], "[[1], [2]]"),
    ],
)
def test_opik_real_sdk_preserves_json_content_across_trace_and_span_boundaries(
    trace: CanonicalTrace, http_calls: list[HTTPCall], value: object, wire_value: object
) -> None:
    content_trace = trace.model_copy(
        update={"spans": tuple(span.model_copy(update={"inputs": value, "outputs": value}) for span in trace.spans)}
    )
    result = export_trace(
        "opik",
        {"api_key": "synthetic-key", "url": "https://opik.test/api", "workspace": "team", "project": "one"},
        content_trace,
    )
    assert result.status == "accepted"
    assert len(http_calls) == 2
    root = json.loads(http_calls[0][2]["content"])
    spans = json.loads(http_calls[1][2]["content"])["spans"]
    for payload in [root, *spans]:
        assert payload.get("input") == wire_value
        assert payload.get("output") == wire_value
    assert spans[1]["parent_span_id"] == spans[0]["id"]
    assert spans[2]["parent_span_id"] == spans[0]["id"]
    assert root["thread_id"] == trace.session_id
    assert spans[1]["usage"]["total_tokens"] == 12
    assert not spans[0].get("usage")
    assert not spans[2].get("usage")


@pytest.mark.parametrize("capture_content", [True, False])
@pytest.mark.parametrize("root_error", [True, False])
def test_opik_trace_error_matches_sanitized_root_and_not_handled_tool_failure(
    trace: CanonicalTrace, http_calls: list[HTTPCall], capture_content: bool, root_error: bool
) -> None:
    root = trace.spans[0].model_copy(
        update={
            "status": CanonicalSpanStatus.ERROR if root_error else CanonicalSpanStatus.OK,
            "error": "private-model-error" if root_error else None,
            "inputs": {"query": "private-error-input"},
        }
    )
    source = trace.model_copy(update={"spans": (root, *trace.spans[1:])})
    canonical = remap_outer_trace(source, trace_id=trace.trace_id, capture_content=capture_content, agent_message=True)
    export_trace(
        "opik",
        {"api_key": "synthetic-key", "url": "https://opik.test/api", "workspace": "team", "project": "one"},
        canonical,
    )
    root_payload = json.loads(http_calls[0][2]["content"])
    spans = json.loads(http_calls[1][2]["content"])["spans"]
    assert spans[2]["error_info"] is not None
    if root_error:
        expected = {
            "exception_type": "DifyExecutionError",
            "message": "private-model-error" if capture_content else "Application execution failed",
            "traceback": "",
        }
        assert root_payload["error_info"] == spans[0]["error_info"] == expected
    else:
        assert root_payload.get("error_info") is None
        assert spans[0].get("error_info") is None
    if not capture_content:
        assert all(b"private-model-error" not in call[2]["content"] for call in http_calls)
        assert all(b"private-error-input" not in call[2]["content"] for call in http_calls)


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, TraceExportRejectedError), (429, RetryableTraceDispatchError), (503, RetryableTraceDispatchError)],
)
def test_explicit_http_rejections_are_classified_without_response_body(
    trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch, status: int, error: type[Exception]
) -> None:
    from core.helper import ssrf_proxy

    monkeypatch.setattr(
        ssrf_proxy,
        "make_request",
        lambda method, url, **_kwargs: httpx.Response(status, text="secret-token", request=httpx.Request(method, url)),
    )
    with pytest.raises(error) as caught:
        export_trace(
            "langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "secret-token"}, trace
        )
    assert "secret-token" not in str(caught.value)


def test_partial_otlp_acceptance_requires_reconciliation(
    trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.helper import ssrf_proxy

    response = ExportTraceServiceResponse()
    response.partial_success.rejected_spans = 1
    monkeypatch.setattr(
        ssrf_proxy,
        "make_request",
        lambda method, url, **_kwargs: httpx.Response(
            200, content=response.SerializeToString(), request=httpx.Request(method, url)
        ),
    )
    with pytest.raises(TraceExportUncertainError):
        export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)


def _langfuse_queue_job_ack() -> dict[str, object]:
    # Synthetic values only. Real acknowledgements contain auth context and must
    # never be logged or persisted as acceptance-test evidence.
    return {
        "name": "otel-ingestion-job",
        "data": {
            "id": "11111111-2222-4333-8444-555555555555",
            "timestamp": "2026-10-15T01:00:00.000Z",
            "name": "otel-ingestion-job",
            "payload": {
                "data": {"fileKey": "otel/test/payload.json", "publicKey": "never-log-public-key"},
                "authCheck": {
                    "validKey": True,
                    "scope": {"projectId": "never-log-project", "accessLevel": "project", "orgId": "test-org"},
                },
                "sdkName": "test-sdk",
                "ingestionVersion": "4",
            },
        },
    }


def _replace_ack_value(ack: dict[str, object], path: tuple[str, ...], value: object) -> None:
    for field in path[:-1]:
        nested = ack[field]
        assert isinstance(nested, dict)
        ack = cast(dict[str, object], nested)
    ack[path[-1]] = value


def test_langfuse_v4_queue_ack_confirms_ingestion_acceptance_only(
    trace: CanonicalTrace,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from core.helper import ssrf_proxy

    monkeypatch.setattr(
        ssrf_proxy,
        "make_request",
        lambda method, url, **_kwargs: httpx.Response(
            200, json=_langfuse_queue_job_ack(), request=httpx.Request(method, url)
        ),
    )
    result = export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)
    assert result.status == "accepted"
    assert result.trace_id == trace.trace_id
    assert result.trace_url is None
    captured = capsys.readouterr()
    evidence = caplog.text + captured.out + captured.err + repr(result)
    assert "never-log-public-key" not in evidence
    assert "never-log-project" not in evidence
    assert "authCheck" not in evidence


@pytest.mark.parametrize(
    "scenario",
    [
        "wrong_name",
        "wrong_nested_name",
        "invalid_id",
        "invalid_timestamp",
        "invalid_auth",
        "missing_scope",
        "missing_file",
        "partial_success",
        "error",
        "failed_job",
        "unknown",
        "null",
        "array",
    ],
)
def test_langfuse_ambiguous_json_ack_remains_uncertain(
    trace: CanonicalTrace,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    scenario: str,
) -> None:
    from core.helper import ssrf_proxy

    ack = _langfuse_queue_job_ack()
    body: object = ack
    if scenario == "wrong_name":
        ack["name"] = "different-job"
    elif scenario == "wrong_nested_name":
        _replace_ack_value(ack, ("data", "name"), "different-job")
    elif scenario == "invalid_id":
        _replace_ack_value(ack, ("data", "id"), "not-a-uuid")
    elif scenario == "invalid_timestamp":
        _replace_ack_value(ack, ("data", "timestamp"), "2026-10-15T01:00:00")
    elif scenario == "invalid_auth":
        _replace_ack_value(ack, ("data", "payload", "authCheck", "validKey"), False)
    elif scenario == "missing_scope":
        _replace_ack_value(ack, ("data", "payload", "authCheck", "scope"), dict[str, object]())
    elif scenario == "missing_file":
        _replace_ack_value(ack, ("data", "payload", "data", "fileKey"), "")
    elif scenario == "partial_success":
        ack["partialSuccess"] = {"rejectedSpans": "1"}
    elif scenario == "error":
        ack["error"] = "never-log-public-key"
    elif scenario == "failed_job":
        ack["failedReason"] = "never-log-public-key"
    elif scenario == "unknown":
        body = {"accepted": True, "publicKey": "never-log-public-key"}
    elif scenario == "null":
        body = None
    elif scenario == "array":
        body = list[object]()
    monkeypatch.setattr(
        ssrf_proxy,
        "make_request",
        lambda method, url, **_kwargs: httpx.Response(
            200,
            content=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            request=httpx.Request(method, url),
        ),
    )
    with pytest.raises(TraceExportUncertainError) as caught:
        export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)
    captured = capsys.readouterr()
    evidence = caplog.text + captured.out + captured.err + str(caught.value)
    assert "never-log-public-key" not in evidence
    assert "never-log-project" not in evidence
    assert "authCheck" not in evidence


@pytest.mark.parametrize(
    ("provider", "version", "status"), [("phoenix", "4", 200), ("langfuse", "3", 200), ("langfuse", "4", 202)]
)
def test_langfuse_queue_ack_is_not_a_generic_otlp_success(
    monkeypatch: pytest.MonkeyPatch, provider: str, version: str, status: int
) -> None:
    from core.helper import ssrf_proxy
    from services.tracing.otlp_export import export_http

    monkeypatch.setattr(
        ssrf_proxy,
        "make_request",
        lambda method, url, **_kwargs: httpx.Response(
            status, json=_langfuse_queue_job_ack(), request=httpx.Request(method, url)
        ),
    )
    with pytest.raises(TraceExportUncertainError):
        export_http(
            provider,
            "https://collector.test/v1/traces",
            {"x-langfuse-ingestion-version": version},
            ExportTraceServiceRequest(),
        )


@pytest.mark.parametrize("body", [{}, {"partialSuccess": {}}, {"partialSuccess": {"rejectedSpans": "1"}}])
def test_langfuse_standard_otlp_json_ack_remains_supported(
    trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch, body: dict[str, dict[str, str]]
) -> None:
    from core.helper import ssrf_proxy

    monkeypatch.setattr(
        ssrf_proxy,
        "make_request",
        lambda method, url, **_kwargs: httpx.Response(200, json=body, request=httpx.Request(method, url)),
    )
    config = {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}
    if body.get("partialSuccess", {}).get("rejectedSpans"):
        with pytest.raises(TraceExportUncertainError):
            export_trace("langfuse", config, trace)
    else:
        assert export_trace("langfuse", config, trace).status == "accepted"


def test_lost_http_ack_is_uncertain_not_rejected(trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch) -> None:
    from core.helper import ssrf_proxy

    def timeout(*_args: object, **_kwargs: object) -> Never:
        raise httpx.ReadTimeout("response lost")

    monkeypatch.setattr(ssrf_proxy, "make_request", timeout)
    with pytest.raises(TraceExportUncertainError):
        export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)


@pytest.mark.parametrize("provider", ["langsmith", "opik"])
@pytest.mark.parametrize("accepted_prefix", [False, True])
def test_native_sdk_preserves_first_failure_or_partial_acceptance(
    trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch, provider: str, accepted_prefix: bool
) -> None:
    from core.helper import ssrf_proxy

    calls: list[str] = []

    def send(method: str, url: str, **_kwargs: object) -> httpx.Response:
        calls.append(url)
        status = 200 if accepted_prefix and len(calls) == 1 else 429
        return httpx.Response(status, content=b"", request=httpx.Request(method, url))

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    config = {"api_key": "test-key", "project": "one", "endpoint": "https://smith.test", "url": "https://opik.test/api"}
    expected = TraceExportUncertainError if accepted_prefix else RetryableTraceDispatchError
    with pytest.raises(expected) as caught:
        export_trace(provider, config, trace)
    assert isinstance(caught.value, TraceExportUncertainError) is accepted_prefix
    assert len(calls) == (2 if accepted_prefix else 1)


def test_http_exports_keep_destination_credentials_local(trace: CanonicalTrace, http_calls: list[HTTPCall]) -> None:
    for project in ("a", "b"):
        export_trace(
            "langfuse", {"host": f"https://{project}.test", "public_key": project, "secret_key": project}, trace
        )
    assert http_calls[0][1].startswith("https://a.test/")
    assert http_calls[1][1].startswith("https://b.test/")
    assert http_calls[0][2]["headers"]["Authorization"] != http_calls[1][2]["headers"]["Authorization"]
    assert http_calls[0][2]["content"] == http_calls[1][2]["content"]


@pytest.mark.parametrize(
    "provider",
    ["langfuse", "langsmith", "phoenix", "arize", "opik", "weave", "mlflow", "databricks", "aliyun", "tencent"],
)
def test_capabilities_state_implemented_contract_not_platform_validation(provider: str) -> None:
    result = provider_capabilities(provider)
    assert result["agent_spans"] is True
    assert result["export_ack"] == "accepted"
    assert "platform_validated" not in result


def test_rejects_unfinished_and_unknown_provider_before_sending(
    trace: CanonicalTrace, http_calls: list[HTTPCall]
) -> None:
    unfinished = trace.model_copy(update={"spans": (trace.spans[0].model_copy(update={"end_time": None}),)})
    with pytest.raises(TraceExportRejectedError):
        export_trace("langfuse", {}, unfinished)
    with pytest.raises(TraceExportRejectedError):
        export_trace("unknown", {}, trace)
    assert not http_calls
