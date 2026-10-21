"""Confirmed Agent control stays attached to its durable child and exact inputs."""

from unittest.mock import MagicMock

import pytest
import pytest_mock
import sqlalchemy.orm
from dify_agent.client import Client
from dify_agent.protocol import (
    CreateRunRequest,
    CreateRunResponse,
    RunComposition,
    RunWaitingEvent,
    RunWaitingEventData,
)

from clients.agent_backend.client import DifyAgentBackendRunClient
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
from core.dify_builder.models import Actor
from graphon.engine_events.node import NodeRunPauseRequestedEvent
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import ErrorStrategy, WorkflowNodeExecutionStatus
from graphon.node_events import StreamCompletedEvent
from graphon.variables.segments import StringSegment
from models.dify_builder_native_tests import NativeDispatch
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.agent_contracts import (
    AgentCreateInserted,
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentProtectedState,
    AgentStartPreparation,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.contracts import CheckpointRef, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NodeJournalState,
    ResolvedNativeTestContext,
)
from services.agent.workflow_run_recovery import AgentCreateAcknowledgementUnknown, WorkflowAgentRunRecovery
from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
from services.dify_builder.native_testing.agent_runtime_config import (
    NativeAgentDefinition,
    NativeAgentRuntimeConfigBuilder,
)
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from services.workflow_runtime.agent_node import DifyAgentNode
from tests.unit_tests.core.workflow.nodes.agent_v2.test_agent_node import FakeBindingResolver, _node
from tests.unit_tests.installed_spies import installed_mock
from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker


def _resolved(context: BuilderAgentExecutionContext, *, generation: int = 0) -> ResolvedNativeTestContext:
    return ResolvedNativeTestContext(
        ref=context.ref,
        tenant_id="tenant-1",
        actor_id="user-1",
        app_id="app-1",
        workflow_id="workflow-1",
        graph={},
        inputs={},
        graph_revision="a" * 64,
        input_revision="b" * 64,
        resource_manifest=(),
        generation=generation,
        root_native_run_id=context.native_run_id,
        native_run_id=context.native_run_id,
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="budget",
        cancellation_ref="cancellation",
        execution_mode="native",
    )


def _wait(parent: AgentParentNodeRef, *, event: str = "original-wait", generation: int = 2) -> AgentWaitAssociation:
    return AgentWaitAssociation(
        parent_node=parent,
        association_object_ref="association",
        agent_generation=generation,
        checkpoint_object_ref="owned-wait",
        checkpoint_digest="b" * 64,
        backend_wait_event_id=event,
    )


def _protected(parent: AgentParentNodeRef, *, event: str = "original-wait") -> AgentProtectedState:
    return AgentProtectedState(
        association_object_ref="association",
        association=AgentNodeAssociation(
            parent_node=parent,
            workflow_native_run_id=parent.ref.request_id,
            agent_run_id="original-child",
            config_ref="config",
            config_digest="b" * 64,
            pinned_snapshot_id="snapshot",
            home_snapshot_id=None,
            workspace=AgentTestWorkspaceRef(
                binding_id="binding",
                workspace_id="workspace",
                backend_binding_ref="backend-binding",
                backend_workspace_ref="backend-workspace",
                pinned_snapshot_id="snapshot",
                home_snapshot_id=None,
                workspace_generation=0,
            ),
        ),
        wait=_wait(parent, event=event),
        checkpoint={},
        terminal_result_ref=None,
        terminal_result=None,
    )


def _api(
    factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session], actor: Actor | None = None
) -> NativeTestApiService:
    return NativeTestApiService(
        session_factory=factory,
        actor=actor or Actor(account_id="user-1", tenant_id="tenant-1"),
        resolver=None,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    )


def _confirmed(
    monkeypatch: pytest.MonkeyPatch,
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    *,
    existing: bool = False,
    unknown: bool = False,
    custom_outputs: list[dict[str, object]] | None = None,
) -> tuple[
    DifyAgentNode,
    BuilderAgentExecutionContext,
    AgentParentNodeRef,
    AgentPreparationService,
    ConfirmedAgentCommands,
    WorkflowAgentRunRecovery,
    MagicMock,
]:
    context = marker()
    api = _api(sqlite_session_factory)
    store = api.store
    mocker.patch.object(store, "load_context", return_value=_resolved(context))
    mocker.patch.object(store, "store_node_inputs", return_value="input-ref")
    raw = Client(base_url="http://127.0.0.1:1")
    backend = DifyAgentBackendRunClient(raw)
    config_builder = NativeAgentRuntimeConfigBuilder(loader=api.loader, profile="confirmed")
    preparation = AgentPreparationService(state_store=store, backend=raw, workspace=None, config_builder=config_builder)
    mocker.patch.object(config_builder, "typed_inputs", return_value={"query": "typed", "values": {"prior.number": 42}})
    commands = ConfirmedAgentCommands(api=api, continuation=None, backend=backend, publish=None)
    mocker.patch.object(commands, "load_wait", return_value=None)
    mocker.patch.object(commands, "continue_wait")
    mocker.patch.object(commands, "prepare_wait")
    recovery = WorkflowAgentRunRecovery(sqlite_session_factory)
    mocker.patch.object(
        recovery,
        "recover_existing",
        return_value=(CreateRunResponse(run_id="original-child", status="running") if existing else None),
    )
    mocker.patch.object(
        recovery, "start_or_recover", return_value=CreateRunResponse(run_id="original-child", status="running")
    )
    if unknown:
        _installed_spy_33 = installed_mock(recovery.recover_existing)
        _installed_spy_33.side_effect = AgentCreateAcknowledgementUnknown("unknown")
    resolver = FakeBindingResolver()
    node = _node(
        binding_resolver=resolver,
        confirmed_owners=(preparation, commands, recovery),
        declared_outputs=custom_outputs,
        error_strategy=ErrorStrategy.DEFAULT_VALUE,
    )
    mocker.patch.object(
        config_builder,
        "load_definition",
        return_value=NativeAgentDefinition(
            node_id="agent-node",
            agent_id=resolver.agent.id,
            snapshot_id=resolver.snapshot.id,
            soul=resolver.snapshot.config_snapshot,
            node_job=resolver.binding.node_job_config,
            stamp="a" * 64,
        ),
    )
    run_context = node.require_run_context_value(DIFY_RUN_CONTEXT_KEY)
    run_context.builder_agent_execution = context
    # A Workflow context has no owning chat conversation.
    pool = node.runtime_state.variable_pool
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

    def saved_parent(
        *, state_store: NativeExecutionStateStore, ref: NativeTestContextRef, execution_id: str
    ) -> AgentParentNodeRef | None:
        assert state_store is preparation.state_store
        assert (ref, execution_id) == (context.ref, node.execution_id)
        return parent if existing else None

    monkeypatch.setattr(workspace, "load_confirmed_agent_parent", saved_parent)
    prepared = AgentStartPreparation(
        claim=AgentCreateInserted(config_ref="config", config_digest="b" * 64),
        parent_node=parent,
        request=CreateRunRequest(composition=RunComposition(layers=[]), idempotency_key="stable-original"),
    )
    prepare = mocker.patch.object(workspace, "prepare_confirmed_agent_request", return_value=prepared)
    mocker.patch.object(
        node._runtime_request_builder, "build", side_effect=AssertionError("confirmed must not rebuild ordinary tools")
    )
    node._agent_backend_client = backend
    mocker.patch.object(
        backend, "create_run", side_effect=AssertionError("confirmed must not create an ordinary child")
    )
    mocker.patch.object(backend, "cancel_run_and_wait")
    mocker.patch.object(
        backend,
        "stream_events",
        return_value=iter(
            [
                RunWaitingEvent(
                    id="waiting-event",
                    run_id="original-child",
                    data=RunWaitingEventData(generation=2, pending_actions=()),
                ),
            ]
        ),
    )
    _installed_spy_1 = installed_mock(commands.prepare_wait)
    _installed_spy_1.return_value = _wait(parent, event="waiting-event")
    return node, context, parent, preparation, commands, recovery, prepare


def test_confirmed_wait_emits_pause_after_checkpoint_owner_without_failure_or_cancel(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    node, context, _, preparation, commands, recovery, prepare = _confirmed(monkeypatch, mocker, sqlite_session_factory)
    events = list(node._run())
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert isinstance(event.reason, SchedulingPause)
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.PAUSED
    assert event.node_run_result.outputs == {}
    _installed_spy_2 = installed_mock(commands.prepare_wait)
    assert _installed_spy_2.call_args.kwargs["agent_generation"] == 2
    _installed_spy_3 = installed_mock(commands.prepare_wait)
    assert _installed_spy_3.call_args.kwargs["backend_wait_event_id"] == "waiting-event"
    assert prepare.call_args.kwargs["inputs"] == {"query": "typed", "values": {"prior.number": 42}}
    _installed_spy_4 = installed_mock(preparation.state_store.store_node_inputs)
    assert _installed_spy_4.call_args.kwargs["native_execution_id"] == node.execution_id
    _installed_spy_5 = installed_mock(recovery.start_or_recover)
    assert _installed_spy_5.call_args.kwargs["scope"].workflow_run_id == context.native_run_id
    _installed_spy_6 = installed_mock(node._agent_backend_client.create_run)
    _installed_spy_6.assert_not_called()
    _installed_spy_7 = installed_mock(node._agent_backend_client.cancel_run_and_wait)
    _installed_spy_7.assert_not_called()
    assert node.error_strategy is None


def test_restore_continues_same_child_without_compose_or_create(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    node, _, parent, preparation, commands, recovery, prepare = _confirmed(
        monkeypatch, mocker, sqlite_session_factory, existing=True
    )
    protected = _protected(parent)
    _installed_spy_8 = installed_mock(commands.load_wait)
    _installed_spy_8.return_value = protected
    _installed_spy_9 = installed_mock(commands.continue_wait)
    _installed_spy_9.return_value = protected
    events = list(node._run())
    assert len(events) == 1
    assert isinstance(events[0], NodeRunPauseRequestedEvent)
    _installed_spy_10 = installed_mock(commands.continue_wait)
    _installed_spy_10.assert_called_once()
    _installed_spy_11 = installed_mock(commands.continue_wait)
    assert _installed_spy_11.call_args.kwargs["parent_node"] == parent
    _installed_spy_12 = installed_mock(node._agent_backend_client.stream_events)
    assert _installed_spy_12.call_args.kwargs["after"] == "original-wait"
    _installed_spy_13 = installed_mock(recovery.start_or_recover)
    _installed_spy_13.assert_not_called()
    _installed_spy_14 = installed_mock(preparation.state_store.store_node_inputs)
    _installed_spy_14.assert_not_called()
    prepare.assert_not_called()


def test_node_recovers_terminal_child_after_lost_continue_ack_without_second_continue(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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

    node, context, parent, _, commands, recovery, prepare = _confirmed(
        monkeypatch, mocker, sqlite_session_factory, existing=True
    )
    protected = _protected(parent, event="100-0")
    wait = protected.wait
    _installed_spy_15 = installed_mock(commands.load_wait)
    _installed_spy_15.return_value = protected
    resumed = RunResumedEvent(id="101-0", run_id="original-child", data=RunResumedEventData(generation=3))
    terminal = RunSucceededEvent(
        id="102-0",
        run_id="original-child",
        data=RunSucceededEventData(
            output="done",
            session_snapshot=SessionSnapshot(layers={}),
        ),
    )
    _installed_spy_16 = installed_mock(node._agent_backend_client.stream_events)
    _installed_spy_16.return_value = iter((resumed, terminal))
    assert isinstance(node._agent_backend_client, DifyAgentBackendRunClient)
    raw = node._agent_backend_client.client
    assert isinstance(raw, Client)
    mocker.patch.object(
        raw,
        "get_run_sync",
        return_value=RunStatusResponse(
            run_id="original-child",
            status="succeeded",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        ),
    )
    mocker.patch.object(
        raw,
        "get_events_sync",
        return_value=RunEventsResponse(
            run_id="original-child",
            events=[resumed, terminal],
            next_cursor=None,
        ),
    )
    mocker.patch.object(
        raw, "continue_run_sync", side_effect=AssertionError("terminal child cannot be continued again")
    )
    backend = node._agent_backend_client
    # The C03 SQL claim is an explicit prevalidated port here; exercise the real
    # command's readback and public node behavior after a lost continue ACK.
    api = _api(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(
            NativeDispatch(
                id="dispatch",
                tenant_id="tenant-1",
                request_id=context.ref.request_id,
                invocation_id=context.ref.invocation_id,
                generation=1,
                idempotency_digest="c" * 64,
                state="claimed",
            )
        )
    mocker.patch.object(api.store, "load_context", return_value=_resolved(context, generation=1))
    checkpoint = CheckpointRef(checkpoint_id="checkpoint", payload_digest="d" * 64)
    mocker.patch.object(api.lifecycle, "claimed_resume_checkpoint", return_value=checkpoint)
    mocker.patch.object(
        api.store,
        "read_checkpoint",
        return_value=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=context.native_run_id,
            generation=1,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=(
                NodeJournalState(
                    invocation_id=parent.ref.invocation_id,
                    occurrence_path=(parent.execution_id,),
                    input_result_ref=parent.input_result_ref,
                    input_digest=parent.input_digest,
                    cursor=0,
                    operation_keys=(),
                    result_refs=(),
                ),
            ),
            child_refs=(),
            input_result_refs=(parent.input_result_ref,),
            agent_associations=(wait,),
        ),
    )
    mocker.patch.object(api.store, "load_agent_association", return_value=protected)
    owner = ConfirmedAgentCommands(api=api, continuation=None, backend=backend, publish=None)
    _installed_spy_17 = installed_mock(commands.continue_wait)
    _installed_spy_17.side_effect = owner.continue_wait
    (event,) = list(node._run())
    assert isinstance(event, StreamCompletedEvent)
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert event.node_run_result.outputs["text"] == "done"
    installed_mock(raw.continue_run_sync).assert_not_called()
    _installed_spy_18 = installed_mock(recovery.start_or_recover)
    _installed_spy_18.assert_not_called()
    prepare.assert_not_called()
    _installed_spy_19 = installed_mock(backend.stream_events)
    assert _installed_spy_19.call_args.kwargs["after"] == "100-0"


def test_unknown_create_ack_pauses_without_approval_or_failure(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    node, _, _, _, commands, recovery, prepare = _confirmed(
        monkeypatch, mocker, sqlite_session_factory, existing=True, unknown=True
    )
    events = list(node._run())
    assert len(events) == 1
    assert isinstance(events[0], NodeRunPauseRequestedEvent)
    assert isinstance(events[0].reason, SchedulingPause)
    assert events[0].reason.message == "agent_create_ack_unknown"
    assert events[0].node_run_result.status == WorkflowNodeExecutionStatus.PAUSED
    assert not any(isinstance(event, StreamCompletedEvent) for event in events)
    _installed_spy_20 = installed_mock(commands.prepare_wait)
    _installed_spy_20.assert_not_called()
    _installed_spy_21 = installed_mock(recovery.start_or_recover)
    _installed_spy_21.assert_not_called()
    prepare.assert_not_called()
    _installed_spy_22 = installed_mock(node._agent_backend_client.cancel_run_and_wait)
    _installed_spy_22.assert_not_called()


def test_unverified_wait_never_becomes_resumable_approval(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    node, _, _, _, commands, _, _ = _confirmed(monkeypatch, mocker, sqlite_session_factory)
    _installed_spy_23 = installed_mock(commands.prepare_wait)
    _installed_spy_23.side_effect = BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
    (event,) = list(node._run())
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert isinstance(event.reason, SchedulingPause)
    assert event.reason.message == "native_agent_wait_unverified"
    assert "agent_wait" not in event.node_run_result.process_data
    _installed_spy_24 = installed_mock(node._agent_backend_client.cancel_run_and_wait)
    _installed_spy_24.assert_not_called()


def test_lost_continue_ack_pauses_without_streaming_or_another_create(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    node, _, parent, _, commands, recovery, prepare = _confirmed(
        monkeypatch, mocker, sqlite_session_factory, existing=True
    )
    _installed_spy_25 = installed_mock(commands.load_wait)
    _installed_spy_25.return_value = _protected(parent)
    _installed_spy_26 = installed_mock(commands.continue_wait)
    _installed_spy_26.side_effect = BuilderExecutionPolicyError("native_agent_continuation_unknown")
    (event,) = list(node._run())
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert isinstance(event.reason, SchedulingPause)
    assert event.reason.message == "native_agent_continuation_unknown"
    _installed_spy_27 = installed_mock(node._agent_backend_client.stream_events)
    _installed_spy_27.assert_not_called()
    _installed_spy_28 = installed_mock(recovery.start_or_recover)
    _installed_spy_28.assert_not_called()
    prepare.assert_not_called()


@pytest.mark.parametrize("fault", ["transport", "exhausted"])
def test_confirmed_stream_ack_loss_preserves_child_without_implicit_cancel(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
    fault: str,
) -> None:
    from clients.agent_backend import AgentBackendTransportError

    node, _, _, _, _, recovery, _ = _confirmed(monkeypatch, mocker, sqlite_session_factory, existing=True)
    if fault == "transport":
        _installed_spy_34 = installed_mock(node._agent_backend_client.stream_events)
        _installed_spy_34.side_effect = AgentBackendTransportError("lost SSE ACK")
    else:
        _installed_spy_35 = installed_mock(node._agent_backend_client.stream_events)
        _installed_spy_35.return_value = iter(())
    (event,) = list(node._run())
    assert isinstance(event, NodeRunPauseRequestedEvent)
    assert isinstance(event.reason, SchedulingPause)
    assert event.reason.message == "agent_stream_ack_unknown"
    assert event.node_run_result.outputs == {}
    _installed_spy_29 = installed_mock(recovery.start_or_recover)
    _installed_spy_29.assert_not_called()
    _installed_spy_30 = installed_mock(node._agent_backend_client.cancel_run_and_wait)
    _installed_spy_30.assert_not_called()


def test_confirmed_output_validation_retry_cannot_allocate_a_second_child(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dify_agent.protocol import RunSucceededEvent, RunSucceededEventData
    from dify_agent.protocol.snapshot import SessionSnapshot

    node, _, _, _, _, recovery, prepare = _confirmed(
        monkeypatch,
        mocker,
        sqlite_session_factory,
        custom_outputs=[
            {
                "name": "score",
                "type": "number",
                "failure_strategy": {"retry": {"enabled": True, "max_retries": 1}},
            }
        ],
    )
    _installed_spy_31 = installed_mock(node._agent_backend_client.stream_events)
    _installed_spy_31.return_value = iter(
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
    _installed_spy_32 = installed_mock(recovery.start_or_recover)
    _installed_spy_32.assert_called_once()
    prepare.assert_called_once()


def test_node_factory_injects_confirmed_owners_only_for_server_marker(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.dify_builder import wiring
    from services.workflow_runtime.agent_node import DifyAgentNode
    from services.workflow_runtime.node_factory import DifyNodeFactory

    node, _, _, _, _, _, _ = _confirmed(monkeypatch, mocker, sqlite_session_factory)
    factory = DifyNodeFactory(init_params=node.init_params, runtime_state=node.runtime_state)
    owners = (node._agent_preparation, node._agent_commands, node._agent_run_recovery)
    build = mocker.patch.object(wiring, "build_confirmed_agent_node_owners", return_value=owners)
    monkeypatch.setattr(
        "clients.agent_backend.factory.create_agent_backend_run_client", lambda **_: node._agent_backend_client
    )
    kwargs = factory._build_agent_node_init_kwargs(node_class=DifyAgentNode)
    assert kwargs["agent_preparation"] is owners[0]
    assert kwargs["agent_commands"] is owners[1]
    assert kwargs["agent_run_recovery"] is owners[2]
    assert build.call_args.kwargs["backend"] is kwargs["agent_backend_client"]
    build.reset_mock()
    factory._dify_context.builder_agent_execution = None
    assert "agent_preparation" not in factory._build_agent_node_init_kwargs(node_class=DifyAgentNode)
    build.assert_not_called()
