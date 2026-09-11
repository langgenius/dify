import base64
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.common.v1.common_pb2 import AnyValue
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import export_span_id, span_id_bytes
from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan, make_span_id, make_trace_id


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
