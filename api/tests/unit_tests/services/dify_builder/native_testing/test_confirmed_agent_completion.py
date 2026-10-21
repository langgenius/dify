"""Terminal C03 evidence closes the original Builder attempt, without another run."""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from dify_agent.client import Client
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from clients.agent_backend import DifyAgentBackendRunClient
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.dify_builder.models import DifyBuilderContext, EntryMode, Run, Session
from core.dify_builder.state import PcState
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.dify_builder_native_tests import NativeEffectOperation, NativeInvocationState, NativeTestScope
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentProtectedState,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NodeJournalState,
    ResolvedNativeTestContext,
)
from services.dify_builder import dify_port
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_commands import (
    ConfirmedAgentCommands,
    confirmed_parent_outcome,
)
from services.dify_builder.native_testing.confirmed_agent_continuation import (
    ConfirmedAgentContinuation,
    OwnedParentPause,
)
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import OwnedNativeTest, native_workflow_revision
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision
from tests.builder_agent_fixtures import AgentCase, make_case
from tests.unit_tests.core.app.entities.test_app_invoke_entities import _create_workflow_generate_entity


@dataclass
class _CompletionDatabase:
    engine: Engine


@dataclass
class CompletedOwner:
    factory: sessionmaker
    repo: SqlDifyBuilderRepository
    case: AgentCase
    session: Session
    context: DifyBuilderContext
    verify_id: str
    saved_id: str
    native_id: str
    request_id: str
    ref: NativeTestContextRef
    commands: ConfirmedAgentCommands
    reservation: Run
    child_status: str = "cancelled"
    cancel_calls: list[str] = field(default_factory=list)
    paused: OwnedParentPause | None = None
    writer_depth: int = 0


def _api(factory, actor):
    return NativeTestApiService(
        session_factory=factory,
        actor=actor,
        resolver=None,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    )


def _owned(owner, *, generation=1):
    return OwnedNativeTest(
        ref=owner.ref,
        tenant_id=owner.case.actor.tenant_id,
        actor_id=owner.case.actor.account_id,
        app_id=owner.case.workflow.app_id,
        workflow_id=owner.case.workflow.id,
        session_id=owner.session.id,
        test_input_id=owner.saved_id,
        bindings={},
        generation=generation,
        task_approved=True,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        state="running",
    )


def _context(owner, *, generation=1):
    return ResolvedNativeTestContext(
        ref=owner.ref,
        tenant_id=owner.case.actor.tenant_id,
        actor_id=owner.case.actor.account_id,
        app_id=owner.case.workflow.app_id,
        workflow_id=owner.case.workflow.id,
        graph=owner.case.workflow.graph_dict,
        inputs={},
        graph_revision="a" * 64,
        input_revision="b" * 64,
        resource_manifest=(),
        generation=generation,
        root_native_run_id=owner.native_id,
        native_run_id=owner.native_id,
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="budget",
        cancellation_ref="cancel",
        execution_mode="native",
    )


def _protected(owner, execution_id):
    parent = AgentParentNodeRef(
        ref=owner.ref, execution_id=execution_id, input_result_ref="input", input_digest="b" * 64
    )
    wait = AgentWaitAssociation(
        parent_node=parent,
        association_object_ref="association",
        agent_generation=0,
        checkpoint_object_ref="checkpoint",
        checkpoint_digest="d" * 64,
        backend_wait_event_id="100-0",
    )
    association = AgentNodeAssociation(
        parent_node=parent,
        workflow_native_run_id=owner.native_id,
        agent_run_id="original-child",
        config_ref="config",
        config_digest="c" * 64,
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
    )
    return AgentProtectedState(
        association_object_ref="association",
        association=association,
        wait=wait,
        checkpoint={},
        terminal_result_ref=None,
        terminal_result=None,
    )


@pytest.fixture
def completed(mocker, sqlite_session_factory, monkeypatch, request):
    factory = sqlite_session_factory
    with factory.begin() as sql:
        case = make_case(sql)
        case.workflow.graph = json.dumps(
            {
                "nodes": [
                    {"id": "start", "data": {"type": "start"}},
                    {"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}},
                    {"id": "end", "data": {"type": "end", "outputs": []}},
                ],
                "edges": [],
            }
        )
        sql.flush()
        revision = execution_revision(case.workflow)
        graph_revision = executable_graph_revision(case.workflow.graph_dict)
        raw_revision = native_workflow_revision(case.workflow)
    repo = SqlDifyBuilderRepository(factory)
    session = Session(
        app_id=case.workflow.app_id,
        tenant_id=case.actor.tenant_id,
        owner_account_id=case.actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_TEST_AND_REPAIR,
    )
    context = DifyBuilderContext()
    repo.create_session(session, context, [])
    saved_id, native_id, request_id, verify_id = (str(uuid4()) for _ in range(4))
    with factory.begin() as sql:
        sql.add(
            DifyBuilderTestInput(
                id=saved_id,
                session_id=session.id,
                source="upload",
                inputs={"contract_text": "synthetic"},
                start_schema_hash="schema",
            )
        )
    monkeypatch.setattr(dify_port, "_session_factory", lambda: factory)
    monkeypatch.setattr(dify_port, "db", _CompletionDatabase(engine=factory.kw["bind"]))
    from services import workflow_service

    monkeypatch.setattr(workflow_service, "db", _CompletionDatabase(engine=factory.kw["bind"]))
    from services.dify_builder import session_lock

    monkeypatch.setattr(session_lock, "acquire", lambda _: "completion-token")
    monkeypatch.setattr(session_lock, "release", lambda *_: None)
    port = dify_port.WorkflowServiceDifyPort()
    reservation, _ = port._reserve_full_run(session.id, saved_id, revision, graph_revision, frozenset())
    port._bind_full_native_id(reservation.id, native_id)
    initial = repo.get_run(reservation.id)
    initial.id, initial.kind, initial.session_id = verify_id, "verify", session.id
    initial.inputs_ref, initial.immutable = saved_id, True
    repo.save_run(session.id, initial)
    context.verify_run_id, context.test_input_ref = verify_id, saved_id
    repo.compare_and_advance(session.id, 1, PcState.BUILD_AWAIT_REPAIR, context, [])
    request_context = {
        "policy_version": "builder-native-test-v1",
        "request_id": request_id,
        "invocation_id": "root",
        "native_run_id": native_id,
        "expected_version": 1,
        "execution_revision": raw_revision,
        "input_revision": canonical_digest({"contract_text": "synthetic"}),
        "profile": {"profile_id": "builder-agent-confirmed-v1"},
        "tenant_id": case.actor.tenant_id,
        "actor_id": case.actor.account_id,
        "app_id": case.workflow.app_id,
        "workflow_id": case.workflow.id,
        "session_id": session.id,
        "test_input_id": saved_id,
    }
    try:
        profile = request.param
    except AttributeError:
        profile = "legacy"
    if profile == "confirmed":
        from services.dify_builder.native_testing.repository import admitted_workflow_revision

        request_context["revision_basis"] = "confirmed-canvas-v1"
        request_context["execution_revision"] = admitted_workflow_revision(case.workflow, request_context)
    ref = NativeTestContextRef(
        request_id=request_id, invocation_id="root", context_digest=canonical_digest(request_context)
    )
    with factory.begin() as sql:
        for table in (NativeTestScope.__table__, NativeInvocationState.__table__, NativeEffectOperation.__table__):
            table.create(sql.connection(), checkfirst=True)
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=case.actor.tenant_id,
                actor_id=case.actor.account_id,
                app_id=case.workflow.app_id,
                workflow_id=case.workflow.id,
                session_id=session.id,
                test_input_id=saved_id,
                context=request_context,
                context_digest=ref.context_digest,
                native_run_id=native_id,
                state="sealed",
            )
        )
        sql.add(
            NativeTestScope(
                tenant_id=case.actor.tenant_id,
                request_id=request_id,
                generation=1,
                task_approved=True,
                cancelled=False,
                expires_at=datetime(2099, 1, 1),
                max_calls=10,
                max_dispatches=10,
                max_cost_units=10,
                spent_calls=1,
                spent_dispatches=1,
                spent_cost_units=1,
                budget_limits={},
                budget_spent={},
                profile={},
            )
        )
        sql.add(
            NativeInvocationState(
                tenant_id=case.actor.tenant_id,
                request_id=request_id,
                invocation_id="root",
                app_id=case.workflow.app_id,
                workflow_id=case.workflow.id,
                context_object_id="context",
                generation=1,
                state="completed",
                pending_ids=[],
                resolution=[],
                outcome=confirmed_parent_outcome(
                    ref=ref, native_run_id=native_id, native_status="succeeded", operation_states=("completed",)
                ).model_dump(mode="json"),
            )
        )
        sql.add(
            NativeEffectOperation(
                id=str(uuid4()),
                tenant_id=case.actor.tenant_id,
                request_id=request_id,
                invocation_id="root",
                operation_digest="a" * 64,
                intent_digest="b" * 64,
                scope_digest="c" * 64,
                state="completed",
                result_ref="result",
            )
        )
        sql.add(
            WorkflowRun(
                id=native_id,
                tenant_id=case.actor.tenant_id,
                app_id=case.workflow.app_id,
                workflow_id=case.workflow.id,
                type="workflow",
                triggered_from="debugging",
                version="draft",
                graph=case.workflow.graph,
                inputs="{}",
                outputs=json.dumps({"summary": "actual output"}),
                status="succeeded",
                elapsed_time=1,
                total_tokens=2,
                total_steps=3,
                created_by=case.actor.account_id,
                created_by_role=CreatorUserRole.ACCOUNT,
            )
        )
        for index, node_id in enumerate(("start", "agent", "end")):
            sql.add(
                WorkflowNodeExecutionModel(
                    id=str(uuid4()),
                    tenant_id=case.actor.tenant_id,
                    app_id=case.workflow.app_id,
                    workflow_id=case.workflow.id,
                    workflow_run_id=native_id,
                    triggered_from="workflow-run",
                    index=index,
                    node_id=node_id,
                    node_type=node_id,
                    title=node_id,
                    status="succeeded",
                    inputs="{}",
                    outputs="{}",
                    process_data="{}",
                    execution_metadata="{}",
                    elapsed_time=0,
                    created_by=case.actor.account_id,
                    created_by_role=CreatorUserRole.ACCOUNT,
                )
            )
    receipt = NativeTestPublicReceipt(
        request_id=request_id,
        generation=1,
        version=1,
        status="terminal",
        wait_reason=None,
        native_run_id=native_id,
        native_status="succeeded",
        pending=(),
        outcome="succeeded",
        evidence_refs=(),
    )
    api = _api(factory, case.actor)
    mocker.patch.object(api, "get", return_value=receipt)
    commands = ConfirmedAgentCommands(
        api=api,
        continuation=None,
        backend=None,
        publish=None,
    )
    commands._request = lambda **_: None
    commands._root_ref = lambda **_: ref
    return CompletedOwner(
        factory=factory,
        repo=repo,
        case=case,
        session=session,
        context=context,
        verify_id=verify_id,
        saved_id=saved_id,
        native_id=native_id,
        request_id=request_id,
        ref=ref,
        commands=commands,
        reservation=reservation,
    )


def observe(owner):
    return owner.commands.get(actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id)


def test_terminal_public_read_closes_same_builder_run_and_review_without_dispatch(completed):
    owner = completed
    assert owner.repo.get_run(owner.verify_id).status == "running"
    observe(owner)
    run = owner.repo.get_run(owner.verify_id)
    session, context = owner.repo.get_session(owner.session.id)
    assert run.status == "succeeded"
    assert run.id == context.verify_run_id == owner.verify_id
    assert run.inputs_ref == owner.saved_id
    assert run.dify_run_id == owner.native_id
    assert run.verification.execution_evidence.sealed
    assert run.verification.terminal_outputs == {"summary": "actual output"}
    assert session.current_state == PcState.BUILD_REVIEW
    with owner.factory() as sql:
        assert len(sql.scalars(select(DifyBuilderRun)).all()) == 2
    observe(owner)
    assert owner.repo.get_session(owner.session.id)[0].version == session.version
    page = owner.repo.list_conversation_page(owner.session.id, limit=20)
    assert len([item for item in page.data if item.kind == "test_result"]) == 1


@pytest.mark.parametrize("drift", ["version", "input", "verify", "native", "revision", "effect", "c03"])
def test_terminal_projection_refuses_stale_or_unsettled_original_attempt(completed, drift):
    owner = completed
    with owner.factory.begin() as sql:
        if drift == "version":
            sql.get(DifyBuilderSession, owner.session.id).version += 1
        elif drift in {"input", "verify"}:
            commit = sql.scalar(select(DifyBuilderSessionCommit).where(DifyBuilderSessionCommit.version == 2))
            commit.context = {**commit.context, "test_input_ref" if drift == "input" else "verify_run_id": "other"}
        elif drift == "native":
            sql.get(DifyBuilderRun, owner.verify_id).dify_run_id = str(uuid4())
        elif drift == "revision":
            from models.workflow import Workflow

            sql.get(Workflow, owner.case.workflow.id).graph = '{"nodes":[],"edges":[]}'
        elif drift == "effect":
            sql.scalar(select(NativeEffectOperation)).state = "unknown"
        else:
            sql.scalar(select(NativeInvocationState)).state = "unknown"
    before = owner.repo.get_session(owner.session.id)[0].version
    observe(owner)
    assert owner.repo.get_run(owner.verify_id).status == "running"
    assert owner.repo.get_session(owner.session.id)[0].version == before


def test_inflight_builder_command_keeps_its_session_lease(completed, monkeypatch):
    from services.dify_builder import session_lock

    monkeypatch.setattr(session_lock, "acquire", lambda _: None)
    observe(completed)
    assert completed.repo.get_run(completed.verify_id).status == "running"


def test_actual_terminal_run_can_use_the_protected_context_native_id_without_a_column_ack(completed):
    owner = completed
    with owner.factory.begin() as sql:
        sql.get(DifyBuilderExecutionRequest, owner.request_id).native_run_id = None
    observe(owner)
    assert owner.repo.get_run(owner.verify_id).status == "succeeded"
    assert owner.repo.get_run(owner.verify_id).dify_run_id == owner.native_id
    with owner.factory() as sql:
        assert sql.get(DifyBuilderExecutionRequest, owner.request_id).native_run_id is None


@pytest.mark.parametrize("drift", ["column_disagrees", "actual_row_missing"])
def test_context_native_identity_never_replaces_the_actual_owned_native_run(completed, drift):
    owner = completed
    with owner.factory.begin() as sql:
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        request.native_run_id = str(uuid4()) if drift == "column_disagrees" else None
        if drift == "actual_row_missing":
            sql.delete(sql.get(WorkflowRun, owner.native_id))
    observe(owner)
    assert owner.repo.get_run(owner.verify_id).status == "running"


@pytest.mark.parametrize(
    ("completed", "change", "expected"),
    [("confirmed", "canvas", True), ("confirmed", "task", False), ("legacy", "canvas", False)],
    indirect=["completed"],
)
def test_completion_uses_the_immutable_admitted_revision_basis(completed, change, expected):
    from models.workflow import Workflow

    owner = completed
    with owner.factory.begin() as sql:
        workflow = sql.get(Workflow, owner.case.workflow.id)
        graph = workflow.graph_dict
        if change == "canvas":
            graph["nodes"][1]["position"] = {"x": 900, "y": 42}
            graph["viewport"] = {"x": 50, "y": 60, "zoom": 0.8}
        else:
            graph["nodes"][1]["data"]["agent_task"] = "An executable task change"
        workflow.graph = json.dumps(graph)
    observe(owner)
    assert (owner.repo.get_run(owner.verify_id).status == "succeeded") is expected


def test_resume_finalizes_actual_c03_before_closing_original_builder_run(mocker, completed):
    from contextlib import contextmanager

    from models.dify_builder_native_tests import NativeDispatch, NativeTestInvocation
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService

    owner = completed
    with owner.factory.begin() as sql:
        for model in (NativeDispatch, NativeTestInvocation):
            model.__table__.create(sql.connection(), checkfirst=True)
        sql.get(DifyBuilderExecutionRequest, owner.request_id).state = "running"
        state = sql.scalar(select(NativeInvocationState))
        state.state, state.outcome = "running", None
        sql.add(
            NativeTestInvocation(
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id="root",
                active=True,
                bindings={},
            )
        )
        sql.add(
            NativeDispatch(
                id="original-dispatch",
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id="root",
                generation=1,
                state="claimed",
                checkpoint_id="source",
                idempotency_digest="f" * 64,
            )
        )

    @contextmanager
    def locked(**_values):
        with owner.factory.begin() as sql:
            yield (
                sql,
                _owned(owner),
                sql.get(NativeTestScope, owner.request_id),
            )

    loader = owner.commands.api.loader
    mocker.patch.object(loader, "locked", side_effect=locked)
    mocker.patch.object(owner.commands.api.store, "load_context", return_value=_context(owner))
    owner.commands.api.lifecycle = NativeTestLifecycleService(loader, state_store=owner.commands.api.store)
    owner.commands.finish_resume(ref=owner.ref, generation=1, dispatch_id="original-dispatch")
    assert owner.repo.get_run(owner.verify_id).status == "succeeded"
    assert owner.repo.get_session(owner.session.id)[0].current_state == PcState.BUILD_REVIEW
    with owner.factory() as sql:
        assert sql.get(NativeDispatch, "original-dispatch").state == "completed"
        assert sql.get(DifyBuilderExecutionRequest, owner.request_id).state == "sealed"


def test_user_session_cas_wins_during_terminal_result_read(completed, monkeypatch):
    original = dify_port.WorkflowServiceDifyPort._bind_run

    def read_then_user_change(port, *args, **kwargs):
        result = original(port, *args, **kwargs)
        session, context = completed.repo.get_session(completed.session.id)
        completed.repo.compare_and_advance(session.id, session.version, PcState.BUILD_EXECUTION, context, [])
        return result

    monkeypatch.setattr(dify_port.WorkflowServiceDifyPort, "_bind_run", read_then_user_change)
    observe(completed)
    assert completed.repo.get_run(completed.verify_id).status == "running"
    assert completed.repo.get_run(completed.reservation.id).status == "running"
    assert completed.repo.get_session(completed.session.id)[0].current_state == PcState.BUILD_EXECUTION


def test_actual_native_failure_closes_old_run_without_diagnosis_or_new_execution(completed):
    owner = completed
    with owner.factory.begin() as sql:
        run = sql.get(WorkflowRun, owner.native_id)
        run.status, run.error = "failed", "actual native failure"
        state = sql.scalar(select(NativeInvocationState))
        state.outcome = confirmed_parent_outcome(
            ref=owner.ref, native_run_id=owner.native_id, native_status="failed", operation_states=("completed",)
        ).model_dump(mode="json")
    owner.commands._complete_builder(ref=owner.ref)
    run = owner.repo.get_run(owner.verify_id)
    session, context = owner.repo.get_session(owner.session.id)
    assert run.status == "failed"
    assert run.error == "actual native failure"
    assert run.verification.execution_evidence.safety_outcome == "native_failed"
    assert session.current_state == PcState.BUILD_AWAIT_REPAIR
    assert context.diagnosis is None
    assert context.staged_repair == []
    with owner.factory() as sql:
        assert len(sql.scalars(select(DifyBuilderRun)).all()) == 2


def test_concurrent_terminal_observers_commit_one_result_on_the_same_attempt(completed, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock

    from services.dify_builder import session_lock

    lease, reading, proceed = Lock(), Event(), Event()
    monkeypatch.setattr(session_lock, "acquire", lambda _: "held" if lease.acquire(blocking=False) else None)
    monkeypatch.setattr(session_lock, "release", lambda *_: lease.release())
    original = dify_port.WorkflowServiceDifyPort._bind_run

    def bounded_read(port, *args, **kwargs):
        run = original(port, *args, **kwargs)
        reading.set()
        assert proceed.wait(5)
        return run

    monkeypatch.setattr(dify_port.WorkflowServiceDifyPort, "_bind_run", bounded_read)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(observe, completed)
        assert reading.wait(5)
        try:
            second = pool.submit(observe, completed)
            assert second.result(timeout=5).outcome == "succeeded"
            assert completed.repo.get_run(completed.verify_id).status == "running"
        finally:
            proceed.set()
        assert first.result(timeout=5).outcome == "succeeded"
    assert completed.repo.get_run(completed.verify_id).status == "succeeded"
    assert completed.repo.get_session(completed.session.id)[0].version == 3
    page = completed.repo.list_conversation_page(completed.session.id, limit=20)
    assert len([item for item in page.data if item.kind == "test_result"]) == 1


def test_declined_terminal_proof_closes_same_builder_attempt_and_returns_editable_review(completed):
    """A saved verified stop must escape the old pending repair view, once only."""
    owner = completed
    with owner.factory.begin() as sql:
        sql.get(WorkflowRun, owner.native_id).status = "stopped"
        sql.get(WorkflowRun, owner.native_id).error = "effect_denied"
        sql.get(NativeTestScope, owner.request_id).cancelled = True
        state = sql.scalar(select(NativeInvocationState))
        state.state = "cancelled"
        state.outcome = {
            **state.outcome,
            "status": "stopped",
            "native_status": "stopped",
            "reason_code": "effect_denied",
        }
    owner.commands._complete_builder(ref=owner.ref)
    run = owner.repo.get_run(owner.verify_id)
    session, context = owner.repo.get_session(owner.session.id)
    assert run.status == "failed"
    assert run.dify_run_id == owner.native_id
    assert run.inputs_ref == owner.saved_id
    assert run.verification.execution_evidence.safety_outcome == "native_failed"
    assert session.current_state == PcState.BUILD_REVIEW
    assert not context.confirmed_consent_id
    assert not context.confirmed_command_id
    assert not context.staged_repair
    assert context.diagnosis is None
    card = next(
        item
        for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
        if item.kind == "test_result"
    )
    assert "declin" in str(card.payload).lower()
    owner.commands._complete_builder(ref=owner.ref)
    assert owner.repo.get_session(owner.session.id)[0].version == session.version
    assert (
        len(
            [
                item
                for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
                if item.kind == "test_result"
            ]
        )
        == 1
    )


@pytest.fixture
def declining(mocker, completed, monkeypatch, request):
    """Real original SQL owners; private checkpoint reader and backend are bounded ports."""
    from models.dify_builder_native_tests import (
        NativeContinuation,
        NativeDispatch,
        NativePayloadObject,
        NativeTestInvocation,
    )
    from models.workflow import WorkflowPause, WorkflowPauseReason
    from runtime_contracts.builder.native.contracts import CancellationReceipt
    from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_continuation import saved_state

    owner = completed
    try:
        generation = request.param
    except AttributeError:
        generation = 1
    saved, execution_id = saved_state(ref=owner.ref, run_id=owner.native_id)
    entity = _create_workflow_generate_entity().model_copy(
        update={
            "builder_agent_execution": BuilderAgentExecutionContext(ref=owner.ref, native_run_id=owner.native_id),
        }
    )
    saved = WorkflowResumptionContext(
        serialized_graph_runtime_state=saved.serialized_graph_runtime_state,
        generate_entity=_WorkflowGenerateEntityWrapper(entity=entity),
    )
    pause_id = str(uuid4())
    owned = _owned(owner, generation=generation)
    with owner.factory.begin() as sql:
        for model in (
            WorkflowPause,
            WorkflowPauseReason,
            NativeContinuation,
            NativeDispatch,
            NativePayloadObject,
            NativeTestInvocation,
        ):
            model.__table__.create(sql.connection(), checkfirst=True)
        sql.get(WorkflowRun, owner.native_id).status = "paused"
        sql.get(WorkflowRun, owner.native_id).finished_at = None
        sql.get(DifyBuilderExecutionRequest, owner.request_id).state = "waiting"
        state = sql.scalar(select(NativeInvocationState))
        state.state, state.outcome, state.checkpoint_id = "waiting", None, "checkpoint"
        state.generation = generation
        scope = sql.get(NativeTestScope, owner.request_id)
        scope.generation = generation
        scope.spent_dispatches = generation
        state.cleanup_complete = False
        sql.scalar(select(NativeEffectOperation)).state = "denied"
        pause = WorkflowPause(
            workflow_id=owned.workflow_id, workflow_run_id=owner.native_id, state_object_key="original-pause"
        )
        pause.id = pause_id
        sql.add(pause)
        from graphon.entities.pause_reason import SchedulingPause

        sql.add(
            WorkflowPauseReason.from_entity(
                pause_id=pause_id, pause_reason=SchedulingPause(message="agent_tool_approval")
            )
        )
        sql.scalar(
            select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "agent")
        ).status = "paused"
        sql.add(
            NativeTestInvocation(
                tenant_id=owned.tenant_id, request_id=owner.request_id, invocation_id="root", active=True, bindings={}
            )
        )
        if generation:
            sql.add(
                NativeDispatch(
                    id="source",
                    tenant_id=owned.tenant_id,
                    request_id=owner.request_id,
                    invocation_id="root",
                    generation=1,
                    state="completed",
                    checkpoint_id="checkpoint",
                    idempotency_digest="f" * 64,
                )
            )
        sql.add(
            NativeContinuation(
                tenant_id=owned.tenant_id,
                request_id=owner.request_id,
                invocation_id="root",
                generation=generation,
                checkpoint_id="checkpoint",
                payload_ref="checkpoint-storage",
                payload_digest="d" * 64,
            )
        )
        sql.add(
            NativePayloadObject(
                id="checkpoint",
                tenant_id=owned.tenant_id,
                request_id=owner.request_id,
                invocation_id="root",
                kind="checkpoint",
                logical_key="checkpoint",
                storage_key="checkpoint-storage",
                payload_digest="d" * 64,
                value_digest="e" * 64,
            )
        )
    protected = _protected(owner, execution_id)
    parent, wait = protected.association.parent_node, protected.wait
    from graphon.runtime import RuntimeState

    paused = OwnedParentPause(
        pause_id=pause_id,
        state_object_key="original-pause",
        native_run_id=owner.native_id,
        state=saved,
        runtime=RuntimeState.from_snapshot(saved.serialized_graph_runtime_state),
    )
    api = owner.commands.api
    continuation = ConfirmedAgentContinuation(
        loader=api.loader, store=api.store, operations=None, backend=None, lifecycle=api.lifecycle
    )
    mocker.patch.object(continuation, "read_parent_pause", return_value=paused)
    mocker.patch.object(continuation, "_stored_waits", return_value=(wait,))
    owner.commands.continuation = continuation
    mocker.patch.object(api.store, "load_agent_association", return_value=protected)
    mocker.patch.object(
        api.store,
        "read_checkpoint",
        return_value=NativeCheckpointPayload(
            schema_version="1",
            native_run_id=owner.native_id,
            generation=generation,
            generate_entity_json="{}",
            graph_runtime_state_json=saved.serialized_graph_runtime_state,
            response_stream_filter_json="{}",
            node_journals=(
                NodeJournalState(
                    invocation_id=owner.ref.invocation_id,
                    occurrence_path=(execution_id,),
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

    def revoke(**_):
        with owner.factory.begin() as sql:
            sql.get(NativeTestScope, owner.request_id).cancelled = True
            sql.scalar(select(NativeInvocationState)).state = "cancelled"
            sql.scalar(select(NativeInvocationState)).cancellation_key = "revoked"
            sql.scalar(select(NativeTestInvocation)).active = False
            sql.scalar(select(NativeEffectOperation)).state = "not_dispatched"

    mocker.patch.object(owner.commands.api.lifecycle, "cancel", side_effect=revoke)
    owner.child_status = "cancelled"
    owner.cancel_calls = []

    def cancel_child(child):
        with owner.factory() as sql:
            assert sql.get(NativeTestScope, owner.request_id).cancelled
        owner.cancel_calls.append(child)

    def child_status(child):
        from dify_agent.protocol.schemas import RunStatusResponse

        assert child == "original-child"
        return RunStatusResponse(
            run_id=child, status=owner.child_status, created_at=datetime(2026, 1, 1), updated_at=datetime(2026, 1, 1)
        )

    raw = Client(base_url="http://127.0.0.1:1")
    mocker.patch.object(raw, "get_run_sync", side_effect=child_status)
    backend = DifyAgentBackendRunClient(raw)
    mocker.patch.object(backend, "cancel_run", side_effect=cancel_child)
    owner.commands.backend = backend

    def public(**_):
        with owner.factory() as sql:
            native = sql.get(WorkflowRun, owner.native_id)
            return NativeTestPublicReceipt(
                request_id=owner.request_id,
                generation=generation,
                version=2,
                status="running",
                wait_reason=None,
                native_run_id=owner.native_id,
                native_status=native.status,
                pending=(),
                outcome=None,
                evidence_refs=(owner.native_id,),
                cancellation=CancellationReceipt(
                    request_id=owner.request_id, generation=generation, status="cancelling", operation_states={}
                ),
            )

    owner.commands.api.get = public
    monkeypatch.setattr(
        "services.dify_builder.native_testing.confirmed_agent_commands.validate_private_read",
        lambda *_: PrivateReadOwner(
            tenant_id=owned.tenant_id,
            actor_id=owned.actor_id,
            app_id=owned.app_id,
            workflow_id=owned.workflow_id,
            parent_invocation_id=None,
            context_object_id="context",
            generation=generation,
            graph_revision="a" * 64,
            root_revision_matches=True,
            input_revision=None,
            expires_at=owned.expires_at,
            cancelled=False,
            active=True,
            request_state="running",
        ),
    )
    from services.dify_builder.native_testing import confirmed_agent_cancellation

    mocker.patch.object(confirmed_agent_cancellation.storage, "load", return_value=b"snapshot")
    mocker.patch.object(confirmed_agent_cancellation.WorkflowResumptionContext, "loads", return_value=saved)
    owner.paused = paused
    return owner


@pytest.mark.parametrize("declining", [0], indirect=True)
def test_initial_ordinary_run_without_dispatch_settles_same_declined_attempt_once(declining):
    """The initial ordinary generator owns a generation-zero pause without a dispatch row."""
    from models.dify_builder_native_tests import NativeDispatch
    from models.workflow import Workflow, WorkflowPause

    owner = declining
    with owner.factory() as sql:
        assert sql.scalars(select(NativeDispatch)).all() == []
        assert sql.get(NativeTestScope, owner.request_id).generation == 0
        graph = sql.get(Workflow, owner.case.workflow.id).graph
    receipt = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert receipt.status == "terminal"
    assert receipt.outcome == "cancelled"
    assert receipt.native_status == "stopped"
    assert receipt.cancellation.status == "cancelling"
    with owner.factory() as sql:
        native = sql.get(WorkflowRun, owner.native_id)
        assert native.status == "stopped"
        finished_at = native.finished_at
        assert finished_at is not None
        assert sql.scalar(select(WorkflowPause)) is None
        assert sql.scalars(select(NativeDispatch)).all() == []
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
        assert sql.get(Workflow, owner.case.workflow.id).graph == graph
    verify = owner.repo.get_run(owner.verify_id)
    assert verify.status == "failed"
    assert verify.dify_run_id == owner.native_id
    assert verify.inputs_ref == owner.saved_id
    assert verify.immutable
    session, _ = owner.repo.get_session(owner.session.id)
    assert session.current_state == PcState.BUILD_REVIEW
    assert observe(owner).outcome == "cancelled"
    assert owner.repo.get_session(owner.session.id)[0].version == session.version
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).finished_at == finished_at
        assert sql.scalars(select(NativeDispatch)).all() == []
    assert (
        len(
            [
                item
                for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
                if item.kind == "test_result"
            ]
        )
        == 1
    )


@pytest.mark.parametrize("source", ["missing", "earlier_generation"])
def test_later_generation_requires_its_completed_source_before_declined_settlement(declining, source):
    from models.dify_builder_native_tests import NativeDispatch

    owner = declining
    with owner.factory.begin() as sql:
        dispatch = sql.get(NativeDispatch, "source")
        if source == "missing":
            sql.delete(dispatch)
        else:
            dispatch.generation = 0
    owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).status == "paused"
        assert sql.scalar(select(NativeInvocationState)).outcome is None
    assert owner.repo.get_run(owner.verify_id).status == "running"


@pytest.mark.parametrize("declining", [0], indirect=True)
@pytest.mark.parametrize("dispatch_state", ["completed", "claimed"])
def test_initial_no_source_proof_refuses_dispatch_added_after_child_cancel(declining, dispatch_state):
    from models.dify_builder_native_tests import NativeDispatch

    owner = declining
    original = owner.commands.backend.cancel_run

    def raced(child):
        original(child)
        with owner.factory.begin() as sql:
            sql.add(
                NativeDispatch(
                    id="racing-dispatch",
                    tenant_id=owner.case.actor.tenant_id,
                    request_id=owner.request_id,
                    invocation_id=owner.ref.invocation_id,
                    generation=0,
                    state=dispatch_state,
                    checkpoint_id="checkpoint",
                    idempotency_digest="f" * 64,
                )
            )

    owner.commands.backend.cancel_run = raced
    owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).status == "paused"
        assert sql.scalar(select(NativeInvocationState)).outcome is None
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
    assert owner.repo.get_run(owner.verify_id).status == "running"


def test_cancel_settles_original_paused_native_without_claiming_physical_cleanup(declining):
    from models.workflow import WorkflowPause, WorkflowPauseReason

    owner = declining
    receipt = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert receipt.status == "terminal"
    assert receipt.outcome == "cancelled"
    assert receipt.native_status == "stopped"
    assert receipt.cancellation.status == "cancelling"
    with owner.factory() as sql:
        native = sql.get(WorkflowRun, owner.native_id)
        assert native.status == "stopped"
        assert native.finished_at is not None
        assert sql.scalar(select(WorkflowPause)) is None
        assert sql.scalar(select(WorkflowPauseReason)) is None
        assert sql.get(DifyBuilderExecutionRequest, owner.request_id).state == "sealed"
        assert (
            sql.scalar(select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "agent")).status
            == "paused"
        )
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
    assert owner.repo.get_run(owner.verify_id).status == "failed"
    assert owner.repo.get_session(owner.session.id)[0].current_state == PcState.BUILD_REVIEW


@pytest.mark.parametrize("status", ["waiting", "running", "failed", "succeeded", "timeout"])
def test_unverified_child_never_stops_native_or_projects_declined_result(declining, status):
    owner = declining
    owner.child_status = status
    if status == "timeout":
        owner.commands.backend.client.get_run_sync = lambda _: (_ for _ in ()).throw(TimeoutError())
    receipt = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert receipt.outcome is None
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).status == "paused"
        assert sql.get(NativeTestScope, owner.request_id).cancelled
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
        assert sql.scalar(select(NativeInvocationState)).outcome is None
    assert owner.repo.get_run(owner.verify_id).status == "running"


@pytest.mark.parametrize(
    "drift",
    [
        "checkpoint",
        "context",
        "pause",
        "resumed",
        "claimed",
        "unknown_source",
        "effect_claimed",
        "effect_unknown",
        "native_success",
        "foreign_native",
        "association_receipt",
        "generation",
    ],
)
def test_cancel_rechecks_owned_pause_dispatch_and_effect_facts_after_external_ack(declining, drift):
    from models.dify_builder_native_tests import NativeDispatch, NativePayloadObject
    from models.workflow import WorkflowPause

    owner = declining
    original = owner.commands.backend.cancel_run

    def raced(child):
        original(child)
        with owner.factory.begin() as sql:
            if drift == "checkpoint":
                sql.scalar(select(NativeInvocationState)).checkpoint_id = "changed"
            elif drift == "context":
                sql.scalar(select(NativeInvocationState)).context_object_id = "changed"
            elif drift == "pause":
                sql.scalar(select(WorkflowPause)).state_object_key = "changed"
            elif drift == "resumed":
                sql.scalar(select(WorkflowPause)).resumed_at = datetime(2026, 1, 1)
            elif drift in {"claimed", "unknown_source"}:
                sql.scalar(select(NativeDispatch)).state = "claimed" if drift == "claimed" else "unknown"
            elif drift.startswith("effect_"):
                sql.scalar(select(NativeEffectOperation)).state = drift.removeprefix("effect_")
            elif drift == "native_success":
                sql.get(WorkflowRun, owner.native_id).status = "succeeded"
            elif drift == "foreign_native":
                sql.get(WorkflowRun, owner.native_id).created_by = str(uuid4())
            elif drift == "association_receipt":
                sql.scalar(select(NativePayloadObject)).payload_digest = "9" * 64
            else:
                sql.get(NativeTestScope, owner.request_id).generation += 1

    owner.commands.backend.cancel_run = raced
    owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).status == ("succeeded" if drift == "native_success" else "paused")
        assert sql.scalar(select(NativeInvocationState)).outcome is None
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
    assert owner.repo.get_run(owner.verify_id).status == "running"


def test_cancel_reconnect_finishes_only_original_preparation_and_projection_once(declining, monkeypatch):
    from models.workflow import Workflow
    from services.dify_builder import session_lock

    owner = declining
    with owner.factory() as sql:
        graph = sql.get(Workflow, owner.case.workflow.id).graph
    owner.child_status = "waiting"
    first = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert first.status == "running"
    owner.child_status = "cancelled"
    monkeypatch.setattr(session_lock, "acquire", lambda _: None)
    stopped = observe(owner)
    assert stopped.outcome == "cancelled"
    assert stopped.cancellation.status == "cancelling"
    assert owner.repo.get_run(owner.verify_id).status == "running"
    monkeypatch.setattr(session_lock, "acquire", lambda _: "projection-retry")
    observe(owner)
    version = owner.repo.get_session(owner.session.id)[0].version
    with owner.factory() as sql:
        finished_at = sql.get(WorkflowRun, owner.native_id).finished_at
    owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    observe(owner)
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).finished_at == finished_at
        assert sql.get(Workflow, owner.case.workflow.id).graph == graph
        assert len(sql.scalars(select(DifyBuilderRun)).all()) == 2
        assert len(sql.get(DifyBuilderExecutionRequest, owner.request_id).observations) == 1
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
    assert owner.repo.get_session(owner.session.id)[0].version == version
    assert (
        len(
            [
                item
                for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
                if item.kind == "test_result"
            ]
        )
        == 1
    )


def test_failed_preparation_still_revokes_without_fabricating_native_stop(declining):
    owner = declining
    owner.commands.api.store.load_agent_association = lambda **_: (_ for _ in ()).throw(
        BuilderExecutionPolicyError("native_agent_owner_mismatch")
    )
    receipt = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert receipt.status == "running"
    assert receipt.outcome is None
    with owner.factory() as sql:
        assert sql.get(NativeTestScope, owner.request_id).cancelled
        assert sql.get(WorkflowRun, owner.native_id).status == "paused"
        assert not sql.get(DifyBuilderExecutionRequest, owner.request_id).observations


@pytest.mark.parametrize("terminal", ["verify", "reservation"])
def test_declined_projection_preserves_prior_immutable_terminal_builder_evidence(declining, terminal):
    owner = declining
    target = owner.verify_id if terminal == "verify" else owner.reservation.id
    with owner.factory.begin() as sql:
        row = sql.get(DifyBuilderRun, target)
        row.status, row.immutable, row.error = "failed", True, "previous terminal evidence"
        sealed = row.verification
    owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    with owner.factory() as sql:
        row = sql.get(DifyBuilderRun, target)
        assert row.status == "failed"
        assert row.immutable
        assert row.error == "previous terminal evidence"
        assert row.verification == sealed
    assert owner.repo.get_session(owner.session.id)[0].version == 2


def test_declined_builder_cas_race_preserves_newer_user_work(declining, monkeypatch):
    owner = declining
    original = dify_port.WorkflowServiceDifyPort._bind_run

    def user_changes_session(port, *args, **kwargs):
        result = original(port, *args, **kwargs)
        session, context = owner.repo.get_session(owner.session.id)
        owner.repo.compare_and_advance(session.id, session.version, PcState.BUILD_EXECUTION, context, [])
        return result

    monkeypatch.setattr(dify_port.WorkflowServiceDifyPort, "_bind_run", user_changes_session)
    receipt = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert receipt.outcome == "cancelled"
    assert owner.repo.get_run(owner.verify_id).status == "running"
    assert owner.repo.get_run(owner.reservation.id).status == "running"
    assert owner.repo.get_session(owner.session.id)[0].version == 3
    observe(owner)
    assert owner.repo.get_session(owner.session.id)[0].version == 3
    assert not [
        item
        for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
        if item.kind == "test_result"
    ]


def test_declined_result_cannot_publish_and_preserves_graph_and_original_ids(declining):
    from models.dify_builder_native_tests import NativeDispatch
    from models.workflow import Workflow
    from services.dify_builder.application.verification import publication_decision

    owner = declining
    owner.commands.publish = lambda **_: pytest.fail("denial dispatched a resume")
    with owner.factory() as sql:
        graph = sql.get(Workflow, owner.case.workflow.id).graph
    owner.commands.api.decide = lambda **_: owner.commands.api.get()
    receipt = owner.commands.decide(
        actor=owner.case.actor,
        session_id=owner.session.id,
        request_id=owner.request_id,
        pending_operation_id="original-pending",
        decision="deny",
        scope_digest="c" * 64,
        expected_version=2,
        idempotency_key="deny-original",
    )
    assert receipt.outcome == "cancelled"
    run = owner.repo.get_run(owner.verify_id)
    assert not publication_decision(
        run,
        session_id=owner.session.id,
        current_revision=run.verification.execution_revision,
        current_graph_revision=run.verification.executed_graph_revision,
    ).allowed
    with owner.factory() as sql:
        assert sql.get(Workflow, owner.case.workflow.id).graph == graph
        assert len(sql.scalars(select(NativeDispatch)).all()) == 1
        assert len(sql.scalars(select(NativeEffectOperation)).all()) == 1
        assert len(sql.scalars(select(DifyBuilderRun)).all()) == 2
    assert owner.cancel_calls == ["original-child"]


def test_clean_physical_receipt_cannot_finish_confirmed_paused_parent_without_logical_proof(declining):
    owner = declining
    public = owner.commands.api.get

    def physically_clean(**values):
        receipt = public(**values)
        return receipt.model_copy(
            update={
                "status": "terminal",
                "outcome": "cancelled",
                "cancellation": receipt.cancellation.model_copy(update={"status": "cancelled"}),
            }
        )

    def absent_association(**_):
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")

    owner.commands.api.get = physically_clean
    owner.commands.api.store.load_agent_association = absent_association
    receipt = owner.commands.cancel(
        actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id, idempotency_key="deny"
    )
    assert receipt.status == "running"
    assert receipt.outcome is None
    assert receipt.native_status == "paused"
    assert receipt.cancellation.status == "cancelled"
    with owner.factory() as sql:
        assert sql.scalar(select(NativeInvocationState)).outcome is None
        assert sql.get(WorkflowRun, owner.native_id).status == "paused"
    assert owner.repo.get_run(owner.verify_id).status == "running"


@pytest.fixture
def retrying_decline(mocker, declining, monkeypatch):
    """Retain real active-reader refusal and integrity-checked SQL object reads."""
    from contextlib import contextmanager

    from models.dify_builder_native_tests import NativeContinuation, NativePayloadObject
    from runtime_contracts.builder.native.agent_contracts import (
        AgentNodeAssociation,
        AgentParentNodeRef,
        AgentTestWorkspaceRef,
        AgentWaitAssociation,
    )
    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState
    from services.dify_builder.native_testing import state_store

    owner = declining
    execution_id = owner.commands.continuation._stored_waits(ref=owner.ref)[0].parent_node.execution_id
    parent = AgentParentNodeRef(
        ref=owner.ref, execution_id=execution_id, input_result_ref="input", input_digest="b" * 64
    )
    association = AgentNodeAssociation(
        parent_node=parent,
        workflow_native_run_id=owner.native_id,
        agent_run_id="original-child",
        config_ref="config",
        config_digest="c" * 64,
        pinned_snapshot_id=owner.case.snapshot.id,
        home_snapshot_id=None,
        workspace=AgentTestWorkspaceRef(
            binding_id="binding",
            workspace_id="workspace",
            backend_binding_ref="binding",
            backend_workspace_ref="workspace",
            pinned_snapshot_id=owner.case.snapshot.id,
            home_snapshot_id=None,
            workspace_generation=0,
        ),
    )
    wait = AgentWaitAssociation(
        parent_node=parent,
        association_object_ref="association",
        agent_generation=1,
        checkpoint_object_ref="agent-checkpoint",
        checkpoint_digest="d" * 64,
        backend_wait_event_id="1-0",
    )
    payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id=owner.native_id,
        generation=1,
        generate_entity_json="{}",
        graph_runtime_state_json=owner.paused.state.serialized_graph_runtime_state,
        response_stream_filter_json="{}",
        node_journals=(
            NodeJournalState(
                invocation_id=owner.ref.invocation_id,
                occurrence_path=(execution_id,),
                input_result_ref="input",
                input_digest="b" * 64,
                cursor=0,
                operation_keys=(),
                result_refs=(),
            ),
        ),
        child_refs=(),
        input_result_refs=("input",),
        agent_associations=(wait,),
    )
    objects = {}
    with owner.factory.begin() as sql:
        for identity, kind, key, value in (
            ("checkpoint", "checkpoint", "checkpoint", payload.model_dump(mode="json")),
            (
                "association",
                "result",
                state_store.NativeExecutionStateStore._agent_key("agent-bind", parent),
                association.model_dump(mode="json"),
            ),
        ):
            raw, digest = state_store.encode_payload(
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                kind=kind,
                payload=value,
            )
            row = sql.get(NativePayloadObject, identity)
            if row is None:
                row = NativePayloadObject(
                    id=identity,
                    tenant_id=owner.case.actor.tenant_id,
                    request_id=owner.request_id,
                    invocation_id=owner.ref.invocation_id,
                    kind=kind,
                    logical_key=key,
                    storage_key=identity + "-storage",
                    payload_digest=digest,
                    value_digest=canonical_digest(value),
                )
                sql.add(row)
            else:
                row.payload_digest, row.value_digest = digest, canonical_digest(value)
            objects[row.storage_key] = raw.encode()
            if kind == "checkpoint":
                sql.scalar(select(NativeContinuation)).payload_digest = digest

    loader = owner.commands.loader
    original_locked = loader.locked
    owner.writer_depth = 0

    @contextmanager
    def tracked_writer(**values):
        with original_locked(**values) as rows:
            owner.writer_depth += 1
            try:
                yield rows
            finally:
                owner.writer_depth -= 1

    loader.locked = tracked_writer

    def active_waits(**_):
        loader.load(ref=owner.ref)
        return (wait,)

    def active_association(**_):
        loader.load(ref=owner.ref)
        return AgentProtectedState(
            association_object_ref="association",
            association=association,
            wait=wait,
            checkpoint={},
            terminal_result_ref=None,
            terminal_result=None,
        )

    def active_pause(**_):
        loader.load(ref=owner.ref)
        return owner.paused

    owner.commands.continuation._stored_waits = active_waits
    owner.commands.continuation.read_parent_pause = active_pause
    owner.commands.api.store.load_agent_association = active_association
    owner.commands.api.store.read_checkpoint = lambda **_: payload
    owner.commands.api.store._read_object = state_store.NativeExecutionStateStore._read_object

    objects[owner.paused.state_object_key] = owner.paused.state.dumps().encode()

    def load_object(key):
        assert owner.writer_depth == 0
        return objects[key]

    mocker.patch.object(state_store.storage, "load", side_effect=load_object)
    monkeypatch.setattr(state_store.encrypter, "decrypt_token", lambda _tenant, raw: raw)
    owner.child_status = "waiting"

    def cancel_after_one_lost_post(child):
        assert owner.writer_depth == 0
        assert child == "original-child"
        owner.cancel_calls.append(child)
        if len(owner.cancel_calls) == 1:
            raise TimeoutError("first POST was not delivered")
        owner.child_status = "cancelled"

    owner.commands.backend.cancel_run = cancel_after_one_lost_post
    original_status = owner.commands.backend.client.get_run_sync

    def read_status(child):
        assert owner.writer_depth == 0
        return original_status(child)

    owner.commands.backend.client.get_run_sync = read_status
    owner.commands.publish = lambda **_: pytest.fail("cancel retry dispatched a resume")
    return owner


def test_explicit_cancel_retry_reaches_same_child_after_real_active_reader_refusal(retrying_decline):
    from models.dify_builder_native_tests import NativeDispatch

    owner = retrying_decline
    values = {
        "actor": owner.case.actor,
        "session_id": owner.session.id,
        "request_id": owner.request_id,
        "idempotency_key": "deny",
    }
    first = owner.commands.cancel(**values)
    assert first.status == "running"
    assert owner.child_status == "waiting"
    with pytest.raises(BuilderExecutionPolicyError):
        owner.commands.continuation._stored_waits(ref=owner.ref)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.commands.api.store.load_agent_association(ref=owner.ref)
    observe(owner)
    assert owner.cancel_calls == ["original-child"]
    second = owner.commands.cancel(**values)
    assert owner.cancel_calls == ["original-child", "original-child"]
    assert second.outcome == "cancelled"
    assert second.native_status == "stopped"
    assert second.cancellation.status == "cancelling"
    assert owner.repo.get_run(owner.verify_id).status == "failed"
    session, _ = owner.repo.get_session(owner.session.id)
    assert session.current_state == PcState.BUILD_REVIEW
    observe(owner)
    observe(owner)
    assert owner.cancel_calls == ["original-child", "original-child"]
    assert owner.repo.get_session(owner.session.id)[0].version == session.version
    with owner.factory() as sql:
        assert len(sql.scalars(select(NativeDispatch)).all()) == 1
        assert len(sql.scalars(select(NativeEffectOperation)).all()) == 1
        assert len(sql.scalars(select(DifyBuilderRun)).all()) == 2
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
    assert (
        len(
            [
                item
                for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
                if item.kind == "test_result"
            ]
        )
        == 1
    )


@pytest.mark.parametrize(
    "drift", ["missing", "forged_child", "stale_checkpoint", "foreign_association", "foreign_owner"]
)
def test_cancel_retry_refuses_missing_forged_stale_or_foreign_retained_proof(retrying_decline, drift):
    from copy import deepcopy

    from models.dify_builder_native_tests import NativePayloadObject
    from services.dify_builder.native_testing.confirmed_agent_cancellation import PREPARATION

    owner = retrying_decline
    values = {
        "actor": owner.case.actor,
        "session_id": owner.session.id,
        "request_id": owner.request_id,
        "idempotency_key": "deny",
    }
    owner.commands.cancel(**values)
    with owner.factory.begin() as sql:
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        if drift == "missing":
            request.observations = []
        elif drift == "forged_child":
            records = deepcopy(request.observations)
            next(record[PREPARATION] for record in records if PREPARATION in record)["children"] = ["foreign-child"]
            request.observations = records
        elif drift == "stale_checkpoint":
            sql.scalar(select(NativeInvocationState)).checkpoint_id = "stale-checkpoint"
        elif drift == "foreign_association":
            sql.get(NativePayloadObject, "association").tenant_id = str(uuid4())
        else:
            sql.get(DifyBuilderSession, owner.session.id).owner_account_id = str(uuid4())
    receipt = owner.commands.cancel(**values)
    assert owner.cancel_calls == ["original-child"]
    assert owner.child_status == "waiting"
    assert receipt.outcome is None
    with owner.factory() as sql:
        assert sql.get(WorkflowRun, owner.native_id).status == "paused"
        assert sql.scalar(select(NativeInvocationState)).outcome is None
        assert not sql.scalar(select(NativeInvocationState)).cleanup_complete
    assert owner.repo.get_run(owner.verify_id).status == "running"


def _edit_attempt(owner, *, continued=False, state=PcState.EDIT_AWAIT_REPAIR):
    with owner.factory.begin() as sql:
        session = sql.get(DifyBuilderSession, owner.session.id)
        session.entry_mode = str(EntryMode.BUILD if continued else EntryMode.EDIT)
        session.current_state = str(state)
        commit = sql.scalar(
            select(DifyBuilderSessionCommit).where(
                DifyBuilderSessionCommit.session_id == owner.session.id,
                DifyBuilderSessionCommit.version == session.version,
            )
        )
        commit.state = str(state)
        commit.context = {**commit.context, "active_entry_mode": "edit" if continued else ""}


@pytest.mark.parametrize("continued", [False, True])
@pytest.mark.parametrize("state", [PcState.EDIT_TEST_AFFECTED_PATHS, PcState.EDIT_AWAIT_REPAIR])
def test_edit_terminal_success_closes_same_attempt_in_edit_review_once(completed, continued, state):
    owner = completed
    _edit_attempt(owner, continued=continued, state=state)
    observe(owner)
    run = owner.repo.get_run(owner.verify_id)
    session, context = owner.repo.get_session(owner.session.id)
    assert run.status == "succeeded"
    assert run.verification.execution_evidence.sealed
    assert run.verification.terminal_outputs == {"summary": "actual output"}
    assert session.current_state == PcState.EDIT_REVIEW
    assert context.verify_run_id == owner.verify_id
    assert run.dify_run_id == owner.native_id
    observe(owner)
    assert owner.repo.get_session(owner.session.id)[0].version == session.version
    assert (
        len(
            [
                item
                for item in owner.repo.list_conversation_page(owner.session.id, limit=20).data
                if item.kind == "test_result"
            ]
        )
        == 1
    )
    with owner.factory() as sql:
        assert len(sql.scalars(select(DifyBuilderRun)).all()) == 2


@pytest.mark.parametrize("declined", [False, True])
def test_edit_terminal_failure_or_decline_preserves_edit_family_without_execution(completed, declined):
    owner = completed
    _edit_attempt(owner)
    with owner.factory.begin() as sql:
        native = sql.get(WorkflowRun, owner.native_id)
        native.status = "stopped" if declined else "failed"
        native.error = "effect_denied" if declined else "actual native failure"
        state = sql.scalar(select(NativeInvocationState))
        if declined:
            sql.get(NativeTestScope, owner.request_id).cancelled = True
            state.state = "cancelled"
            state.outcome = {
                **state.outcome,
                "status": "stopped",
                "native_status": "stopped",
                "reason_code": "effect_denied",
            }
        else:
            state.outcome = confirmed_parent_outcome(
                ref=owner.ref, native_run_id=owner.native_id, native_status="failed", operation_states=("completed",)
            ).model_dump(mode="json")
    observe(owner)
    run = owner.repo.get_run(owner.verify_id)
    session, context = owner.repo.get_session(owner.session.id)
    assert run.status == "failed"
    assert run.verification.execution_evidence.sealed
    assert session.current_state == (PcState.EDIT_REVIEW if declined else PcState.EDIT_AWAIT_REPAIR)
    assert context.diagnosis is None
    assert not context.staged_repair
    assert run.dify_run_id == owner.native_id
    assert context.verify_run_id == owner.verify_id


@pytest.mark.parametrize("drift", ["version", "input", "effect_unknown", "outcome_unknown", "mode"])
def test_edit_terminal_projection_refuses_stale_unknown_or_wrong_task_family(completed, drift):
    owner = completed
    _edit_attempt(owner)
    with owner.factory.begin() as sql:
        session = sql.get(DifyBuilderSession, owner.session.id)
        if drift == "version":
            session.version += 1
        elif drift == "input":
            sql.get(DifyBuilderTestInput, owner.saved_id).inputs = {"contract_text": "changed"}
        elif drift == "effect_unknown":
            sql.scalar(select(NativeEffectOperation)).state = "unknown"
        elif drift == "outcome_unknown":
            sql.scalar(select(NativeInvocationState)).state = "unknown"
        else:
            session.entry_mode = "build"
    version = owner.repo.get_session(owner.session.id)[0].version
    observe(owner)
    assert owner.repo.get_run(owner.verify_id).status == "running"
    session, _ = owner.repo.get_session(owner.session.id)
    assert session.version == version
    assert session.current_state == PcState.EDIT_AWAIT_REPAIR
