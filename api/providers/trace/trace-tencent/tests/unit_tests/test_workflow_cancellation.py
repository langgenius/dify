"""Keep the provider's stopped-workflow status after live workflow capture."""

from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.trace.v1.trace_pb2 import Status

from core.ops.trace_data import CompletedTrace, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import GraphRunAbortedEvent, GraphRunStartedEvent
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("reason", ["Workflow execution stopped", ""])
def test_stopped_workflow_preserves_native_status_without_reclassifying_nodes(
    reason: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    recorder.on_event(GraphRunStartedEvent())
    start_node(recorder, workflow_node(source))
    recorder.on_event(GraphRunAbortedEvent(reason=reason))
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    assert all(span.status == "cancelled" for span in trace.spans)

    client = create_trace_client(make_provider_config())
    send_traces = Mock()
    monkeypatch.setattr(client, "send_traces", send_traces)
    monkeypatch.setattr(client, "send_metrics", Mock())
    client.export_trace(trace)
    request = ExportTraceServiceRequest.FromString(send_traces.call_args.args[0].SerializeToString())
    root, node = request.resource_spans[0].scope_spans[0].spans
    assert root.status.code == (Status.STATUS_CODE_ERROR if reason else Status.STATUS_CODE_UNSET)
    assert root.status.message == reason
    assert node.status.code == Status.STATUS_CODE_UNSET
    assert node.status.message == reason
    assert {attribute.key: attribute.value.string_value for attribute in root.attributes}[
        "dify.span.status"
    ] == "cancelled"
