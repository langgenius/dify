"""CI-only actual Dify/Graphon + PostgreSQL/encrypted C03 native delivery.

Do not import, collect or run on the development host. Only HTTP transport and
queue publication are offline boundaries; Run/history, claims, grants, journal,
checkpoint serialization and physical owned threads use their actual owners.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from core.dify_builder.models import Actor
from models.account import Tenant
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestScope
from models.workflow import Workflow, WorkflowRun
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.contracts import decode_native_ref
from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
from services.dify_builder.native_testing.runtime import DifyNativeRuntime, DifyNativeRuntimeOwner, build_native_api
from sqlalchemy import select
from tests.test_containers_integration_tests.core.workflow.builder_native_runtime_diagnostics import (
    native_runtime_resume_diagnostics as native_runtime_resume_diagnostics,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    no_live as no_live,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_http_binding import literal_data


def initial_graph(kind="root"):
    graph: dict[str, Any] = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "http", "data": literal_data()},
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {"variable": "body", "value_selector": ["http", "body"]},
                    ],
                },
            },
        ],
        "edges": [
            {"id": "start-http", "source": "start", "target": "http", "sourceHandle": "source"},
            {"id": "http-end", "source": "http", "target": "end", "sourceHandle": "source"},
        ],
    }

    if kind == "root":
        return graph
    http = graph["nodes"][1]
    http["data"][kind + "_id"] = "container"
    graph["nodes"] = [
        graph["nodes"][0],
        {
            "id": "container",
            "data": {
                "type": kind,
                "start_node_id": "body-start",
                **(
                    {
                        "iterator_selector": ["start", "items"],
                        "output_selector": ["http", "body"],
                        "is_parallel": True,
                        "parallel_nums": 2,
                        "flatten_output": True,
                    }
                    if kind == "iteration"
                    else {"loop_count": 1, "break_conditions": [], "logical_operator": "and"}
                ),
            },
        },
        {"id": "body-start", "data": {"type": kind + "-start", kind + "_id": "container"}},
        http,
        {"id": "end", "data": {"type": "end", "outputs": []}},
    ]
    graph["edges"] = [
        {"source": "start", "target": "container"},
        {"source": "body-start", "target": "http"},
        {"source": "container", "target": "end"},
    ]
    return graph


@pytest.fixture
def runtime_case(
    flask_app_with_containers,
    native_owner,
    no_live,
    migrated_continuation_tables,
    migrated_dispatch_claims,
    mock_ssrf_proxy_requests,
    monkeypatch,
    request,
):
    kind = getattr(request, "param", "root")
    assert migrated_continuation_tables is migrated_dispatch_claims is no_live is None
    from core.helper import ssrf_proxy
    from extensions.ext_database import db
    from libs.key_providers import generate_key_pair
    from libs.sensitive_http_telemetry import SensitiveHttpLogFilter

    filtering = SensitiveHttpLogFilter()
    handlers = tuple(logging.getLogger().handlers)
    for handler in handlers:
        handler.addFilter(filtering)
    try:
        factory, actor, app, workflow, session_id, input_id = native_owner
        # Preserve native_owner teardown IDs, then release its committed setup
        # snapshot before the independent Session updates the tenant key.
        assert app.id
        assert workflow.id
        db.session.expunge(app)
        db.session.expunge(workflow)
        db.session.close()
        public_key = generate_key_pair(actor.tenant_id)
        with factory.begin() as session:
            session.get(Tenant, actor.tenant_id).encrypt_public_key = public_key
            actual = session.get(Workflow, workflow.id)
            actual.graph = json.dumps(initial_graph(kind))
            actual._features = "{}"
            actual._environment_variables = "{}"
            session.get(DifyBuilderTestInput, input_id).inputs = (
                {"items": ["one", "two"]} if kind == "iteration" else {}
            )
            version = session.get(DifyBuilderSession, session_id).version
        published, sends = [], []

        def publish(**message):
            published.append(message)

        def send(client, request, **kwargs):
            sends.append(request)
            assert request.url.host == "example.com"
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                content=b'{"private":"response-canary","flag":true}',
                request=request,
            )

        monkeypatch.setattr(httpx.Client, "send", send)
        # Restore the real SSRF facade only while this lower transport is synthetic.
        monkeypatch.setattr(ssrf_proxy, "make_request", mock_ssrf_proxy_requests)
        owner = DifyNativeRuntimeOwner()
        api = build_native_api(sessions=factory, actor=actor, owner=owner, publish=publish)
        admitted = api.start(
            actor=actor,
            session_id=session_id,
            test_input_id=input_id,
            expected_version=version,
            mode="native",
            idempotency_key="actual-initial",
        )
        assert len(published) == 1
        yield SimpleNamespace(
            factory=factory,
            actor=actor,
            app=flask_app_with_containers,
            session_id=session_id,
            api=api,
            owner=owner,
            published=published,
            sends=sends,
            request_id=admitted.request_id,
            kind=kind,
        )
    finally:
        for handler in handlers:
            handler.removeFilter(filtering)


def delivery(c, message):
    return c.owner.delivery(
        sessions=c.factory,
        delivery=NativeDispatchRef(decode_native_ref(message["ref"]), message["generation"], message["dispatch_id"]),
        actor_hint=Actor(**message["actor"]),
    )


def execute(c, lifecycle, message):
    with c.app.app_context():
        return lifecycle.execute_dispatch(
            ref=decode_native_ref(message["ref"]), generation=message["generation"], dispatch_id=message["dispatch_id"]
        )


def confirm(c):
    receipt = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
    assert receipt.status == "waiting"
    assert receipt.wait_reason == "approval"
    assert receipt.native_run_id
    assert 1 <= len(receipt.pending) <= (2 if c.kind == "iteration" else 1)
    for pending in receipt.pending:
        c.api.decide(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            pending_operation_id=pending.pending_operation_id,
            decision="confirm",
            scope_digest=pending.scope_digest,
            expected_version=receipt.version,
            idempotency_key="confirmation-" + pending.pending_operation_id,
        )
    return receipt


@pytest.mark.parametrize("runtime_case", ["root", "loop", "iteration"], indirect=True)
def test_actual_same_run_http_wait_checkpoint_cleanup_claimed_resume_and_duplicate(runtime_case):
    c = runtime_case
    first = c.published[0]
    initial = delivery(c, first)
    waiting = execute(c, initial, first)
    assert waiting.status == "waiting"
    assert c.sends == []
    checkpoint = c.api.store.read_checkpoint(ref=waiting.ref, checkpoint=waiting.checkpoint_ref)
    assert checkpoint.native_run_id == waiting.native_run_id
    assert checkpoint.node_journals
    assert checkpoint.approval_proposals
    with c.factory() as session:
        before = session.get(WorkflowRun, waiting.native_run_id)
        created_at = before.created_at
        assert before.status == "paused"
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert state.cleanup_complete
        assert session.get(NativeDispatch, first["dispatch_id"]).state == "completed"
    completed = waiting
    second = resumed = None
    for index in range(3):
        receipt = confirm(c)
        c.api.resume(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            expected_generation=receipt.generation,
            idempotency_key=f"same-run-resume-{index}",
        )
        c.api.lifecycle.publish_pending(publish=lambda **message: c.published.append(message))
        second = c.published[-1]
        resumed = delivery(c, second)
        completed = execute(c, resumed, second)
        if completed.status != "waiting":
            break
    assert completed.status == "completed"
    assert completed.native_status == "succeeded"
    assert completed.native_run_id == receipt.native_run_id == waiting.native_run_id
    assert len(c.sends) == (2 if c.kind == "iteration" else 1)
    assert second is not None
    assert resumed is not None
    # Same real used acquisition/capacity is retained even after cleanup.
    assert delivery(c, second) is resumed
    assert execute(c, resumed, second) is None
    assert len(c.sends) == (2 if c.kind == "iteration" else 1)
    with c.factory() as session:
        run = session.get(WorkflowRun, completed.native_run_id)
        assert run.created_at == created_at
        assert run.status == "succeeded"
        assert "response-canary" not in run.outputs
        assert len(session.scalars(select(WorkflowRun).where(WorkflowRun.id == run.id)).all()) == 1


def test_real_resume_writer_refuses_wait_cleanup_before_source_finalize_then_same_command_succeeds(
    runtime_case,
    monkeypatch,
):
    c = runtime_case
    message = c.published[0]
    lifecycle = delivery(c, message)
    held, release = Event(), Event()
    actual_pause = lifecycle.pause

    def pause(**kwargs):
        receipt = actual_pause(**kwargs)
        if lifecycle._capacity._verifier._consumed:
            held.set()  # Real wait and cleanup committed; no SQL writer held.
            assert release.wait(15)
        return receipt

    monkeypatch.setattr(lifecycle, "pause", pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute, c, lifecycle, message)
        try:
            assert held.wait(15)
            confirm(c)
            with pytest.raises(BuilderExecutionPolicyError, match="native_resume_unsettled"):
                c.api.resume(
                    actor=c.actor,
                    session_id=c.session_id,
                    request_id=c.request_id,
                    expected_generation=0,
                    idempotency_key="race-resume",
                )
            with c.factory() as session:
                state = session.scalar(
                    select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id)
                )
                scope = session.get(NativeTestScope, c.request_id)
                assert state.generation == scope.generation == 0
                assert state.cleanup_complete
                assert scope.spent_calls == scope.spent_dispatches == 0
                assert (
                    len(session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all())
                    == 1
                )
                assert session.get(NativeDispatch, message["dispatch_id"]).state == "claimed"
        finally:
            release.set()
        assert future.result(timeout=15).status == "waiting"
    c.api.resume(
        actor=c.actor,
        session_id=c.session_id,
        request_id=c.request_id,
        expected_generation=0,
        idempotency_key="race-resume",
    )
    with c.factory() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert state.generation == 1
        assert state.state == "queued"
        assert len(session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()) == 2
    assert c.sends == []


@pytest.mark.parametrize("registered_before_cancel", [False, True])
def test_actual_api_cancel_initial_outbox_before_delivery_is_logically_settled(runtime_case, registered_before_cancel):
    c = runtime_case
    message = c.published[0]
    assert c.owner._requests == c.owner._current == {}
    registered = delivery(c, message) if registered_before_cancel else None
    if registered is not None:
        assert isinstance(registered.runtime, DifyNativeRuntime)
        assert registered.runtime.host.lifetime._registry is None
    result = c.api.cancel(
        actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="before-worker"
    )
    assert result.cancellation.status == "cancelled"
    assert result.status == "terminal"
    assert c.api.lifecycle.reconcile() == 0
    late = delivery(c, message)
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        execute(c, late, message)
    c.owner.retire_closed(sessions=c.factory)
    assert c.owner._requests == c.owner._current == {}
    if registered is not None:
        assert isinstance(registered.runtime, DifyNativeRuntime)
        assert registered.runtime.registry._disposed
        assert not registered.runtime.host.lifetime._consumed
        with pytest.raises(ValueError, match="native_host_acquisition_not_current"):
            registered.runtime.registry.activate(lifetime=registered.runtime.host.lifetime)
    assert c.sends == []
    with c.factory() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert state.generation == 0
        assert state.cleanup_complete
        dispatches = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()
        assert len(dispatches) == 1
        assert dispatches[0].state == "cancelled"
        assert dispatches[0].claim_expires_at is None
        request = session.get(DifyBuilderExecutionRequest, c.request_id)
        assert request is not None
        assert result.native_run_id is None
        assert session.get(WorkflowRun, request.context["native_run_id"]) is None


def test_actual_cancel_through_consumed_source_owner_does_not_ack_live_resumed_owner(runtime_case, monkeypatch):
    c = runtime_case
    initial = delivery(c, c.published[0])
    waiting = execute(c, initial, c.published[0])
    assert waiting.status == "waiting"
    assert initial.runtime.host.lifetime._consumed
    receipt = confirm(c)
    c.api.resume(
        actor=c.actor,
        session_id=c.session_id,
        request_id=c.request_id,
        expected_generation=receipt.generation,
        idempotency_key="cancel-other-owner-resume",
    )
    c.api.lifecycle.publish_pending(publish=lambda **message: c.published.append(message))
    message = c.published[-1]
    assert message["generation"] == 1
    other = DifyNativeRuntimeOwner()
    resumed = other.delivery(
        sessions=c.factory,
        delivery=NativeDispatchRef(decode_native_ref(message["ref"]), message["generation"], message["dispatch_id"]),
    )
    assert isinstance(resumed.runtime, DifyNativeRuntime)
    entered, release = Event(), Event()
    actual_send = httpx.Client.send

    def held_send(client, request, **kwargs):
        entered.set()
        assert release.wait(15)
        return actual_send(client, request, **kwargs)

    monkeypatch.setattr(httpx.Client, "send", held_send)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute, c, resumed, message)
        try:
            assert entered.wait(15)
            result = c.api.cancel(
                actor=c.actor,
                session_id=c.session_id,
                request_id=c.request_id,
                idempotency_key="cancel-through-old-process",
            )
            assert result.cancellation.status in {"cancelling", "unknown"}
            assert not resumed.runtime.host.lifetime._consumed
            c.api.lifecycle.reconcile()
            with c.factory() as session:
                state = session.scalar(
                    select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id)
                )
                assert state.generation == 1
                assert not state.cleanup_complete
                assert session.get(NativeDispatch, message["dispatch_id"]).state == "claimed"
                assert session.get(NativeDispatch, c.published[0]["dispatch_id"]).state == "completed"
        finally:
            release.set()
        # The actual worker closes or fails under the durable cancellation fence;
        # its result/exception is not a cleanup receipt for the older owner.
        from services.dify_builder.native_testing.observation_adapters import NativeObservationError

        try:
            future.result(timeout=15)
        except (BuilderExecutionPolicyError, NativeObservationError):
            assert c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id).cancellation.status in {
                "cancelling",
                "unknown",
                "cancelled",
            }
    assert initial.runtime.host.lifetime._consumed


def test_actual_initial_run_null_outputs_survive_first_native_node_persistence(runtime_case):
    """Real mapped insert/read witness before any graph effect or cleanup claim."""
    from uuid import uuid4

    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from libs.datetime_utils import naive_utc_now
    from models.account import Account
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom

    from graphon.entities import WorkflowExecution, WorkflowNodeExecution
    from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType

    c = runtime_case
    lifecycle = delivery(c, c.published[0])
    assert isinstance(lifecycle.runtime, DifyNativeRuntime)
    context = lifecycle.runtime.context
    guard = lifecycle.runtime.host.native_observation
    with c.factory() as session:
        account = session.get(Account, context.actor_id)
        assert account is not None
        session.expunge(account)
    runs = SQLAlchemyWorkflowExecutionRepository(
        c.factory, context.tenant_id, account, context.app_id, WorkflowRunTriggeredFrom.DEBUGGING
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        c.factory, context.tenant_id, account, context.app_id, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    )
    runs.bind_native_observation(context=context, guard=guard)
    nodes.bind_native_observation(context=context, guard=guard)
    now = naive_utc_now()
    execution = WorkflowExecution(
        id_=context.native_run_id,
        workflow_id=context.workflow_id,
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph=context.graph,
        inputs=context.inputs,
        started_at=now,
    )
    assert execution.outputs is None
    runs.save(execution)
    with c.factory() as session:
        row = session.scalar(
            select(WorkflowRun).where(
                WorkflowRun.id == context.native_run_id,
                WorkflowRun.tenant_id == context.tenant_id,
                WorkflowRun.app_id == context.app_id,
                WorkflowRun.workflow_id == context.workflow_id,
                WorkflowRun.created_by == context.actor_id,
                WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
            )
        )
        assert row is not None
        assert row.status is WorkflowExecutionStatus.RUNNING
        assert row.outputs == "null"
    restored = runs.get_native_observation_run(workflow_run_id=context.native_run_id)
    assert restored.outputs is None
    assert not guard.failed
    node_id = str(uuid4())
    nodes.save(
        WorkflowNodeExecution(
            id=node_id,
            node_execution_id=node_id,
            workflow_id=context.workflow_id,
            workflow_execution_id=context.native_run_id,
            index=1,
            node_id="start",
            node_type="start",
            title="Start",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={},
            outputs={},
            process_data={},
            created_at=now,
            finished_at=now,
        )
    )
    with c.factory() as session:
        row = session.scalar(
            select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.id == node_id,
                WorkflowNodeExecutionModel.workflow_run_id == context.native_run_id,
                WorkflowNodeExecutionModel.tenant_id == context.tenant_id,
                WorkflowNodeExecutionModel.app_id == context.app_id,
                WorkflowNodeExecutionModel.workflow_id == context.workflow_id,
                WorkflowNodeExecutionModel.created_by == context.actor_id,
                WorkflowNodeExecutionModel.created_by_role == CreatorUserRole.ACCOUNT,
            )
        )
        assert row is not None
        assert row.status is WorkflowNodeExecutionStatus.SUCCEEDED
    assert execution.outputs is None
    assert not guard.failed
    assert c.sends == []


def test_real_cancel_after_wait_cleanup_before_source_finalize_preserves_unknown(runtime_case, monkeypatch):
    """CI-only actual WAIT/SQL/checkpoint/verifier race; no synthesized ACK or source settlement."""
    from models.dify_builder_native_tests import (
        NativeContinuation,
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativePendingAction,
    )

    c = runtime_case
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    lifecycle = delivery(c, message)
    held, release = Event(), Event()
    actual_pause = lifecycle.pause
    waits = []

    def pause(**kwargs):
        receipt = actual_pause(**kwargs)
        if lifecycle._capacity._verifier._consumed:
            waits.append(receipt)
            held.set()  # Real protected WAIT + consumed physical verifier, before finalizer.
            assert release.wait(15)
        return receipt

    monkeypatch.setattr(lifecycle, "pause", pause)
    # A separate API process owner has no retained worker lifetime to fabricate ACK.
    api = build_native_api(
        sessions=c.factory, actor=c.actor, owner=DifyNativeRuntimeOwner(), publish=lambda **msg: c.published.append(msg)
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute, c, lifecycle, message)
        try:
            assert held.wait(15)
            assert lifecycle.runtime.host.lifetime._consumed
            waiting = waits[0]
            assert waiting.generation == 0
            assert waiting.wait_reason == "approval"
            checkpoint = c.api.store.read_checkpoint(ref=ref, checkpoint=waiting.checkpoint)
            assert checkpoint.generation == 0
            assert checkpoint.node_journals
            assert checkpoint.approval_proposals
            with c.factory() as session:
                request = session.get(DifyBuilderExecutionRequest, c.request_id)
                state = session.scalar(
                    select(NativeInvocationState).where(
                        NativeInvocationState.tenant_id == c.actor.tenant_id,
                        NativeInvocationState.request_id == c.request_id,
                        NativeInvocationState.invocation_id == ref.invocation_id,
                    )
                )
                scope = session.get(NativeTestScope, c.request_id)
                source = session.get(NativeDispatch, message["dispatch_id"])
                continuation = session.scalar(
                    select(NativeContinuation).where(
                        NativeContinuation.tenant_id == c.actor.tenant_id,
                        NativeContinuation.request_id == c.request_id,
                        NativeContinuation.invocation_id == ref.invocation_id,
                        NativeContinuation.checkpoint_id == waiting.checkpoint.checkpoint_id,
                    )
                )
                pending = session.scalars(
                    select(NativePendingAction).where(NativePendingAction.request_id == c.request_id)
                ).all()
                assert continuation is not None
                assert continuation.generation == 0
                assert continuation.payload_digest == waiting.checkpoint.payload_digest
                assert set(state.pending_ids) == set(waiting.pending_operation_ids) == {row.id for row in pending}
                assert all(row.generation == 0 and row.category == "approval" for row in pending)
                assert state.checkpoint_id == continuation.checkpoint_id
                assert state.generation == scope.generation == source.generation == 0
                assert state.cleanup_complete
                assert source.state == "claimed"
                assert (source.tenant_id, source.request_id, source.invocation_id) == (
                    c.actor.tenant_id,
                    c.request_id,
                    ref.invocation_id,
                )
                native_run_id = checkpoint.native_run_id
                run = session.get(WorkflowRun, native_run_id)
                created_at = run.created_at
                assert run.status == "paused"
                assert request.context["native_run_id"] == run.id
                assert scope.spent_calls == scope.spent_dispatches == 0
                operation_ids = {
                    row.id
                    for row in session.scalars(
                        select(NativeEffectOperation).where(NativeEffectOperation.request_id == c.request_id)
                    )
                }
                for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
                    assert session.scalar(select(model.id).where(model.request_id == c.request_id)) is None
            cancelled = api.cancel(
                actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="ack-window-cancel"
            )
            assert cancelled.cancellation.status == "cancelling"
            assert cancelled.outcome is None
            assert cancelled.status == "running"
            assert cancelled.native_run_id == native_run_id
            assert cancelled.native_status == "paused"
        finally:
            release.set()
        # The unchanged finalizer rejects cancelled authority. execute_dispatch's
        # real exception tail must persist unknown while retaining the physical ACK.
        with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_conflict"):
            future.result(timeout=15)
    assert c.sends == []
    assert lifecycle.runtime.host.lifetime._consumed
    for _ in range(2):
        for receipt in (
            api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id),
            api.cancel(
                actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="ack-window-cancel"
            ),
        ):
            assert receipt.cancellation.status == receipt.outcome == "unknown"
            assert receipt.status == "terminal"
            assert set(receipt.cancellation.operation_states) == operation_ids
            assert set(receipt.cancellation.operation_states.values()) <= {"not_dispatched"}
            assert receipt.native_run_id == native_run_id
            assert receipt.native_status == "paused"
            assert receipt.generation == 0
            assert receipt.pending == ()
        assert api.lifecycle.reconcile() == 0
    with c.factory() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        scope = session.get(NativeTestScope, c.request_id)
        sources = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()
        assert len(sources) == 1
        source = sources[0]
        assert (
            source.id,
            source.tenant_id,
            source.request_id,
            source.invocation_id,
            source.generation,
            source.state,
        ) == (message["dispatch_id"], c.actor.tenant_id, c.request_id, ref.invocation_id, 0, "unknown")
        assert state.state == "cancelled"
        assert state.cleanup_complete
        assert scope.cancelled
        assert state.generation == scope.generation == 0
        assert state.checkpoint_id == waiting.checkpoint.checkpoint_id
        assert scope.spent_calls == scope.spent_dispatches == 0
        run = session.get(WorkflowRun, native_run_id)
        assert run.status == "paused"
        assert run.created_at == created_at
        assert len(session.scalars(select(WorkflowRun).where(WorkflowRun.id == native_run_id)).all()) == 1
        assert {
            row.id
            for row in session.scalars(
                select(NativeEffectOperation).where(NativeEffectOperation.request_id == c.request_id)
            )
        } == operation_ids
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
            assert session.scalar(select(model.id).where(model.request_id == c.request_id)) is None
    assert len(c.published) == 1
    assert c.sends == []
