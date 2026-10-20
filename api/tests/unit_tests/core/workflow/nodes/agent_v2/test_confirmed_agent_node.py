"""Confirmed Agent control stays attached to its durable child and exact inputs."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from dify_agent.protocol import (
    CreateRunRequest,
    CreateRunResponse,
    RunComposition,
    RunWaitingEvent,
    RunWaitingEventData,
)

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import ErrorStrategy, WorkflowNodeExecutionStatus
from graphon.graph_events import NodeRunPauseRequestedEvent
from graphon.node_events import StreamCompletedEvent
from graphon.variables.segments import StringSegment
from runtime_contracts.builder.native.agent_contracts import AgentCreateInserted, AgentParentNodeRef
from services.agent.workflow_run_recovery import AgentCreateAcknowledgementUnknown
from tests.unit_tests.core.workflow.nodes.agent_v2.test_agent_node import _node
from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker


def _confirmed(monkeypatch, *, existing=False, unknown=False, custom_outputs=None):
    context = marker()
    store = MagicMock()
    store.load_context.return_value = SimpleNamespace(generation=0)
    store.store_node_inputs.return_value = "input-ref"
    preparation = SimpleNamespace(state_store=store, config_builder=MagicMock())
    preparation.config_builder.typed_inputs.return_value = {"query": "typed", "values": {"prior.number": 42}}
    commands = MagicMock()
    commands.load_wait.return_value = None
    recovery = MagicMock()
    recovery.recover_existing.return_value = (
        CreateRunResponse(run_id="original-child", status="running") if existing else None
    )
    recovery.start_or_recover.return_value = CreateRunResponse(run_id="original-child", status="running")
    if unknown:
        recovery.recover_existing.side_effect = AgentCreateAcknowledgementUnknown("unknown")
    node = _node(
        confirmed_owners=(preparation, commands, recovery),
        declared_outputs=custom_outputs,
        error_strategy=ErrorStrategy.DEFAULT_VALUE,
    )
    run_context = node.graph_init_params.run_context[DIFY_RUN_CONTEXT_KEY]
    run_context.builder_agent_execution = context
    # A Workflow context has no owning chat conversation.
    pool = node.graph_runtime_state.variable_pool
    old_get = pool.get
    pool.get = lambda selector: (
        StringSegment(value=context.native_run_id)
        if tuple(selector) == ("sys", "workflow_run_id")
        else None
        if tuple(selector) == ("sys", "conversation_id")
        else old_get(selector)
    )
    parent = AgentParentNodeRef(
        ref=context.ref, execution_id=node.execution_id, input_result_ref="input-ref", input_digest="a" * 64
    )
    import services.dify_builder.native_testing.agent_confirmed_workspace as workspace

    monkeypatch.setattr(workspace, "load_confirmed_agent_parent", lambda **_: parent if existing else None)
    prepared = SimpleNamespace(
        claim=AgentCreateInserted(config_ref="config", config_digest="b" * 64),
        parent_node=parent,
        request=CreateRunRequest(composition=RunComposition(layers=[]), idempotency_key="stable-original"),
    )
    prepare = MagicMock(return_value=prepared)
    monkeypatch.setattr(workspace, "prepare_confirmed_agent_request", prepare)
    node._runtime_request_builder = MagicMock(
        side_effect=AssertionError("confirmed must not use ordinary config builder")
    )
    node._runtime_request_builder.build.side_effect = AssertionError("confirmed must not rebuild ordinary tools")
    node._agent_backend_client = MagicMock()
    node._agent_backend_client.stream_events.return_value = iter(
        [
            RunWaitingEvent(
                id="waiting-event", run_id="original-child", data=RunWaitingEventData(generation=2, pending_actions=())
            ),
        ]
    )
    commands.prepare_wait.return_value = SimpleNamespace(model_dump=lambda **_: {"checkpoint_object_ref": "owned-wait"})
    return node, context, parent, preparation, commands, recovery, prepare


def test_confirmed_wait_emits_pause_after_checkpoint_owner_without_failure_or_cancel(monkeypatch):
    node, context, _, preparation, commands, recovery, prepare = _confirmed(monkeypatch)
    events = list(node._run())
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert isinstance(event.reason, SchedulingPause)
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.PAUSED
    assert event.node_run_result.outputs == {}
    assert commands.prepare_wait.call_args.kwargs["agent_generation"] == 2
    assert commands.prepare_wait.call_args.kwargs["backend_wait_event_id"] == "waiting-event"
    assert prepare.call_args.kwargs["inputs"] == {"query": "typed", "values": {"prior.number": 42}}
    assert preparation.state_store.store_node_inputs.call_args.kwargs["native_execution_id"] == node.execution_id
    assert recovery.start_or_recover.call_args.kwargs["scope"].workflow_run_id == context.native_run_id
    node._agent_backend_client.create_run.assert_not_called()
    node._agent_backend_client.cancel_run_and_wait.assert_not_called()
    assert node.error_strategy is None


def test_restore_continues_same_child_without_compose_or_create(monkeypatch):
    node, _, parent, preparation, commands, recovery, prepare = _confirmed(monkeypatch, existing=True)
    wait = SimpleNamespace(backend_wait_event_id="original-wait")
    protected = SimpleNamespace(wait=wait, association=SimpleNamespace(agent_run_id="original-child"))
    commands.load_wait.return_value = protected
    commands.continue_wait.return_value = protected
    events = list(node._run())
    assert len(events) == 1
    assert isinstance(events[0], NodeRunPauseRequestedEvent)
    commands.continue_wait.assert_called_once()
    assert commands.continue_wait.call_args.kwargs["parent_node"] == parent
    assert node._agent_backend_client.stream_events.call_args.kwargs["after"] == "original-wait"
    recovery.start_or_recover.assert_not_called()
    preparation.state_store.store_node_inputs.assert_not_called()
    prepare.assert_not_called()


def test_node_recovers_terminal_child_after_lost_continue_ack_without_second_continue(monkeypatch):
    from contextlib import nullcontext
    from datetime import UTC, datetime

    from dify_agent.protocol import (
        RunEventsResponse,
        RunResumedEvent,
        RunResumedEventData,
        RunStatusResponse,
        RunSucceededEvent,
        RunSucceededEventData,
    )
    from dify_agent.protocol.snapshot import SessionSnapshot

    from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands

    node, context, parent, _, commands, recovery, prepare = _confirmed(monkeypatch, existing=True)
    wait = SimpleNamespace(
        parent_node=parent,
        backend_wait_event_id="100-0",
        agent_generation=2,
        checkpoint_digest="b" * 64,
    )
    protected = SimpleNamespace(wait=wait, association=SimpleNamespace(agent_run_id="original-child"))
    commands.load_wait.return_value = protected
    resumed = RunResumedEvent(id="101-0", run_id="original-child", data=RunResumedEventData(generation=3))
    terminal = RunSucceededEvent(
        id="102-0",
        run_id="original-child",
        data=RunSucceededEventData(
            output="done",
            session_snapshot=SessionSnapshot(layers={}),
        ),
    )
    node._agent_backend_client.stream_events.return_value = iter((resumed, terminal))
    raw = MagicMock()
    raw.get_run_sync.return_value = RunStatusResponse(
        run_id="original-child",
        status="succeeded",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    raw.get_events_sync.return_value = RunEventsResponse(
        run_id="original-child",
        events=[resumed, terminal],
        next_cursor=None,
    )
    raw.continue_run_sync.side_effect = AssertionError("terminal child cannot be continued again")
    backend = node._agent_backend_client
    backend.client = raw
    # The C03 SQL claim is an explicit prevalidated port here; exercise the real
    # command's readback and public node behavior after a lost continue ACK.
    loader = SimpleNamespace(
        session_factory=lambda: nullcontext(SimpleNamespace(scalar=lambda _: SimpleNamespace(id="dispatch")))
    )
    store = SimpleNamespace(
        load_context=lambda **_: SimpleNamespace(tenant_id="tenant-1", generation=1),
        read_checkpoint=lambda **_: SimpleNamespace(agent_associations=(wait,)),
        load_agent_association=lambda **_: protected,
    )
    api = SimpleNamespace(
        actor=None,
        loader=loader,
        store=store,
        lifecycle=SimpleNamespace(claimed_resume_checkpoint=lambda **_: object()),
    )
    owner = ConfirmedAgentCommands(api=api, continuation=None, backend=backend, publish=None)
    commands.continue_wait.side_effect = owner.continue_wait
    (event,) = list(node._run())
    assert isinstance(event, StreamCompletedEvent)
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert event.node_run_result.outputs["text"] == "done"
    raw.continue_run_sync.assert_not_called()
    recovery.start_or_recover.assert_not_called()
    prepare.assert_not_called()
    assert backend.stream_events.call_args.kwargs["after"] == "100-0"


def test_unknown_create_ack_pauses_without_approval_or_failure(monkeypatch):
    node, _, _, _, commands, recovery, prepare = _confirmed(monkeypatch, existing=True, unknown=True)
    events = list(node._run())
    assert len(events) == 1
    assert isinstance(events[0], NodeRunPauseRequestedEvent)
    assert events[0].reason.message == "agent_create_ack_unknown"
    assert events[0].node_run_result.status == WorkflowNodeExecutionStatus.PAUSED
    assert not any(isinstance(event, StreamCompletedEvent) for event in events)
    commands.prepare_wait.assert_not_called()
    recovery.start_or_recover.assert_not_called()
    prepare.assert_not_called()
    node._agent_backend_client.cancel_run_and_wait.assert_not_called()


def test_unverified_wait_never_becomes_resumable_approval(monkeypatch):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    node, _, _, _, commands, _, _ = _confirmed(monkeypatch)
    commands.prepare_wait.side_effect = BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
    (event,) = list(node._run())
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert event.reason.message == "native_agent_wait_unverified"
    assert "agent_wait" not in event.node_run_result.process_data
    node._agent_backend_client.cancel_run_and_wait.assert_not_called()


def test_lost_continue_ack_pauses_without_streaming_or_another_create(monkeypatch):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    node, _, _, _, commands, recovery, prepare = _confirmed(monkeypatch, existing=True)
    commands.load_wait.return_value = SimpleNamespace(association=SimpleNamespace(agent_run_id="original-child"))
    commands.continue_wait.side_effect = BuilderExecutionPolicyError("native_agent_continuation_unknown")
    (event,) = list(node._run())
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert event.reason.message == "native_agent_continuation_unknown"
    node._agent_backend_client.stream_events.assert_not_called()
    recovery.start_or_recover.assert_not_called()
    prepare.assert_not_called()


@pytest.mark.parametrize("fault", ["transport", "exhausted"])
def test_confirmed_stream_ack_loss_preserves_child_without_implicit_cancel(monkeypatch, fault):
    from clients.agent_backend import AgentBackendTransportError

    node, _, _, _, _, recovery, _ = _confirmed(monkeypatch, existing=True)
    if fault == "transport":
        node._agent_backend_client.stream_events.side_effect = AgentBackendTransportError("lost SSE ACK")
    else:
        node._agent_backend_client.stream_events.return_value = iter(())
    (event,) = list(node._run())
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert event.reason.message == "agent_stream_ack_unknown"
    assert event.node_run_result.outputs == {}
    recovery.start_or_recover.assert_not_called()
    node._agent_backend_client.cancel_run_and_wait.assert_not_called()


def test_confirmed_output_validation_retry_cannot_allocate_a_second_child(monkeypatch):
    from dify_agent.protocol import RunSucceededEvent, RunSucceededEventData
    from dify_agent.protocol.snapshot import SessionSnapshot

    node, _, _, _, _, recovery, prepare = _confirmed(
        monkeypatch,
        custom_outputs=[
            {
                "name": "score",
                "type": "number",
                "failure_strategy": {"retry": {"enabled": True, "max_retries": 1}},
            }
        ],
    )
    node._agent_backend_client.stream_events.return_value = iter(
        [
            RunSucceededEvent(
                id="done",
                run_id="original-child",
                data=RunSucceededEventData(
                    output={"score": "invalid"},
                    session_snapshot=SessionSnapshot(layers={}),
                ),
            ),
        ]
    )
    (event,) = list(node._run())
    assert isinstance(event, StreamCompletedEvent)
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert event.node_run_result.error_type == "native_agent_output_retry_unavailable"
    recovery.start_or_recover.assert_called_once()
    prepare.assert_called_once()


def test_node_factory_injects_confirmed_owners_only_for_server_marker(monkeypatch):
    from services.dify_builder import wiring
    from services.workflow_runtime.agent_node import DifyAgentNode
    from services.workflow_runtime.node_factory import DifyNodeFactory

    node, _, _, _, _, _, _ = _confirmed(monkeypatch)
    factory = object.__new__(DifyNodeFactory)
    factory._dify_context = node.graph_init_params.run_context[DIFY_RUN_CONTEXT_KEY]
    owners = (object(), object(), object())
    build = MagicMock(return_value=owners)
    monkeypatch.setattr(wiring, "build_confirmed_agent_node_owners", build, raising=False)
    monkeypatch.setattr("clients.agent_backend.factory.create_agent_backend_run_client", lambda **_: object())
    kwargs = factory._build_agent_node_init_kwargs(node_class=DifyAgentNode)
    assert kwargs["agent_preparation"] is owners[0]
    assert kwargs["agent_commands"] is owners[1]
    assert kwargs["agent_run_recovery"] is owners[2]
    assert build.call_args.kwargs["backend"] is kwargs["agent_backend_client"]
    build.reset_mock()
    factory._dify_context.builder_agent_execution = None
    assert "agent_preparation" not in factory._build_agent_node_init_kwargs(node_class=DifyAgentNode)
    build.assert_not_called()
