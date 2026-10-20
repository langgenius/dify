"""Ordinary NewAgent recovery/cancellation contracts, without live services.

The parent uses the real SQLite reservation and scoped native-row recovery.
The child uses the real Agent node, API client and SDK; only HTTP is replaced.
These are regression checks, not native runtime/remote cleanup acceptance.
"""

import json
from typing import cast
from uuid import uuid4

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.protocol import (
    CreateRunRequest,
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunSucceededEvent,
    RunSucceededEventData,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from sqlalchemy import select

from clients.agent_backend import DifyAgentBackendRunClient
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import StreamCompletedEvent
from models.dify_builder import DifyBuilderRun
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder import dify_port
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.effect_disclosure import disclose
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
def _no_model_metadata_io(monkeypatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.resolve_model_context_window", lambda **_kwargs: None
    )


class ChildHTTP:
    """Replace transport only; never infer cleanup from a cancellation response."""

    def __init__(self, terminal="succeeded", *, cancel_timeout=False):
        self.terminal = terminal
        self.cancel_timeout = cancel_timeout
        self.created = []
        self.cancel_requests = []
        self.cancel_terminal_read = False

    def __call__(self, request):
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


def _client(http):
    return DifyAgentBackendRunClient(
        Client(base_url="https://agent.invalid", sync_http_client=http), stream_max_reconnects=0
    )


@pytest.mark.parametrize("status", ["succeeded", "failed", "running"])
def test_agent_acknowledged_attempt_recovers_parent_without_second_child(harness, monkeypatch, status):
    """Removing the reservation recovery branch would create a second child."""
    native_id, workflow_id = str(uuid4()), str(uuid4())
    # This test's generator explicitly runs an ordinary child. Admission itself
    # has real SQL coverage elsewhere; keep this transport regression focused on
    # the parent reservation and do not pretend this fake generator propagates
    # the confirmed marker into that ordinary child.
    marker = BuilderAgentExecutionContext(
        ref=NativeTestContextRef(request_id=str(uuid4()), invocation_id=str(uuid4()), context_digest="a" * 64),
        native_run_id=native_id,
    )
    monkeypatch.setattr(
        WorkflowServiceDifyPort, "_prepare_confirmed_agent_execution", staticmethod(lambda **_kwargs: marker)
    )
    dify_port._load_draft_workflow_or_raise.return_value.graph = json.dumps(AGENT_GRAPH)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", harness.native_finish)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_bind_run", _bind_native_result)
    transport = ChildHTTP(terminal="failed" if status == "failed" else "succeeded")
    parent_dispatches = []

    class Interrupted(BaseException):
        pass

    with httpx.Client(transport=httpx.MockTransport(transport)) as http:
        child = _node(agent_backend_client=_client(http))

        def generate(**kwargs):
            parent_dispatches.append(kwargs)
            result = cast(StreamCompletedEvent, list(child._run())[-1]).node_run_result
            assert result.status.value == ("failed" if status == "failed" else "succeeded")
            with harness.factory.begin() as session:
                session.add(
                    WorkflowRun(
                        id=native_id,
                        tenant_id=harness.ids["tenant"],
                        app_id=harness.ids["app"],
                        workflow_id=workflow_id,
                        type="workflow",
                        triggered_from="debugging",
                        version="draft",
                        graph=json.dumps(AGENT_GRAPH),
                        inputs=json.dumps({"topic": "x"}),
                        status=status,
                        error=result.error,
                        created_by_role="account",
                        created_by=harness.ids["account"],
                        outputs=json.dumps(result.outputs),
                    )
                )
                session.add(
                    WorkflowNodeExecutionModel(
                        id=str(uuid4()),
                        tenant_id=harness.ids["tenant"],
                        app_id=harness.ids["app"],
                        workflow_id=workflow_id,
                        workflow_run_id=native_id,
                        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                        index=1,
                        node_id="agent-node",
                        node_type="agent",
                        title="Agent",
                        status=result.status,
                        error=result.error,
                        outputs=json.dumps(result.outputs),
                        process_data=json.dumps(result.process_data),
                        execution_metadata=json.dumps(result.metadata),
                        created_by_role="account",
                        created_by=harness.ids["account"],
                    )
                )
            return iter([{"event": "workflow_started", "workflow_run_id": native_id, "data": {"id": native_id}}])

        def interrupt(_event):
            raise Interrupted()

        harness.generate.side_effect = generate
        signature = next(item.signature for item in disclose(AGENT_GRAPH).items if item.node_id == "agent-node")
        with pytest.raises(Interrupted):
            full_run_tests._run(harness, confirmation={"agent-node": signature}, on_workflow_event=interrupt)
        recovered = full_run_tests._run(harness, confirmation={"agent-node": signature})
        assert recovered.dify_run_id == native_id
        assert recovered.status == status
        assert recovered.verification.execution_evidence.sealed is (status != "running")
        assert recovered.per_node[0].node_id == "agent-node"
        if status == "failed":
            assert recovered.per_node[0].error == "child tool failed"
        else:
            assert recovered.per_node[0].outputs == {"text": "child answer"}
        assert len(parent_dispatches) == len(transport.created) == 1
        assert parent_dispatches[0]["builder_mocked_node_ids"] == frozenset()
        assert parent_dispatches[0]["builder_agent_execution"] == marker
        assert CreateRunRequest.model_validate(transport.created[0]).execution_mode == "ordinary"
        # Request keys are sent, but one launch is established by the SQL
        # reservation above; this transport deliberately implements no dedup.
        assert transport.created[0]["idempotency_key"]
        with harness.factory() as session:
            attempts = list(session.scalars(select(DifyBuilderRun)))
        assert len(attempts) == 1
        assert attempts[0].dify_run_id == native_id


@pytest.mark.parametrize("cancel_timeout", [False, True])
def test_graph_abort_waits_for_child_terminal_or_preserves_cleanup_uncertainty(cancel_timeout):
    """An abort must call cancellation; a timeout must not become proof of cleanup."""
    transport = ChildHTTP(cancel_timeout=cancel_timeout)
    store = FakeSessionStore()
    with httpx.Client(transport=httpx.MockTransport(transport)) as http:
        node = _node(agent_backend_client=_client(http), session_store=store)
        node.runtime_state.graph_execution.aborted = True
        result = cast(StreamCompletedEvent, list(node._run())[-1]).node_run_result

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
