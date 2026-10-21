"""Real SQLite transition witnesses; PostgreSQL timeout transport is the boundary."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from time import monotonic
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder_native_code import NativeCodePhysicalOperation
from models.dify_builder_native_tests import (
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeInvocationState,
    NativeTestScope,
)
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.repository import OwnedNativeTest
from services.dify_builder.native_testing.sandbox.contracts import (
    CodeAcquisitionRef,
    CodePhysicalRef,
)
from services.dify_builder.native_testing.sandbox.repository import NativeCodePhysicalRepository


def fixed_transaction_deadline():
    """Synthetic fixed budget; does not attest a retained host acquisition."""
    deadline = monotonic() + 60
    return lambda _settlement: deadline


def uid():
    return str(uuid4())


def physical():
    ref = NativeTestContextRef(request_id=uid(), invocation_id="root", context_digest="a" * 64)
    acquisition = CodeAcquisitionRef(ref=ref, root_dispatch_id=uid(), generation=0, acquisition_id=uid())
    return CodePhysicalRef(
        id=uid(),
        ref=ref,
        acquisition=acquisition,
        tenant_id=uid(),
        actor_id=uid(),
        operation_id=uid(),
        attempt_id=uid(),
        effect_claim_id=uid(),
        invocation_generation=0,
        native_execution_id=uid(),
        operation_digest="b" * 64,
        intent_digest="c" * 64,
        scope_id="code_" + uuid4().hex,
        scope_generation=1,
        scope_spec_digest="d" * 64,
        environment_digest="e" * 64,
        payload_digest="f" * 64,
        profile_digest="0" * 64,
        base_snapshot_ref="empty",
        base_snapshot_digest="1" * 64,
        scope_expires_at=datetime.now(UTC) + timedelta(minutes=1),
        scope_create_acked=False,
        job_reserved=False,
        job_id=None,
        input_may_have_been_sent=False,
        observed_output_offset=0,
        ambiguous=False,
        destroyed_at=None,
    )


@dataclass
class TransitionCase:
    repo: NativeCodePhysicalRepository
    physical: CodePhysicalRef
    row: NativeCodePhysicalOperation
    current: Current
    committed: list[dict[str, object]]
    calls: list[dict[str, object]]


@dataclass
class PhysicalOwnerCase:
    repo: NativeCodePhysicalRepository
    args: dict[str, object]
    stored: list[NativeCodePhysicalOperation]
    rows: dict[type, object]
    operation: NativeEffectOperation
    attempt: NativeEffectAttempt
    claim: NativeEffectDispatchClaim
    root: NativeDispatch
    state: NativeInvocationState
    current: Current
    events: list[str]
    session: Session
    owned: OwnedNativeTest
    scope: NativeTestScope


def _loader(factory=None):
    return NativeTestApiService(
        session_factory=factory or sessionmaker(),
        actor=Actor(account_id="actor", tenant_id="tenant"),
        resolver=None,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    ).loader


def _scope(p, *, expires_at=None):
    return NativeTestScope(
        tenant_id=p.tenant_id,
        request_id=p.ref.request_id,
        generation=0,
        task_approved=True,
        cancelled=False,
        expires_at=expires_at or datetime.now(UTC) + timedelta(minutes=1),
        budget_limits={},
        budget_spent={},
        profile={},
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
    )


def _owned(p):
    return OwnedNativeTest(
        ref=p.ref,
        tenant_id=p.tenant_id,
        actor_id=p.actor_id,
        app_id=uid(),
        workflow_id=uid(),
        session_id=uid(),
        test_input_id=uid(),
        bindings={},
        generation=0,
        task_approved=True,
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
        state="running",
    )


def _row_snapshot(row):
    return {column.key: inspect(row).attrs[column.key].value for column in inspect(type(row)).column_attrs}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("invocation_generation", True),
        ("scope_generation", True),
        ("observed_output_offset", True),
        ("observed_output_offset", 2**63),
        ("observed_output_offset", -1),
        ("native_execution_id", "node"),
        ("scope_id", "agent_existing"),
        ("payload_digest", "z" * 64),
    ],
)
def test_reference_rejects_invalid_authority_shape(field, value):
    values = physical().model_dump(mode="python")
    values[field] = value
    with pytest.raises(ValidationError):
        CodePhysicalRef.model_validate(values)


class Current:
    def __init__(self):
        self.calls = 0
        self.fail_at = None

    def check_current(self, acquisition):
        del acquisition
        self.calls += 1
        if self.calls == self.fail_at:
            raise BuilderExecutionPolicyError("stale_acquisition")


def _timeout_loader(mocker, p, *, events, execute, expires_at, record_begin=False):
    """Real PostgreSQL dialect and Session transaction; timeout transport is the seam."""

    class TimeoutSession(Session):
        pass

    engine = create_engine("postgresql+psycopg2://unused@127.0.0.1:1/unused")
    factory = sessionmaker(bind=engine, class_=TimeoutSession)
    if record_begin:
        event.listen(TimeoutSession, "after_transaction_create", lambda *_: events.append("begin"))
    event.listen(TimeoutSession, "after_commit", lambda *_: events.append("commit"))
    mocker.patch.object(TimeoutSession, "execute", side_effect=execute)
    loader = _loader(factory)
    mocker.patch.object(loader, "load", return_value=None)
    mocker.patch.object(loader, "_load", return_value=(_owned(p), _scope(p, expires_at=expires_at)))
    return loader


@pytest.fixture
def transition(monkeypatch, sqlite_session):
    from services.dify_builder.native_testing.sandbox.repository import (
        NativeCodePhysicalRepository,
    )

    p = physical()
    row = NativeCodePhysicalOperation(
        **p.model_dump(exclude={"ref", "acquisition", "id"}),
        request_id=p.ref.request_id,
        invocation_id=p.ref.invocation_id,
        host_dispatch_id=p.acquisition.root_dispatch_id,
        host_acquisition_id=p.acquisition.acquisition_id,
        root_invocation_id=p.ref.invocation_id,
        host_generation=p.acquisition.generation,
    )
    row.id = p.id
    sqlite_session.add(row)
    sqlite_session.commit()
    current = Current()
    loader = _loader()
    repo = NativeCodePhysicalRepository(
        loader,
        acquisition_owner=current,
        transaction_deadline=fixed_transaction_deadline(),
    )
    committed = []
    calls = []

    @contextmanager
    def transaction(**kwargs):
        calls.append(kwargs)
        if sqlite_session.in_transaction() or sqlite_session.dirty:
            sqlite_session.commit()
        try:
            with sqlite_session.begin():
                yield sqlite_session, None, None
        except BaseException:
            sqlite_session.refresh(row)
            sqlite_session.commit()
            raise
        else:
            committed.append(_row_snapshot(row))

    monkeypatch.setattr(repo, "_transaction", transaction)
    monkeypatch.setattr(repo, "_physical_row", lambda **_kwargs: row)
    return TransitionCase(
        repo=repo,
        physical=p,
        row=row,
        current=current,
        committed=committed,
        calls=calls,
    )


def test_scope_ack_is_exact_and_cannot_be_reused(transition):
    t = transition
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.ack_scope(physical=t.physical, scope_id="code_" + uuid4().hex, generation=1)
    assert not t.row.scope_create_acked
    t.repo.ack_scope(physical=t.physical, scope_id=t.physical.scope_id, generation=1)
    assert t.committed[-1]["scope_create_acked"]
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.ack_scope(physical=t.physical, scope_id=t.physical.scope_id, generation=1)


def test_offset_compare_and_swap_never_regresses_or_changes_job(transition):
    t = transition
    t.row.job_id = "job1"
    t.row.job_reserved = True
    t.row.scope_create_acked = True
    t.repo.observe_output(physical=t.physical, job_id="job1", expected_offset=0, next_offset=9)
    assert t.row.observed_output_offset == 9
    for job, start, end in [
        ("job1", 0, 10),
        ("job1", 9, 8),
        ("job2", 9, 10),
        ("job1", 9, True),
    ]:
        with pytest.raises((BuilderExecutionPolicyError, ValueError)):
            t.repo.observe_output(physical=t.physical, job_id=job, expected_offset=start, next_offset=end)
    assert t.row.observed_output_offset == 9


def test_unknown_and_exact_destruction_are_settlement_after_cancel(transition):
    t = transition
    t.repo.mark_unknown(physical=t.physical)
    t.repo.ack_destroyed(physical=t.physical)
    assert t.row.ambiguous
    assert t.row.destroyed_at is not None
    assert all(call["settlement"] for call in t.calls)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.ack_scope(physical=t.physical, scope_id=t.physical.scope_id, generation=1)


def test_job_reservation_is_single_use_and_input_fence_precedes_return(transition):
    t = transition
    t.row.scope_create_acked = True
    t.repo.reserve_dispatch(
        physical=t.physical,
        intent=None,
        permit=None,
        payload_digest=t.physical.payload_digest,
        profile_digest=t.physical.profile_digest,
    )
    assert t.committed[-1]["job_reserved"]
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_dispatch(
            physical=t.physical,
            intent=None,
            permit=None,
            payload_digest=t.physical.payload_digest,
            profile_digest=t.physical.profile_digest,
        )
    t.repo.associate_job(physical=t.physical, intent=None, permit=None, job_id="job1")
    assert t.committed[-1]["job_id"] == "job1"
    assert t.committed[-1]["input_may_have_been_sent"]
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.associate_job(physical=t.physical, intent=None, permit=None, job_id="job1")


def test_lost_commit_response_never_makes_a_second_job_reservation(transition, monkeypatch):
    t = transition
    t.row.scope_create_acked = True
    original = t.repo._transaction

    @contextmanager
    def lost(**kwargs):
        with original(**kwargs) as values:
            yield values
        raise ConnectionError("commit response lost")

    monkeypatch.setattr(t.repo, "_transaction", lost)
    with pytest.raises(ConnectionError):
        t.repo.reserve_dispatch(
            physical=t.physical,
            intent=None,
            permit=None,
            payload_digest=t.physical.payload_digest,
            profile_digest=t.physical.profile_digest,
        )
    monkeypatch.setattr(t.repo, "_transaction", original)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_dispatch(
            physical=t.physical,
            intent=None,
            permit=None,
            payload_digest=t.physical.payload_digest,
            profile_digest=t.physical.profile_digest,
        )
    assert len(t.committed) == 1


@pytest.fixture
def owner_case(monkeypatch, sqlite_session):
    from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec

    from models.dify_builder_native_code import NativeCodePhysicalOperation
    from models.dify_builder_native_tests import (
        NativeDispatch,
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativeInvocationState,
    )
    from runtime_contracts.builder.native.contracts import (
        DispatchPermit,
        EffectIntent,
        OperationKey,
        operation_digest,
    )
    from services.dify_builder.native_testing.sandbox.contracts import CodeScopeSpec
    from services.dify_builder.native_testing.sandbox.repository import (
        NativeCodePhysicalRepository,
    )

    p = physical()
    now = datetime.now(UTC)
    key = OperationKey(
        invocation_id=p.ref.invocation_id,
        occurrence_path=(p.native_execution_id,),
        cursor=0,
    )
    spec = CodeScopeSpec(
        native=NativeScopeSpec(
            scope_id=p.scope_id,
            generation=1,
            binding_ref="code_binding",
            base_snapshot_ref="empty",
            capability_digest="a" * 64,
            deadline=now + timedelta(seconds=20),
            limits=NativeScopeLimits(
                cpu_quota=1000,
                memory_bytes=64 << 20,
                pids=8,
                fds=32,
                wall_seconds=20,
                input_bytes=1,
                output_bytes=4096,
                disk_bytes=1 << 20,
            ),
        ),
        environment_digest="e" * 64,
        base_snapshot_digest="1" * 64,
    )
    target = {
        "code_physical": {
            "scope_spec_digest": canonical_digest(spec.native.model_dump(mode="json")),
            "environment_digest": spec.environment_digest,
            "base_snapshot_ref": "empty",
            "base_snapshot_digest": "1" * 64,
            "payload_digest": p.payload_digest,
            "profile_digest": p.profile_digest,
        }
    }
    intent = EffectIntent(
        key=key,
        kind="code",
        resource_ref="code",
        implementation_revision="1",
        account_ref=None,
        target=target,
        parameters={},
        input_digest="b" * 64,
        capability_digest="a" * 64,
    )
    permit = DispatchPermit(
        permit_id="permit",
        operation_id=p.operation_id,
        attempt_id=p.attempt_id,
        expires_at=(now + timedelta(seconds=30)).isoformat(),
    )
    owner = {
        "tenant_id": p.tenant_id,
        "request_id": p.ref.request_id,
        "invocation_id": p.ref.invocation_id,
    }
    operation = NativeEffectOperation(
        **owner,
        id=p.operation_id,
        operation_digest=operation_digest(key),
        intent_digest=canonical_digest(intent.model_dump(mode="json")),
        state="claimed",
        scope_digest="a" * 64,
    )
    attempt = NativeEffectAttempt(
        **owner,
        id=p.attempt_id,
        operation_id=p.operation_id,
        execution_id=p.native_execution_id,
        expires_at=now + timedelta(seconds=30),
        grant_id=uid(),
        dispatch_index=1,
        permit_digest="a" * 64,
        cost_units=1,
        budget_reservation_ref="budget",
        invocation_digest="b" * 64,
        budget={},
        profile={},
    )
    claim = NativeEffectDispatchClaim(
        **owner,
        id=p.effect_claim_id,
        operation_id=p.operation_id,
        attempt_id=p.attempt_id,
        claimed_at=now,
    )
    root = NativeDispatch(
        **owner,
        id=p.acquisition.root_dispatch_id,
        generation=0,
        state="claimed",
        claim_expires_at=now + timedelta(seconds=30),
        idempotency_digest="c" * 64,
    )
    state = NativeInvocationState(
        **owner,
        generation=0,
        parent_invocation_id=None,
        cleanup_complete=False,
        context_object_id="context",
        state="running",
        pending_ids=[],
        resolution=[],
    )
    rows = {
        NativeEffectOperation: operation,
        NativeEffectAttempt: attempt,
        NativeEffectDispatchClaim: claim,
        NativeDispatch: root,
        NativeInvocationState: state,
    }
    stored = []
    events = []

    session = sqlite_session
    session.add_all([operation, attempt, claim, root, state])
    session.commit()
    from sqlalchemy import event

    def added(_session, instance):
        if isinstance(instance, NativeCodePhysicalOperation):
            stored.append(instance)

    event.listen(session, "after_attach", added)
    event.listen(session, "before_flush", lambda *_args: events.append("flush"))
    current = Current()
    repo = NativeCodePhysicalRepository(
        _loader(),
        acquisition_owner=current,
        transaction_deadline=fixed_transaction_deadline(),
    )
    owned = _owned(p)
    scope = _scope(p)

    @contextmanager
    def transaction(**kwargs):
        current.check_current(kwargs["acquisition"])
        if session.in_transaction() or session.dirty:
            session.commit()
        with session.begin():
            yield session, owned, scope
            current.check_current(kwargs["acquisition"])
        events.append("commit")
        current.check_current(kwargs["acquisition"])

    monkeypatch.setattr(repo, "_transaction", transaction)

    def validator(**kwargs):
        assert kwargs["intent"] == intent
        assert kwargs["permit"] == permit
        events.append("validated")
        return attempt

    monkeypatch.setattr(repo.authorization, "_validate_dispatch_locked", validator)

    def forbidden(*args, **kwargs):
        del args, kwargs
        raise AssertionError("independent permit transaction forbidden")

    monkeypatch.setattr(repo.authorization, "_permit_ref", forbidden)
    args = {
        "ref": p.ref,
        "key": key,
        "permit": permit,
        "acquisition": p.acquisition,
        "spec": spec,
        "intent": intent,
        "payload_digest": p.payload_digest,
        "profile_digest": p.profile_digest,
        "physical_deadline": now + timedelta(seconds=15),
    }
    return PhysicalOwnerCase(
        repo=repo,
        args=args,
        stored=stored,
        rows=rows,
        operation=operation,
        attempt=attempt,
        claim=claim,
        root=root,
        state=state,
        current=current,
        events=events,
        session=session,
        owned=owned,
        scope=scope,
    )


def test_scope_reservation_rechecks_real_intent_without_nested_permit_transaction(
    owner_case,
):
    t = owner_case
    p = t.repo.reserve_scope(**t.args)
    assert len(t.stored) == 1
    assert t.events == ["validated", "flush", "commit"]
    assert p.effect_claim_id == t.claim.id
    assert t.current.calls == 3
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert len(t.stored) == 1
    t.repo.ack_scope(physical=p, scope_id=p.scope_id, generation=1)
    assert t.stored[0].scope_create_acked


@pytest.mark.parametrize(
    ("row", "field"),
    [
        ("operation", "tenant_id"),
        ("attempt", "operation_id"),
        ("claim", "attempt_id"),
        ("claim", "invocation_id"),
        ("root", "invocation_id"),
        ("state", "parent_invocation_id"),
    ],
)
def test_disconnected_owner_chain_cannot_reserve_scope(owner_case, row, field):
    t = owner_case
    setattr(
        {"operation": t.operation, "attempt": t.attempt, "claim": t.claim, "root": t.root, "state": t.state}[row],
        field,
        uid(),
    )
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert t.stored == []


def test_stale_acquisition_and_changed_spec_refuse_before_scope_insert(owner_case):
    t = owner_case
    t.current.fail_at = 1
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert t.stored == []
    t.current.fail_at = None
    t.args["profile_digest"] = "9" * 64
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert t.stored == []


def test_acquisition_loss_after_commit_never_returns_io_permission(owner_case):
    t = owner_case
    t.current.fail_at = 3
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert len(t.stored) == 1
    t.current.fail_at = None
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert len(t.stored) == 1


def test_aborted_scope_reservation_cannot_retry_same_delivery(owner_case, monkeypatch):
    t = owner_case
    original = t.repo._transaction

    @contextmanager
    def rollback(**kwargs):
        with original(**kwargs) as values:
            yield values
            t.stored.clear()
            raise ConnectionError("rollback")

    monkeypatch.setattr(t.repo, "_transaction", rollback)
    with pytest.raises(ConnectionError):
        t.repo.reserve_scope(**t.args)
    monkeypatch.setattr(t.repo, "_transaction", original)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert t.stored == []


def test_initial_lock_timeout_precedes_ownership_read_and_current_fences_commit(mocker):
    from services.dify_builder.native_testing.sandbox.repository import NativeCodePhysicalRepository

    p = physical()
    events = []

    class Owner:
        def check_current(self, acquisition):
            assert acquisition == p.acquisition
            events.append("current")

    def timeout(statement, params):
        assert "set_config" in str(statement)
        assert 0 < int(params["limit"][:-2]) <= 1000
        events.append("timeout")

    loader = _timeout_loader(
        mocker,
        p,
        events=events,
        execute=timeout,
        expires_at=datetime.now(UTC) + timedelta(seconds=30),
        record_begin=True,
    )

    def load(session, **kwargs):
        assert isinstance(session, Session)
        assert events[-1] == "timeout"
        assert kwargs["lock"] is True
        events.append("load")
        return _owned(p), _scope(p)

    loader._load.side_effect = load
    repo = NativeCodePhysicalRepository(
        loader, acquisition_owner=Owner(), transaction_deadline=fixed_transaction_deadline()
    )
    with repo._transaction(ref=p.ref, acquisition=p.acquisition, settlement=True):
        events.append("mutation")
    assert events == ["current", "begin", "timeout", "load", "mutation", "current", "commit", "current"]


def test_admission_expiring_during_writer_rolls_back_before_commit(mocker, monkeypatch):
    from services.dify_builder.native_testing.sandbox import repository as module

    p = physical()
    events = []
    deadline = datetime.now(UTC) + timedelta(seconds=1)

    loader = _timeout_loader(mocker, p, events=events, execute=lambda *_args, **_kwargs: None, expires_at=deadline)
    repo = module.NativeCodePhysicalRepository(
        loader,
        acquisition_owner=Current(),
        transaction_deadline=fixed_transaction_deadline(),
    )
    with (
        pytest.raises(BuilderExecutionPolicyError),
        repo._transaction(ref=p.ref, acquisition=p.acquisition, settlement=False, deadline=deadline),
    ):
        monkeypatch.setattr(module, "utc_now", lambda: deadline + timedelta(seconds=1))
    assert events == []


@pytest.mark.parametrize("settlement", [False, True])
def test_transaction_uses_exact_operation_budget_and_refuses_expiry_before_commit(mocker, monkeypatch, settlement):
    from services.dify_builder.native_testing.sandbox import repository as module

    p = physical()
    events, limits = [], []
    clock = [10.0]
    monkeypatch.setattr(module, "monotonic", lambda: clock[0], raising=False)

    def timeout(_statement, params):
        limits.append(int(params["limit"][:-2]))

    loader = _timeout_loader(
        mocker, p, events=events, execute=timeout, expires_at=datetime.now(UTC) + timedelta(seconds=30)
    )

    def transaction_deadline(is_settlement):
        assert is_settlement is settlement
        return 10.05 if is_settlement else 10.03

    repo = module.NativeCodePhysicalRepository(
        loader, acquisition_owner=Current(), transaction_deadline=transaction_deadline
    )

    def expire_during_transaction():
        with repo._transaction(
            ref=p.ref,
            acquisition=p.acquisition,
            settlement=settlement,
            deadline=datetime.now(UTC) + timedelta(seconds=30),
        ):
            assert limits
            assert all(0 < limit <= (50 if settlement else 30) for limit in limits)
            clock[0] = 11.0

    with pytest.raises(BuilderExecutionPolicyError):
        expire_during_transaction()
    assert events == []


@pytest.mark.parametrize("deadline", [float("nan"), float("inf"), True, None, "later", -1.0])
def test_invalid_or_expired_transaction_deadline_never_opens_writer(mocker, deadline):
    from services.dify_builder.native_testing.sandbox.repository import (
        NativeCodePhysicalRepository,
    )

    p = physical()

    factory = sessionmaker()
    begin = mocker.patch.object(factory, "begin", side_effect=AssertionError("invalid budget opened SQL writer"))
    loader = _loader(factory)
    repo = NativeCodePhysicalRepository(loader, acquisition_owner=Current(), transaction_deadline=lambda _: deadline)
    with (
        pytest.raises(BuilderExecutionPolicyError),
        repo._transaction(ref=p.ref, acquisition=p.acquisition, settlement=True),
    ):
        pytest.fail("invalid budget admitted mutation")
    begin.assert_not_called()


@pytest.mark.parametrize("cap", ["candidate", "logical", "attempt", "scope", "root"])
def test_admission_persists_once_bounded_wire_spec_separate_from_logical_intent(owner_case, cap):
    from runtime_contracts.builder.execution import canonical_digest

    t = owner_case
    deadline = datetime.now(UTC) + timedelta(seconds=10)
    if cap == "candidate":
        t.args["physical_deadline"] = deadline
    elif cap == "logical":
        # Existing logical deadline is the 20s ceiling; candidate remains bounded.
        deadline = t.args["spec"].native.deadline
        t.args["physical_deadline"] = deadline + timedelta(seconds=1)
    else:
        if cap == "root":
            t.root.claim_expires_at = deadline
        else:
            {"scope": t.scope, "attempt": t.attempt}[cap].expires_at = deadline
    original_intent = t.args["intent"].model_dump(mode="json")
    physical = t.repo.reserve_scope(**t.args)
    assert physical.scope_expires_at == deadline
    wire = t.args["spec"].native.model_copy(update={"deadline": deadline})
    assert physical.scope_spec_digest == canonical_digest(wire.model_dump(mode="json"))
    assert t.args["intent"].model_dump(mode="json") == original_intent
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**{**t.args, "physical_deadline": deadline + timedelta(seconds=1)})
    assert len(t.stored) == 1
    assert t.stored[0].scope_expires_at == deadline


@pytest.mark.parametrize("seconds", [-1, 31])
def test_expired_or_unbounded_physical_candidate_never_reserves(owner_case, seconds):
    t = owner_case
    t.args["physical_deadline"] = datetime.now(UTC) + timedelta(seconds=seconds)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert not t.stored


def test_expired_root_refuses_reservation_even_with_live_effect_permit(owner_case):
    t = owner_case
    t.root.claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert not t.stored


def test_settlement_reloads_exact_persisted_deadline_after_expiry_without_recreate(owner_case, monkeypatch):
    from models.dify_builder_native_code import NativeCodePhysicalOperation
    from services.dify_builder.native_testing.sandbox import repository as module

    t = owner_case
    physical = t.repo.reserve_scope(**t.args)
    original_expiry = t.root.claim_expires_at
    scalar = t.session.scalar

    def row_read(query):
        if query.column_descriptions[0]["entity"] is NativeCodePhysicalOperation:
            return t.stored[0]
        return scalar(query)

    monkeypatch.setattr(t.session, "scalar", row_read)
    monkeypatch.setattr(module, "utc_now", lambda: physical.scope_expires_at + timedelta(seconds=1))
    loaded = t.repo.load_for_settlement(
        ref=physical.ref,
        operation_id=physical.operation_id,
        acquisition=physical.acquisition,
    )
    assert loaded == physical
    assert len(t.stored) == 1
    assert t.root.claim_expires_at == original_expiry
    assert not loaded.scope_create_acked
    assert loaded.destroyed_at is None
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(
            **{
                **t.args,
                "physical_deadline": physical.scope_expires_at + timedelta(seconds=10),
            }
        )
    assert len(t.stored) == 1
