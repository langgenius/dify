"""Normal CI only: real PostgreSQL/C03 fence ordering, never local collection.

Fixture UUIDs and metadata are synthetic; actual native public-node association
and physical host quiescence are separately owned. No provider I/O is invoked.
"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from models.dify_builder_native_tests import (
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePendingAction,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import ApprovalWait, DispatchPermit, PolicyStop, RecordedResult
from services.dify_builder.native_testing.pending_actions import NativePendingActionService
from services.dify_builder.native_testing.transitions import quarantine_unknown
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    _bind_child_effect,
    _child_case,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    ledger_case as ledger_case,  # noqa: PLC0414
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


@pytest.fixture
def fence_case(continuation_case, migrated_dispatch_claims):
    assert migrated_dispatch_claims is None
    return continuation_case


def _state(c, ref=None):
    ref = ref or c.ref
    with c.factory() as session:
        return session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == ref.request_id,
                NativeInvocationState.invocation_id == ref.invocation_id,
            )
        )


def _pending(c, category, ref=None):
    ref = ref or c.ref
    generation = c.store.load_context(ref=ref).generation
    service = NativePendingActionService(c.store.loader)
    if category == "configuration":
        return service.configuration(ref=ref, requirements_ref="configuration-1", expected_generation=generation)
    if category == "interaction":
        return service.interaction(ref=ref, native_form_ref="form-1", expected_generation=generation)
    effect = c.ledger.intent if ref == c.ref else _bind_child_effect(c, ref, approval_scope="operation")
    return c.ledger.guard.before_call(ref=ref, intent=effect)


def _fence(c, pending_id, ref=None):
    ref = ref or c.ref
    return c.lifecycle.fence_pending(
        ref=ref, pending_operation_ids=(pending_id,), expected_generation=c.store.load_context(ref=ref).generation
    )


def _count(c, model):
    with c.factory() as session:
        return session.scalar(select(func.count()).select_from(model).where(model.request_id == c.ref.request_id))


def _pause_configuration(c):
    wait = _pending(c, "configuration")
    _fence(c, wait.pending_operation_id)
    cp = c.checkpoint()
    c.lifecycle.pause(
        ref=c.ref, checkpoint=cp, pending_operation_ids=(wait.pending_operation_id,), expected_generation=0
    )
    c.resolution.resolved = True
    receipt = c.resume()
    return wait, cp, receipt


@pytest.mark.parametrize("category", ["approval", "configuration", "interaction"])
def test_running_fence_coalesces_exact_real_category_without_new_operation_or_spend(fence_case, category):
    c = fence_case
    wait = _pending(c, category)
    baseline = _count(c, NativeEffectOperation)
    assert _fence(c, wait.pending_operation_id) is None
    assert _fence(c, wait.pending_operation_id) is None
    state = _state(c)
    assert (state.state, state.checkpoint_id, state.wait_reason) == ("running", None, category)
    assert state.pending_ids == [wait.pending_operation_id]
    sibling = c.ledger.occurrence("fixture-" + str(uuid4()))
    assert c.ledger.guard.before_call(ref=c.ref, intent=sibling) == wait
    assert _count(c, NativeEffectOperation) == baseline
    assert _count(c, NativeEffectAttempt) == _count(c, NativeEffectDispatchClaim) == 0
    with c.factory() as session:
        scope = session.get(NativeTestScope, c.ref.request_id)
        assert (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units) == (0, 0, 0)


def test_completed_result_replay_survives_later_running_fence(fence_case):
    c = fence_case
    c.ledger.confirm()
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    c.ledger.guard.claim_dispatch(ref=c.ref, intent=c.ledger.intent, permit=permit)
    result = c.store.store_result(ref=c.ref, key=c.ledger.intent.key, result={"done": True})
    c.ledger.guard.record_outcome(permit=permit, outcome="completed", result_ref=result)
    wait = _pending(c, "configuration")
    _fence(c, wait.pending_operation_id)
    assert c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent) == RecordedResult(
        operation_id=permit.operation_id, result_ref=result
    )
    assert _count(c, NativeEffectAttempt) == _count(c, NativeEffectDispatchClaim) == 1


def test_reserved_permit_losing_fence_race_is_not_refunded_or_physically_consumed(fence_case):
    c = fence_case
    c.ledger.confirm()
    permit = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    assert isinstance(permit, DispatchPermit)
    wait = _pending(c, "configuration")
    _fence(c, wait.pending_operation_id)
    with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_fenced"):
        c.ledger.guard.claim_dispatch(ref=c.ref, intent=c.ledger.intent, permit=permit)
    assert c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent) == PolicyStop(
        reason_code="dispatch_in_progress"
    )
    assert _count(c, NativeEffectAttempt) == 1
    assert _count(c, NativeEffectDispatchClaim) == _count(c, NativeEffectOutcome) == 0
    with c.factory() as session:
        scope = session.get(NativeTestScope, c.ref.request_id)
        assert (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units) == (1, 1, 2)


@pytest.mark.parametrize("boundary", ["reserve", "physical"])
def test_real_root_lock_orders_fence_against_reservation_or_physical_claim(fence_case, boundary):
    c = fence_case
    c.ledger.confirm(max_calls=2, max_dispatches=2)
    wait = _pending(c, "configuration")
    effect = c.ledger.occurrence("fixture-" + str(uuid4()))
    permit = c.ledger.guard.before_call(ref=c.ref, intent=effect) if boundary == "physical" else None
    barrier = Barrier(2)

    def fence():
        barrier.wait(timeout=10)
        _fence(c, wait.pending_operation_id)

    def consume():
        barrier.wait(timeout=10)
        if boundary == "reserve":
            return c.ledger.guard.before_call(ref=c.ref, intent=effect)
        try:
            c.ledger.guard.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
            return "claimed"
        except BuilderExecutionPolicyError as error:
            return error.reason_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(fence)
        result = pool.submit(consume).result(timeout=20)
        future.result(timeout=20)
    if boundary == "reserve":
        assert isinstance(result, (ApprovalWait, DispatchPermit))
        assert _count(c, NativeEffectAttempt) == int(isinstance(result, DispatchPermit))
        if isinstance(result, DispatchPermit):
            with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_fenced"):
                c.ledger.guard.claim_dispatch(ref=c.ref, intent=effect, permit=result)
        else:
            assert result == wait
        assert _count(c, NativeEffectDispatchClaim) == 0
    else:
        assert result in {"claimed", "native_dispatch_fenced"}
        assert _count(c, NativeEffectDispatchClaim) == int(result == "claimed")
        assert _count(c, NativeEffectAttempt) == 1


def test_foreign_invocation_fence_and_ancestor_work_never_inherit_pending_identity(fence_case):
    c = fence_case
    service, child = _child_case(c)
    effect = _bind_child_effect(c, child)
    child_wait = _pending(c, "configuration", child)
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_mismatch"):
        _fence(c, child_wait.pending_operation_id)
    root_wait = _pending(c, "configuration")
    _fence(c, root_wait.pending_operation_id)
    decision = c.ledger.guard.before_call(ref=child, intent=effect)
    assert isinstance(decision, PolicyStop)
    assert _count(c, NativeEffectAttempt) == 0
    key = effect.key.model_copy(update={"occurrence_path": ("fixture-new-child",)})
    input_ref = c.store.store_result(ref=child, key=key, result={"nested": True})
    with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_fenced"):
        service.get_or_create(
            parent_ref=child,
            key=key,
            child_app_id=c.context.app_id,
            child_workflow_revision=c.context.graph_revision,
            input_digest=canonical_digest({"nested": True}),
            input_result_ref=input_ref,
        )


def test_pause_rejects_omitting_a_late_real_fence_member(fence_case):
    c = fence_case
    first = _pending(c, "configuration")
    second = _pending(c, "interaction")
    _fence(c, first.pending_operation_id)
    cp = c.checkpoint()
    c.lifecycle.fence_pending(ref=c.ref, pending_operation_ids=(second.pending_operation_id,), expected_generation=0)
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_mismatch"):
        c.lifecycle.pause(
            ref=c.ref, checkpoint=cp, pending_operation_ids=(first.pending_operation_id,), expected_generation=0
        )
    assert _state(c).state == "running"
    assert _state(c).pending_ids == [first.pending_operation_id, second.pending_operation_id]


def test_enqueue_keeps_fence_and_exclusive_claim_opens_only_acknowledged_reason(fence_case):
    c = fence_case
    wait, _, receipt = _pause_configuration(c)
    assert (_state(c).state, _state(c).pending_ids) == ("queued", [wait.pending_operation_id])
    assert isinstance(c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent), PolicyStop)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert (_state(c).state, _state(c).pending_ids, _state(c).wait_reason) == (
        "running",
        [wait.pending_operation_id],
        None,
    )
    assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert _state(c).pending_ids == [wait.pending_operation_id]
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_mismatch"):
        c.lifecycle.fence_pending(ref=c.ref, pending_operation_ids=(wait.pending_operation_id,), expected_generation=1)


@pytest.mark.parametrize("fault", ["empty", "wrong_id", "unresolved", "unknown"])
def test_malformed_saved_resolution_or_unknown_never_reopens_queued_fence(fence_case, fault):
    c = fence_case
    wait, _, receipt = _pause_configuration(c)
    with c.store.loader.locked(ref=c.ref) as (session, owned, _):
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        if fault == "unknown":
            quarantine_unknown(session, ref=c.ref, tenant_id=owned.tenant_id)
        elif fault == "empty":
            state.resolution = []
        else:
            raw = dict(state.resolution[0])
            raw["pending_action_id" if fault == "wrong_id" else "resolved"] = (
                "foreign" if fault == "wrong_id" else False
            )
            state.resolution = [raw]
    if fault == "unknown":
        assert not c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert _state(c).pending_ids == [wait.pending_operation_id]
    assert _state(c).state != "running"


@pytest.mark.parametrize("category", ["approval", "configuration", "interaction"])
def test_real_pending_creation_and_fence_use_child_local_generation_after_unrelated_root_resume(fence_case, category):
    c = fence_case
    _, child = _child_case(c)
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert c.store.load_context(ref=child).generation == 0
    with c.factory() as session:
        assert session.get(NativeTestScope, c.ref.request_id).generation == 1
    wait = _pending(c, category, child)
    assert isinstance(wait, ApprovalWait)
    with c.factory() as session:
        assert session.get(NativePendingAction, wait.pending_operation_id).generation == 0
    _fence(c, wait.pending_operation_id, child)
    assert _state(c, child).pending_ids == [wait.pending_operation_id]


@pytest.mark.parametrize("stale_local", [False, True])
def test_real_protected_child_approval_local_zero_shared_one_and_stale_local_rejection(fence_case, stale_local):
    from types import SimpleNamespace

    from tests.test_containers_integration_tests.core.workflow.test_builder_native_approval_scope import (
        _decide,
        _prepare_pending,
    )

    c = fence_case
    _, child = _child_case(c)
    c.pause()
    c.ledger.confirm()
    receipt = c.resume()
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    context = c.store.load_context(ref=child)
    assert context.generation == 0
    effect = _bind_child_effect(c, child, approval_scope="operation", input_digest=canonical_digest({"limit": 1}))
    selected = SimpleNamespace(
        ref=child,
        store=c.store,
        factory=c.factory,
        context=context,
        lifecycle=c.lifecycle,
        ledger=SimpleNamespace(actor=c.ledger.actor, guard=c.ledger.guard),
    )
    _, guards = _prepare_pending(selected, (effect,))
    with c.factory() as session:
        assert session.get(NativeTestScope, c.ref.request_id).generation == 1
        assert session.get(NativePendingAction, guards[0].pending_operation_id).generation == 0
    if stale_local:
        with c.factory.begin() as session:
            state = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == child.request_id,
                    NativeInvocationState.invocation_id == child.invocation_id,
                )
            )
            state.generation = 1
        with pytest.raises(BuilderExecutionPolicyError, match="native_pending_conflict"):
            _decide(selected, guards[0])
    else:
        assert _decide(selected, guards[0]) == _decide(selected, guards[0])


def _expire_claim(c, receipt):
    from datetime import UTC, datetime, timedelta

    from models.dify_builder_native_tests import NativeDispatch

    with c.factory.begin() as session:
        session.get(NativeDispatch, receipt.dispatch_id).claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    c.lifecycle.reconcile()


@pytest.mark.parametrize("late_fence", [False, True])
def test_real_explicit_recovery_preserves_source_and_refuses_later_fence_evidence_loss(fence_case, late_fence):
    c = fence_case
    wait, _, receipt = _pause_configuration(c)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    assert (_state(c).pending_ids, _state(c).wait_reason) == ([wait.pending_operation_id], None)
    if late_fence:
        late = _pending(c, "interaction")
        _fence(c, late.pending_operation_id)
        assert _state(c).pending_ids == [late.pending_operation_id]
    _expire_claim(c, receipt)
    assert _state(c).state == "unknown"

    class RuntimeProof:
        """Trusted proof-port fixture; this does not claim real host quiescence."""

        def recovery_evidence(self, **_kwargs):
            return "not_started"

    c.lifecycle.runtime = RuntimeProof()
    if late_fence:
        with pytest.raises(BuilderExecutionPolicyError):
            c.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=receipt.dispatch_id)
        assert _state(c).state == "unknown"
        assert _state(c).pending_ids == [late.pending_operation_id]
    else:
        c.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=receipt.dispatch_id)
        assert _state(c).state == "queued"
        assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
        assert (_state(c).state, _state(c).pending_ids, _state(c).wait_reason) == (
            "running",
            [wait.pending_operation_id],
            None,
        )
    assert _count(c, NativeEffectAttempt) == _count(c, NativeEffectDispatchClaim) == 0


def test_history_allows_fresh_pending_then_first_new_fence_replaces_only_old_evidence(fence_case):
    c = fence_case
    old, _, receipt = _pause_configuration(c)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    fresh = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    assert isinstance(fresh, ApprovalWait)
    assert fresh.wait_reason == "approval"
    assert fresh.pending_operation_id != old.pending_operation_id
    _fence(c, fresh.pending_operation_id)
    assert (_state(c).pending_ids, _state(c).wait_reason) == ([fresh.pending_operation_id], "approval")


def test_active_private_reason_does_not_publish_a_waiting_receipt(fence_case):
    from types import SimpleNamespace

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.native_testing.api_service import NativeTestApiService

    c = fence_case
    wait = _pending(c, "configuration")
    _fence(c, wait.pending_operation_id)
    with c.factory() as session:
        session_id = session.get(DifyBuilderExecutionRequest, c.ref.request_id).session_id
    api = NativeTestApiService(
        session_factory=c.factory,
        actor=c.ledger.actor,
        resolver=c.ledger.metadata,
        admission=None,
        resolution=c.resolution,
        runtime=None,
        disclosure=SimpleNamespace(describe=lambda **_kw: pytest.fail("running fence is private")),
    )
    receipt = api.get(actor=c.ledger.actor, session_id=session_id, request_id=c.ref.request_id)
    assert _state(c).state == "running"
    assert receipt.status != "waiting"
    assert receipt.wait_reason is None
    assert receipt.pending == ()


def test_exclusive_parent_claim_reopens_only_checkpoint_represented_descendant_reasons(fence_case):
    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload

    c = fence_case
    _, selected = _child_case(c)
    _, unrelated = _child_case(c)
    selected_wait = _pending(c, "configuration", selected)
    unrelated_wait = _pending(c, "configuration", unrelated)
    _fence(c, selected_wait.pending_operation_id, selected)
    _fence(c, unrelated_wait.pending_operation_id, unrelated)

    def payload(ref, children=()):
        return NativeCheckpointPayload(
            schema_version="1",
            native_run_id=c.store.load_context(ref=ref).native_run_id,
            generation=0,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=(),
            child_refs=children,
            input_result_refs=(),
        )

    child_cp = c.store.commit_checkpoint(ref=selected, generation=0, payload=payload(selected))
    c.lifecycle.pause(
        ref=selected,
        checkpoint=child_cp,
        pending_operation_ids=(selected_wait.pending_operation_id,),
        expected_generation=0,
    )
    root_cp = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload(c.ref, (selected,)))
    c.lifecycle.pause(
        ref=c.ref,
        checkpoint=root_cp,
        pending_operation_ids=(selected_wait.pending_operation_id,),
        expected_generation=0,
    )
    c.resolution.resolved = True
    receipt = c.resume()
    assert _state(c, selected).state == "queued"
    assert _state(c, unrelated).state == "running"
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)
    for ref in (c.ref, selected):
        state = _state(c, ref)
        assert (state.state, state.wait_reason, state.pending_ids) == (
            "running",
            None,
            [selected_wait.pending_operation_id],
        )
    other = _state(c, unrelated)
    assert (other.generation, other.wait_reason, other.pending_ids) == (
        0,
        "configuration",
        [unrelated_wait.pending_operation_id],
    )


def test_lost_fence_commit_ack_never_returns_acceptance_or_a_wait_receipt(fence_case, monkeypatch):
    from contextlib import contextmanager

    c = fence_case
    wait = _pending(c, "configuration")
    original = c.lifecycle.loader.locked

    @contextmanager
    def lost_ack(**kwargs):
        with original(**kwargs) as value:
            yield value
        raise OSError("lost commit acknowledgement")

    monkeypatch.setattr(c.lifecycle.loader, "locked", lost_ack)
    with pytest.raises(OSError, match="lost commit acknowledgement"):
        _fence(c, wait.pending_operation_id)
    assert (_state(c).state, _state(c).wait_reason, _state(c).pending_ids) == (
        "running",
        "configuration",
        [wait.pending_operation_id],
    )
    assert _count(c, NativeEffectAttempt) == _count(c, NativeEffectDispatchClaim) == 0


def test_concurrent_generation_claim_has_one_owner_and_retains_exact_evidence(fence_case):
    c = fence_case
    wait, _, receipt = _pause_configuration(c)
    barrier = Barrier(2)

    def claim(_):
        barrier.wait(timeout=10)
        return c.lifecycle.claim_dispatch(ref=c.ref, generation=receipt.generation, dispatch_id=receipt.dispatch_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(claim, range(2)))
    assert sorted(outcomes) == [False, True]
    assert (_state(c).generation, _state(c).wait_reason, _state(c).pending_ids) == (
        1,
        None,
        [wait.pending_operation_id],
    )


@pytest.mark.parametrize("child_status", ["running", "completed", "stopped"])
@pytest.mark.parametrize("fault", [None, "permission", "revision", "input"])
def test_real_existing_nested_child_lookup_revalidates_parent_app_and_protected_input(
    fence_case, monkeypatch, child_status, fault
):
    """Root A stays authorized; actual parent B must qualify every lookup of C."""
    import json
    from types import SimpleNamespace

    from sqlalchemy import inspect

    from configs import dify_config
    from extensions.ext_storage import storage
    from models.dify_builder_native_tests import NativePayloadObject
    from models.model import App
    from models.workflow import Workflow
    from runtime_contracts.builder.native.contracts import OperationKey
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService
    from services.enterprise.rbac_service import RBACService

    c = fence_case
    # Copy real owned app/workflow metadata to a distinct invocation app B.
    with c.factory.begin() as session:
        original = session.get(App, c.context.app_id)
        app = App(**{a.key: getattr(original, a.key) for a in inspect(App).column_attrs if a.key != "id"})
        app.id, app.maintainer = str(uuid4()), str(uuid4())
        original_workflow = session.get(Workflow, c.context.workflow_id)
        workflow = Workflow(
            **{a.key: getattr(original_workflow, a.key) for a in inspect(Workflow).column_attrs if a.key != "id"}
        )
        workflow.id, workflow.app_id = str(uuid4()), app.id
        app.workflow_id = workflow.id
        session.add_all((app, workflow))
        parent_app_id, parent_workflow_id = app.id, workflow.id
    try:
        _, parent_ref = _child_case(c, app_id=parent_app_id, workflow_id=parent_workflow_id)
        parent = c.store.load_context(ref=parent_ref)
        assert parent.app_id != c.context.app_id
        inputs = {"nested": True}
        key = OperationKey(invocation_id=parent_ref.invocation_id, occurrence_path=("existing-C",), cursor=0)
        input_ref = c.store.store_result(ref=parent_ref, key=key, result=inputs)

        def resolve_child(*, parent, ref, child_app_id, child_workflow_revision, inputs):
            return parent.model_copy(
                update={
                    "ref": ref,
                    "parent_invocation_id": parent.ref.invocation_id,
                    "call_depth": parent.call_depth + 1,
                    "app_id": child_app_id,
                    "workflow_id": c.context.workflow_id,
                    "graph": c.context.graph,
                    "graph_revision": child_workflow_revision,
                    "inputs": inputs,
                    "input_revision": canonical_digest(inputs),
                    "native_run_id": "existing-" + ref.invocation_id,
                }
            )

        service = NativeChildInvocationService(c.store, resolver=SimpleNamespace(resolve_child=resolve_child))
        args = {
            "parent_ref": parent_ref,
            "key": key,
            "child_app_id": c.context.app_id,
            "child_workflow_revision": c.context.graph_revision,
            "input_digest": canonical_digest(inputs),
            "input_result_ref": input_ref,
        }
        child_ref = service.get_or_create(**args)
        if child_status != "running":
            service.complete(
                child_ref=child_ref,
                outcome=NativeWorkflowOutcome(
                    status=child_status,
                    ref=child_ref,
                    native_run_id=c.store.load_context(ref=child_ref).native_run_id,
                    checkpoint_ref=None,
                    pending_operation_ids=(),
                    wait_reason=None,
                    reason_code=None,
                    native_status="succeeded" if child_status == "completed" else "stopped",
                    output_result_ref=None,
                ),
            )
        service.resolver = SimpleNamespace(resolve_child=lambda **_kw: pytest.fail("existing C must not resolve again"))
        before = _count(c, NativeInvocationState)
        if fault == "permission":
            monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)

            def check(tenant_id, actor_id, *, scene, resource_type, resource_id):
                assert (tenant_id, actor_id) == (c.ledger.actor.tenant_id, c.ledger.actor.account_id)
                assert scene is not None
                assert resource_type is not None
                return resource_id == c.context.app_id

            monkeypatch.setattr(RBACService.CheckAccess, "check", check)
        elif fault == "revision":
            with c.factory.begin() as session:
                workflow = session.get(Workflow, parent_workflow_id)
                graph = json.loads(workflow.graph)
                graph["nodes"] = [*graph.get("nodes", []), {"id": "changed-node", "data": {"type": "start"}}]
                workflow.graph = json.dumps(graph)
        elif fault == "input":
            with c.factory() as session:
                storage_key = session.get(NativePayloadObject, input_ref).storage_key
            original_load = storage.load
            monkeypatch.setattr(
                storage,
                "load",
                lambda key, *a, **kw: b"corrupt ciphertext" if key == storage_key else original_load(key, *a, **kw),
            )
        # Prove the request-root-only loader still admits B; local private authority must reject.
        assert service.loader.load(ref=parent_ref).app_id == c.context.app_id
        if fault is None:
            assert service.get_or_create(**args) == child_ref
        else:
            reason = {
                "permission": "execution_permission_denied",
                "revision": "native_revision_drift",
                "input": "native_payload_unavailable",
            }[fault]
            with pytest.raises(BuilderExecutionPolicyError, match=reason):
                service.get_or_create(**args)
        assert _count(c, NativeInvocationState) == before
        assert _state(c, parent_ref).state == "running"
        assert _state(c, child_ref).state == child_status
    finally:
        with c.factory.begin() as session:
            session.delete(session.get(Workflow, parent_workflow_id))
            session.delete(session.get(App, parent_app_id))
