"""Exercise real vendor serializers and OTLP stubs at their network boundary."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.provider_dispatch import (
    TraceExportRejectedError,
    TraceExportUncertainError,
    export_trace,
    provider_capabilities,
)


@pytest.fixture
def trace():
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
def http_calls(monkeypatch):
    from core.helper import ssrf_proxy

    calls = []

    def send(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return httpx.Response(200, content=b"", request=httpx.Request(method, url))

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    return calls


def spans_from_call(call):
    request = ExportTraceServiceRequest.FromString(call[2]["content"])
    return list(request.resource_spans[0].scope_spans[0].spans)


def attributes(span):
    return {item.key: getattr(item.value, item.value.WhichOneof("value")) for item in span.attributes}


def test_langfuse_v4_tree_and_native_usage(trace, http_calls):
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
    assert json.loads(llm["langfuse.observation.usage_details"]) == {"input": 8, "output": 4, "total": 12}
    assert json.loads(llm["langfuse.observation.cost_details"]) == {"total": 0.03}
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
def test_other_http_providers_have_native_semantics(trace, http_calls, provider, config, suffix, kind_key, kind):
    result = export_trace(provider, config, trace)
    assert result.status == "accepted"
    assert http_calls[0][1].endswith(suffix)
    spans = spans_from_call(http_calls[0])
    assert attributes(spans[0])[kind_key] == kind
    token_key = "llm.token_count.prompt" if provider == "phoenix" else "gen_ai.usage.input_tokens"
    assert attributes(spans[1])[token_key] == 8
    assert token_key not in attributes(spans[0])


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
def test_grpc_real_stub_serialization(trace, monkeypatch, provider, config, header):
    import grpc

    calls = []

    class Channel:
        def unary_unary(self, method, request_serializer, response_deserializer, **_kwargs):
            assert method == "/opentelemetry.proto.collector.trace.v1.TraceService/Export"

            def invoke(payload, metadata, timeout):
                assert timeout == 30
                calls.append((ExportTraceServiceRequest.FromString(request_serializer(payload)), metadata))
                return response_deserializer(ExportTraceServiceResponse().SerializeToString())

            return invoke

        def close(self):
            pass

    monkeypatch.setattr(grpc, "secure_channel", lambda *_args, **_kwargs: Channel())
    result = export_trace(provider, config, trace)
    assert result.status == "accepted"
    assert header in calls[0][1]
    spans = calls[0][0].resource_spans[0].scope_spans[0].spans
    assert spans[1].parent_span_id == spans[0].span_id


def test_langsmith_real_sdk_uses_isolated_sync_runs(trace, http_calls):
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


def test_opik_real_sdk_preserves_tree_thread_and_native_usage(trace, http_calls):
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
    ("status", "error"),
    [(401, TraceExportRejectedError), (429, RetryableTraceDispatchError), (503, RetryableTraceDispatchError)],
)
def test_explicit_http_rejections_are_classified_without_response_body(trace, monkeypatch, status, error):
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


def test_partial_otlp_acceptance_requires_reconciliation(trace, monkeypatch):
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


def _langfuse_queue_job_ack():
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


def test_langfuse_v4_queue_ack_confirms_ingestion_acceptance_only(trace, monkeypatch, caplog, capsys):
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
def test_langfuse_ambiguous_json_ack_remains_uncertain(trace, monkeypatch, caplog, capsys, scenario):
    from core.helper import ssrf_proxy

    body = _langfuse_queue_job_ack()
    if scenario == "wrong_name":
        body["name"] = "different-job"
    elif scenario == "wrong_nested_name":
        body["data"]["name"] = "different-job"
    elif scenario == "invalid_id":
        body["data"]["id"] = "not-a-uuid"
    elif scenario == "invalid_timestamp":
        body["data"]["timestamp"] = "2026-10-15T01:00:00"
    elif scenario == "invalid_auth":
        body["data"]["payload"]["authCheck"]["validKey"] = False
    elif scenario == "missing_scope":
        body["data"]["payload"]["authCheck"]["scope"] = {}
    elif scenario == "missing_file":
        body["data"]["payload"]["data"]["fileKey"] = ""
    elif scenario == "partial_success":
        body["partialSuccess"] = {"rejectedSpans": "1"}
    elif scenario == "error":
        body["error"] = "never-log-public-key"
    elif scenario == "failed_job":
        body["failedReason"] = "never-log-public-key"
    elif scenario == "unknown":
        body = {"accepted": True, "publicKey": "never-log-public-key"}
    elif scenario == "null":
        body = None
    elif scenario == "array":
        body = []
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
def test_langfuse_queue_ack_is_not_a_generic_otlp_success(monkeypatch, provider, version, status):
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
def test_langfuse_standard_otlp_json_ack_remains_supported(trace, monkeypatch, body):
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


def test_lost_http_ack_is_uncertain_not_rejected(trace, monkeypatch):
    from core.helper import ssrf_proxy

    def timeout(*_args, **_kwargs):
        raise httpx.ReadTimeout("response lost")

    monkeypatch.setattr(ssrf_proxy, "make_request", timeout)
    with pytest.raises(TraceExportUncertainError):
        export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)


@pytest.mark.parametrize("provider", ["langsmith", "opik"])
@pytest.mark.parametrize("accepted_prefix", [False, True])
def test_native_sdk_preserves_first_failure_or_partial_acceptance(trace, monkeypatch, provider, accepted_prefix):
    from core.helper import ssrf_proxy

    calls = []

    def send(method, url, **_kwargs):
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


def test_http_exports_keep_destination_credentials_local(trace, http_calls):
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
def test_capabilities_state_implemented_contract_not_platform_validation(provider):
    result = provider_capabilities(provider)
    assert result["agent_spans"] is True
    assert result["export_ack"] == "accepted"
    assert "platform_validated" not in result


def test_rejects_unfinished_and_unknown_provider_before_sending(trace, http_calls):
    unfinished = trace.model_copy(update={"spans": (trace.spans[0].model_copy(update={"end_time": None}),)})
    with pytest.raises(TraceExportRejectedError):
        export_trace("langfuse", {}, unfinished)
    with pytest.raises(TraceExportRejectedError):
        export_trace("unknown", {}, trace)
    assert not http_calls
