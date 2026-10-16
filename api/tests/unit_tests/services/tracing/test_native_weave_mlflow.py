"""Real SDK schema/serialization boundaries with HTTP transport substituted.

These tests do not claim acceptance by a live third-party account.
"""

import base64
import json
import os
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import TypedDict, Unpack

import httpx
import pytest
from mlflow.entities import Span, TraceData
from mlflow.tracing.constant import SpanAttributeKey
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from core.helper import ssrf_proxy
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.provider_dispatch import TraceExportUncertainError, export_trace


class TransportOptions(TypedDict, total=False):
    content: bytes | str
    headers: Mapping[str, str]
    auth: tuple[str, str]
    max_retries: int


@pytest.fixture
def trace() -> CanonicalTrace:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    root = CanonicalSpan(
        id="0000000000000001",
        parent_id=None,
        name="Agent",
        kind=CanonicalSpanKind.AGENT,
        start_time=start,
        end_time=start + timedelta(seconds=2),
        inputs={"query": "hello"},
        outputs="answer",
        status=CanonicalSpanStatus.OK,
        metadata={"total_price": 999, "total_tokens": 999},
    )
    child = CanonicalSpan(
        id="0000000000000002",
        parent_id=root.id,
        name="Model",
        kind=CanonicalSpanKind.LLM,
        start_time=start,
        end_time=start + timedelta(seconds=1),
        inputs={"prompt": "hello"},
        outputs="answer",
        status=CanonicalSpanStatus.OK,
        metadata={
            "model_name": "test-model",
            "prompt_tokens": 2,
            "completion_tokens": 3,
            "total_tokens": 5,
            "total_price": "0.01",
            "currency": "USD",
        },
    )
    return CanonicalTrace(
        trace_id="1234567890abcdef1234567890abcdef", session_id="session-1", root_span_id=root.id, spans=(root, child)
    )


def _response(url: str, *, body: object = None, content: bytes | None = None, status: int = 200) -> httpx.Response:
    request = httpx.Request("POST", url)
    if content is not None:
        return httpx.Response(status, request=request, content=content)
    return httpx.Response(status, request=request, json=body or {})


@pytest.mark.parametrize("host", ["https://api.wandb.ai", "https://API.WANDB.AI:443"])
def test_weave_sdk_exports_tree_session_usage_without_global_credentials(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, host: str
) -> None:
    calls = []
    before = dict(os.environ)

    def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
        body = json.loads(kwargs["content"])
        calls.append((_method, url, kwargs, body))
        start = body.get("start")
        return _response(url, body={"id": start["id"], "trace_id": start["trace_id"]} if start else {})

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    result = export_trace("weave", {"api_key": "tenant-key", "entity": "team", "project": "demo", "host": host}, trace)
    assert len(calls) == 4
    root, child = calls[0][3]["start"], calls[1][3]["start"]
    assert child["parent_id"] == root["id"]
    assert child["thread_id"] == root["thread_id"] == "session-1"
    assert calls[2][3]["end"]["summary"]["usage"]["test-model"]["total_tokens"] == 5
    assert calls[3][3]["end"]["summary"] == {}
    assert result.trace_url == f"https://wandb.ai/team/demo/r/call/{root['id']}"
    assert result.span_urls[trace.spans[1].id].endswith(child["id"])
    assert all(call[2]["auth"] == ("api", "tenant-key") and call[2]["max_retries"] == 0 for call in calls)
    assert dict(os.environ) == before


def test_weave_resolves_optional_entity_using_only_supplied_credentials(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
) -> None:
    def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
        assert kwargs["auth"] == ("api", "tenant-key")
        if url.endswith("/graphql"):
            return _response(url, body={"data": {"viewer": {"entity": "default-team"}}})
        body = json.loads(kwargs["content"])
        if start := body.get("start"):
            assert start["project_id"] == "default-team/demo"
            return _response(url, body={"id": start["id"], "trace_id": start["trace_id"]})
        return _response(url)

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    result = export_trace("weave", {"api_key": "tenant-key", "project": "demo"}, trace)
    assert result.trace_url is not None
    assert "/default-team/demo/" in result.trace_url


def test_weave_partial_tree_is_uncertain_and_not_retried(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
) -> None:
    calls = []

    def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
        calls.append(url)
        if len(calls) > 1:
            return _response(url, status=503)
        start = json.loads(kwargs["content"])["start"]
        return _response(url, body={"id": start["id"], "trace_id": start["trace_id"]})

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    with pytest.raises(TraceExportUncertainError, match="partially accepted"):
        export_trace("weave", {"api_key": "secret", "entity": "team", "project": "demo"}, trace)
    assert len(calls) == 2


def test_mlflow_sdk_span_roundtrip_and_credential_isolation(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
) -> None:
    calls = []
    before = dict(os.environ)

    def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
        calls.append((url, kwargs))
        return _response(url, content=b"")

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    for username in ("tenant-a", "tenant-b"):
        result = export_trace(
            "mlflow",
            {
                "tracking_uri": "https://mlflow.example",
                "experiment_id": "42",
                "username": username,
                "password": "password",
            },
            trace,
        )
        assert result.trace_id == "tr-" + trace.trace_id
    for index, (url, options) in enumerate(calls):
        assert url == "https://mlflow.example/v1/traces"
        assert options["headers"]["x-mlflow-experiment-id"] == "42"
        assert (
            options["headers"]["Authorization"]
            == "Basic " + base64.b64encode(f"tenant-{'a' if index == 0 else 'b'}:password".encode()).decode()
        )
        content = options["content"]
        assert isinstance(content, bytes)
        payload = ExportTraceServiceRequest.FromString(content)
        spans = [Span.from_otel_proto(span) for span in payload.resource_spans[0].scope_spans[0].spans]
        assert spans[1].parent_id == spans[0].span_id
        assert spans[1].get_attribute(SpanAttributeKey.CHAT_USAGE) == {
            "input_tokens": 2,
            "output_tokens": 3,
            "total_tokens": 5,
        }
        assert spans[1].get_attribute(SpanAttributeKey.LLM_COST) == {"total_cost": 0.01}
        assert spans[0].get_attribute(SpanAttributeKey.CHAT_USAGE) is None
        assert spans[0].get_attribute(SpanAttributeKey.SESSION_ID) == "session-1"
    assert dict(os.environ) == before


def test_mlflow_partial_otlp_ack_is_uncertain(monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace) -> None:
    ack = ExportTraceServiceResponse()
    ack.partial_success.rejected_spans = 1
    monkeypatch.setattr(
        ssrf_proxy, "make_request", lambda _method, url, **_kwargs: _response(url, content=ack.SerializeToString())
    )
    with pytest.raises(TraceExportUncertainError, match="partially accepted"):
        export_trace("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "42"}, trace)


@pytest.mark.parametrize(
    "credential_type", ["AWS_PRESIGNED_URL", "GCP_SIGNED_URL", "AZURE_SAS_URI", "AZURE_ADLS_GEN2_SAS_URI"]
)
@pytest.mark.parametrize("oauth", [False, True])
def test_databricks_sdk_v3_metadata_and_native_artifact(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, credential_type: str, oauth: bool
) -> None:
    calls: list[tuple[str, str, TransportOptions]] = []
    uploaded: list[TraceData] = []
    before = dict(os.environ)

    def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
        calls.append((_method, url, kwargs))
        if url.endswith("/oidc/v1/token"):
            assert kwargs["auth"] == ("client", "client-secret")
            return _response(url, body={"access_token": "oauth-token"})
        if url.endswith("/api/3.0/mlflow/traces"):
            assert kwargs["headers"]["Authorization"] == ("Bearer oauth-token" if oauth else "Bearer pat-token")
            body = json.loads(kwargs["content"])
            assert body["trace"]["trace_info"]["trace_metadata"]["mlflow.trace.session"] == "session-1"
            return _response(url, body=body)
        if url.endswith("/credentials-for-data-upload"):
            return _response(
                url,
                body={
                    "credential_info": {
                        "signed_uri": "https://storage.example/trace?sig=fake",
                        "type": credential_type,
                        "headers": [],
                    }
                },
            )
        assert "Authorization" not in kwargs["headers"]
        if kwargs.get("content"):
            uploaded.append(TraceData.from_dict(json.loads(kwargs["content"])))
        return _response(url)

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    config = {"host": "https://databricks.example", "experiment_id": "42"}
    config.update(
        {"client_id": "client", "client_secret": "client-secret"} if oauth else {"personal_access_token": "pat-token"}
    )
    result = export_trace("databricks", config, trace)
    assert result.trace_id == "tr-" + trace.trace_id
    data = uploaded[0]
    assert len(data.spans) == 2
    assert data.spans[1].parent_id == data.spans[0].span_id
    usage = data.spans[1].get_attribute(SpanAttributeKey.CHAT_USAGE)
    assert usage is not None
    assert usage["total_tokens"] == 5
    assert data.spans[1].get_attribute(SpanAttributeKey.LLM_COST) == {"total_cost": 0.01}
    assert dict(os.environ) == before
    assert len(calls) == 3 + int(oauth) + int(credential_type == "AZURE_ADLS_GEN2_SAS_URI")


def test_databricks_partial_metadata_delivery_is_uncertain(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
) -> None:
    def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
        if url.endswith("/api/3.0/mlflow/traces"):
            return _response(url, body=json.loads(kwargs["content"]))
        return _response(url, status=503)

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    with pytest.raises(TraceExportUncertainError, match="metadata"):
        export_trace(
            "databricks",
            {"host": "https://databricks.example", "experiment_id": "42", "personal_access_token": "secret"},
            trace,
        )


@pytest.mark.parametrize("provider", ["weave", "databricks"])
def test_success_status_with_unreadable_ack_is_uncertain(
    monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, provider: str
) -> None:
    monkeypatch.setattr(ssrf_proxy, "make_request", lambda _method, url, **_kwargs: _response(url, content=b"not-json"))
    config = {
        "api_key": "secret",
        "entity": "team",
        "project": "demo",
        "host": "https://example.com",
        "experiment_id": "42",
        "personal_access_token": "secret",
    }
    with pytest.raises(TraceExportUncertainError, match="unreadable"):
        export_trace(provider, config, trace)
