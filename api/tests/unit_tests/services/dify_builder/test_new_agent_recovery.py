"""Ordinary NewAgent recovery/cancellation contracts, without live services.

The parent uses the real SQLite reservation and scoped native-row recovery.
The child uses the real Agent node, API client and SDK; only HTTP is replaced.
These are regression checks, not native runtime/remote cleanup acceptance.
"""

import json

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.protocol import (
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunSucceededEvent,
    RunSucceededEventData,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from httpx import Request, Response

from clients.agent_backend import DifyAgentBackendRunClient
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import StreamCompletedEvent
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from tests.unit_tests.core.workflow.nodes.agent_v2.test_agent_node import FakeSessionStore, _node
from tests.unit_tests.services.dify_builder import test_confirmed_full_run as full_run_tests

harness = full_run_tests.harness
_bind_native_result = WorkflowServiceDifyPort._bind_run


AGENT_GRAPH = {
    "nodes": [
        {"id": "start", "data": {"type": "start", "title": "Start"}},
        {
            "id": "agent-node",
            "data": {
                "type": "agent",
                "version": "2",
                "agent_node_kind": "dify_agent",
                "agent_binding": {
                    "binding_type": "roster_agent",
                    "agent_id": "agent-1",
                    "current_snapshot_id": "snapshot-1",
                },
            },
        },
    ],
    "edges": [{"source": "start", "target": "agent-node"}],
}


@pytest.fixture(autouse=True)
def _no_model_metadata_io(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.app.llm.model_access import ModelRuntimeProfile

    monkeypatch.setattr(
        "core.app.llm.model_access.resolve_model_runtime_profile",
        lambda **_kwargs: ModelRuntimeProfile(context_window_tokens=None, supported_modalities=[]),
    )


class ChildHTTP:
    """Replace transport only; never infer cleanup from a cancellation response."""

    def __init__(self, terminal: str = "succeeded", *, cancel_timeout: bool = False) -> None:
        self.terminal = terminal
        self.cancel_timeout = cancel_timeout
        self.created: list[dict[str, object]] = []
        self.cancel_requests: list[dict[str, object]] = []
        self.cancel_terminal_read = False

    def __call__(self, request: Request) -> Response:
        if request.method == "POST" and request.url.path == "/runs":
            self.created.append(json.loads(request.content))
            return httpx.Response(200, json={"run_id": "child-1", "status": "running"})
        if request.method == "POST" and request.url.path == "/runs/child-1/cancel":
            self.cancel_requests.append(json.loads(request.content))
            if self.cancel_timeout:
                raise httpx.ReadTimeout("cancellation acknowledgement lost", request=request)
            return httpx.Response(200, json={"run_id": "child-1", "status": "cancelled"})
        if request.method == "GET" and request.url.path == "/runs/child-1/events/sse":
            if self.cancel_requests:
                self.cancel_terminal_read = True
                event = RunCancelledEvent(
                    id="2-0",
                    run_id="child-1",
                    data=RunCancelledEventData(
                        reason="workflow_graph_aborted", session_snapshot=SessionSnapshot(layers={})
                    ),
                )
            elif self.terminal == "failed":
                event = RunFailedEvent(id="2-0", run_id="child-1", data=RunFailedEventData(error="child tool failed"))
            else:
                event = RunSucceededEvent(
                    id="2-0",
                    run_id="child-1",
                    data=RunSucceededEventData(
                        output={"text": "child answer"}, session_snapshot=SessionSnapshot(layers={})
                    ),
                )
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=f"id: 2-0\nevent: {event.type}\ndata: {event.model_dump_json()}\n\n",
            )
        raise AssertionError(f"Unexpected child request: {request.method} {request.url.path}")


def _client(http: httpx.Client) -> DifyAgentBackendRunClient:
    return DifyAgentBackendRunClient(
        Client(base_url="https://agent.invalid", sync_http_client=http), stream_max_reconnects=0
    )


@pytest.mark.parametrize("cancel_timeout", [False, True])
def test_graph_abort_waits_for_child_terminal_or_preserves_cleanup_uncertainty(cancel_timeout: bool) -> None:
    """An abort must call cancellation; a timeout must not become proof of cleanup."""
    transport = ChildHTTP(cancel_timeout=cancel_timeout)
    store = FakeSessionStore()
    with httpx.Client(transport=httpx.MockTransport(transport)) as http:
        node = _node(agent_backend_client=_client(http), session_store=store)
        node.runtime_state.graph_execution.aborted = True
        completed = list(node._run())[-1]
        assert isinstance(completed, StreamCompletedEvent)
        result = completed.node_run_result

    assert len(transport.created) == 1
    assert transport.cancel_requests == [
        {"reason": "workflow_graph_aborted", "message": "Workflow Agent event consumption stopped"}
    ]
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "agent_backend_stream_error"
    assert "cancelled by the caller" in result.error
    backend = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]
    assert backend["run_id"] == "child-1"
    assert transport.cancel_terminal_read is not cancel_timeout
    if cancel_timeout:
        assert store.saved == []
        assert backend.get("status") != "cancelled"
        assert "session_snapshot_persisted" not in backend
    else:
        assert len(store.saved) == 1
        assert store.saved[0][2] == SessionSnapshot(layers={})
        assert backend["session_snapshot_persisted"] is True
