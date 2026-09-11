import base64
import json
import ssl
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_config import (
    decrypt_provider_config,
    encrypt_provider_config,
    mask_provider_config,
    resolve_provider_config,
)
from core.ops.provider_export import TraceExportError, basic_auth, export_span_id, span_id_bytes
from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan, copy_trace_value, make_span_id, make_trace_id
from core.rag.models.document import Document
from graphon.variables.segments import ArrayObjectSegment
from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import AppTracingConfigVerificationFailedError


def read_attribute_value(value: AnyValue) -> JsonValue:
    match value.WhichOneof("value"):
        case "kvlist_value":
            return {item.key: read_attribute_value(item.value) for item in value.kvlist_value.values}
        case "array_value":
            return [read_attribute_value(item) for item in value.array_value.values]
        case "int_value":
            return value.int_value
        case "double_value":
            return value.double_value
        case "bool_value":
            return value.bool_value
        case _:
            return value.string_value


def make_trace() -> CompletedTrace:
    tenant_id, operation_id, app_id = (str(uuid4()) for _ in range(3))
    root_id, child_id = (make_span_id(tenant_id, operation_id, name) for name in ("root", "llm"))
    started_at = datetime(2026, 9, 9, 8, tzinfo=UTC)
    return CompletedTrace(
        source=TraceSource(
            tenant_id=tenant_id,
            operation_id=operation_id,
            app_id=app_id,
            actor_id="customer-7",
            session_id="session-5",
            message_id=str(uuid4()),
        ),
        trace_id=make_trace_id(tenant_id, operation_id),
        root_span_id=root_id,
        spans=(
            TraceSpan(
                span_id=root_id,
                span_name="Workflow",
                span_type="workflow",
                source_workflow_version="2026-09-09",
                started_at=started_at,
                ended_at=started_at + timedelta(seconds=3),
                inputs={"query": "Hello"},
                outputs={"answer": "World"},
            ),
            TraceSpan(
                span_id=child_id,
                parent_span_id=root_id,
                span_name="Model",
                span_type="llm",
                started_at=started_at + timedelta(seconds=1),
                ended_at=started_at + timedelta(seconds=2),
                inputs=[{"role": "human", "text": "Rendered prompt"}],
                outputs={"text": "World", "finish_reason": "stop"},
                attributes={
                    "model_name": "gpt-4o",
                    "model_provider": "openai",
                    "model_parameters": {"temperature": 0.2},
                },
                usage={
                    "prompt_tokens": 3,
                    "completion_tokens": 5,
                    "total_tokens": 8,
                    "total_price": "0.02",
                    "time_to_first_token": 0.25,
                },
            ),
        ),
    )


@pytest.mark.parametrize("provider_name", ["mlflow", "databricks"])
def test_project_url_opens_the_provider_trace_view(provider_name: str) -> None:
    config = (
        {"host": "https://tracing.example/", "personal_access_token": "secret", "experiment_id": "7"}
        if provider_name == "databricks"
        else {"tracking_uri": "https://tracing.example/", "experiment_id": "7"}
    )
    client = MLflowTraceClient(provider_name, config)
    expected_path = "/ml/experiments/7/traces" if provider_name == "databricks" else "/#/experiments/7/traces"
    assert client.get_project_url() == "https://tracing.example" + expected_path


@pytest.mark.parametrize(
    ("host", "endpoint"),
    [
        ("adb-123.azuredatabricks.net", "https://adb-123.azuredatabricks.net"),
        ("workspace.cloud.databricks.com:443/prefix/", "https://workspace.cloud.databricks.com/prefix"),
        ("https://workspace.cloud.databricks.com:443/", "https://workspace.cloud.databricks.com"),
        ("http://workspace.example:8080/prefix/", "http://workspace.example:8080/prefix"),
    ],
)
def test_databricks_saved_hosts_preserve_sdk_normalization(host: str, endpoint: str) -> None:
    client = MLflowTraceClient("databricks", {"host": host, "experiment_id": "7", "personal_access_token": "secret"})
    assert client.http.endpoint == endpoint
    assert client.get_project_url() == endpoint + "/ml/experiments/7/traces"
    assert isinstance(client.config, DatabricksConfig)
    assert client.config.host == host


@pytest.mark.parametrize("host", ["", "https:///workspace", "ftp://workspace.example", "user:secret@workspace.example"])
def test_databricks_host_normalization_keeps_endpoint_validation(host: str) -> None:
    with pytest.raises(ValueError):
        MLflowTraceClient("databricks", {"host": host, "experiment_id": "7", "personal_access_token": "secret"})


@pytest.mark.parametrize("host", ["https://databricks.example/", "databricks.example"])
@pytest.mark.parametrize(
    ("response", "error_reason"),
    [
        (httpx.Response(401), "provider_http_401"),
        (httpx.Response(503), "provider_http_503"),
        (httpx.ConnectError("provider unavailable"), "provider_unreachable"),
        (httpx.Response(200, json={"access_token": ""}), "databricks_token_missing"),
    ],
)
def test_databricks_saved_oauth_config_is_readable_but_authentication_failures_reject_writes(
    host: str, response: httpx.Response | httpx.RequestError, error_reason: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    settings = {
        "host": host,
        "experiment_id": "7",
        "client_id": "client",
        "client_secret": "secret",
        "personal_access_token": None,
    }
    encrypted = {**settings, "client_secret": "cipher-secret"}
    request = Mock(side_effect=response) if isinstance(response, Exception) else Mock(return_value=response)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    checks = TraceProviderConfigChecks()
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["secret"]) as decrypt:
        presented = checks.present_config(
            workspace_id=workspace_id, tracing_provider="databricks", tracing_config=encrypted
        )
    decrypt.assert_called_once_with(workspace_id, ["cipher-secret"])
    assert presented == {
        **settings,
        "client_secret": "*" * 20,
        "project_url": "https://databricks.example/ml/experiments/7/traces",
    }
    assert encrypted["client_secret"] == "cipher-secret"
    request.assert_not_called()
    with patch("core.helper.encrypter.encrypt_token") as encrypt:
        with pytest.raises(AppTracingConfigVerificationFailedError) as failure:
            checks.prepare_new_config(workspace_id=workspace_id, tracing_provider="databricks", tracing_config=settings)
    assert isinstance(failure.value.__cause__, TraceExportError)
    assert str(failure.value.__cause__) == error_reason
    encrypt.assert_not_called()
    client = MLflowTraceClient("databricks", settings)
    with pytest.raises(TraceExportError, match=error_reason):
        client.export_trace(make_trace())
    assert request.call_count == 2
    assert all(call.args[:2] == ("POST", "https://databricks.example/oidc/v1/token") for call in request.call_args_list)


@pytest.mark.parametrize("operation", ["verify", "export"])
@pytest.mark.parametrize(
    ("credentials", "oauth"),
    [
        ({"client_id": "client", "client_secret": "secret"}, True),
        ({"client_id": "client", "client_secret": "secret", "personal_access_token": "pat"}, True),
        ({"personal_access_token": "pat"}, False),
        ({"client_id": "client", "personal_access_token": "pat"}, False),
    ],
)
def test_databricks_authenticated_operations_prefer_complete_oauth_credentials(
    operation: str, credentials: dict[str, str], oauth: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    responses = [httpx.Response(200, json={"access_token": "oauth-token"})] if oauth else []
    responses.append(httpx.Response(200, json={}))
    if operation == "export":
        responses.extend(
            [
                httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
                httpx.Response(200),
            ]
        )
    request = Mock(side_effect=responses)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = MLflowTraceClient(
        "databricks", {"host": "https://databricks.example", "experiment_id": "7", **credentials}
    )
    request.assert_not_called()
    if operation == "verify":
        assert client.verify_credentials()
    else:
        client.export_trace(make_trace())
    assert request.call_count == len(responses)
    if oauth:
        token_request = request.call_args_list[0]
        assert token_request.args[:2] == ("POST", "https://databricks.example/oidc/v1/token")
        assert token_request.kwargs["headers"]["Authorization"] == basic_auth("client", "secret")
        assert token_request.kwargs["data"] == {"grant_type": "client_credentials", "scope": "all-apis"}
    api_request = request.call_args_list[int(oauth)]
    assert api_request.kwargs["headers"]["Authorization"] == ("Bearer oauth-token" if oauth else "Bearer pat")


@pytest.mark.parametrize("oauth", [False, True])
@pytest.mark.parametrize("requests_ca", [False, True])
@pytest.mark.parametrize("scheme", ["http", "https"])
def test_databricks_ca_snapshot_covers_api_authentication_and_signed_uploads(
    oauth: bool, requests_ca: bool, scheme: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests_bundle, curl_bundle = tmp_path / "requests.pem", tmp_path / "curl.pem"
    requests_bundle.write_bytes(b"Requests private CA")
    curl_bundle.write_bytes(b"cURL private CA")
    monkeypatch.setenv("CURL_CA_BUNDLE", str(curl_bundle))
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(requests_bundle) if requests_ca else "")
    config = {
        "host": f"{scheme}://workspace.databricks.example",
        "experiment_id": "7",
        **({"client_id": "client", "client_secret": "secret"} if oauth else {"personal_access_token": "pat"}),
    }
    first = resolve_provider_config("databricks", config)
    tls = first["_runtime_settings"]["tls"]
    assert base64.b64decode(tls["certificate"]) == (b"Requests private CA" if requests_ca else b"cURL private CA")
    requests_bundle.write_bytes(b"rotated Requests CA")
    curl_bundle.write_bytes(b"rotated cURL CA")
    assert resolve_provider_config("databricks", config) != first
    requests_bundle.unlink()
    curl_bundle.unlink()
    monkeypatch.setattr(DatabricksConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    api_context, upload_context = ssl.create_default_context(), ssl.create_default_context()
    build_context = Mock(side_effect=[api_context, upload_context] if scheme == "http" else [api_context])
    monkeypatch.setattr("dify_trace_mlflow.mlflow_trace.create_ssl_context", build_context)
    responses = [httpx.Response(200, json={"access_token": "oauth-token"})] if oauth else []
    responses.extend(
        [
            httpx.Response(200, json={}),
            httpx.Response(
                200,
                json={
                    "credential_info": {
                        "signed_uri": "https://storage.example/trace?signature=signed",
                        "headers": [{"name": "x-storage-auth", "value": "upload-secret"}],
                    }
                },
            ),
            httpx.Response(200),
        ]
    )
    requests: list[httpx.Request] = []
    contexts: list[ssl.SSLContext | None] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return responses.pop(0)

    def create_http_client(*, ssl_context: ssl.SSLContext | None = None) -> httpx.Client:
        contexts.append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context or True)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_http_client)
    client = MLflowTraceClient("databricks", first)
    client.export_trace(make_trace())
    assert [call.args for call in build_context.call_args_list] == ([({},), (tls,)] if scheme == "http" else [(tls,)])
    assert all(context is api_context for context in contexts[:-1])
    assert contexts[-1] is (upload_context if scheme == "http" else api_context)
    assert requests[-1].headers["x-storage-auth"] == "upload-secret"
    assert "Authorization" not in requests[-1].headers
    assert str(requests[-1].url) == "https://storage.example/trace?signature=signed"
    assert requests[int(oauth)].headers["Authorization"] == ("Bearer oauth-token" if oauth else "Bearer pat")


def test_databricks_empty_tls_snapshot_prevents_later_environment_reads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = resolve_provider_config("databricks", {"host": "workspace.example", "experiment_id": "7"})
    assert config["_runtime_settings"] == {"sampling_ratio": 1.0, "disabled": False, "tls": {}}
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(tmp_path / "not-readable.pem"))
    client = MLflowTraceClient("databricks", config)
    assert client.http.ssl_context is not None


def test_databricks_captures_requests_ca_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "deadbeef.0").write_bytes(b"private CA")
    (tmp_path / "unrelated.txt").write_text("not a certificate")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(tmp_path))
    settings = DatabricksConfig.load_runtime_settings({"host": "workspace.example", "experiment_id": "7"})
    assert json.loads(settings["tls"]["certificate_directory"]) == {
        "deadbeef.0": base64.b64encode(b"private CA").decode()
    }


@pytest.mark.parametrize("ca_error", ["unreadable", "invalid"])
def test_databricks_http_verification_defers_captured_ca_errors_until_https_upload(
    ca_error: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = tmp_path / "ca.pem"
    if ca_error == "invalid":
        bundle.write_bytes(b"invalid certificate")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(bundle))
    config = resolve_provider_config(
        "databricks", {"host": "http://workspace.example", "experiment_id": "7", "personal_access_token": "pat"}
    )
    if ca_error == "unreadable":
        assert config["_runtime_settings"] == {"sampling_ratio": 1.0, "disabled": False, "tls_read_failed": True}
    assert str(bundle) not in json.dumps(config["_runtime_settings"])
    monkeypatch.setenv("SSL_CERT_FILE", str(tmp_path / "missing-ambient-ca.pem"))
    monkeypatch.setattr(DatabricksConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context or True),
    )
    client = MLflowTraceClient("databricks", config)
    assert client.http.ssl_context is not None
    assert client.verify_credentials()
    with pytest.raises(ValueError if ca_error == "unreadable" else ssl.SSLError):
        client._upload_spans({"signed_uri": "https://storage.example/upload"}, b"{}")
    assert len(requests) == 1
    assert requests[0].url.scheme == "http"


@pytest.mark.parametrize("root_type", ["workflow", "llm"])
@pytest.mark.parametrize("registration_response", [200, 409, 503])
def test_mlflow_native_metadata_registration_retries_preserve_identity_and_attached_children(
    root_type: str, registration_response: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_trace()
    external_id = str(uuid4())
    trace = trace.model_copy(
        update={
            "source": trace.source.model_copy(update={"external_trace_id": external_id}),
            "spans": (trace.spans[0].model_copy(update={"span_type": root_type}), *trace.spans[1:]),
        }
    )
    requests: list[httpx.Request] = []
    saved: dict[str, Any] = {}
    sent: list[ExportTraceServiceRequest] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/v1/traces"):
            assert saved["trace_metadata"]["mlflow.trace.user"] == "customer-7"
            assert saved["trace_metadata"]["mlflow.trace.session"] == "session-5"
            assert "mlflow.trace.tokenUsage" not in saved["trace_metadata"]
            sent.append(ExportTraceServiceRequest.FromString(request.content))
            return httpx.Response(200)
        if request.method == "GET":
            return httpx.Response(200, json={"trace": {"trace_info": saved}}) if saved else httpx.Response(404)
        assert request.method == "POST"
        assert request.url.path == "/api/3.0/mlflow/traces"
        assert not saved, "Retrying a registered trace must preserve its metadata"
        saved.update(json.loads(request.content)["trace"]["trace_info"])
        return httpx.Response(registration_response, json={"trace": {"trace_info": saved}})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context or True),
    )
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "7"})
    if registration_response == 503:
        with pytest.raises(TraceExportError, match="provider_http_503"):
            client.export_trace(trace)
        assert not sent
    receipt = client.export_trace(trace)
    assert saved["trace_id"] == "tr-" + UUID(external_id).hex
    assert saved["client_request_id"] == external_id
    assert saved["trace_metadata"]["dify.operation_id"] == trace.source.operation_id
    assert len(sent) == 1
    assert receipt.spans[trace.root_span_id]["trace_id"] == external_id
    assert client.export_trace(trace) == receipt
    assert len(sent) == 2

    late = make_trace()
    late = late.model_copy(update={"source": late.source.model_copy(update={"actor_id": "other-actor"})})
    requests.clear()
    late_receipt = client.export_trace(late, receipt.spans[trace.root_span_id])
    assert len(requests) == 1
    assert requests[0].url.path == "/v1/traces"
    assert late_receipt.spans[late.root_span_id]["trace_id"] == external_id
    assert all(span.trace_id == UUID(external_id).bytes for span in sent[-1].resource_spans[0].scope_spans[0].spans)

    saved["trace_metadata"]["dify.tenant_id"] = str(uuid4())
    requests.clear()
    with pytest.raises(TraceExportError, match="mlflow_trace_identity_mismatch"):
        client.export_trace(trace)
    assert len(requests) == 1
    assert requests[0].method == "GET"


def test_mlflow_native_llm_format_usage_cost_model_and_grouping(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    external_id = str(uuid4())
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    send = Mock()
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "1"})
    request = Mock(side_effect=[TraceExportError("provider_http_404"), httpx.Response(200)])
    monkeypatch.setattr(client.http, "request", request)
    receipt = client.export_trace(trace)
    info = request.call_args.kwargs["json"]["trace"]["trace_info"]
    assert info["trace_id"] == "tr-" + UUID(external_id).hex
    assert info["client_request_id"] == external_id
    assert info["trace_metadata"]["mlflow.trace.user"] == "customer-7"
    assert info["trace_metadata"]["mlflow.trace.session"] == "session-5"
    assert "mlflow.trace.tokenUsage" not in info["trace_metadata"]
    spans = send.call_args.args[0].resource_spans[0].scope_spans[0].spans
    assert all(span.trace_id == UUID(external_id).bytes for span in spans)
    assert receipt.spans[trace.root_span_id]["trace_id"] == external_id
    attributes = {item.key: item.value for item in spans[-1].attributes}
    assert attributes["user.id"].string_value == "customer-7"
    assert attributes["session.id"].string_value == "session-5"
    assert attributes["mlflow.llm.model"].string_value == "gpt-4o"
    assert attributes["mlflow.llm.provider"].string_value == "openai"
    assert attributes["mlflow.message.format"].string_value == "openai"
    assert read_attribute_value(attributes["mlflow.spanInputs"]) == {
        "messages": [{"role": "user", "content": "Rendered prompt"}],
    }
    assert read_attribute_value(attributes["mlflow.chat.tokenUsage"]) == {
        "input_tokens": 3,
        "output_tokens": 5,
        "total_tokens": 8,
    }
    assert read_attribute_value(attributes["mlflow.llm.cost"]) == {"total_cost": 0.02}


@pytest.mark.parametrize("provider_name", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    ("span_types", "parent_indexes", "model_calls"),
    [
        pytest.param(("workflow", "llm"), (None, 0), 1, id="workflow"),
        pytest.param(("operation", "llm"), (None, 0), 1, id="basic-chat-or-completion"),
        pytest.param(("llm",), (None,), 1, id="standalone-model"),
        pytest.param(("workflow", "node", "llm", "llm"), (None, 0, 1, 1), 2, id="model-retry"),
    ],
)
def test_native_token_usage_counts_model_calls_without_root_or_container_aggregates(
    provider_name: str,
    span_types: tuple[str, ...],
    parent_indexes: tuple[int | None, ...],
    model_calls: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trace = make_trace()
    usage = {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
    aggregate_usage = {key: value * model_calls for key, value in usage.items()}
    span_ids = [
        make_span_id(trace.source.tenant_id, trace.source.operation_id, str(index)) for index in range(len(span_types))
    ]
    spans = tuple(
        trace.spans[1].model_copy(
            update={
                "span_id": span_ids[index],
                "parent_span_id": span_ids[parent_index] if parent_index is not None else None,
                "span_type": span_type,
                "usage": aggregate_usage if index == 0 else usage if span_type == "llm" else {},
                "attributes": {"metrics_from_parent": True}
                if span_type == "llm"
                else {"aggregate_usage": aggregate_usage},
                "status": "error" if span_type == "llm" and index == 2 and model_calls == 2 else "ok",
            }
        )
        for index, (span_type, parent_index) in enumerate(zip(span_types, parent_indexes))
    )
    trace = trace.model_copy(update={"root_span_id": span_ids[0], "spans": spans})
    config = (
        {"host": "https://tracing.example", "personal_access_token": "secret", "experiment_id": "7"}
        if provider_name == "databricks"
        else {"tracking_uri": "https://tracing.example", "experiment_id": "7"}
    )
    client = MLflowTraceClient(provider_name, config)
    if provider_name == "databricks":
        monkeypatch.setattr(
            client.http,
            "request",
            Mock(
                side_effect=[
                    httpx.Response(200, json={}),
                    httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
                ]
            ),
        )
        upload = Mock()
        monkeypatch.setattr(client, "_upload_spans", upload)
        client.export_trace(trace)
        exported_spans = json.loads(upload.call_args.args[1])["spans"]
        span_attributes = [
            {key: json.loads(value) for key, value in span["attributes"].items()} for span in exported_spans
        ]
    else:
        send = Mock()
        monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
        monkeypatch.setattr(
            client.http, "request", Mock(side_effect=[TraceExportError("provider_http_404"), httpx.Response(200)])
        )
        client.export_trace(trace)
        exported_spans = send.call_args.args[0].resource_spans[0].scope_spans[0].spans
        span_attributes = [
            {item.key: read_attribute_value(item.value) for item in span.attributes} for span in exported_spans
        ]
    native_usage = [
        attributes["mlflow.chat.tokenUsage"] for attributes in span_attributes if "mlflow.chat.tokenUsage" in attributes
    ]
    # MLflow 3.11.1's SQL ingestion sums every span carrying this native attribute.
    assert native_usage == [{"input_tokens": 3, "output_tokens": 5, "total_tokens": 8}] * model_calls
    assert span_attributes[0]["dify.usage"] == aggregate_usage
    for span, attributes in zip(spans, span_attributes):
        assert ("mlflow.chat.tokenUsage" in attributes) == (span.span_type == "llm")
        assert attributes["dify.usage"] == span.usage


@pytest.mark.parametrize("provider_name", ["mlflow", "databricks"])
@pytest.mark.parametrize("output_shape", ["workflow", "message", "native"])
@pytest.mark.parametrize("empty", [False, True])
def test_retrieval_exports_native_documents(
    provider_name: str, output_shape: str, empty: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    documents = (
        []
        if empty
        else [
            Document(
                page_content="检索内容\nSecond line",
                metadata={"dataset_id": str(uuid4()), "document_id": str(uuid4()), "score": 0.0, "position": 0},
            ),
            Document(page_content="", metadata={}),
        ]
    )
    expected_outputs = [
        {"page_content": document.page_content, "metadata": document.metadata} for document in documents
    ]
    if output_shape == "workflow":
        outputs = copy_trace_value(
            {
                "result": ArrayObjectSegment(
                    value=[
                        {"content": document.page_content, "metadata": document.metadata, "title": "Knowledge"}
                        for document in documents
                    ]
                )
            }
        )
    elif output_shape == "message":
        outputs = copy_trace_value({"documents": documents})
    else:
        outputs = copy_trace_value(expected_outputs)
    trace = make_trace()
    retrieval = trace.spans[1].model_copy(
        update={"span_name": "Knowledge retrieval", "span_type": "retrieval", "outputs": outputs}
    )
    trace = trace.model_copy(update={"spans": (trace.spans[0], retrieval)})
    config = (
        {"host": "https://tracing.example", "personal_access_token": "secret", "experiment_id": "7"}
        if provider_name == "databricks"
        else {"tracking_uri": "https://tracing.example", "experiment_id": "7"}
    )
    client = MLflowTraceClient(provider_name, config)
    if provider_name == "databricks":
        monkeypatch.setattr(
            client.http,
            "request",
            Mock(
                side_effect=[
                    httpx.Response(200, json={}),
                    httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
                ]
            ),
        )
        upload = Mock()
        monkeypatch.setattr(client, "_upload_spans", upload)
        client.export_trace(trace)
        span = json.loads(upload.call_args.args[1])["spans"][-1]
        attributes = {key: json.loads(value) for key, value in span["attributes"].items()}
    else:
        send = Mock()
        monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
        monkeypatch.setattr(
            client.http, "request", Mock(side_effect=[TraceExportError("provider_http_404"), httpx.Response(200)])
        )
        client.export_trace(trace)
        exported_span = send.call_args.args[0].resource_spans[0].scope_spans[0].spans[-1]
        attributes = {item.key: read_attribute_value(item.value) for item in exported_span.attributes}
    assert attributes["mlflow.spanType"] == "RETRIEVER"
    assert attributes["mlflow.spanOutputs"] == expected_outputs
    assert json.loads(client._attributes(trace, retrieval, trace.trace_id)["dify.outputs"]) == outputs
    assert retrieval.outputs == outputs


def test_databricks_native_grouping_and_valid_parent_link(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    parent_trace_id, parent_span_id = str(uuid4()), str(uuid4())
    parent: dict[str, JsonValue] = {"trace_id": parent_trace_id, "span_id": parent_span_id}
    client = MLflowTraceClient(
        "databricks",
        {
            "host": "https://workspace.databricks.example",
            "experiment_id": "1",
            "personal_access_token": "secret",
        },
    )
    request = Mock(
        side_effect=[
            httpx.Response(200, json={}),
            httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
        ]
    )
    upload = Mock()
    monkeypatch.setattr(client.http, "request", request)
    monkeypatch.setattr(client, "_upload_spans", upload)
    receipt = client.export_trace(trace, parent)
    trace_info = request.call_args_list[0].kwargs["json"]["trace"]["trace_info"]
    metadata = trace_info["trace_metadata"]
    assert metadata["mlflow.trace.user"] == "customer-7"
    assert metadata["mlflow.trace.session"] == "session-5"
    assert metadata["dify.operation_id"] == trace.source.operation_id
    assert metadata["dify.linked_trace_id"] == "tr-" + UUID(parent_trace_id).hex
    assert metadata["dify.linked_parent_span_id"] == span_id_bytes(parent_span_id).hex()
    spans = json.loads(upload.call_args.args[1])["spans"]
    root = spans[0]
    assert root["parent_span_id"] is None
    assert root["links"] == [
        {
            "trace_id": metadata["dify.linked_trace_id"],
            "span_id": metadata["dify.linked_parent_span_id"],
            "attributes": {"dify.relationship": "parent"},
        }
    ]
    assert spans[-1]["links"] == []
    root_receipt_id = receipt.spans[trace.root_span_id]["span_id"]
    assert isinstance(root_receipt_id, str)
    assert base64.b64decode(root["span_id"]) == span_id_bytes(root_receipt_id)
    assert base64.b64decode(spans[-1]["parent_span_id"]) == span_id_bytes(export_span_id(trace, trace.root_span_id))
    assert trace_info["trace_id"] != metadata["dify.linked_trace_id"]


@pytest.mark.parametrize("provider_name", ["mlflow", "databricks"])
@pytest.mark.parametrize(
    ("status", "complete", "expected_errors"),
    [("handled_error", True, [False, True]), ("cancelled", True, [True, True]), ("ok", False, [False, False])],
)
def test_native_status_preserves_handled_node_and_cancelled_workflow_errors(
    provider_name: str, status: str, complete: bool, expected_errors: list[bool], monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_trace()
    trace = trace.model_copy(
        update={
            "spans": tuple(
                span.model_copy(update={"status": status, "error": "execution stopped" if status != "ok" else None})
                for span in trace.spans
            ),
            "complete": complete,
            "truncation": {} if complete else {"reasons": ["span_limit"]},
        }
    )
    config = (
        {"host": "https://tracing.example", "personal_access_token": "secret", "experiment_id": "7"}
        if provider_name == "databricks"
        else {"tracking_uri": "https://tracing.example", "experiment_id": "7"}
    )
    client = MLflowTraceClient(provider_name, config)
    if provider_name == "databricks":
        request = Mock(
            side_effect=[
                httpx.Response(200, json={}),
                httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
            ]
        )
        upload = Mock()
        monkeypatch.setattr(client.http, "request", request)
        monkeypatch.setattr(client, "_upload_spans", upload)
        client.export_trace(trace)
        info = request.call_args_list[0].kwargs["json"]["trace"]["trace_info"]
        assert info["state"] == ("ERROR" if expected_errors[0] else "OK")
        spans = json.loads(upload.call_args.args[1])["spans"]
        assert [span["status"]["code"] == "STATUS_CODE_ERROR" for span in spans] == expected_errors
    else:
        send = Mock()
        monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
        monkeypatch.setattr(
            client.http, "request", Mock(side_effect=[TraceExportError("provider_http_404"), httpx.Response(200)])
        )
        client.export_trace(trace)
        exported_spans = send.call_args.args[0].resource_spans[0].scope_spans[0].spans
        assert [span.status.code == 2 for span in exported_spans] == expected_errors


def test_databricks_external_request_id_is_native_and_internal_identity_is_retained(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trace = make_trace()
    external_id = "tr-" + uuid4().hex
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    client = MLflowTraceClient(
        "databricks",
        {
            "host": "https://workspace.databricks.example",
            "experiment_id": "1",
            "personal_access_token": "secret",
        },
    )
    request = Mock(
        side_effect=[
            httpx.Response(200, json={}),
            httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
        ]
    )
    monkeypatch.setattr(client.http, "request", request)
    monkeypatch.setattr(client, "_upload_spans", Mock())
    client.export_trace(trace)
    info = request.call_args_list[0].kwargs["json"]["trace"]["trace_info"]
    assert info["trace_id"] == info["client_request_id"] == external_id
    assert info["trace_metadata"]["dify.tenant_id"] == trace.source.tenant_id
    assert info["trace_metadata"]["dify.operation_id"] == trace.source.operation_id


@pytest.mark.parametrize("otlp_status", [404, 501])
def test_mlflow_filestore_upload_retry_and_late_operations(otlp_status: int, monkeypatch: pytest.MonkeyPatch) -> None:
    # MLflow 3.11.1's FileStore supports start_trace + artifact upload but
    # inherits AbstractStore.log_spans, which the OTLP route translates to 501.
    trace = make_trace()
    requests: list[httpx.Request] = []
    saved_traces: dict[str, dict[str, Any]] = {}
    artifacts: dict[str, bytes] = {}
    fail_upload = True

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal fail_upload
        requests.append(request)
        assert request.headers["Authorization"] == basic_auth("user", "secret")
        path = request.url.path
        if path.endswith("/v1/traces"):
            return httpx.Response(otlp_status, json={"detail": "REST OTLP span logging is not supported by FileStore"})
        if path.endswith("/experiments/get"):
            return httpx.Response(200, json={"experiment": {"experiment_id": "7"}})
        if path == "/prefix/api/3.0/mlflow/traces" and request.method == "POST":
            info = json.loads(request.content)["trace"]["trace_info"]
            trace_id = info["trace_id"]
            if trace_id in saved_traces:
                # FileStore fallback completes token metadata after native preregistration.
                existing = saved_traces[trace_id]["trace_metadata"]
                assert "mlflow.trace.tokenUsage" not in existing
                assert info["trace_metadata"] == {
                    **existing,
                    "mlflow.trace.tokenUsage": json.dumps(
                        {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8}, separators=(",", ":")
                    ),
                }
            info["tags"]["mlflow.artifactLocation"] = f"mlflow-artifacts:/7/traces/{trace_id}/artifacts"
            saved_traces[trace_id] = info
            return httpx.Response(200, json={"trace": {"trace_info": info}})
        if path.startswith("/prefix/api/3.0/mlflow/traces/") and request.method == "GET":
            info = saved_traces.get(path.rsplit("/", 1)[-1])
            return httpx.Response(200, json={"trace": {"trace_info": info}}) if info else httpx.Response(404)
        if path.startswith("/prefix/api/2.0/mlflow-artifacts/artifacts/") and request.method == "PUT":
            if fail_upload:
                fail_upload = False
                return httpx.Response(503)
            assert path.endswith("/artifacts/traces.json")
            assert request.headers["Content-Type"] == "application/json"
            artifacts[path] = request.content
            return httpx.Response(200, json={})
        pytest.fail(f"Unexpected provider request: {request.method} {path}")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(
            transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False
        ),
    )
    client = MLflowTraceClient(
        "mlflow",
        {
            "tracking_uri": "https://mlflow.example/prefix",
            "experiment_id": "7",
            "username": "user",
            "password": "secret",
        },
    )
    assert client.verify_credentials()
    with pytest.raises(TraceExportError, match="provider_http_503"):
        client.export_trace(trace)
    receipt = client.export_trace(trace)
    original_artifacts = dict(artifacts)
    assert len(saved_traces) == len(artifacts) == 1
    assert json.loads(next(iter(saved_traces.values()))["trace_metadata"]["mlflow.trace.tokenUsage"]) == {
        "input_tokens": 3,
        "output_tokens": 5,
        "total_tokens": 8,
    }
    exported_spans = json.loads(next(iter(artifacts.values())))["spans"]
    assert len(exported_spans) == 2
    assert base64.b64decode(exported_spans[1]["parent_span_id"]) == base64.b64decode(exported_spans[0]["span_id"])
    assert json.loads(exported_spans[1]["attributes"]["mlflow.chat.tokenUsage"])["total_tokens"] == 8
    parent = receipt.spans[trace.root_span_id]
    assert parent["artifact_trace"] is True

    late = make_trace()
    late = late.model_copy(
        update={
            "source": late.source.model_copy(
                update={"tenant_id": trace.source.tenant_id, "app_id": trace.source.app_id}
            )
        }
    )
    requests.clear()
    late_receipt = client.export_trace(late, parent)
    assert not any(request.url.path.endswith("/v1/traces") for request in requests)
    assert parent["trace_id"] != late_receipt.spans[late.root_span_id]["trace_id"]
    assert len(saved_traces) == len(artifacts) == 2
    assert all(artifacts[path] == content for path, content in original_artifacts.items())
    late_info = saved_traces["tr-" + UUID(late.trace_id).hex]
    assert late_info["trace_metadata"]["dify.linked_trace_id"] == "tr-" + UUID(str(parent["trace_id"])).hex

    # An external-ID collision must not rewrite another tenant's trace artifact.
    saved_traces["tr-" + UUID(trace.trace_id).hex]["trace_metadata"]["dify.tenant_id"] = str(uuid4())
    requests.clear()
    with pytest.raises(TraceExportError, match="mlflow_trace_identity_mismatch"):
        client.export_trace(trace)
    assert not any(request.method == "PUT" for request in requests)


@pytest.mark.parametrize("failure_stage", ["create", "end", "upload"])
@pytest.mark.parametrize("auth_source", ["saved", "netrc", "userinfo"])
def test_mlflow_v2_server_ids_retries_and_late_links(
    failure_stage: str, auth_source: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_trace()
    requests: list[httpx.Request] = []
    saved_traces: dict[str, dict[str, Any]] = {}
    artifacts: dict[str, bytes] = {}
    failure_pending = True

    def reply(stage: str, info: dict[str, Any]) -> httpx.Response:
        nonlocal failure_pending
        if failure_pending and failure_stage == stage:
            failure_pending = False
            return httpx.Response(503)
        return httpx.Response(200, json={"trace_info": info})

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["Authorization"] == expected_auth
        assert request.url.userinfo == b""
        assert all(0 < timeout <= 7 for timeout in request.extensions["timeout"].values())
        path = request.url.path
        if path.endswith("/v1/traces") or "/api/3.0/" in path:
            return httpx.Response(404)
        if path == "/prefix/api/2.0/mlflow/traces" and request.method == "GET":
            assert request.url.params.get_list("experiment_ids") == ["7"]
            assert request.url.params["max_results"] == "2"
            matched = []
            for info in saved_traces.values():
                tags = {entry["key"]: entry["value"] for entry in info["tags"]}
                if request.url.params["filter"] == f"tags.`dify.trace_id` = '{tags['dify.trace_id']}'":
                    matched.append(info)
            return httpx.Response(200, json={"traces": matched})
        if path == "/prefix/api/2.0/mlflow/traces" and request.method == "POST":
            info = json.loads(request.content)
            assert info["timestamp_ms"] == "1788940800000"
            assert info["experiment_id"] == "7"
            request_id = uuid4().hex
            info.update(request_id=request_id, status="IN_PROGRESS", execution_time_ms="0")
            info["tags"].append(
                {"key": "mlflow.artifactLocation", "value": f"mlflow-artifacts:/7/traces/{request_id}/artifacts"}
            )
            saved_traces[request_id] = info
            return reply("create", info)
        if path.startswith("/prefix/api/2.0/mlflow/traces/") and request.method == "PATCH":
            body = json.loads(request.content)
            request_id = path.rsplit("/", 1)[-1]
            assert body["request_id"] == request_id
            assert body["timestamp_ms"] == "1788940803000"
            assert body["status"] == "OK"
            saved = saved_traces[request_id]
            saved.update(status=body["status"], execution_time_ms="3000")
            return reply("end", saved)
        if path.startswith("/prefix/api/2.0/mlflow-artifacts/artifacts/") and request.method == "PUT":
            response = reply("upload", {})
            if response.status_code == 200:
                artifacts[path] = request.content
            return response
        pytest.fail(f"Unexpected provider request: {request.method} {path}")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(
            transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False
        ),
    )
    config: dict[str, Any] = {
        "tracking_uri": "https://mlflow.example/prefix",
        "experiment_id": "7",
        "username": "user",
        "password": "secret",
    }
    expected_auth = basic_auth("user", "secret")
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_TIMEOUT", "7")
    filename = tmp_path / ".netrc"
    if auth_source == "netrc":
        filename.write_text("machine mlflow.example login netrc password secret\n")
        expected_auth = basic_auth("netrc", "secret")
    elif auth_source == "userinfo":
        config["tracking_uri"] = "https://url:p%40ss@mlflow.example/prefix"
        expected_auth = basic_auth("url", "p@ss")
    config = resolve_provider_config("mlflow", config)
    filename.unlink(missing_ok=True)
    with pytest.raises(TraceExportError, match="provider_http_503"):
        MLflowTraceClient("mlflow", config).export_trace(trace)
    # A new delivery attempt must recover without state from the old client.
    receipt = MLflowTraceClient("mlflow", config).export_trace(trace)
    assert len(saved_traces) == len(artifacts) == 1
    native_id, saved = next(iter(saved_traces.items()))
    parent = receipt.spans[trace.root_span_id]
    assert parent["native_trace_id"] == native_id
    assert UUID(str(parent["trace_id"])).hex == native_id
    assert native_id != UUID(trace.trace_id).hex
    assert parent["artifact_trace"] is True
    metadata = {entry["key"]: entry["value"] for entry in saved["request_metadata"]}
    assert metadata["dify.operation_id"] == trace.source.operation_id
    assert metadata["dify.client_request_id"] == trace.source.operation_id
    assert json.loads(metadata["mlflow.trace.tokenUsage"])["total_tokens"] == 8
    spans = json.loads(next(iter(artifacts.values())))["spans"]
    assert all(base64.b64decode(span["trace_id"]) == UUID(native_id).bytes for span in spans)
    assert all(json.loads(span["attributes"]["mlflow.traceRequestId"]) == native_id for span in spans)
    assert spans[1]["parent_span_id"] == spans[0]["span_id"]
    assert json.loads(spans[1]["attributes"]["mlflow.llm.model"]) == "gpt-4o"

    original_artifacts = dict(artifacts)
    late = make_trace()
    late = late.model_copy(
        update={
            "source": late.source.model_copy(
                update={"tenant_id": trace.source.tenant_id, "app_id": trace.source.app_id}
            )
        }
    )
    requests.clear()
    late_receipt = MLflowTraceClient("mlflow", config).export_trace(late, parent)
    late_id = str(late_receipt.spans[late.root_span_id]["native_trace_id"])
    assert late_id != native_id
    assert len(saved_traces) == len(artifacts) == 2
    assert not any(request.url.path.endswith("/v1/traces") for request in requests)
    assert all(artifacts[path] == content for path, content in original_artifacts.items())
    late_metadata = {entry["key"]: entry["value"] for entry in saved_traces[late_id]["request_metadata"]}
    assert late_metadata["dify.linked_trace_id"] == native_id
    late_spans = json.loads(
        artifacts[f"/prefix/api/2.0/mlflow-artifacts/artifacts/7/traces/{late_id}/artifacts/traces.json"]
    )["spans"]
    assert late_spans[0]["links"][0]["trace_id"] == native_id

    # A matching deterministic tag alone never grants access to another owner's trace.
    saved["request_metadata"] = [
        {"key": entry["key"], "value": str(uuid4()) if entry["key"] == "dify.tenant_id" else entry["value"]}
        for entry in saved["request_metadata"]
    ]
    requests.clear()
    with pytest.raises(TraceExportError, match="mlflow_trace_identity_mismatch"):
        MLflowTraceClient("mlflow", config).export_trace(trace)
    assert not any(request.method in {"PUT", "PATCH"} for request in requests)
    assert len(saved_traces) == 2


@pytest.mark.parametrize("search_response", [{"traces": [{}, {}]}, {"traces": [], "next_page_token": "more"}])
def test_mlflow_v2_rejects_ambiguous_retry_identity(search_response: dict[str, Any]) -> None:
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example"})
    with (
        patch.object(
            client.http,
            "request",
            side_effect=[
                TraceExportError("provider_http_404"),
                TraceExportError("provider_http_404"),
                httpx.Response(200, json=search_response),
            ],
        ) as request,
        pytest.raises(TraceExportError, match="mlflow_trace_identity_ambiguous"),
    ):
        client._export_artifact_trace(make_trace(), str(uuid4()), None)
    assert request.call_count == 3


@pytest.mark.parametrize("status", [401, 429, 500, 503])
def test_mlflow_does_not_fallback_after_other_otlp_failures(status: int, monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/v1/traces"):
            return httpx.Response(status)
        return httpx.Response(404 if request.method == "GET" else 200)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(
            transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False
        ),
    )
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example"})
    with pytest.raises(TraceExportError, match=f"provider_http_{status}"):
        client.export_trace(make_trace())
    assert len(requests) == 3
    assert requests[-1].url.path == "/v1/traces"


@pytest.mark.parametrize(
    ("artifact_uri", "expected_url"),
    [
        (
            "mlflow-artifacts:/7/traces/trace/artifacts",
            "https://mlflow.example/prefix/api/2.0/mlflow-artifacts/artifacts/7/traces/trace/artifacts/traces.json",
        ),
        ("https://mlflow.example/files/trace", "https://mlflow.example/files/trace/traces.json"),
        ("https://MLFLOW.example:443/files/trace", "https://mlflow.example/files/trace/traces.json"),
        ("https://mlflow.example:444/files/trace", "https://mlflow.example:444/files/trace/traces.json"),
        ("http://mlflow.example:80/files/trace", "http://mlflow.example/files/trace/traces.json"),
        (
            "mlflow-artifacts://artifacts.example/7/trace",
            "https://artifacts.example/prefix/api/2.0/mlflow-artifacts/artifacts/7/trace/traces.json",
        ),
        (
            "https://artifacts.example/trace?signature=upload",
            "https://artifacts.example/trace/traces.json?signature=upload",
        ),
    ],
)
def test_mlflow_artifact_paths_and_credentials(
    artifact_uri: str, expected_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(
            transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False
        ),
    )
    client = MLflowTraceClient(
        "mlflow", {"tracking_uri": "https://mlflow.example/prefix", "username": "user", "password": "secret"}
    )
    client._upload_mlflow_artifact(artifact_uri, b'{"spans": []}')
    assert str(requests[0].url) == expected_url
    assert requests[0].headers["Authorization"] == basic_auth("user", "secret")
    assert requests[0].content == b'{"spans": []}'


def test_mlflow_uses_captured_tls_for_verification_otlp_and_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    server_certificate, client_certificate = tmp_path / "ca.pem", tmp_path / "client.pem"
    server_certificate.write_bytes(b"private CA")
    client_certificate.write_bytes(b"client certificate and key")
    monkeypatch.setenv("MLFLOW_TRACKING_SERVER_CERT_PATH", str(server_certificate))
    monkeypatch.setenv("MLFLOW_TRACKING_CLIENT_CERT_PATH", str(client_certificate))
    monkeypatch.delenv("MLFLOW_TRACKING_INSECURE_TLS", raising=False)
    runtime_settings = MLflowConfig.load_runtime_settings({"tracking_uri": "https://mlflow.example"})
    assert base64.b64decode(runtime_settings["tls"]["certificate"]) == b"private CA"
    assert base64.b64decode(runtime_settings["tls"]["client_certificate"]) == b"client certificate and key"
    assert runtime_settings["verify"] is True
    server_certificate.unlink()
    client_certificate.unlink()
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "true")

    context = ssl.create_default_context()
    build_context = Mock(return_value=context)
    monkeypatch.setattr("dify_trace_mlflow.mlflow_trace.create_ssl_context", build_context)
    contexts: list[ssl.SSLContext | None] = []

    def create_http_client(*, ssl_context: ssl.SSLContext | None = None) -> httpx.Client:
        contexts.append(ssl_context)
        return httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(404 if "/api/3.0/mlflow/traces/" in request.url.path else 200)
            ),
            verify=ssl_context or True,
            trust_env=False,
        )

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_http_client)
    client = MLflowTraceClient(
        "mlflow", {"tracking_uri": "https://mlflow.example", "_runtime_settings": runtime_settings}
    )
    build_context.assert_called_once_with(runtime_settings["tls"], verify=True)
    assert client.verify_credentials()
    client.export_trace(make_trace())
    client._upload_mlflow_artifact("mlflow-artifacts:/trace", b"{}")
    client._upload_mlflow_artifact("https://MLFLOW.example:443/trace", b"{}")
    client._upload_mlflow_artifact("https://artifacts.example/trace", b"{}")
    assert contexts == [context] * 7
    build_context.assert_called_with(runtime_settings["tls"], verify=True)


@pytest.mark.parametrize("insecure", ["true", "TRUE", "1", "false", "FALSE", "0"])
def test_mlflow_direct_clients_preserve_tls_verification_setting(
    insecure: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", insecure)
    monkeypatch.delenv("MLFLOW_TRACKING_SERVER_CERT_PATH", raising=False)
    monkeypatch.delenv("MLFLOW_TRACKING_CLIENT_CERT_PATH", raising=False)
    monkeypatch.delenv("REQUESTS_CA_BUNDLE", raising=False)
    monkeypatch.delenv("CURL_CA_BUNDLE", raising=False)
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example"})
    assert isinstance(client.http.ssl_context, ssl.SSLContext)
    if insecure.lower() in {"true", "1"}:
        assert client.http.ssl_context.verify_mode == ssl.CERT_NONE
        assert client.http.ssl_context.check_hostname is False
    else:
        assert client.http.ssl_context.verify_mode == ssl.CERT_REQUIRED
        assert client.http.ssl_context.check_hostname is True


@pytest.mark.parametrize("scheme", ["http", "https"])
def test_mlflow_rejects_conflicting_or_invalid_tls_settings(scheme: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "true")
    monkeypatch.setenv("MLFLOW_TRACKING_SERVER_CERT_PATH", "/missing/ca.pem")
    with pytest.raises(ValueError, match="cannot be disabled"):
        MLflowConfig.load_runtime_settings({"tracking_uri": f"{scheme}://mlflow.example"})
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "invalid")
    with pytest.raises(ValueError, match="Invalid MLflow TLS verification setting"):
        MLflowConfig.load_runtime_settings({"tracking_uri": f"{scheme}://mlflow.example"})


@pytest.mark.parametrize(
    ("explicit_ca", "requests_ca", "insecure", "expected"),
    [
        (True, True, False, "mlflow"),
        (False, True, False, "requests"),
        (False, False, False, "curl"),
        (False, True, True, None),
    ],
)
def test_mlflow_preserves_requests_ca_bundle_precedence(
    explicit_ca: bool,
    requests_ca: bool,
    insecure: bool,
    expected: str | None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for label, variable, enabled in (
        ("mlflow", "MLFLOW_TRACKING_SERVER_CERT_PATH", explicit_ca),
        ("requests", "REQUESTS_CA_BUNDLE", requests_ca),
        ("curl", "CURL_CA_BUNDLE", True),
    ):
        path = tmp_path / f"{label}.pem"
        path.write_text(label)
        if enabled:
            monkeypatch.setenv(variable, str(path))
        else:
            monkeypatch.delenv(variable, raising=False)
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", str(insecure))
    monkeypatch.delenv("MLFLOW_TRACKING_CLIENT_CERT_PATH", raising=False)
    runtime_settings = MLflowConfig.load_runtime_settings({"tracking_uri": "https://mlflow.example"})
    certificate = runtime_settings["tls"].get("certificate")
    assert (base64.b64decode(certificate).decode() if certificate else None) == expected


def test_mlflow_http_captures_tls_failures_without_blocking_tracking_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_SERVER_CERT_PATH", "/missing/ca.pem")
    monkeypatch.setenv("MLFLOW_TRACKING_CLIENT_CERT_PATH", "/missing/client.pem")
    monkeypatch.delenv("MLFLOW_TRACKING_INSECURE_TLS", raising=False)
    read_files = Mock(side_effect=ValueError("Cannot read TLS configuration"))
    monkeypatch.setattr("dify_trace_mlflow.config.read_tls_files", read_files)
    config = {"tracking_uri": "http://mlflow.example"}
    assert MLflowConfig.load_runtime_settings(config) == {
        "sampling_ratio": 1.0,
        "request_timeout": 120,
        "disabled": False,
        "verify": True,
        "artifact_tls_read_failed": True,
    }
    ssl_context = MLflowTraceClient("mlflow", config).http.ssl_context
    assert isinstance(ssl_context, ssl.SSLContext)
    assert ssl_context.verify_mode == ssl.CERT_REQUIRED
    assert ssl_context.check_hostname is True
    read_files.assert_called_with(
        {"certificate": "/missing/ca.pem", "client_certificate": "/missing/client.pem"}, allow_ca_directory=True
    )


def test_mlflow_explicit_blank_ca_disables_verification_without_ca_bundle_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_SERVER_CERT_PATH", "")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "/missing/requests.pem")
    monkeypatch.setenv("CURL_CA_BUNDLE", "/missing/curl.pem")
    monkeypatch.setenv("MLFLOW_TRACKING_INSECURE_TLS", "false")
    monkeypatch.delenv("MLFLOW_TRACKING_CLIENT_CERT_PATH", raising=False)
    config = {"tracking_uri": "https://mlflow.example"}
    assert MLflowConfig.load_runtime_settings(config) == {
        "sampling_ratio": 1.0,
        "request_timeout": 120,
        "disabled": False,
        "verify": False,
        "tls": {},
    }
    ssl_context = MLflowTraceClient("mlflow", config).http.ssl_context
    assert ssl_context is not None
    assert ssl_context.verify_mode == ssl.CERT_NONE
    assert ssl_context.check_hostname is False


@pytest.mark.parametrize("ca_setting", ["MLFLOW_TRACKING_SERVER_CERT_PATH", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"])
def test_mlflow_captures_ca_directory_before_delivery(
    ca_setting: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for setting in (
        "MLFLOW_TRACKING_SERVER_CERT_PATH",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "MLFLOW_TRACKING_CLIENT_CERT_PATH",
        "MLFLOW_TRACKING_INSECURE_TLS",
    ):
        monkeypatch.delenv(setting, raising=False)
    certificate_file = tmp_path / "01234567.0"
    certificate_file.write_bytes(b"captured certificate")
    monkeypatch.setenv(ca_setting, str(tmp_path))
    config: dict[str, Any] = {"tracking_uri": "https://mlflow.example"}
    runtime_settings = MLflowConfig.load_runtime_settings(config)
    certificates = json.loads(runtime_settings["tls"]["certificate_directory"])
    assert base64.b64decode(certificates[certificate_file.name]) == b"captured certificate"
    certificate_file.unlink()
    config["_runtime_settings"] = runtime_settings
    ssl_context = MLflowTraceClient("mlflow", config).http.ssl_context
    assert ssl_context is not None
    assert ssl_context.verify_mode == ssl.CERT_REQUIRED


def test_mlflow_optional_credentials_do_not_call_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    encrypt = Mock()
    decrypt = Mock()
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    monkeypatch.setattr("core.helper.encrypter.batch_decrypt_token", decrypt)
    settings = {"tracking_uri": "https://mlflow.example", "experiment_id": "1"}
    saved = encrypt_provider_config(str(uuid4()), "mlflow", settings)
    assert saved["password"] is None
    assert mask_provider_config("mlflow", saved) == saved
    assert decrypt_provider_config(str(uuid4()), "mlflow", saved) == saved
    encrypt.assert_not_called()
    decrypt.assert_not_called()
