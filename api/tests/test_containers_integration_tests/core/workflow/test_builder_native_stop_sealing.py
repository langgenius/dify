"""Normal CI only: actual SQL stop fencing, not native physical qualification."""

from contextlib import contextmanager
from uuid import uuid4

import pytest
from sqlalchemy import select

from models.account import TenantAccountJoin
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeDispatch,
    NativeInvocationState,
    NativeTestInvocation,
    NativeTestScope,
)
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    capacity_case as capacity_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    continuation_case as continuation_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_host_capacity import (
    no_live as no_live,  # noqa: PLC0414
)


@pytest.fixture
def stop_case(capacity_case):
    c = capacity_case
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    assert c.lifecycle.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    # This is a genuine SQL claim fixture, not entitlement to launch a host.
    return c, dispatch


def seal(c, dispatch):
    return c.lifecycle.seal_stop(
        ref=c.ref,
        expected_generation=dispatch.generation,
        dispatch_id=dispatch.dispatch_id,
        reason_code="effect_denied",
    )


def state(c, session):
    return session.scalar(
        select(NativeInvocationState).where(
            NativeInvocationState.request_id == c.ref.request_id,
            NativeInvocationState.invocation_id == c.ref.invocation_id,
        )
    )


def test_real_stop_commit_seals_authority_but_retains_acquisition_and_cleanup(stop_case):
    c, dispatch = stop_case
    assert seal(c, dispatch) is None
    with c.factory() as session:
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "sealed"
        assert session.get(NativeDispatch, dispatch.dispatch_id).state == "claimed"
        current = state(c, session)
        assert current.state == "running"
        assert current.outcome is None
        assert not current.cleanup_complete
        assert not session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == c.ref.request_id,
                NativeTestInvocation.invocation_id == c.ref.invocation_id,
            )
        ).active
        assert not session.get(NativeTestScope, c.ref.request_id).cancelled
    with pytest.raises(BuilderExecutionPolicyError):
        seal(c, dispatch)
    assert c.ledger.dispatched_attempt_count() == 0


@pytest.mark.parametrize("dispatch_state", ["queued", "published", "claimed"])
def test_real_stop_rejects_orphan_dispatch_without_mutating_authority_or_outbox(stop_case, dispatch_state):
    c, dispatch = stop_case
    orphan_id = str(uuid4())
    with c.factory.begin() as session:
        # The actual dispatch schema has no invocation foreign key. A valid
        # request/tenant alone must not let this missing owner through sealing.
        session.add(
            NativeDispatch(
                id=orphan_id,
                tenant_id=c.ledger.actor.tenant_id,
                request_id=c.ref.request_id,
                invocation_id="missing-invocation",
                generation=0,
                idempotency_digest=uuid4().hex * 2,
                state=dispatch_state,
                checkpoint_id=None,
                claim_expires_at=session.get(NativeDispatch, dispatch.dispatch_id).claim_expires_at
                if dispatch_state == "claimed"
                else None,
            )
        )

    def snapshot():
        with c.factory() as session:
            return {
                model.__name__: [
                    dict(row)
                    for row in session.execute(
                        select(model.__table__)
                        .where(
                            model.id == c.ref.request_id
                            if model is DifyBuilderExecutionRequest
                            else model.request_id == c.ref.request_id
                        )
                        .order_by(model.request_id if model is NativeTestScope else model.id)
                    ).mappings()
                ]
                for model in (
                    DifyBuilderExecutionRequest,
                    NativeTestScope,
                    NativeInvocationState,
                    NativeTestInvocation,
                    NativeDispatch,
                )
            }

    before = snapshot()
    assert all(row["invocation_id"] != "missing-invocation" for row in before["NativeInvocationState"])
    assert all(row["invocation_id"] != "missing-invocation" for row in before["NativeTestInvocation"])
    assert next(row["state"] for row in before["NativeDispatch"] if row["id"] == orphan_id) == dispatch_state
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        seal(c, dispatch)
    assert snapshot() == before


@pytest.mark.parametrize("status", ["stopped", "unknown"])
def test_real_stopped_or_unknown_evidence_can_finalize_after_authority_seal(stop_case, status):
    c, dispatch = stop_case
    seal(c, dispatch)
    outcome = NativeWorkflowOutcome(
        status=status,
        ref=c.ref,
        native_run_id=c.context.native_run_id,
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code="effect_denied" if status == "stopped" else "outcome_unknown",
        wait_reason=None,
        native_status=None,
        output_result_ref=None,
    )
    with c.lifecycle.loader.locked(ref=c.ref, settlement=True) as (session, owned, scope):
        c.lifecycle.finalize_dispatch_locked(
            session=session, owned=owned, scope=scope, dispatch_id=dispatch.dispatch_id, generation=0, outcome=outcome
        )
    with c.factory() as session:
        assert state(c, session).state == status
        assert state(c, session).outcome["status"] == status
        assert not state(c, session).cleanup_complete
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "sealed"


def test_real_seal_rejects_late_success_without_changing_acquisition(stop_case):
    c, dispatch = stop_case
    seal(c, dispatch)
    outcome = NativeWorkflowOutcome(
        status="completed",
        ref=c.ref,
        native_run_id=c.context.native_run_id,
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="succeeded",
        output_result_ref=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_request_sealed"):
        with c.lifecycle.loader.locked(ref=c.ref, settlement=True) as (session, owned, scope):
            c.lifecycle.finalize_dispatch_locked(
                session=session,
                owned=owned,
                scope=scope,
                dispatch_id=dispatch.dispatch_id,
                generation=0,
                outcome=outcome,
            )
    with c.factory() as session:
        assert session.get(NativeDispatch, dispatch.dispatch_id).state == "claimed"
        assert state(c, session).outcome is None
        assert not state(c, session).cleanup_complete


def test_real_stop_can_close_authority_after_membership_revocation(stop_case):
    c, dispatch = stop_case
    with c.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == c.ledger.actor.tenant_id,
                TenantAccountJoin.account_id == c.ledger.actor.account_id,
            )
        )
        membership.role = "normal"
    with pytest.raises(BuilderExecutionPolicyError):
        c.lifecycle.loader.load(ref=c.ref)
    assert seal(c, dispatch) is None
    assert c.ledger.dispatched_attempt_count() == 0


def test_real_stop_lost_commit_ack_never_replays_as_acceptance(stop_case, monkeypatch):
    c, dispatch = stop_case
    actual_locked = c.lifecycle.loader.locked

    @contextmanager
    def lost_ack(**kwargs):
        with actual_locked(**kwargs) as owned:
            yield owned
        raise RuntimeError("synthetic stop commit acknowledgment loss")

    monkeypatch.setattr(c.lifecycle.loader, "locked", lost_ack)
    with pytest.raises(RuntimeError, match="synthetic stop commit acknowledgment loss"):
        seal(c, dispatch)
    monkeypatch.setattr(c.lifecycle.loader, "locked", actual_locked)
    with c.factory() as session:
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "sealed"
        assert session.get(NativeDispatch, dispatch.dispatch_id).state == "claimed"
        assert not state(c, session).cleanup_complete
    with pytest.raises(BuilderExecutionPolicyError):
        seal(c, dispatch)
