"""Real MLflow SDK export must not select the application's ambient OTLP destination."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Never

import mlflow
import pytest
import requests
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowDataTrace
from google.protobuf.json_format import Parse
from mlflow.entities import SpanType, Trace
from mlflow.entities.trace_location import MlflowExperimentLocation
from mlflow.protos.service_pb2 import StartTraceV3
from mlflow.tracing import provider as sdk_provider
from mlflow.tracing.constant import SpanAttributeKey, TraceMetadataKey, TraceTagKey
from mlflow.tracing.trace_manager import InMemoryTraceManager
from mlflow.tracing.utils.otlp import _decode_otel_proto_anyvalue
from opentelemetry import trace
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.trace.v1.trace_pb2 import Span as ProtoSpan
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import INVALID_SPAN_CONTEXT, NonRecordingSpan

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from models.model import Message
from models.workflow import WorkflowNodeExecutionModel


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> list[requests.PreparedRequest]:
    calls: list[requests.PreparedRequest] = []

    def send(_session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        calls.append(request)
        response = requests.Response()
        response.status_code = 200
        response.request = request
        response.url = request.url or ""
        if response.url.endswith("/version"):
            response._content = b"3.17.1"
        elif response.url.endswith("/v1/traces"):
            response._content = b"{}"
        elif response.url.endswith("/api/3.0/mlflow/traces"):
            assert isinstance(request.body, (str, bytes))
            body = json.loads(request.body)
            info = body["trace"]["trace_info"]
            info.setdefault("tags", {})[TraceTagKey.SPANS_LOCATION] = "TRACKING_STORE"
            response._content = json.dumps(body).encode()
        else:
            raise AssertionError(f"Unexpected SDK endpoint: {request.method} {request.path_url}")
        return response

    monkeypatch.setattr(requests.Session, "send", send)
    monkeypatch.setenv("MLFLOW_DISABLE_TELEMETRY", "true")
    monkeypatch.delenv("_MLFLOW_TELEMETRY_SESSION_ID", raising=False)
    monkeypatch.setenv("MLFLOW_ENABLE_ASYNC_TRACE_LOGGING", "false")
    monkeypatch.setenv("MLFLOW_ENABLE_OTLP_EXPORTER", "true")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://dify-internal.example:4318")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http")
    monkeypatch.setenv("OTEL_SERVICE_NAME", "dify-api")
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=unit-test")
    return calls


def tool_info() -> ToolTraceInfo:
    started = datetime(2026, 1, 1, tzinfo=UTC)
    return ToolTraceInfo(
        tool_name="code",
        tool_inputs={"a": 17},
        tool_outputs="323",
        tool_config={},
        tool_parameters={},
        time_cost=1,
        metadata={},
        inputs={"a": 17},
        outputs="323",
        start_time=started,
        end_time=started + timedelta(seconds=1),
    )


@pytest.mark.parametrize("default_provider", ["true", "false"])
def test_real_sdk_uses_private_mlflow_exporter_without_touching_shared_state(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
    default_provider: str,
) -> None:
    monkeypatch.setenv("MLFLOW_USE_DEFAULT_TRACER_PROVIDER", default_provider)
    main_provider = TracerProvider()
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", main_provider)
    sdk_before = sdk_provider.provider.get()
    destination_before = sdk_provider._MLFLOW_TRACE_USER_DESTINATION.get()
    unrelated = MlflowExperimentLocation("999")
    monkeypatch.setattr(sdk_provider._MLFLOW_TRACE_USER_DESTINATION, "_global_value", unrelated)
    destination_before = sdk_provider._MLFLOW_TRACE_USER_DESTINATION.get()
    environment_before = dict(os.environ)

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("Legacy exporter must not initialize or reset the process SDK")

    for name in ("set_tracking_uri", "set_experiment"):
        monkeypatch.setattr(mlflow, name, forbidden)
    monkeypatch.setattr(sdk_provider, "set_destination", forbidden)
    monkeypatch.setattr(sdk_provider, "reset", forbidden)
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://legacy.example", experiment_id="12"))
    assert transport == []
    instance.trace(tool_info())
    assert sdk_provider.provider.get() is sdk_before
    assert sdk_provider._MLFLOW_TRACE_USER_DESTINATION.get() is destination_before
    assert trace.get_tracer_provider() is main_provider
    assert dict(os.environ) == environment_before
    otlp_requests = [request for request in transport if (request.url or "").endswith("/v1/traces")]
    assert len(otlp_requests) == 1
    assert otlp_requests[0].url == "https://legacy.example/v1/traces"
    assert otlp_requests[0].headers["x-mlflow-experiment-id"] == "12"
    body = otlp_requests[0].body
    assert isinstance(body, bytes)
    spans = ExportTraceServiceRequest.FromString(body).resource_spans[0].scope_spans[0].spans
    assert len(spans) == 1
    assert spans[0].name == "code"
    assert len(spans[0].trace_id) == 16
    assert any(spans[0].trace_id)
    assert any((request.url or "").endswith("/api/3.0/mlflow/traces") for request in transport)
    main_provider.shutdown()


def exported_spans(calls: list[requests.PreparedRequest]) -> list[ProtoSpan]:
    spans: list[ProtoSpan] = []
    for request in calls:
        if (request.url or "").endswith("/v1/traces"):
            assert isinstance(request.body, bytes)
            spans.extend(ExportTraceServiceRequest.FromString(request.body).resource_spans[0].scope_spans[0].spans)
    return spans


def exported_traces(calls: list[requests.PreparedRequest]) -> list[Trace]:
    results: list[Trace] = []
    for request in calls:
        if (request.url or "").endswith("/api/3.0/mlflow/traces"):
            assert isinstance(request.body, (bytes, str))
            results.append(Trace.from_proto(Parse(request.body, StartTraceV3()).trace))
    return results


def test_workflow_parent_children_usage_metadata_and_explicit_experiment(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
) -> None:
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://workflow.example", experiment_id="42"))
    started = datetime(2026, 1, 1, tzinfo=UTC)
    nodes = [
        WorkflowNodeExecutionModel(
            id=f"node-{index}",
            tenant_id="tenant",
            app_id="app",
            title=name,
            node_type=node_type,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs='{"question":"synthetic"}',
            outputs='{"text":"answer"}',
            elapsed_time=0.1,
            process_data=json.dumps(
                {
                    "prompts": [{"role": "user", "text": "synthetic"}],
                    "model_name": "test-model",
                    "model_provider": "test",
                    "usage": {"prompt_tokens": 25, "completion_tokens": 7, "total_tokens": 32},
                }
            )
            if node_type == BuiltinNodeTypes.LLM
            else None,
        )
        for index, (name, node_type) in enumerate(
            [
                ("Start", BuiltinNodeTypes.START),
                ("LLM", BuiltinNodeTypes.LLM),
                ("End", BuiltinNodeTypes.END),
            ]
        )
    ]
    for trace_node_index, trace_node_record in enumerate(nodes):
        trace_node_record.created_at = started + timedelta(milliseconds=trace_node_index)
    monkeypatch.setattr(instance, "_get_workflow_nodes", lambda _run_id: nodes)
    info = WorkflowTraceInfo(
        workflow_id="workflow",
        tenant_id="tenant",
        workflow_run_id="run",
        workflow_run_elapsed_time=1,
        workflow_run_status=WorkflowNodeExecutionStatus.SUCCEEDED,
        workflow_run_inputs={"q": "synthetic", "sys.hidden": "drop"},
        workflow_run_outputs={"answer": "answer"},
        workflow_run_version="1",
        total_tokens=32,
        file_list=[],
        query="",
        conversation_id="session",
        metadata={"user_id": "user"},
        start_time=started,
        end_time=started + timedelta(seconds=1),
    )
    ambient_provider = TracerProvider()
    with ambient_provider.get_tracer("ambient").start_as_current_span("unrelated"):
        instance.trace(info)
    spans = exported_spans(transport)
    assert len(spans) == 4
    root = next(span for span in spans if span.name == "workflow")
    assert not root.parent_span_id
    assert all(span.trace_id == root.trace_id for span in spans)
    assert all(span.parent_span_id == root.span_id for span in spans if span is not root)
    assert all(
        request.headers["x-mlflow-experiment-id"] == "42"
        for request in transport
        if (request.url or "").endswith("/v1/traces")
    )
    native = exported_traces(transport)
    assert len(native) == 1
    location = native[0].info.trace_location.mlflow_experiment
    assert location is not None
    assert location.experiment_id == "42"
    assert native[0].info.trace_metadata[TraceMetadataKey.TRACE_SESSION] == "session"
    assert native[0].info.trace_metadata[TraceMetadataKey.TRACE_USER] == "user"
    assert json.loads(native[0].info.trace_metadata[TraceMetadataKey.TOKEN_USAGE]) == {
        "input_tokens": 25,
        "output_tokens": 7,
        "total_tokens": 32,
    }
    attributes = {
        attribute.key: _decode_otel_proto_anyvalue(attribute.value)
        for attribute in root.attributes
        if attribute.key in (SpanAttributeKey.INPUTS, SpanAttributeKey.OUTPUTS)
    }
    assert attributes[SpanAttributeKey.INPUTS] == {"q": "synthetic"}
    assert attributes[SpanAttributeKey.OUTPUTS] == {"answer": "answer"}
    ambient_provider.shutdown()


def test_interleaved_instances_keep_children_on_their_own_uri_and_experiment(
    transport: list[requests.PreparedRequest],
) -> None:
    barrier = Barrier(2)
    instances = [
        MLflowDataTrace(MLflowConfig(tracking_uri=f"https://{name}.example", experiment_id=experiment))
        for name, experiment in [("first", "12"), ("second", "34")]
    ]

    def emit(instance: MLflowDataTrace) -> tuple[str, str]:
        root = instance._start_span_no_context(name="workflow", span_type=SpanType.CHAIN)
        barrier.wait(timeout=5)
        child = instance._start_span_no_context(name="node", span_type=SpanType.TOOL, parent_span=root)
        child.end(outputs="ok")
        barrier.wait(timeout=5)
        root.end(outputs="ok")
        return root.trace_id, root.span_id

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(emit, instances))
    assert ids[0][0] != ids[1][0]
    for host, experiment in [("first", "12"), ("second", "34")]:
        requests_for_host = [item for item in transport if (item.url or "").startswith(f"https://{host}.example/")]
        spans = exported_spans(requests_for_host)
        assert len(spans) == 2
        assert spans[0].trace_id == spans[1].trace_id
        root = next(span for span in spans if not span.parent_span_id)
        child = next(span for span in spans if span.parent_span_id)
        assert child.parent_span_id == root.span_id
        assert all(
            item.headers["x-mlflow-experiment-id"] == experiment
            for item in requests_for_host
            if (item.url or "").endswith("/v1/traces")
        )
        location = exported_traces(requests_for_host)[0].info.trace_location.mlflow_experiment
        assert location is not None
        assert location.experiment_id == experiment


@pytest.mark.parametrize(
    "method", ["message", "moderation", "dataset_retrieval", "suggested_question", "generate_name"]
)
def test_other_legacy_entrypoints_use_the_same_private_sdk(
    method: str,
    transport: list[requests.PreparedRequest],
) -> None:
    started = datetime(2026, 1, 1, tzinfo=UTC)
    message = Message(
        model_provider="test",
        model_id="model",
        answer="answer",
        total_price=0,
        created_at=started,
        updated_at=started + timedelta(seconds=1),
    )
    common = {
        "metadata": {},
        "message_data": message,
        "inputs": "synthetic",
        "outputs": "answer",
        "start_time": started,
        "end_time": started + timedelta(seconds=1),
    }
    match method:
        case "message":
            info = MessageTraceInfo(
                **common,
                conversation_model="chat",
                conversation_mode="chat",
                message_tokens=3,
                answer_tokens=2,
                total_tokens=5,
            )
        case "moderation":
            info = ModerationTraceInfo(**common, flagged=False, action="allow", preset_response="", query="synthetic")
        case "dataset_retrieval":
            info = DatasetRetrievalTraceInfo(**common, documents=[{"content": "synthetic"}])
        case "suggested_question":
            info = SuggestedQuestionTraceInfo(**common, total_tokens=5, suggested_question=["synthetic"], level="info")
        case _:
            info = GenerateNameTraceInfo(**common, tenant_id="tenant")
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://other.example", experiment_id="16"))
    instance.trace(info)
    assert len(exported_spans(transport)) == 1
    location = exported_traces(transport)[0].info.trace_location.mlflow_experiment
    assert location is not None
    assert location.experiment_id == "16"


@pytest.mark.parametrize("failure", ["exception", "noop", "unregistered"])
def test_span_creation_failure_is_explicit_and_does_not_export_success(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
    failure: str,
) -> None:
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://failure.example", experiment_id="10"))
    if failure == "exception":

        def fail(*_args: object, **_kwargs: object) -> Never:
            raise ValueError("must-not-leak-vendor-details")

        monkeypatch.setattr(instance._tracer, "start_span", fail)
        expected = "mlflow_legacy_span_start_failed"
    elif failure == "noop":

        def noop(*_args: object, **_kwargs: object) -> NonRecordingSpan:
            return NonRecordingSpan(INVALID_SPAN_CONTEXT)

        monkeypatch.setattr(instance._tracer, "start_span", noop)
        expected = "mlflow_legacy_span_not_recording"
    else:
        manager = InMemoryTraceManager.get_instance()
        monkeypatch.setattr(manager, "get_span_from_id", lambda *_args: None)
        expected = "mlflow_legacy_span_not_registered"
    with pytest.raises(RuntimeError, match=f"^{expected}$"):
        instance.trace(tool_info())
    assert not exported_spans(transport)
    assert not exported_traces(transport)


def test_legacy_basic_credentials_remain_compatible_at_transport_boundary(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
) -> None:
    # This preserves legacy process-level credentials; it is not an isolation claim.
    for key in ("MLFLOW_TRACKING_USERNAME", "MLFLOW_TRACKING_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    instance = MLflowDataTrace(
        MLflowConfig(
            tracking_uri="https://basic.example",
            experiment_id="12",
            username="synthetic-user",
            password="synthetic-secret",
        )
    )
    instance.trace(tool_info())
    import base64

    expected = "Basic " + base64.b64encode(b"synthetic-user:synthetic-secret").decode()
    assert all(request.headers["Authorization"] == expected for request in transport)


@pytest.mark.parametrize("noop", [False, True])
def test_databricks_preserves_legacy_sdk_setup_and_span_selection(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
    noop: bool,
) -> None:
    import dify_trace_mlflow.mlflow_trace as legacy
    from mlflow.entities import LiveSpan
    from mlflow.entities.span import NoOpSpan

    setup: list[tuple[str, str]] = []
    provider = TracerProvider()
    raw = provider.get_tracer("databricks-legacy").start_span("code")
    span = LiveSpan(raw, "tr-synthetic-databricks")
    options: list[dict[str, object]] = []

    def start(**kwargs: object) -> LiveSpan | NoOpSpan:
        options.append(kwargs)
        return NoOpSpan() if noop else span

    monkeypatch.setattr(mlflow, "set_tracking_uri", lambda uri: setup.append(("uri", uri)))
    monkeypatch.setattr(mlflow, "set_experiment", lambda *, experiment_id: setup.append(("experiment", experiment_id)))
    monkeypatch.setattr(legacy, "start_span_no_context", start)
    for name in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "MLFLOW_ENABLE_ASYNC_TRACE_LOGGING"):
        monkeypatch.delenv(name, raising=False)
    instance = MLflowDataTrace(
        DatabricksConfig(host="https://workspace.example", experiment_id="123", personal_access_token="synthetic-pat")
    )
    assert setup == [("uri", "databricks"), ("experiment", "123")]
    assert instance._tracer is None
    assert instance._exporter is None
    if noop:
        with pytest.raises(RuntimeError, match="^mlflow_legacy_span_not_recording$"):
            instance.trace(tool_info())
        raw.end()
    else:
        instance.trace(tool_info())
        assert span.outputs == "323"
    assert options[0]["name"] == "code"
    assert options[0]["inputs"] == {"a": 17}
    assert transport == []
    provider.shutdown()


def test_private_exporter_is_synchronous_and_does_not_retain_evicted_adapters(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
) -> None:
    import atexit
    import gc
    import weakref

    from mlflow.tracing.export import mlflow_v3

    monkeypatch.setenv("MLFLOW_ENABLE_ASYNC_TRACE_LOGGING", "true")

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("A private legacy exporter must not retain an SDK queue or exit callback")

    monkeypatch.setattr(mlflow_v3, "AsyncTraceExportQueue", forbidden)
    monkeypatch.setattr(atexit, "register", forbidden)
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://synchronous.example", experiment_id="77"))
    reference = weakref.ref(instance)
    provider_reference = weakref.ref(instance._provider)
    instance.trace(tool_info())
    instance.trace(tool_info())
    assert len(exported_traces(transport)) == 2  # Complete before return, no global flush call.
    assert os.environ["MLFLOW_ENABLE_ASYNC_TRACE_LOGGING"] == "true"
    del instance
    gc.collect()
    assert reference() is None
    assert provider_reference() is None


@pytest.mark.parametrize("endpoint", ["/v1/traces", "/api/3.0/mlflow/traces"])
def test_synchronous_http_failure_reaches_task_boundary_and_does_not_poison_next_trace(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
    endpoint: str,
) -> None:
    original_send = requests.Session.send
    fail = True

    def send(session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        if fail and (request.url or "").endswith(endpoint):
            response = requests.Response()
            response.status_code = 403
            response._content = b'{"error_code":"PERMISSION_DENIED","message":"synthetic denial"}'
            response.request = request
            response.url = request.url or ""
            return response
        return original_send(session, request)

    monkeypatch.setattr(requests.Session, "send", send)
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://failure-transport.example", experiment_id="70"))
    with pytest.raises(RuntimeError, match="^mlflow_legacy_export_failed$"):
        instance.trace(tool_info())
    assert instance._exporter is not None
    assert instance._exporter.failed.get() is False
    fail = False
    transport.clear()
    instance.trace(tool_info())
    assert len(exported_spans(transport)) == len(exported_traces(transport)) == 1


@pytest.mark.parametrize("artifact_fails", [False, True])
def test_expected_501_falls_back_to_sdk_artifact_and_only_final_failure_is_reported(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
    artifact_fails: bool,
) -> None:
    from mlflow.entities import TraceData, TraceInfo
    from mlflow.tracing.client import TracingClient

    assert transport == []
    original_send = requests.Session.send
    uploaded: list[TraceData] = []

    def send(session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        if (request.url or "").endswith("/v1/traces"):
            response = requests.Response()
            response.status_code = 501
            response._content = b'{"error_code":"NOT_IMPLEMENTED","message":"REST OTLP span logging is not supported"}'
            response.request = request
            response.url = request.url or ""
            return response
        response = original_send(session, request)
        if (request.url or "").endswith("/api/3.0/mlflow/traces"):
            body = response.json()
            body["trace"]["trace_info"]["tags"].pop(TraceTagKey.SPANS_LOCATION)
            response._content = json.dumps(body).encode()
        return response

    def upload(_client: TracingClient, _info: TraceInfo, data: TraceData) -> None:
        if artifact_fails:
            raise requests.HTTPError("synthetic artifact failure")
        uploaded.append(data)

    monkeypatch.setattr(requests.Session, "send", send)
    monkeypatch.setattr(TracingClient, "_upload_trace_data", upload)
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://file-store.example", experiment_id="80"))
    if artifact_fails:
        with pytest.raises(RuntimeError, match="^mlflow_legacy_export_failed$"):
            instance.trace(tool_info())
    else:
        instance.trace(tool_info())
        assert len(uploaded) == 1
        assert len(uploaded[0].spans) == 1
        assert uploaded[0].spans[0].outputs == "323"


@pytest.mark.parametrize("fallback_fails", [False, True])
def test_v3_endpoint_not_found_keeps_real_sdk_v2_fallback(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
    fallback_fails: bool,
) -> None:
    from mlflow.entities.trace_info_v2 import TraceInfoV2
    from mlflow.exceptions import MlflowException
    from mlflow.protos.databricks_pb2 import ENDPOINT_NOT_FOUND
    from mlflow.store.tracking.rest_store import RestStore

    assert transport == []
    original_endpoint = RestStore._call_endpoint
    actions: list[str] = []

    def endpoint(store: RestStore, api: object, json_body: str, **kwargs: object) -> object:
        if api is StartTraceV3:
            actions.append("v3-not-found")
            raise MlflowException("old server", error_code=ENDPOINT_NOT_FOUND)
        return original_endpoint(store, api, json_body, **kwargs)

    def start_v2(_store: RestStore, **kwargs: object) -> TraceInfoV2:
        actions.append("v2-start")
        if fallback_fails:
            raise requests.HTTPError("synthetic v2 failure")
        return TraceInfoV2.from_dict(
            {
                "request_id": "tr-v2",
                "experiment_id": str(kwargs["experiment_id"]),
                "timestamp_ms": 1,
                "execution_time_ms": 1,
                "status": "OK",
                "request_metadata": {},
                "tags": {TraceTagKey.SPANS_LOCATION: "TRACKING_STORE"},
            }
        )

    def end_v2(_store: RestStore, **_kwargs: object) -> None:
        actions.append("v2-end")

    monkeypatch.setattr(RestStore, "_call_endpoint", endpoint)
    monkeypatch.setattr(RestStore, "deprecated_start_trace_v2", start_v2)
    monkeypatch.setattr(RestStore, "deprecated_end_trace_v2", end_v2)
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://old-v2.example", experiment_id="90"))
    if fallback_fails:
        with pytest.raises(RuntimeError, match="^mlflow_legacy_export_failed$"):
            instance.trace(tool_info())
        assert actions == ["v3-not-found", "v2-start"]
    else:
        instance.trace(tool_info())
        assert actions == ["v3-not-found", "v2-start", "v2-end"]


def test_concurrent_dispatches_on_cached_adapter_do_not_share_failure_state(
    monkeypatch: pytest.MonkeyPatch,
    transport: list[requests.PreparedRequest],
) -> None:
    from contextvars import ContextVar

    original_send = requests.Session.send
    fail_this_dispatch: ContextVar[bool] = ContextVar("fail_this_dispatch", default=False)
    barrier = Barrier(2)

    def send(session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        if (request.url or "").endswith("/v1/traces"):
            barrier.wait(timeout=5)
            if fail_this_dispatch.get():
                response = requests.Response()
                response.status_code = 403
                response._content = b'{"error_code":"PERMISSION_DENIED","message":"synthetic denial"}'
                response.request = request
                response.url = request.url or ""
                return response
        return original_send(session, request)

    monkeypatch.setattr(requests.Session, "send", send)
    instance = MLflowDataTrace(MLflowConfig(tracking_uri="https://concurrent.example", experiment_id="71"))

    def emit(fail: bool) -> bool:
        token = fail_this_dispatch.set(fail)
        try:
            if fail:
                with pytest.raises(RuntimeError, match="^mlflow_legacy_export_failed$"):
                    instance.trace(tool_info())
                return False
            instance.trace(tool_info())
            return True
        finally:
            fail_this_dispatch.reset(token)
            assert instance._exporter is not None
            assert not instance._exporter.failed.get()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(emit, [True, False])) == [False, True]
    assert len(exported_spans(transport)) == 1
