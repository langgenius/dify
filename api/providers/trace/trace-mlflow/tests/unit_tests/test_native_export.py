import base64
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.common.v1.common_pb2 import AnyValue
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient
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
    ("response", "error_reason"),
    [
        (httpx.Response(401), "provider_http_401"),
        (httpx.Response(503), "provider_http_503"),
        (httpx.ConnectError("provider unavailable"), "provider_unreachable"),
        (httpx.Response(200, json={"access_token": ""}), "databricks_token_missing"),
    ],
)
def test_databricks_saved_oauth_config_is_readable_but_authentication_failures_reject_writes(
    response: httpx.Response | httpx.RequestError, error_reason: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    settings = {
        "host": "https://databricks.example/",
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


def test_mlflow_native_llm_format_usage_cost_model_and_grouping(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    external_id = str(uuid4())
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    send = Mock()
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "1"})
    receipt = client.export_trace(trace)
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
