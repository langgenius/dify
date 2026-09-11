import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from google.protobuf.json_format import ParseDict

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import TraceExportError, provider_uuid, timestamp_ns
from core.ops.trace_data import CompletedTrace
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import GraphRunSucceededEvent, NodeRunStartedEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace
from tests.unit_tests.core.ops.test_workflow_trace_limits import workflow_node

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("route", ["mlflow", "mlflow-artifact", "databricks"])
@pytest.mark.parametrize("missing", [(True, True), (True, False), (False, True)])
def test_partial_detail_times_use_captured_endpoints_in_otlp_and_artifacts(
    route: str, missing: tuple[bool, bool], monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = "databricks" if route == "databricks" else "mlflow"
    trace = make_completed_trace()
    root, parent, detail = trace.spans
    assert root.started_at is not None
    detail_start = root.started_at + timedelta(milliseconds=500)
    detail_end = root.started_at + timedelta(seconds=1)
    detail = detail.model_copy(
        update={
            "started_at": None if missing[0] else detail_start,
            "ended_at": None if missing[1] else detail_end,
            "span_type": "agent",
            "usage": {},
            "attributes": {"timing_source": "unavailable"},
        }
    )
    trace = trace.model_copy(update={"spans": (root, parent, detail)})
    original = trace.model_dump_json()
    client = MLflowTraceClient(provider, {**make_provider_config(provider), "_runtime_settings": {}})
    send = Mock()
    if route == "mlflow-artifact":
        send.side_effect = TraceExportError("provider_http_501")
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    monkeypatch.setattr(client, "_register_trace_metadata", Mock())
    monkeypatch.setattr(client, "_read_existing_trace", Mock(return_value=None))
    saved_info = client._build_trace_info(trace, provider_uuid(trace.trace_id))
    saved_info["tags"]["mlflow.artifactLocation"] = "https://mlflow.example/artifacts"
    request = Mock(
        side_effect=[
            httpx.Response(200, json={"trace": {"trace_info": saved_info}}),
            httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/traces"}}),
        ]
    )
    monkeypatch.setattr(client.http, "request", request)
    upload = Mock()
    monkeypatch.setattr(client, "_upload_mlflow_artifact" if provider == "mlflow" else "_upload_spans", upload)
    client.export_trace(trace)
    expected = detail.started_at or detail.ended_at or parent.started_at
    if route == "mlflow":
        spans = send.call_args.args[0].resource_spans[0].scope_spans[0].spans
        actual = [(span.start_time_unix_nano, span.end_time_unix_nano) for span in spans]
        attributes = {item.key: item.value for item in spans[-1].attributes}
        assert attributes["dify.timing.estimated"].bool_value is True
        assert attributes["dify.timing.source"].string_value == "captured_endpoint"
    else:
        spans = json.loads(upload.call_args.args[1])["spans"]
        actual = [(span["start_time_unix_nano"], span["end_time_unix_nano"]) for span in spans]
        assert json.loads(spans[-1]["attributes"]["dify.timing.estimated"]) is True
        assert json.loads(spans[-1]["attributes"]["dify.timing.source"]) == "captured_endpoint"
    assert actual == [
        (timestamp_ns(root.started_at), timestamp_ns(root.ended_at)),
        (timestamp_ns(parent.started_at), timestamp_ns(parent.ended_at)),
        (timestamp_ns(expected), timestamp_ns(expected)),
    ]
    assert trace.model_dump_json() == original


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("missing", [False, True])
def test_invalid_or_unanchored_times_fail_before_authentication_or_metadata(
    provider: str, missing: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_completed_trace()
    root = trace.spans[0]
    root = root.model_copy(
        update={"started_at": None, "ended_at": None}
        if missing
        else {"started_at": root.ended_at, "ended_at": root.started_at}
    )
    trace = trace.model_copy(update={"spans": (root, *trace.spans[1:])})
    client = MLflowTraceClient(provider, {**make_provider_config(provider), "_runtime_settings": {}})
    request = Mock()
    monkeypatch.setattr(client.http, "request", request)
    authenticate = Mock()
    monkeypatch.setattr(client, "_authenticate_databricks", authenticate)
    with pytest.raises(TraceExportError, match="mlflow_span_time_missing" if missing else "mlflow_span_time_invalid"):
        client.export_trace(trace)
    request.assert_not_called()
    authenticate.assert_not_called()


def test_final_only_agent_detail_keeps_real_mlflow_store_trace_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    # The SDK is optional after migration. When installed, exercise its actual OTLP consumer and SQL time bounds.
    entities = pytest.importorskip("mlflow.entities")
    service = pytest.importorskip("mlflow.protos.service_pb2")
    tracking = pytest.importorskip("mlflow.store.tracking.sqlalchemy_store")
    source = make_completed_trace().source
    started = datetime(2026, 9, 9, 8, tzinfo=UTC)
    finished = started + timedelta(seconds=3)
    clock = Mock(wraps=datetime)
    clock.now.side_effect = [started, finished]
    monkeypatch.setattr("core.ops.workflow_trace.datetime", clock)
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, _settings=(): submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type="agent")
    with recorder.node_run_context(node):
        recorder.on_event(
            NodeRunStartedEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node.node_type,
                node_title=node.title,
                start_at=started,
            )
        )
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="agent",
            start_at=started,
            finished_at=finished,
            node_run_result=NodeRunResult(
                outputs={
                    "json": [{"id": "step", "label": "1 Thought", "status": "success", "data": {"text": "answer"}}]
                }
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = submitted[0]
    assert trace.spans[-1].started_at is trace.spans[-1].ended_at is None
    client = MLflowTraceClient(
        "mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "0", "_runtime_settings": {}}
    )
    monkeypatch.setattr(client, "_register_trace_metadata", Mock())
    send = Mock()
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    client.export_trace(trace)
    spans = [
        entities.Span.from_otel_proto(span) for span in send.call_args.args[0].resource_spans[0].scope_spans[0].spans
    ]
    store = tracking.SqlAlchemyStore("sqlite:///:memory:", "mlflow-artifacts:/")
    try:
        store.start_trace(
            entities.TraceInfo.from_proto(
                ParseDict(client._build_trace_info(trace, provider_uuid(trace.trace_id)), service.TraceInfoV3())
            )
        )
        store.log_spans("0", spans)
        info = store.get_trace_info(spans[0].trace_id)
        assert info.request_time == timestamp_ns(started) // 1_000_000
        assert info.execution_duration == 3000
    finally:
        store.engine.dispose()
