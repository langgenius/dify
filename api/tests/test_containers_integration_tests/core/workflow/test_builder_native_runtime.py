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
    monkeypatch,
    request,
):
    kind = getattr(request, "param", "root")
    assert migrated_continuation_tables is migrated_dispatch_claims is no_live is None
    from libs.key_providers import generate_key_pair
    from libs.sensitive_http_telemetry import SensitiveHttpLogFilter

    filtering = SensitiveHttpLogFilter()
    handlers = tuple(logging.getLogger().handlers)
    for handler in handlers:
        handler.addFilter(filtering)
    try:
        factory, actor, app, workflow, session_id, input_id = native_owner
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
