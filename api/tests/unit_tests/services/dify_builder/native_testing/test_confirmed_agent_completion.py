"""Terminal C03 evidence closes the original Builder attempt, without another run."""

import json
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.dify_builder.models import DifyBuilderContext, EntryMode, Session
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
from services.dify_builder import dify_port
from services.dify_builder.execution_contracts import canonical_digest
from services.dify_builder.native_testing.confirmed_agent_commands import (
    ConfirmedAgentCommands,
    confirmed_parent_outcome,
)
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import native_workflow_revision
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision
from tests.builder_agent_fixtures import make_case


@pytest.fixture
def completed(sqlite_session_factory, monkeypatch):
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
    monkeypatch.setattr(dify_port, "db", SimpleNamespace(engine=factory.kw["bind"]))
    from services import workflow_service

    monkeypatch.setattr(workflow_service, "db", SimpleNamespace(engine=factory.kw["bind"]))
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
    commands = ConfirmedAgentCommands(
        api=SimpleNamespace(actor=case.actor, loader=SimpleNamespace(session_factory=factory), get=lambda **_: receipt),
        continuation=None,
        backend=None,
        publish=None,
    )
    commands._request = lambda **_: None
    commands._root_ref = lambda **_: ref
    return SimpleNamespace(
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


def test_resume_finalizes_actual_c03_before_closing_original_builder_run(completed):
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
                SimpleNamespace(ref=owner.ref, tenant_id=owner.case.actor.tenant_id, state="running"),
                sql.get(NativeTestScope, owner.request_id),
            )

    loader = SimpleNamespace(session_factory=owner.factory, locked=locked)
    owner.commands.api.loader = loader
    owner.commands.api.store = SimpleNamespace(
        load_context=lambda **_: SimpleNamespace(
            native_run_id=owner.native_id,
            tenant_id=owner.case.actor.tenant_id,
            app_id=owner.case.workflow.app_id,
            workflow_id=owner.case.workflow.id,
            actor_id=owner.case.actor.account_id,
        )
    )
    owner.commands.api.lifecycle = NativeTestLifecycleService(loader, state_store=None)
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
