"""Command composition at the existing ordinary resume task boundary."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

import httpx
import pytest
import pytest_mock
import sqlalchemy.orm
from dify_agent.client import Client
from sqlalchemy import Table, select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend import DifyAgentBackendRunClient
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.dify_builder.models import Actor
from graphon.runtime import RuntimeState
from models.dify_builder_native_tests import NativeTestScope
from models.workflow import WorkflowPause
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentProtectedState,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.contracts import NativeTestContextRef, ResumeReceipt
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.agent.workflow_run_recovery import AgentCreateScope
from services.dify_builder.native_testing import confirmed_agent_commands as commands_module
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_continuation import (
    ConfirmedAgentContinuation,
    OwnedParentPause,
)
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import OwnedNativeTest
from tests.unit_tests.core.app.entities.test_app_invoke_entities import _create_workflow_generate_entity
from tests.unit_tests.installed_spies import installed_mock
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT

REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)
RUN = str(uuid4())
ACTOR = Actor(account_id="account", tenant_id="tenant")


def envelope() -> dict[str, object]:
    return {
        "workflow_run_id": RUN,
        "builder_agent_dispatch": {
            "ref": REF.model_dump(mode="json"),
            "generation": 1,
            "dispatch_id": "dispatch",
            "actor": {"account_id": ACTOR.account_id, "tenant_id": ACTOR.tenant_id},
        },
    }


def entity(*, marked: bool = True) -> WorkflowAppGenerateEntity:
    result = _create_workflow_generate_entity()
    result.builder_agent_execution = BuilderAgentExecutionContext(ref=REF, native_run_id=RUN) if marked else None
    return result


def _api(factory: sessionmaker[Session] | None = None, *, actor: Actor = ACTOR) -> NativeTestApiService:
    return NativeTestApiService(
        session_factory=factory or sessionmaker(),
        actor=actor,
        resolver=None,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    )


def _context(*, generation: int = 1, scope: AgentCreateScope | None = None) -> ResolvedNativeTestContext:
    return ResolvedNativeTestContext.model_validate(
        {
            **CONTEXT,
            "ref": REF,
            "tenant_id": scope.tenant_id if scope else ACTOR.tenant_id,
            "app_id": scope.app_id if scope else "app",
            "workflow_id": scope.workflow_id if scope else "workflow",
            "native_run_id": RUN,
            "root_native_run_id": RUN,
            "generation": generation,
        }
    )


def _owned() -> OwnedNativeTest:
    return OwnedNativeTest(
        ref=REF,
        tenant_id=ACTOR.tenant_id,
        actor_id=ACTOR.account_id,
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=1,
        task_approved=True,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        state="running",
    )


def _scope() -> NativeTestScope:
    return NativeTestScope(
        request_id=REF.request_id,
        tenant_id=ACTOR.tenant_id,
        generation=1,
        task_approved=True,
        cancelled=False,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        budget_limits={},
        budget_spent={},
        profile={},
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
    )


def _continuation(
    api: NativeTestApiService, backend: DifyAgentBackendRunClient | None = None
) -> ConfirmedAgentContinuation:
    return ConfirmedAgentContinuation(
        loader=api.loader,
        store=api.store,
        operations=None,
        backend=backend,
        lifecycle=api.lifecycle,
    )


def _protected() -> AgentProtectedState:
    parent = AgentParentNodeRef(
        ref=REF,
        execution_id="00000000-0000-4000-8000-000000000001",
        input_result_ref="input",
        input_digest="b" * 64,
    )
    workspace = AgentTestWorkspaceRef(
        binding_id="binding",
        workspace_id="workspace",
        backend_binding_ref="backend-binding",
        backend_workspace_ref="backend-workspace",
        pinned_snapshot_id="snapshot",
        home_snapshot_id=None,
        workspace_generation=0,
    )
    return AgentProtectedState(
        association_object_ref="association",
        association=AgentNodeAssociation(
            parent_node=parent,
            workflow_native_run_id=RUN,
            agent_run_id="child",
            config_ref="config",
            config_digest="c" * 64,
            pinned_snapshot_id="snapshot",
            home_snapshot_id=None,
            workspace=workspace,
        ),
        wait=AgentWaitAssociation(
            parent_node=parent,
            association_object_ref="association",
            agent_generation=0,
            checkpoint_object_ref="checkpoint",
            checkpoint_digest="d" * 64,
            backend_wait_event_id="100-0",
        ),
        checkpoint={},
        terminal_result_ref=None,
        terminal_result=None,
    )


def _pause(runtime: RuntimeState | None = None) -> OwnedParentPause:
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
    from graphon.runtime import RuntimeState, VariablePool

    return OwnedParentPause(
        pause_id="pause",
        state_object_key="pause-object",
        native_run_id=RUN,
        state=WorkflowResumptionContext(
            serialized_graph_runtime_state="{}", generate_entity=_WorkflowGenerateEntityWrapper(entity=entity())
        ),
        runtime=runtime or RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
    )


def test_ordinary_legacy_resume_keeps_its_existing_path() -> None:
    assert commands_module.guard_confirmed_agent_resume(
        payload={"workflow_run_id": RUN}, generate_entity=entity(marked=False)
    )


def test_actual_resume_task_refuses_malformed_marked_envelope_before_unscoped_storage() -> None:
    from tasks.app_generate.workflow_execute_task import _resume_app_execution

    # Without the preflight this would reach the legacy repository/database
    # before discovering that a confirmed task carries no valid dispatch.
    with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_mismatch"):
        _resume_app_execution({"workflow_run_id": RUN, "builder_agent_dispatch": {"approval": True}})


@pytest.mark.parametrize("change", ["missing", "run", "ref", "boolean_generation", "extra"])
def test_marked_resume_requires_exact_dispatch_envelope_before_any_claim(change: str) -> None:
    payload = envelope()
    if change == "missing":
        payload.pop("builder_agent_dispatch")
    elif change == "run":
        payload["workflow_run_id"] = str(uuid4())
    elif change == "ref":
        cast(dict[str, object], cast(dict[str, object], payload["builder_agent_dispatch"])["ref"])["request_id"] = (
            "foreign"
        )
    elif change == "boolean_generation":
        cast(dict[str, object], payload["builder_agent_dispatch"])["generation"] = True
    else:
        cast(dict[str, object], payload["builder_agent_dispatch"])["approval"] = True
    with pytest.raises(BuilderExecutionPolicyError):
        commands_module.guard_confirmed_agent_resume(payload=payload, generate_entity=entity())


def test_guard_uses_claim_owner_and_drops_redelivery_without_second_resume() -> None:
    from flask import Flask

    calls = []

    class Commands:
        actor = ACTOR

        def claim_resume(self, **values: object) -> bool:
            assert values == {"ref": REF, "native_run_id": RUN, "generation": 1, "dispatch_id": "dispatch"}
            calls.append(values)
            return len(calls) == 1

    app = Flask(__name__)
    app.extensions["confirmed_agent_command_factory"] = lambda *, actor: Commands() if actor == ACTOR else None
    with app.app_context():
        assert commands_module.guard_confirmed_agent_resume(payload=envelope(), generate_entity=entity())
        assert not commands_module.guard_confirmed_agent_resume(payload=envelope(), generate_entity=entity())
    assert len(calls) == 2


def test_resume_publishes_only_after_committed_lifecycle_resume(mocker: pytest_mock.MockerFixture) -> None:
    events: list[object] = []
    receipt = ResumeReceipt(request_id=REF.request_id, generation=1, dispatch_id="dispatch", status="queued")
    api = _api()
    mocker.patch.object(api.lifecycle, "resume", side_effect=lambda **_: events.append("committed") or receipt)
    commands = commands_module.ConfirmedAgentCommands(api=api, continuation=None, backend=None, publish=None)
    commands._request = lambda **_: None
    commands._root_ref = lambda **_: REF
    commands._publish_one = lambda **_: events.append("published") or True
    commands.get = lambda **_: "receipt"
    assert (
        commands.resume(
            actor=ACTOR, session_id="session", request_id="request", expected_generation=0, idempotency_key="once"
        )
        == "receipt"
    )
    assert events == ["committed", "published"]


def test_actual_sql_outbox_survives_lost_enqueue_ack_and_reuses_dispatch(
    mocker: pytest_mock.MockerFixture, sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session]
) -> None:
    from contextlib import contextmanager

    from models.dify_builder_native_tests import NativeDispatch

    owned = _owned()

    @contextmanager
    def locked(**_values: object) -> Generator[tuple[Session, OwnedNativeTest, NativeTestScope | None]]:
        with sqlite_session_factory.begin() as sql:
            yield sql, owned, None

    with sqlite_session_factory.begin() as sql:
        table = NativeDispatch.__table__
        assert isinstance(table, Table)
        assert isinstance(table, Table)
        table.create(sql.connection(), checkfirst=True)
        sql.add(
            NativeDispatch(
                id="dispatch",
                tenant_id="tenant",
                request_id=REF.request_id,
                invocation_id=REF.invocation_id,
                generation=1,
                idempotency_digest="b" * 64,
                state="queued",
                checkpoint_id="checkpoint",
                claim_expires_at=None,
            )
        )
    api = _api(sqlite_session_factory)
    mocker.patch.object(api.loader, "locked", side_effect=locked)
    mocker.patch.object(api.store, "load_context", return_value=_context())
    envelopes = []

    def publish(**values: object) -> None:
        # The broker callback sees a separately committed SQL source. An enqueue
        # ACK can vanish without removing or allocating a replacement dispatch.
        with sqlite_session_factory() as sql:
            dispatch = sql.get(NativeDispatch, "dispatch")
            assert dispatch is not None
            assert dispatch.state == "queued"
        envelopes.append(values)
        if len(envelopes) == 1:
            raise TimeoutError("broker ACK lost")

    commands = commands_module.ConfirmedAgentCommands(api=api, continuation=None, backend=None, publish=publish)
    commands._publish_one(ref=REF, generation=1, dispatch_id="dispatch")
    with sqlite_session_factory() as sql:
        dispatch = sql.get(NativeDispatch, "dispatch")
        assert dispatch is not None
        assert dispatch.state == "queued"
    commands._publish_one(ref=REF, generation=1, dispatch_id="dispatch")
    assert envelopes[0] == envelopes[1]
    with sqlite_session_factory() as sql:
        dispatch = sql.get(NativeDispatch, "dispatch")
        assert dispatch is not None
        assert dispatch.state == "published"


@pytest.mark.parametrize(
    ("status", "generation", "observed"),
    [
        ("succeeded", 1, True),
        ("running", 1, True),
        ("waiting", None, False),
        ("running", None, None),
        ("running", 2, None),
    ],
)
def test_continuation_readback_recovers_same_generation_without_second_continue(
    status: str, generation: int | None, observed: bool | None
) -> None:
    from dify_agent.client import Client

    from clients.agent_backend import DifyAgentBackendRunClient

    calls = []

    def transport(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/runs/child":
            return httpx.Response(
                200,
                json={
                    "run_id": "child",
                    "status": status,
                    "created_at": "2026-10-17T00:00:00Z",
                    "updated_at": "2026-10-17T00:00:01Z",
                },
            )
        assert request.url.path == "/runs/child/events"
        assert request.url.params["after"] == "100-0"
        events: list[object] = []
        if generation is not None:
            events.append({"id": "101-0", "type": "run_resumed", "run_id": "child", "data": {"generation": generation}})
        if status == "succeeded":
            events.append(
                {
                    "id": "102-0",
                    "type": "run_succeeded",
                    "run_id": "child",
                    "data": {"output": "done", "session_snapshot": {"schema_version": 2, "layers": {}}},
                }
            )
        return httpx.Response(200, json={"run_id": "child", "events": events, "next_cursor": None})

    backend = DifyAgentBackendRunClient(
        Client(base_url="http://test.invalid", sync_http_client=httpx.Client(transport=httpx.MockTransport(transport)))
    )
    commands = commands_module.ConfirmedAgentCommands(api=_api(), continuation=None, backend=backend, publish=None)
    protected = _protected()
    if observed is None:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_continuation_unknown"):
            commands._continuation_observed(protected=protected)
    else:
        assert commands._continuation_observed(protected=protected) is observed
    assert calls == ["/runs/child", "/runs/child/events"]


def test_readback_accepts_actual_backend_retained_cursor_on_empty_event_page(mocker: pytest_mock.MockerFixture) -> None:
    from dify_agent.protocol.schemas import RunEventsResponse, RunResumedEvent, RunResumedEventData, RunStatusResponse

    cursors = []

    def events(run_id: str, *, after: str | None, limit: int) -> RunEventsResponse:
        assert limit == 100
        cursors.append(after)
        event_list = (
            [RunResumedEvent(id="101-0", run_id=run_id, data=RunResumedEventData(generation=1))]
            if after == "100-0"
            else []
        )
        return RunEventsResponse(run_id=run_id, events=event_list, next_cursor="101-0")

    status = RunStatusResponse(
        run_id="child", status="running", created_at="2026-10-17T00:00:00Z", updated_at="2026-10-17T00:00:01Z"
    )
    raw = Client(base_url="http://127.0.0.1:1")
    mocker.patch.object(raw, "get_run_sync", return_value=status)
    mocker.patch.object(raw, "get_events_sync", side_effect=events)
    commands = commands_module.ConfirmedAgentCommands(
        api=_api(),
        continuation=None,
        publish=None,
        backend=DifyAgentBackendRunClient(raw),
    )
    protected = _protected()
    assert commands._continuation_observed(protected=protected)
    assert cursors == ["100-0", "101-0"]
    terminal_status = status.model_copy(update={"status": "succeeded"})
    installed_mock(raw.get_run_sync).return_value = terminal_status
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_continuation_unknown"):
        commands._continuation_observed(protected=protected, require_terminal=True)


def test_completed_child_recovery_requeues_original_claim_only_after_terminal_proof(
    mocker: pytest_mock.MockerFixture, sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session]
) -> None:
    """Actual SQL source identity; lifecycle's independently tested fencing port is explicit."""
    from contextlib import contextmanager

    from sqlalchemy import select

    from models.dify_builder_native_tests import NativeDispatch, NativeEffectOperation, NativeInvocationState

    owned = _owned()
    with sqlite_session_factory.begin() as sql:
        for table in (NativeDispatch.__table__, NativeEffectOperation.__table__, NativeInvocationState.__table__):
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        sql.add(
            NativeInvocationState(
                tenant_id="tenant",
                request_id=REF.request_id,
                invocation_id=REF.invocation_id,
                app_id="app",
                workflow_id="workflow",
                context_object_id="context",
                parent_invocation_id=None,
                parent_operation_digest=None,
                child_identity_digest=None,
                generation=1,
                state="running",
                checkpoint_id="checkpoint",
                pending_ids=["pending"],
                wait_reason=None,
                outcome=None,
                resolution=[],
                cancellation_key=None,
            )
        )
        sql.add(
            NativeDispatch(
                id="original-dispatch",
                tenant_id="tenant",
                request_id=REF.request_id,
                invocation_id=REF.invocation_id,
                generation=1,
                idempotency_digest="b" * 64,
                state="claimed",
                checkpoint_id="checkpoint",
                claim_expires_at=None,
            )
        )
        sql.add(
            NativeEffectOperation(
                tenant_id="tenant",
                request_id=REF.request_id,
                invocation_id=REF.invocation_id,
                operation_digest="c" * 64,
                intent_digest="d" * 64,
                scope_digest="e" * 64,
                state="completed",
                result_ref="result",
            )
        )

    @contextmanager
    def locked(**_values: object) -> Generator[tuple[Session, OwnedNativeTest, NativeTestScope | None]]:
        with sqlite_session_factory.begin() as sql:
            yield sql, owned, _scope()

    events: list[object] = []

    def recover_dispatch(**values: object) -> None:
        assert values == {"ref": REF, "dispatch_id": "original-dispatch"}
        with sqlite_session_factory.begin() as sql:
            dispatch = sql.get(NativeDispatch, "original-dispatch")
            assert dispatch is not None
            assert dispatch.state == "unknown"
            dispatch.state = "queued"
        events.append("lifecycle-fence-recover")

    api = _api(sqlite_session_factory)
    mocker.patch.object(api.loader, "locked", side_effect=locked)
    mocker.patch.object(api.lifecycle, "recover_dispatch", side_effect=recover_dispatch)
    mocker.patch.object(api.store, "load_context", return_value=_context())
    continuation = _continuation(api)
    pause = WorkflowPause(workflow_id="workflow", workflow_run_id=RUN, state_object_key="pause-object")
    pause.id = "pause"
    mocker.patch.object(continuation, "_parent_rows", return_value=(None, pause))
    commands = commands_module.ConfirmedAgentCommands(api=api, continuation=continuation, backend=None, publish=None)
    protected = _protected()
    mocker.patch.object(commands, "load_wait", return_value=protected)
    mocker.patch.object(commands, "_terminal_recovery_proof", return_value=_pause())
    commands._publish_one = lambda **values: events.append(("publish", values)) or True
    assert commands._recover_terminal_continuation(ref=REF, parent_node=protected.association.parent_node)
    assert events == [
        "lifecycle-fence-recover",
        ("publish", {"ref": REF, "generation": 1, "dispatch_id": "original-dispatch"}),
    ]
    with sqlite_session_factory() as sql:
        assert len(sql.scalars(select(NativeDispatch)).all()) == 1


def test_stored_profile_router_uses_actual_scoped_sql_request(
    mocker: pytest_mock.MockerFixture, sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session]
) -> None:
    from models.dify_builder import DifyBuilderExecutionRequest

    ids = {name: str(uuid4()) for name in ("tenant", "actor", "session", "app", "workflow", "input")}
    actor = Actor(account_id=ids["actor"], tenant_id=ids["tenant"])
    request_ids = {}
    with sqlite_session_factory.begin() as sql:
        table = DifyBuilderExecutionRequest.__table__
        assert isinstance(table, Table)
        assert isinstance(table, Table)
        table.create(sql.connection(), checkfirst=True)
        for profile in ("builder-agent-confirmed-v1", "legacy"):
            request_ids[profile] = str(uuid4())
            sql.add(
                DifyBuilderExecutionRequest(
                    id=request_ids[profile],
                    tenant_id=ids["tenant"],
                    actor_id=ids["actor"],
                    app_id=ids["app"],
                    workflow_id=ids["workflow"],
                    session_id=ids["session"],
                    test_input_id=ids["input"],
                    state="running",
                    context={"profile": {"profile_id": profile}},
                    context_digest="a" * 64,
                    observations=[],
                )
            )
    api = _api(sqlite_session_factory, actor=actor)
    confirmed = commands_module.ConfirmedAgentCommands(api=api, continuation=None, backend=None, publish=None)
    mocker.patch.object(confirmed, "get", return_value="confirmed")
    mocker.patch.object(api, "get", return_value="legacy")
    service = commands_module.ProfiledNativeTestCommands(
        sessions=sqlite_session_factory,
        actor=actor,
        confirmed_factory=lambda: confirmed,
        legacy_factory=lambda: api,
    )
    assert (
        service.get(actor=actor, session_id=ids["session"], request_id=request_ids["builder-agent-confirmed-v1"])
        == "confirmed"
    )
    assert service.get(actor=actor, session_id=ids["session"], request_id=request_ids["legacy"]) == "legacy"
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        service.get(actor=actor, session_id=str(uuid4()), request_id=request_ids["builder-agent-confirmed-v1"])
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        service.get(
            actor=Actor(account_id=str(uuid4()), tenant_id=ids["tenant"]),
            session_id=ids["session"],
            request_id=request_ids["legacy"],
        )


def test_terminal_projection_does_not_erase_unknown_effects() -> None:
    assert (
        commands_module.confirmed_parent_outcome(
            ref=REF, native_run_id=RUN, native_status="succeeded", operation_states=("completed",)
        ).status
        == "completed"
    )
    for state in ("claimed", "unknown"):
        outcome = commands_module.confirmed_parent_outcome(
            ref=REF, native_run_id=RUN, native_status="succeeded", operation_states=(state,)
        )
        assert outcome.status == "unknown"
        assert outcome.native_status is None
    with pytest.raises(BuilderExecutionPolicyError, match="native_parent_not_terminal"):
        commands_module.confirmed_parent_outcome(
            ref=REF, native_run_id=RUN, native_status="paused", operation_states=()
        )


def test_lost_create_ack_status_recovery_uses_saved_sql_identity_and_no_second_post(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Real SQL intent, SDK HTTP and Graphon state; C03 payload ports are explicit doubles."""
    import json

    from dify_agent.client import Client
    from dify_agent.protocol import CreateRunRequest, RunComposition

    from clients.agent_backend import DifyAgentBackendRunClient
    from graphon.entities.pause_reason import SchedulingPause
    from graphon.runtime import RuntimeState, VariablePool
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from services.agent.workflow_run_recovery import (
        AgentCreateAcknowledgementUnknown,
        AgentCreateScope,
        WorkflowAgentRunRecovery,
    )
    from services.dify_builder.native_testing import agent_confirmed_workspace
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _execution_row

    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    execution = runtime.graph_execution.get_or_create_node_execution(frame_id="root", node_id="node-1")
    runtime.graph_execution.start()
    runtime.graph_execution.pause(SchedulingPause(message="agent_create_ack_unknown"))
    scope = AgentCreateScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id=RUN,
        node_id="node-1",
        execution_id=execution.execution_id,
        workflow_binding_id="workflow-binding-1",
    )
    with sqlite_session_factory.begin() as sql:
        sql.add(
            _execution_row(
                execution_id=execution.execution_id,
                workflow_run_id=RUN,
                binding_id="binding-1",
                process_data={"workflow_agent_binding_id": "workflow-binding-1"},
            )
        )
    calls: list[str] = []
    lookups: list[object] = []

    def transport(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/runs":
            raise httpx.ReadTimeout("accepted ACK lost", request=request)
        if request.url.path == "/runs/lookup":
            lookups.append(json.loads(request.content))
            if len(lookups) == 1:
                return httpx.Response(503)
            return httpx.Response(200, json={"run_id": "original-child", "status": "waiting"})
        assert request.url.path == "/runs/original-child/events"
        return httpx.Response(
            200,
            json={
                "run_id": "original-child",
                "events": [
                    {
                        "id": "100-0",
                        "type": "run_waiting",
                        "run_id": "original-child",
                        "created_at": "2026-10-17T00:00:00Z",
                        "data": {
                            "generation": 0,
                            "pending_actions": [
                                {"kind": "waiting", "pending_operation_id": "pending", "wait_reason": "approval"}
                            ],
                        },
                    }
                ],
                "next_cursor": None,
            },
        )

    backend = DifyAgentBackendRunClient(
        Client(base_url="http://test.invalid", sync_http_client=httpx.Client(transport=httpx.MockTransport(transport)))
    )
    recovery = WorkflowAgentRunRecovery(sqlite_session_factory)
    with pytest.raises(AgentCreateAcknowledgementUnknown):
        recovery.start_or_recover(
            scope=scope,
            attempt=0,
            request=CreateRunRequest(composition=RunComposition(layers=[]), idempotency_key="original-key"),
            client=backend,
            on_persisted=lambda _: None,
        )
    context = _context(generation=0, scope=scope)
    parent = AgentParentNodeRef(
        ref=REF, execution_id=scope.execution_id, input_result_ref="inputs", input_digest="b" * 64
    )
    api = _api(sqlite_session_factory)
    mocker.patch.object(api.store, "load_context", return_value=context)
    protected = _protected().model_copy(
        update={"association": _protected().association.model_copy(update={"agent_run_id": "original-child"})}
    )
    mocker.patch.object(api.store, "load_agent_association", return_value=protected)
    monkeypatch.setattr(agent_confirmed_workspace, "load_confirmed_agent_parent", lambda **_: parent)
    events: list[object] = []
    continuation = _continuation(api, backend)
    mocker.patch.object(continuation, "read_parent_pause", return_value=_pause(runtime))
    mocker.patch.object(
        continuation, "persist_parent_wait", side_effect=lambda **values: events.append(("parent-commit", values))
    )
    commands = commands_module.ConfirmedAgentCommands(api=api, continuation=continuation, backend=backend, publish=None)
    commands.prepare_wait = lambda **values: events.append(("selected-checkpoint", values))
    assert commands._recover_pending_ack(ref=REF)
    assert [cast(tuple[str, object], event)[0] for event in events] == ["selected-checkpoint", "parent-commit"]
    assert calls == ["/runs", "/runs/lookup", "/runs/lookup", "/runs/original-child/events"]
    assert lookups[0] == lookups[1]
    assert recovery.process_data(scope=scope)["agent_create_attempts"][0]["child_run_id"] == "original-child"


@pytest.mark.parametrize("recovery_raises", [False, True])
@pytest.mark.parametrize(
    "after",
    [
        "waiting",
        "active_claim",
        "missing_claim",
        "initial_ack_unknown",
        "unknown_dispatch",
        "expired_claim",
        "foreign_generation",
        "quarantined",
    ],
)
def test_public_pause_read_refreshes_callback_and_preserves_only_live_owned_resume(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    recovery_raises: bool,
    after: str,
) -> None:
    from datetime import datetime, timedelta

    from sqlalchemy import select

    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState

    now = datetime.now(UTC)
    generation = 0 if after == "initial_ack_unknown" else 2
    with sqlite_session_factory.begin() as sql:
        for model in (NativeDispatch, NativeInvocationState):
            table = model.__table__
            assert isinstance(table, Table)
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        sql.add(
            NativeInvocationState(
                tenant_id=ACTOR.tenant_id,
                request_id=REF.request_id,
                invocation_id=REF.invocation_id,
                app_id="app",
                workflow_id="workflow",
                context_object_id="context",
                generation=generation,
                state="running",
                pending_ids=[],
                resolution=[],
            )
        )
        if after not in {"missing_claim", "initial_ack_unknown"}:
            sql.add(
                NativeDispatch(
                    id="dispatch",
                    tenant_id=ACTOR.tenant_id,
                    request_id=REF.request_id,
                    invocation_id=REF.invocation_id,
                    generation=1 if after == "foreign_generation" else 2,
                    idempotency_digest="b" * 64,
                    state="unknown" if after == "unknown_dispatch" else "claimed",
                    checkpoint_id="checkpoint",
                    claim_expires_at=now + timedelta(minutes=-1 if after == "expired_claim" else 5),
                )
            )
    initial = NativeTestPublicReceipt(
        request_id=REF.request_id,
        generation=generation,
        version=3,
        status="running",
        wait_reason=None,
        native_run_id=RUN,
        native_status="paused",
        pending=(),
        outcome=None,
        evidence_refs=(),
    )
    fresh = (
        initial.model_copy(update={"status": "waiting", "wait_reason": "approval"}) if after == "waiting" else initial
    )
    if after == "quarantined":
        fresh = initial.model_copy(update={"status": "terminal", "outcome": "unknown"})
    reads: list[str] = []
    pause_checks: list[dict[str, object]] = []

    def get(**_kwargs: object) -> NativeTestPublicReceipt:
        reads.append("read")
        return initial if len(reads) == 1 else fresh

    owned = _owned()
    api = _api(sqlite_session_factory)
    mocker.patch.object(api, "get", side_effect=get)
    mocker.patch.object(api.loader, "_load", return_value=(owned, None))
    continuation = _continuation(api)
    mocker.patch.object(continuation, "read_parent_pause", side_effect=lambda **kwargs: pause_checks.append(kwargs))
    commands = commands_module.ConfirmedAgentCommands(api=api, continuation=continuation, backend=None, publish=None)
    commands._request = lambda **_kwargs: None
    commands._root_ref = lambda **_kwargs: REF

    def recover(**_kwargs: object) -> bool:
        if after in {"waiting", "quarantined"}:
            with sqlite_session_factory.begin() as sql:
                state = sql.scalar(select(NativeInvocationState))
                assert state is not None
                state.state = "waiting" if after == "waiting" else "unknown"
        if recovery_raises:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        return False

    commands._recover_pending_ack = recover
    result = commands.get(actor=ACTOR, session_id="session", request_id=REF.request_id)
    if after == "waiting":
        assert result == fresh
        assert len(pause_checks) == 1
    elif after == "active_claim":
        assert result.status == "prepared"
        assert result.outcome is None
    else:
        assert result.status == "terminal"
        assert result.outcome == "unknown"
    with sqlite_session_factory() as sql:
        state = sql.scalar(select(NativeInvocationState))
        assert state is not None
        assert state.state == ({"waiting": "waiting", "quarantined": "unknown"}.get(after, "running"))
        assert state.generation == generation


@pytest.mark.parametrize("selected_profile", ["builder-agent-confirmed-v1", "legacy"])
def test_reconcile_pending_routes_current_request_to_its_stored_profile(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    selected_profile: str,
) -> None:
    from models.dify_builder import DifyBuilderExecutionRequest

    actor = Actor(account_id=str(uuid4()), tenant_id=str(uuid4()))
    session_id = str(uuid4())
    request_id = str(uuid4())
    with sqlite_session_factory.begin() as sql:
        table = DifyBuilderExecutionRequest.__table__
        assert isinstance(table, Table)
        assert isinstance(table, Table)
        table.create(sql.connection(), checkfirst=True)
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=actor.tenant_id,
                actor_id=actor.account_id,
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                session_id=session_id,
                test_input_id=str(uuid4()),
                state="running",
                context={"profile": {"profile_id": selected_profile}},
                context_digest="a" * 64,
                observations=[],
            )
        )
    legacy = _api(sqlite_session_factory, actor=actor)
    confirmed_api = _api(sqlite_session_factory, actor=actor)
    confirmed = commands_module.ConfirmedAgentCommands(api=confirmed_api, continuation=None, backend=None, publish=None)
    selected, other = (
        (confirmed_api, legacy) if selected_profile == "builder-agent-confirmed-v1" else (legacy, confirmed_api)
    )
    reconcile = mocker.patch.object(selected.lifecycle, "reconcile", return_value=2)
    generic_selected_publish = mocker.patch.object(selected.lifecycle, "publish_pending", return_value=3)
    publish_pending = (
        mocker.patch.object(confirmed, "publish_pending", return_value=3)
        if selected_profile == commands_module.PROFILE
        else generic_selected_publish
    )
    other_reconcile = mocker.patch.object(other.lifecycle, "reconcile")
    other_publish = mocker.patch.object(other.lifecycle, "publish_pending")
    service = commands_module.ProfiledNativeTestCommands(
        sessions=sqlite_session_factory,
        actor=actor,
        confirmed_factory=lambda: confirmed,
        legacy_factory=lambda: legacy,
    )
    published: list[object] = []
    assert (
        service.reconcile_pending(
            actor=actor,
            session_id=session_id,
            request_id=request_id,
            publish=published.append,
            limit=7,
        )
        == 5
    )
    reconcile.assert_called_once_with(limit=7, request_id=request_id)
    if selected_profile == commands_module.PROFILE:
        publish_pending.assert_called_once_with(limit=7, request_id=request_id)
        generic_selected_publish.assert_not_called()
    else:
        publish_pending.assert_called_once_with(publish=published.append, limit=7, request_id=request_id)
    other_reconcile.assert_not_called()
    other_publish.assert_not_called()
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        service.reconcile_pending(
            actor=actor,
            session_id=str(uuid4()),
            request_id=request_id,
            publish=published.append,
            limit=7,
        )
    assert reconcile.call_count == publish_pending.call_count == 1

    import schedule.dify_builder_reconcile_task as scheduler
    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from services.dify_builder import wiring
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from tasks.dify_builder_advance_task import advance_native_test
    from tests.unit_tests.services.dify_builder.native_testing.test_dispatch_fence import state

    with sqlite_session_factory.begin() as sql:
        for table in (NativeDispatch.__table__, NativeInvocationState.__table__):
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        sql.add(state(tenant_id=actor.tenant_id, request_id=request_id))
        sql.add(
            NativeDispatch(
                tenant_id=actor.tenant_id,
                request_id=request_id,
                invocation_id="root",
                generation=0,
                checkpoint_id=None,
                idempotency_digest="a" * 64,
                state="queued",
            )
        )
    owner = DifyNativeRuntimeOwner()
    mocker.patch.object(scheduler, "_session_factory", return_value=sqlite_session_factory)
    mocker.patch.object(wiring, "build_native_test_api_service", return_value=service)
    mocker.patch.object(wiring, "native_runtime_owner", return_value=owner)
    reconcile.reset_mock()
    publish_pending.reset_mock()
    assert scheduler.reconcile_native_tests(limit=7) == 5
    reconcile.assert_called_once_with(limit=7, request_id=request_id)
    if selected_profile == commands_module.PROFILE:
        publish_pending.assert_called_once_with(limit=7, request_id=request_id)
        generic_selected_publish.assert_not_called()
    else:
        publish_pending.assert_called_once_with(publish=advance_native_test.delay, limit=7, request_id=request_id)
    other_reconcile.assert_not_called()
    other_publish.assert_not_called()


@pytest.mark.parametrize("selected_index", [0, 1])
def test_native_reconcile_and_outbox_sql_stay_with_selected_profile_request(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    selected_index: int,
) -> None:
    from contextlib import contextmanager

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from tests.unit_tests.services.dify_builder.native_testing.test_dispatch_fence import fence_owner, state

    actor = Actor(account_id=str(uuid4()), tenant_id=str(uuid4()))
    request_ids = [str(uuid4()), str(uuid4())]
    dispatch_ids = [str(uuid4()), str(uuid4())]
    now = datetime.now(UTC)
    with sqlite_session_factory.begin() as sql:
        for table in (DifyBuilderExecutionRequest.__table__, NativeDispatch.__table__, NativeInvocationState.__table__):
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        for index, request_id in enumerate(request_ids):
            sql.add(
                DifyBuilderExecutionRequest(
                    id=request_id,
                    tenant_id=actor.tenant_id,
                    actor_id=actor.account_id,
                    app_id=str(uuid4()),
                    workflow_id=str(uuid4()),
                    session_id=str(uuid4()),
                    test_input_id=str(uuid4()),
                    state="running",
                    context={"profile": {"profile_id": ("builder-agent-confirmed-v1" if index else "legacy")}},
                    context_digest="a" * 64,
                    observations=[],
                )
            )
            sql.add(
                state(
                    tenant_id=actor.tenant_id, request_id=request_id, cancellation_key="cancel", cleanup_complete=False
                )
            )
            sql.add(
                NativeDispatch(
                    id=dispatch_ids[index],
                    tenant_id=actor.tenant_id,
                    request_id=request_id,
                    invocation_id="root",
                    generation=0,
                    checkpoint_id=None,
                    idempotency_digest="a" * 64,
                    state="claimed",
                    claim_expires_at=now - timedelta(minutes=1),
                )
            )
    api = _api(sqlite_session_factory, actor=actor)
    unknown = mocker.patch.object(api.lifecycle, "_mark_unknown")
    cancel = mocker.patch.object(api.lifecycle, "cancel")
    selected_id = request_ids[selected_index]
    assert api.lifecycle.reconcile(request_id=selected_id) == 2
    cancel.assert_called_once_with(actor=actor, request_id=selected_id, idempotency_key="cleanup-reconcile")
    unknown.assert_called_once()
    assert unknown.call_args.kwargs["ref"].request_id == selected_id
    assert unknown.call_args.kwargs["dispatch_id"] == dispatch_ids[selected_index]

    with sqlite_session_factory.begin() as sql:
        for identity in dispatch_ids:
            row = sql.get(NativeDispatch, identity)
            assert row is not None
            assert row is not None
            row.state, row.claim_expires_at = "queued", None

    def load(*, ref: NativeTestContextRef) -> OwnedNativeTest:
        return fence_owner(ref=ref, tenant_id=actor.tenant_id, actor_id=actor.account_id)

    @contextmanager
    def locked(*, ref: NativeTestContextRef) -> Generator[tuple[Session, OwnedNativeTest, None]]:
        with sqlite_session_factory.begin() as sql:
            yield sql, load(ref=ref), None

    mocker.patch.object(api.loader, "load", side_effect=load)
    mocker.patch.object(api.loader, "locked", side_effect=locked)
    published: list[dict[str, object]] = []
    assert (
        api.lifecycle.publish_pending(publish=lambda **message: published.append(message), request_id=selected_id) == 1
    )
    assert [cast(dict[str, object], message["ref"])["request_id"] for message in published] == [selected_id]
    with sqlite_session_factory() as sql:
        for index, identity in enumerate(dispatch_ids):
            row = sql.get(NativeDispatch, identity)
            assert row is not None
            assert row is not None
            assert row.state == ("published" if index == selected_index else "queued")


def test_reconcile_confirmed_outbox_retries_original_workflow_resume_queue_after_lost_ack(
    mocker: pytest_mock.MockerFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from contextlib import contextmanager

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeDispatch
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    with sqlite_session_factory.begin() as sql:
        for table in (DifyBuilderExecutionRequest.__table__, NativeDispatch.__table__):
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        for request_id, tenant_id, actor_id in (
            (REF.request_id, ACTOR.tenant_id, ACTOR.account_id),
            ("other-request", ACTOR.tenant_id, ACTOR.account_id),
            ("foreign-tenant", "foreign", ACTOR.account_id),
            ("foreign-actor", ACTOR.tenant_id, "foreign"),
        ):
            sql.add(
                DifyBuilderExecutionRequest(
                    id=request_id,
                    tenant_id=tenant_id,
                    actor_id=actor_id,
                    app_id="app",
                    workflow_id="workflow",
                    session_id="session",
                    test_input_id="input",
                    state="running",
                    context={"profile": {"profile_id": commands_module.PROFILE}},
                    context_digest=REF.context_digest,
                    observations=[],
                )
            )
            sql.add(
                NativeDispatch(
                    id="dispatch-a" if request_id == REF.request_id else request_id,
                    tenant_id=tenant_id,
                    request_id=request_id,
                    invocation_id=REF.invocation_id,
                    generation=1,
                    state="queued",
                    checkpoint_id="checkpoint",
                    idempotency_digest=canonical_digest(request_id),
                )
            )
        sql.add(
            NativeDispatch(
                id="dispatch-b",
                tenant_id=ACTOR.tenant_id,
                request_id=REF.request_id,
                invocation_id="second-invocation",
                generation=1,
                state="queued",
                checkpoint_id="checkpoint",
                idempotency_digest=canonical_digest("second"),
            )
        )

    api = _api(sqlite_session_factory)
    owned = _owned()

    @contextmanager
    def locked(*, ref: NativeTestContextRef) -> Generator[tuple[Session, OwnedNativeTest, None]]:
        assert ref == REF
        with sqlite_session_factory.begin() as sql:
            yield sql, owned, None

    def context(*, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        assert ref == REF
        return _context()

    mocker.patch.object(api.loader, "locked", side_effect=locked)
    mocker.patch.object(api.loader, "load", return_value=owned)
    mocker.patch.object(api.store, "load_context", side_effect=context)
    reconcile = mocker.patch.object(api.lifecycle, "reconcile", return_value=0)
    queued = mocker.patch.object(resume_app_execution, "delay", side_effect=[TimeoutError("ACK lost"), None])
    from tasks.dify_builder_advance_task import advance_native_test

    generic_publish = mocker.patch.object(
        advance_native_test, "delay", side_effect=AssertionError("confirmed outbox reached native-only queue")
    )
    confirmed = commands_module.ConfirmedAgentCommands(api=api, continuation=None, backend=None, publish=None)
    service = commands_module.ProfiledNativeTestCommands(
        sessions=sqlite_session_factory,
        actor=ACTOR,
        confirmed_factory=lambda: confirmed,
        legacy_factory=lambda: _api(sqlite_session_factory),
    )

    # The first ordinary resume delivery loses its ACK; recovery must retain its exact envelope and source row.
    confirmed._publish_one(ref=REF, generation=1, dispatch_id="dispatch-a")
    with sqlite_session_factory() as sql:
        retained = sql.get(NativeDispatch, "dispatch-a")
        assert retained is not None
        assert retained.state == "queued"
    assert (
        service.reconcile_pending(
            actor=ACTOR,
            session_id="session",
            request_id=REF.request_id,
            publish=generic_publish,
            limit=1,
        )
        == 1
    )
    generic_publish.assert_not_called()
    reconcile.assert_called_once_with(limit=1, request_id=REF.request_id)
    assert queued.call_count == 2
    assert queued.call_args_list[0] == queued.call_args_list[1]
    queued.assert_called_with(
        {
            "workflow_run_id": RUN,
            "builder_agent_dispatch": {
                "ref": REF.model_dump(mode="json"),
                "generation": 1,
                "dispatch_id": "dispatch-a",
                "actor": {"account_id": ACTOR.account_id, "tenant_id": ACTOR.tenant_id},
            },
        }
    )
    with sqlite_session_factory() as sql:
        rows = sql.scalars(select(NativeDispatch)).all()
        assert len(rows) == 5
        assert {row.id: row.state for row in rows} == {
            "dispatch-a": "published",
            "dispatch-b": "queued",
            "other-request": "queued",
            "foreign-tenant": "queued",
            "foreign-actor": "queued",
        }
