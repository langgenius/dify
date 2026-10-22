"""Persisted legacy sources through real OTel protobuf, replacing only HTTP I/O."""

import json
import os
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Barrier, Thread
from typing import TypedDict, Unpack
from uuid import UUID

import httpx
import pytest
from dify_trace_aliyun.aliyun_trace import AliyunDataTrace
from dify_trace_aliyun.config import AliyunConfig
from dify_trace_aliyun.data_exporter.traceclient import TraceClient, convert_to_span_id
from dify_trace_aliyun.entities.aliyun_trace_entity import SpanData
from dify_trace_aliyun.entities.semconv import GEN_AI_USAGE_TOTAL_TOKENS
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from sqlalchemy.orm import Session

from core.helper import ssrf_proxy
from core.ops.entities.trace_entity import MessageTraceInfo, ModerationTraceInfo, WorkflowTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus
from models.model import AppMode
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
    WorkflowType,
)
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError
from tests.unit_tests.model_factories import make_account, make_app, make_message, make_tenant

START = datetime(2026, 10, 19, tzinfo=UTC)
RUN_ID = "a0000000-0000-4000-8000-000000000001"
MESSAGE_ID = "a0000000-0000-4000-8000-000000000002"
NODE_IDS = [f"b0000000-0000-4000-8000-00000000000{i}" for i in range(3)]


class RequestOptions(TypedDict, total=False):
    content: bytes
    headers: Mapping[str, str]
    max_retries: int
    follow_redirects: bool
    timeout: float


def config(**overrides: object) -> AliyunConfig:
    return AliyunConfig.model_validate(
        {
            "app_name": "owned-service",
            "license_key": "owned-key",
            "endpoint": "https://collector.test/prefix",
            **overrides,
        }
    )


def decoded(options: RequestOptions) -> ExportTraceServiceRequest:
    payload = ExportTraceServiceRequest()
    payload.ParseFromString(options["content"])
    return payload


def test_constructor_and_presentation_have_no_network_sdk_queue_or_environment_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Constructor and presentation must not create I/O, exporters or worker threads")

    monkeypatch.setattr(ssrf_proxy, "make_request", forbidden)
    monkeypatch.setattr(OTLPSpanExporter, "__init__", forbidden)
    monkeypatch.setattr(Thread, "start", forbidden)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://ambient.test")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=ambient")
    before = dict(os.environ)
    original = config()
    adapter = AliyunDataTrace(original)
    original.license_key = "mutated-after-construction"
    assert adapter.trace_client.endpoint == "https://collector.test/prefix/adapt_owned-key/api/otlp/traces"
    assert adapter.get_project_url() == "https://arms.console.aliyun.com/#/llm"
    assert not hasattr(adapter.trace_client, "exporter")
    assert not hasattr(adapter.trace_client, "queue")
    assert not hasattr(adapter.trace_client, "worker_thread")
    assert dict(os.environ) == before


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("failure", [None, 400, 401, 403, 429, 503, "timeout", "partial", "malformed", "redirect"])
def test_persisted_workflow_uses_one_acknowledged_protobuf_batch_and_preserves_business_state(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, failure: int | str | None
) -> None:
    tenant = make_tenant(tenant_id="tenant")
    account = make_account(account_id="owner", tenant=tenant)
    app = make_app(app_id="app", tenant_id=tenant.id, mode=AppMode.WORKFLOW, created_by=account.id)
    membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER)
    run = WorkflowRun(
        id=RUN_ID,
        tenant_id=tenant.id,
        app_id=app.id,
        workflow_id="workflow",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="v1",
        inputs=json.dumps({"query": "hello"}),
        outputs=json.dumps({"answer": "ok"}),
        status=WorkflowExecutionStatus.SUCCEEDED,
        total_tokens=32,
        created_by=account.id,
        created_by_role=CreatorUserRole.ACCOUNT,
        finished_at=START + timedelta(seconds=1),
        elapsed_time=1,
    )
    run.created_at = START
    sqlite_session.add_all([tenant, account, app, membership, run])
    nodes = [
        WorkflowNodeExecutionModel(
            id=NODE_IDS[i],
            tenant_id=tenant.id,
            app_id=app.id,
            workflow_id="workflow",
            workflow_run_id=RUN_ID,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            index=i,
            node_id=f"node-{i}",
            title=title,
            node_type=kind,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_by=account.id,
            created_by_role=CreatorUserRole.ACCOUNT,
            inputs=json.dumps({"synthetic": True}),
            outputs=json.dumps(
                {"text": "ok", "usage": {"prompt_tokens": 21, "completion_tokens": 11, "total_tokens": 32}}
            ),
            finished_at=START + timedelta(milliseconds=i + 100),
            elapsed_time=0.1,
            process_data=json.dumps(
                {"prompts": [{"role": "user", "text": "hello"}], "model_provider": "test", "model_name": "test-model"}
            )
            if i == 1
            else None,
        )
        for i, (title, kind) in enumerate(
            [("Start", BuiltinNodeTypes.START), ("LLM", BuiltinNodeTypes.LLM), ("End", BuiltinNodeTypes.END)]
        )
    ]
    for trace_node_index, trace_node_record in enumerate(nodes):
        trace_node_record.created_at = START + timedelta(milliseconds=trace_node_index)
    sqlite_session.add_all(nodes)
    sqlite_session.commit()
    info = WorkflowTraceInfo(
        query="hello",
        workflow_id="workflow",
        tenant_id=tenant.id,
        workflow_run_id=RUN_ID,
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={"query": "hello"},
        workflow_run_outputs={"answer": "ok"},
        workflow_run_version="v1",
        total_tokens=32,
        file_list=[],
        metadata={"app_id": app.id, "conversation_id": "owned-conversation"},
        start_time=START,
        end_time=START + timedelta(seconds=1),
    )
    sent: list[tuple[str, RequestOptions, ExportTraceServiceRequest]] = []

    def send(method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        assert method == "POST"
        assert url == "https://collector.test/prefix/adapt_owned-key/api/otlp/traces"
        sent.append((url, options, decoded(options)))
        if len(sent) == 1:
            if failure == "timeout":
                raise httpx.ReadTimeout("synthetic lost ACK", request=httpx.Request("POST", url))
            if isinstance(failure, int):
                return httpx.Response(failure, content=b"DO_NOT_EXPOSE_BODY")
            if failure == "malformed":
                return httpx.Response(200, content=b"not protobuf")
            if failure == "partial":
                response = ExportTraceServiceResponse()
                response.partial_success.rejected_spans = 1
                response.partial_success.error_message = "DO_NOT_EXPOSE_BODY"
                return httpx.Response(200, content=response.SerializeToString())
            if failure == "redirect":
                return httpx.Response(307, headers={"Location": "https://unrelated.test"})
        return httpx.Response(200, content=ExportTraceServiceResponse().SerializeToString())

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    adapter = AliyunDataTrace(config())
    if failure is None:
        adapter.trace(info)
    else:
        expected = (
            RetryableTraceDispatchError
            if failure in {429, 503}
            else TraceExportUncertainError
            if failure in {"timeout", "partial", "malformed"}
            else TraceExportRejectedError
        )
        with pytest.raises(expected) as error:
            adapter.trace(info)
        assert "DO_NOT_EXPOSE_BODY" not in str(error.value)
        if isinstance(error.value, RetryableTraceDispatchError):
            assert error.value.acceptance_unknown is (expected is TraceExportUncertainError)
    assert len(sent) == 1  # No SDK retry, per-span request, batching thread or silent queue success.
    _, options, payload = sent[0]
    assert options["max_retries"] == 0
    assert options["follow_redirects"] is False
    assert options["headers"] == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}
    resource = payload.resource_spans[0]
    attributes = {item.key: item.value for item in resource.resource.attributes}
    assert attributes["service.name"].string_value == "owned-service"
    spans = list(resource.scope_spans[0].spans)
    assert len(spans) == 4
    assert [s.name for s in spans] == ["workflow", "Start", "LLM", "End"]
    root_id = convert_to_span_id(RUN_ID, "workflow").to_bytes(8)
    assert [s.span_id for s in spans] == [root_id, *[convert_to_span_id(i, "node").to_bytes(8) for i in NODE_IDS]]
    assert all(s.trace_id == UUID(RUN_ID).bytes for s in spans)
    assert [s.parent_span_id for s in spans] == [b"", root_id, root_id, root_id]
    assert spans[0].start_time_unix_nano == int(START.timestamp() * 1_000_000_000)
    assert spans[0].end_time_unix_nano == int((START + timedelta(seconds=1)).timestamp() * 1_000_000_000)
    model_attributes = {item.key: item.value for item in spans[2].attributes}
    assert model_attributes[GEN_AI_USAGE_TOTAL_TOKENS].string_value == "32"
    assert all(s.status.code == 1 for s in spans)
    assert adapter.trace_client._dispatch_spans.get() is None
    assert info.workflow_run_status == "succeeded"
    sqlite_session.refresh(run)
    assert run.status == WorkflowExecutionStatus.SUCCEEDED
    assert run.total_tokens == 32
    assert all(node.status == WorkflowNodeExecutionStatus.SUCCEEDED for node in nodes)
    # A fresh business operation does not inherit any old batch after success or error.
    adapter.trace(ModerationTraceInfo(flagged=False, action="allow", preset_response="", query="", metadata={}))
    assert len(sent) == 1
    adapter.trace(info.model_copy(update={"workflow_run_id": "a0000000-0000-4000-8000-000000000003"}))
    assert len(sent) == 2
    recovered_spans = list(sent[1][2].resource_spans[0].scope_spans[0].spans)
    assert [s.name for s in recovered_spans] == ["workflow"]


@pytest.mark.parametrize("failed", [False, True])
def test_message_mapping_keeps_original_ids_raw_usage_error_and_business_state(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, failed: bool
) -> None:
    message = make_message(
        message_id=MESSAGE_ID,
        app_id="app",
        conversation_id="conversation",
        query="hello",
        answer="ok",
        status=MessageStatus.ERROR if failed else MessageStatus.NORMAL,
        inputs={},
        message={},
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="owner",
        message_tokens=21,
        answer_tokens=11,
    )
    sqlite_session.add(message)
    sqlite_session.commit()
    info = MessageTraceInfo(
        conversation_model="chat",
        conversation_mode="chat",
        message_id=MESSAGE_ID,
        message_data=message,
        inputs={"prompt": "hello"},
        outputs="ok",
        message_tokens=21,
        answer_tokens=11,
        total_tokens=32,
        error="synthetic model failure" if failed else None,
        metadata={
            "app_id": "app",
            "conversation_id": "conversation",
            "ls_model_name": "test-model",
            "ls_provider": "test",
        },
        start_time=START,
        end_time=START + timedelta(seconds=1),
    )
    sent: list[ExportTraceServiceRequest] = []

    def send(_method: str, _url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        sent.append(decoded(options))
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    adapter = AliyunDataTrace(config())
    adapter.trace(info)
    assert len(sent) == 1
    spans = list(sent[0].resource_spans[0].scope_spans[0].spans)
    assert [s.name for s in spans] == ["message", "llm"]
    root_id = convert_to_span_id(MESSAGE_ID, "message").to_bytes(8)
    assert [s.parent_span_id for s in spans] == [b"", root_id]
    assert [s.span_id for s in spans] == [root_id, convert_to_span_id(MESSAGE_ID, "llm").to_bytes(8)]
    assert all(s.trace_id == UUID(MESSAGE_ID).bytes and s.status.code == (2 if failed else 1) for s in spans)
    assert {a.key: a.value for a in spans[1].attributes}[GEN_AI_USAGE_TOTAL_TOKENS].string_value == "32"
    assert message.status == (MessageStatus.ERROR if failed else MessageStatus.NORMAL)


def test_one_cached_client_keeps_interleaved_batches_and_failure_cleanup_isolated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TraceClient(service_name="owned-service", endpoint="https://collector.test/adapt_key/api/otlp/traces")
    barrier = Barrier(2)
    observed: list[list[str]] = []

    def send(_method: str, _url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        payload = decoded(options)
        observed.append([s.name for rs in payload.resource_spans for scope in rs.scope_spans for s in scope.spans])
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(ssrf_proxy, "make_request", send)

    def run(label: str) -> None:
        try:
            with client.batch():
                client.add_span(SpanData(name=label, trace_id=1, span_id=2, start_time=1, end_time=2))
                barrier.wait(timeout=5)
                if label == "failed":
                    raise ValueError("mapper failed before submission")
                client.add_span(SpanData(name=label + "-child", trace_id=1, span_id=3, start_time=1, end_time=2))
        except ValueError:
            assert label == "failed"
        assert client._dispatch_spans.get() is None

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run, ["accepted", "failed"]))
    assert observed == [["accepted", "accepted-child"]]
    with client.batch():
        client.add_span(SpanData(name="next", trace_id=1, span_id=4, start_time=1, end_time=2))
    assert observed == [["accepted", "accepted-child"], ["next"]]
