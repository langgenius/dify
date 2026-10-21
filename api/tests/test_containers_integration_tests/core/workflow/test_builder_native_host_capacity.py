"""Normal CI only: real SQL/C03 capacity, not concrete physical-host qualification.

Verifier doubles stand for the separately owned retained-lifetime proof port.
No local import/collection/run, provider I/O, sleep or fake checkpoint authority.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from models.account import TenantAccountRole, TenantStatus
from runtime_contracts.builder.native.contracts import ResumeReceipt

if TYPE_CHECKING:
    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef


from typing import TYPE_CHECKING, NotRequired, Unpack

from typing_extensions import TypedDict

if TYPE_CHECKING:
    import services.dify_builder.native_testing.repository as _forward_types_0


from typing import TYPE_CHECKING

from sqlalchemy.orm.state import InstanceState

from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from core.dify_builder.models import Actor
    from runtime_contracts.builder.native.contracts import (
        NativeTestContextRef,
    )
    from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
        CapacityOwnerCase,
    )
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import ContinuationCase

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_continuation as _fixture_types_0,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_continuation as _fixture_types_0,
    )


from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
import pytest_mock
from sqlalchemy import inspect, select
from sqlalchemy import inspect as inspect_orm

from core.dify_builder.models import Actor
from models.account import Account, Tenant, TenantAccountJoin
from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeInvocationState,
    NativePendingAction,
)
from models.model import App
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.native_testing.host_capacity import NativeHostCapacity
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.pending_actions import NativePendingActionService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    CapacityOwnerCase,
    require_present,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import ContinuationCase
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
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import no_live as no_live  # noqa: PLC0414
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import raw_ledger_case


@pytest.fixture
def capacity_case(
    continuation_case: _fixture_types_0.ContinuationCase, migrated_dispatch_claims: None
) -> ContinuationCase:
    assert migrated_dispatch_claims is None
    return continuation_case


def _peer(
    c: ContinuationCase | CapacityOwnerCase,
    *,
    another_app: bool = False,
    another_actor: bool = False,
    another_tenant: bool = False,
) -> CapacityOwnerCase:
    """A second real Builder session/request in the existing tenant; actual C03."""
    factory = c.factory
    actor = c.ledger.actor
    with factory.begin() as session:
        app = session.get(App, c.context.app_id)
        workflow = session.get(Workflow, c.context.workflow_id)
        if another_actor:
            account = Account(name="Capacity peer", email=str(uuid4()) + "@example.invalid")
            session.add(account)
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=actor.tenant_id, account_id=account.id, role=TenantAccountRole.OWNER, current=False
                )
            )
            actor = Actor(tenant_id=actor.tenant_id, account_id=account.id)
        if another_tenant:
            tenant = Tenant(name="Capacity peer tenant", status=TenantStatus.NORMAL)
            session.add(tenant)
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id, account_id=actor.account_id, role=TenantAccountRole.OWNER, current=False
                )
            )
            actor = Actor(tenant_id=tenant.id, account_id=actor.account_id)
        if another_app or another_tenant:
            app = App(
                **{
                    a.key: require_instance(inspect_orm(app), InstanceState).attrs[a.key].value
                    for a in inspect(App).column_attrs
                    if a.key != "id"
                }
            )
            app.id, app.tenant_id = str(uuid4()), actor.tenant_id
            workflow = Workflow(
                **{
                    a.key: require_instance(inspect_orm(workflow), InstanceState).attrs[a.key].value
                    for a in inspect(Workflow).column_attrs
                    if a.key != "id"
                }
            )
            workflow.id, workflow.app_id, workflow.tenant_id = str(uuid4()), app.id, actor.tenant_id
            app.workflow_id = workflow.id
            session.add_all((app, workflow))
        builder = DifyBuilderSession(
            app_id=require_present(app).id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode="build",
            current_state="build.await_testdata",
        )
        session.add(builder)
        session.flush()
        inputs = DifyBuilderTestInput(
            session_id=builder.id, source="user", inputs=dict(c.context.inputs), start_schema_hash=""
        )
        session.add(inputs)
        session.flush()
        sid, tid = builder.id, inputs.id
        session.expunge(app)
        session.expunge(workflow)
    if another_tenant:
        from libs.key_providers import generate_key_pair

        public_key = generate_key_pair(actor.tenant_id)
        with factory.begin() as session:
            require_instance(session.get(Tenant, actor.tenant_id), Tenant).encrypt_public_key = public_key
    assert app is not None
    assert workflow is not None
    ledger = raw_ledger_case((factory, actor, app, workflow, sid, tid), None)
    loader = OwnedNativeTestLoader(factory, actor=actor, resolver=ledger.metadata)
    store = NativeExecutionStateStore(loader)
    run = "native-" + ledger.ref.request_id
    context = c.context.model_copy(
        update={
            "ref": ledger.ref,
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "app_id": require_present(app).id,
            "workflow_id": require_present(workflow).id,
            "native_run_id": run,
            "root_native_run_id": run,
            "budget_ref": ledger.ref.request_id,
            "cancellation_ref": ledger.ref.request_id,
        }
    )
    store.initialize_context(context=context)
    assert store.load_context(ref=ledger.ref) == context
    return CapacityOwnerCase(
        factory=factory,
        ledger=ledger,
        ref=ledger.ref,
        store=store,
        context=context,
        resolution=c.resolution,
        lifecycle=NativeTestLifecycleService(loader, state_store=store, resolution=c.resolution),
    )


class LifetimeVerifier:
    """Synthetic exact-lifetime SQL collaborator; never a host shutdown witness."""

    def __init__(
        self,
        ref: NativeTestContextRef,
        dispatch: NativeDispatchRef | ResumeReceipt,
        registry: dict[str, object],
        token: object,
    ) -> None:
        self.expected = (ref, dispatch.generation, dispatch.dispatch_id)
        self.registry, self.token = registry, token
        self.closed, self.used = False, False

    def consume_cleanup(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> None:
        if (
            (ref, generation, dispatch_id) != self.expected
            or self.registry.get(ref.request_id) is not self.token
            or not self.closed
            or self.used
        ):
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        self.used = True


def _owner(
    c: ContinuationCase | CapacityOwnerCase,
    dispatch: NativeDispatchRef | ResumeReceipt,
    registry: dict[str, object] | None = None,
) -> tuple[NativeHostCapacity, LifetimeVerifier, dict[str, object]]:
    registry = {} if registry is None else registry
    token = object()
    registry[c.ref.request_id] = token
    verifier = LifetimeVerifier(c.ref, dispatch, registry, token)
    lifecycle = NativeTestLifecycleService(c.store.loader, state_store=c.store, resolution=c.resolution)
    owner = NativeHostCapacity(lifecycle, cleanup_verifier=verifier)
    return owner, verifier, registry


def _state(c: CapacityOwnerCase | ContinuationCase) -> NativeInvocationState | None:
    with c.factory() as session:
        return session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == c.ref.request_id,
                NativeInvocationState.invocation_id == c.ref.invocation_id,
            )
        )


def test_real_initial_outbox_retries_and_single_claim_have_no_fake_continuation(
    capacity_case: ContinuationCase,
) -> None:
    c = capacity_case
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    assert c.lifecycle.enqueue_initial_dispatch(ref=c.ref) == dispatch
    owner, _, _ = _owner(c, dispatch)
    assert owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    assert not owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    with c.factory() as session:
        assert (
            session.scalar(select(NativeContinuation.id).where(NativeContinuation.request_id == c.ref.request_id))
            is None
        )
        row = session.get(NativeDispatch, dispatch.dispatch_id)
        assert (
            require_instance(row, NativeDispatch).generation,
            require_instance(row, NativeDispatch).state,
            require_instance(row, NativeDispatch).checkpoint_id,
        ) == (
            0,
            "claimed",
            None,
        )
    assert (require_present(_state(c)).state, require_present(_state(c)).cleanup_complete) == ("running", False)


def test_real_app_lock_allows_only_one_of_two_queued_requests_from_distinct_sessions_and_actors(
    capacity_case: ContinuationCase,
) -> None:
    first = capacity_case
    second = _peer(first, another_actor=True)
    a = first.lifecycle.enqueue_initial_dispatch(ref=first.ref)
    b = second.lifecycle.enqueue_initial_dispatch(ref=second.ref)
    left, _, _ = _owner(first, a)
    right, _, _ = _owner(second, b)
    barrier = Barrier(2)

    def claim(pair: tuple[NativeTestLifecycleService, CapacityOwnerCase, NativeDispatchRef]) -> bool | str:
        owner, c, dispatch = pair
        barrier.wait(timeout=10)
        try:
            return owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
        except BuilderExecutionPolicyError as error:
            return error.reason_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, [(left, first, a), (right, second, b)]))
    assert results.count(True) == 1
    assert results.count("native_capacity_busy") == 1
    with first.factory() as session:
        states = [require_instance(session.get(NativeDispatch, d.dispatch_id), NativeDispatch).state for d in (a, b)]
        assert sorted(states) == ["claimed", "queued"]


def test_real_native_capacity_is_not_global_across_apps(capacity_case: ContinuationCase) -> None:
    first = capacity_case
    second = _peer(first, another_app=True)
    for c in (first, second):
        dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
        owner, _, _ = _owner(c, dispatch)
        assert owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)


@pytest.mark.parametrize("status", ["claimed", "unknown", "completed", "cancelled"])
def test_real_acquired_unclean_root_retains_slot_even_after_expiry_or_terminal_projection(
    mocker: pytest_mock.MockerFixture, capacity_case: ContinuationCase, status: str
) -> None:
    c = capacity_case
    peer = _peer(c)
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    owner, verifier, _ = _owner(c, dispatch)
    assert owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    if status == "unknown":
        with c.factory.begin() as session:
            require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).claim_expires_at = (
                datetime.now(UTC) - timedelta(seconds=1)
            )
        owner.lifecycle.reconcile()
    elif status == "completed":
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
        with c.store.loader.locked(ref=c.ref, settlement=True) as (session, owned, scope):
            owner.lifecycle.finalize_dispatch_locked(
                session=session,
                owned=owned,
                scope=scope,
                dispatch_id=dispatch.dispatch_id,
                generation=0,
                outcome=outcome,
            )
    elif status == "cancelled":
        runtime = DifyNativeRuntimeOwner()
        mocker.patch.object(runtime, "cancel", return_value=(c.ref.invocation_id,))
        owner.lifecycle.runtime = runtime
        assert (
            owner.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel").status
            == "cancelling"
        )
    assert not require_present(_state(c)).cleanup_complete
    assert not verifier.used
    other = peer.lifecycle.enqueue_initial_dispatch(ref=peer.ref)
    contender, _, _ = _owner(peer, other)
    with pytest.raises(BuilderExecutionPolicyError, match="native_capacity_busy"):
        contender.claim_dispatch(ref=peer.ref, generation=0, dispatch_id=other.dispatch_id)


def test_real_exact_cleanup_releases_once_and_missing_physical_port_proof_does_not(
    capacity_case: ContinuationCase,
) -> None:
    c = capacity_case
    peer = _peer(c)
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    owner, verifier, _ = _owner(c, dispatch)
    assert owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    assert not require_present(_state(c)).cleanup_complete
    verifier.closed = True
    owner.record_cleanup(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    assert require_present(_state(c)).cleanup_complete
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    other = peer.lifecycle.enqueue_initial_dispatch(ref=peer.ref)
    contender, _, _ = _owner(peer, other)
    assert contender.claim_dispatch(ref=peer.ref, generation=0, dispatch_id=other.dispatch_id)


def test_real_resume_recovery_requires_cleanup_ack_and_new_exact_lifetime_for_same_sql_ids(
    mocker: pytest_mock.MockerFixture, capacity_case: ContinuationCase
) -> None:
    c = capacity_case
    c.pause()
    c.ledger.confirm()
    dispatch = c.resume()
    owner, verifier, registry = _owner(c, dispatch)
    assert owner.claim_dispatch(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    with c.factory.begin() as session:
        require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).claim_expires_at = (
            datetime.now(UTC) - timedelta(seconds=1)
        )
    owner.lifecycle.reconcile()
    calls: list[str] = []
    runtime = DifyNativeRuntimeOwner()
    mocker.patch.object(runtime, "recovery_evidence", side_effect=lambda **_: calls.append("proof") or "stopped")
    owner.lifecycle.runtime = runtime
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=dispatch.dispatch_id)
    assert calls == []
    with c.factory() as session:
        assert require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).state == "unknown"
    verifier.closed = True
    owner.record_cleanup(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    owner.lifecycle.recover_dispatch(ref=c.ref, dispatch_id=dispatch.dispatch_id)
    assert not owner.claim_dispatch(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    fresh, current, _ = _owner(c, dispatch, registry)
    assert fresh.claim_dispatch(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    assert not require_present(_state(c)).cleanup_complete
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    assert not current.used
    assert not require_present(_state(c)).cleanup_complete


def test_real_unrepresented_form_pending_prevents_initial_enqueue(capacity_case: ContinuationCase) -> None:
    c = capacity_case
    wait = NativePendingActionService(c.store.loader).interaction(
        ref=c.ref, native_form_ref="form-1", expected_generation=0
    )
    with c.factory() as session:
        assert (
            require_instance(
                session.get(NativePendingAction, wait.pending_operation_id), NativePendingAction
            ).generation
            == 0
        )
    with pytest.raises(BuilderExecutionPolicyError, match="native_initial_conflict"):
        c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    with c.factory() as session:
        assert session.scalar(select(NativeDispatch.id).where(NativeDispatch.request_id == c.ref.request_id)) is None


def test_real_initial_enqueue_lost_commit_ack_retry_keeps_one_actual_outbox(
    capacity_case: ContinuationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from contextlib import contextmanager

    c = capacity_case
    original = c.lifecycle.loader.locked

    @contextmanager
    def lost_ack(
        **kwargs: Unpack[_ForwardArguments439],
    ) -> _forward_types_0.Generator[
        tuple[_forward_types_0.Session, _forward_types_0.OwnedNativeTest, _forward_types_0.NativeTestScope]
    ]:
        with original(**kwargs) as value:
            yield value
        raise OSError("synthetic acknowledgement loss after actual SQL commit")

    monkeypatch.setattr(c.lifecycle.loader, "locked", lost_ack)
    with pytest.raises(OSError, match="acknowledgement loss"):
        c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    monkeypatch.setattr(c.lifecycle.loader, "locked", original)
    recovered = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    with c.factory() as session:
        rows = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)).all()
        assert len(rows) == 1
        assert rows[0].id == recovered.dispatch_id
        assert (rows[0].state, rows[0].generation, rows[0].checkpoint_id) == ("queued", 0, None)


@pytest.mark.parametrize("status", ["claimed", "unknown", "completed"])
def test_malformed_acquired_dispatch_tenant_cannot_disappear_through_owner_join(
    capacity_case: ContinuationCase, status: str
) -> None:
    c = capacity_case
    peer = _peer(c)
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    owner, _, _ = _owner(c, dispatch)
    assert owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    with c.factory.begin() as session:
        row = session.get(NativeDispatch, dispatch.dispatch_id)
        require_instance(row, NativeDispatch).tenant_id, require_instance(row, NativeDispatch).state = (
            str(uuid4()),
            status,
        )
    other = peer.lifecycle.enqueue_initial_dispatch(ref=peer.ref)
    contender, _, _ = _owner(peer, other)
    with pytest.raises(BuilderExecutionPolicyError, match="native_capacity_owner_mismatch"):
        contender.claim_dispatch(ref=peer.ref, generation=0, dispatch_id=other.dispatch_id)
    with c.factory() as session:
        assert require_instance(session.get(NativeDispatch, other.dispatch_id), NativeDispatch).state == "queued"
    assert not require_present(_state(c)).cleanup_complete


def test_valid_other_tenant_acquisition_is_not_borrowed_or_counted(capacity_case: ContinuationCase) -> None:
    c = capacity_case
    foreign = _peer(c, another_tenant=True)
    for current in (foreign, c):
        dispatch = current.lifecycle.enqueue_initial_dispatch(ref=current.ref)
        owner, _, _ = _owner(current, dispatch)
        assert owner.claim_dispatch(ref=current.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    assert not require_present(_state(c)).cleanup_complete
    assert not require_present(_state(foreign)).cleanup_complete


@pytest.mark.parametrize("status", ["queued", "published"])
def test_real_never_acquired_cancellation_seals_and_stays_complete_under_reconcile(
    capacity_case: ContinuationCase, status: str
) -> None:
    c = capacity_case
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    with c.factory.begin() as session:
        require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).state = status
    owner, verifier, _ = _owner(c, dispatch)
    assert not verifier.closed
    result = owner.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel")
    assert result.status == "cancelled"
    assert require_present(_state(c)).cleanup_complete
    assert not verifier.used
    assert (
        owner.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel").status
        == "cancelled"
    )
    assert owner.lifecycle.reconcile() == 0
    with c.factory() as session:
        from models.dify_builder import DifyBuilderExecutionRequest

        assert (
            require_instance(
                session.get(DifyBuilderExecutionRequest, c.ref.request_id), DifyBuilderExecutionRequest
            ).state
            == "sealed"
        )
        assert require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).state == "cancelled"


@pytest.mark.parametrize("status", ["claimed", "unknown", "completed"])
def test_real_acquired_cancellation_still_requires_exact_physical_verifier(
    capacity_case: ContinuationCase, status: str
) -> None:
    from models.dify_builder import DifyBuilderExecutionRequest

    c = capacity_case
    dispatch = c.lifecycle.enqueue_initial_dispatch(ref=c.ref)
    owner, verifier, _ = _owner(c, dispatch)
    assert owner.claim_dispatch(ref=c.ref, generation=0, dispatch_id=dispatch.dispatch_id)
    with c.factory.begin() as session:
        require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).state = status
    assert not verifier.closed
    expected_pending = {"claimed": "cancelling", "unknown": "unknown", "completed": "cancelling"}[status]
    assert (
        owner.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel").status
        == expected_pending
    )
    assert owner.lifecycle.reconcile() == 1
    assert not verifier.used
    assert not require_present(_state(c)).cleanup_complete
    with c.factory() as session:
        assert require_instance(session.get(NativeDispatch, dispatch.dispatch_id), NativeDispatch).state == status

    # The exact retained verifier port must still be consumed by the real SQL
    # cleanup owner. Its ACK does not finalize or erase an unresolved source.
    verifier.closed = True
    owner.record_cleanup(ref=c.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    assert verifier.used
    assert require_present(_state(c)).cleanup_complete is True
    expected_cleaned = {"claimed": "cancelling", "unknown": "unknown", "completed": "cancelled"}[status]
    for _ in range(2):
        receipt = owner.lifecycle.cancel(actor=c.ledger.actor, request_id=c.ref.request_id, idempotency_key="cancel")
        assert receipt.status == expected_cleaned
        assert receipt.operation_states == {}
        assert owner.lifecycle.reconcile() == 0
        assert verifier.used
        assert require_present(_state(c)).cleanup_complete is True
    with c.factory() as session:
        source = session.get(NativeDispatch, dispatch.dispatch_id)
        assert require_instance(source, NativeDispatch).state == status
        assert (
            require_instance(source, NativeDispatch).generation
            == require_present(_state(c)).generation
            == dispatch.generation
            == 0
        )
        assert (
            len(session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.ref.request_id)).all()) == 1
        )
        assert require_instance(
            session.get(DifyBuilderExecutionRequest, c.ref.request_id), DifyBuilderExecutionRequest
        ).state == ("sealed" if status == "completed" else "running")


class _ForwardArguments439(TypedDict, closed=True):
    ref: _forward_types_0.NativeTestContextRef
    settlement: NotRequired[bool]
