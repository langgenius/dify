"""Actual lifecycle metadata port with SQL/authority doubles, not storage or DB qualification."""

from collections.abc import Generator
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import NoReturn, cast

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.orm.state import InstanceState

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import CheckpointRef, NativeTestContextRef
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL

NOW = datetime(2026, 10, 16, tzinfo=UTC)
REF = NativeTestContextRef(request_id="request", invocation_id="root", context_digest="a" * 64)


@dataclass
class ClaimedCheckpointCase:
    service: NativeTestLifecycleService
    session: SQL
    state: NativeInvocationState
    scope: NativeTestScope
    request: DifyBuilderExecutionRequest
    dispatch: NativeDispatch
    continuation: NativeContinuation
    obj: NativePayloadObject
    events: list[str]
    authority: PrivateReadOwner
    loader: OwnedNativeTestLoader
    ref: NativeTestContextRef


def checkpoint_metadata_snapshot(session: SQL) -> dict[type, list[tuple[object, ...]]]:
    """Snapshot actual ORM values to prove metadata selection never mutates rows."""
    snapshot: dict[type, list[tuple[object, ...]]] = {}
    for model, rows in session.rows.items():
        values: list[tuple[object, ...]] = []
        for row in rows:
            state = inspect(row, raiseerr=False)
            assert isinstance(state, InstanceState)
            values.append(tuple(state.attrs[column.key].value for column in state.mapper.columns))
        snapshot[model] = values
    return deepcopy(snapshot)


@pytest.fixture
def metadata_case(monkeypatch: pytest.MonkeyPatch) -> ClaimedCheckpointCase:
    events: list[str] = []
    state = NativeInvocationState(
        resolution=[],
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        parent_invocation_id=None,
        app_id="app",
        workflow_id="workflow",
        context_object_id="context",
        generation=1,
        state="running",
        checkpoint_id="checkpoint",
        pending_ids=[],
        wait_reason=None,
    )
    scope = NativeTestScope(
        task_approved=False,
        max_calls=16,
        max_dispatches=16,
        max_cost_units=16,
        budget_limits={},
        budget_spent={},
        profile={},
        tenant_id="tenant",
        request_id="request",
        generation=1,
        cancelled=False,
        expires_at=NOW + timedelta(minutes=20),
    )
    request = DifyBuilderExecutionRequest(
        actor_id="actor",
        session_id="session",
        test_input_id="input",
        context={},
        id="request",
        tenant_id="tenant",
        context_digest=REF.context_digest,
        app_id="app",
        workflow_id="workflow",
        state="running",
    )
    dispatch = NativeDispatch(
        idempotency_digest="f" * 64,
        id="dispatch",
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        generation=1,
        state="claimed",
        checkpoint_id="checkpoint",
        claim_expires_at=NOW + timedelta(minutes=10),
    )
    continuation = NativeContinuation(
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        generation=0,
        checkpoint_id="checkpoint",
        payload_digest="b" * 64,
        payload_ref="protected-key",
    )
    obj = NativePayloadObject(
        value_digest="b" * 64,
        id="checkpoint",
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        kind="checkpoint",
        logical_key="0",
        payload_digest="b" * 64,
        storage_key="protected-key",
    )
    rows = {
        NativeInvocationState: [state],
        NativeTestScope: [scope],
        DifyBuilderExecutionRequest: [request],
        NativeDispatch: [dispatch],
        NativeContinuation: [continuation],
        NativePayloadObject: [obj],
        NativeTestInvocation: [
            NativeTestInvocation(
                tenant_id="tenant", request_id="request", invocation_id="root", active=True, bindings={}
            )
        ],
    }
    session = SQL(rows, events)

    @contextmanager
    def factory() -> Generator[SQL]:
        events.append("read-session")
        yield session

    def load(
        _session: object, *, ref: NativeTestContextRef, lock: bool, settlement: bool = False
    ) -> tuple[OwnedNativeTest, NativeTestScope]:
        assert ref == REF
        assert lock is False
        assert settlement is False
        events.append("normal-owner")
        if request.state not in {"running", "waiting"}:
            raise BuilderExecutionPolicyError("native_request_terminal")
        return OwnedNativeTest(
            ref=ref,
            tenant_id="tenant",
            actor_id="actor",
            expires_at=scope.expires_at,
            app_id="app",
            workflow_id="workflow",
            session_id="session",
            test_input_id="input",
            bindings={},
            generation=1,
            task_approved=False,
            state=request.state,
        ), scope

    loader = OwnedNativeTestLoader(
        cast(sessionmaker[Session], factory),
        actor=Actor(tenant_id="tenant", account_id="actor"),
        resolver=NativeHttpBindingResolver(),
    )
    monkeypatch.setattr(loader, "_load", load)
    authority = PrivateReadOwner(
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        parent_invocation_id=None,
        context_object_id="context",
        generation=1,
        graph_revision="c" * 64,
        root_revision_matches=True,
        input_revision="d" * 64,
        expires_at=scope.expires_at,
        cancelled=False,
        active=True,
        request_state="running",
    )

    def private_authority(actual_loader: OwnedNativeTestLoader, ref: NativeTestContextRef) -> PrivateReadOwner:
        assert actual_loader is loader
        assert ref == REF
        events.append("current-permission")
        return authority

    monkeypatch.setattr("services.dify_builder.native_testing.lifecycle.validate_private_read", private_authority)
    store = NativeExecutionStateStore(loader)

    def forbidden_private_read(*args: object, **kwargs: object) -> NoReturn:
        del args, kwargs
        raise AssertionError("metadata handoff must not use private store")

    monkeypatch.setattr(store, "load_context", forbidden_private_read)
    monkeypatch.setattr(store, "read_checkpoint", forbidden_private_read)
    monkeypatch.setattr(store, "load_result", forbidden_private_read)
    monkeypatch.setattr(store, "_read_object", forbidden_private_read)
    service = NativeTestLifecycleService(loader, state_store=store, clock=lambda: NOW)
    return ClaimedCheckpointCase(
        service=service,
        session=session,
        state=state,
        scope=scope,
        request=request,
        dispatch=dispatch,
        continuation=continuation,
        obj=obj,
        events=events,
        authority=authority,
        loader=loader,
        ref=REF,
    )


def test_returns_actual_claimed_checkpoint_metadata_without_io_or_mutation(
    metadata_case: ClaimedCheckpointCase,
) -> None:
    c = metadata_case
    before = checkpoint_metadata_snapshot(c.session)
    actual = c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")
    assert actual == CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64)
    assert checkpoint_metadata_snapshot(c.session) == before
    assert c.events[0] == "current-permission"
    assert "normal-owner" in c.events


def test_local_generation_can_lag_shared_scope_and_skip_checkpoint_generation(
    metadata_case: ClaimedCheckpointCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = metadata_case
    c.state.generation = c.dispatch.generation = 4
    c.continuation.generation = 1
    c.obj.logical_key = "1"
    c.scope.generation = 9
    from dataclasses import replace

    authority = replace(c.authority, generation=4)
    monkeypatch.setattr("services.dify_builder.native_testing.lifecycle.validate_private_read", lambda *_: authority)
    assert c.service.claimed_resume_checkpoint(ref=c.ref, generation=4, dispatch_id="dispatch") == CheckpointRef(
        checkpoint_id="checkpoint", payload_digest="b" * 64
    )


@pytest.mark.parametrize("generation", [0, -1, True, 1.0])
def test_refuses_initial_or_untyped_generation(metadata_case: ClaimedCheckpointCase, generation: object) -> None:
    c = metadata_case
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=cast(int, generation), dispatch_id="dispatch")


@pytest.mark.parametrize("status", ["queued", "published", "unknown", "completed", "cancelled"])
def test_only_current_claimed_dispatch_can_supply_checkpoint(metadata_case: ClaimedCheckpointCase, status: str) -> None:
    c = metadata_case
    c.dispatch.state = status
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")


@pytest.mark.parametrize("model", [NativeDispatch, NativeInvocationState, NativeContinuation, NativePayloadObject])
def test_missing_acknowledged_owner_metadata_refuses(metadata_case: ClaimedCheckpointCase, model: type) -> None:
    c = metadata_case
    c.session.rows[model] = []
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")


@pytest.mark.parametrize("row_name", ["dispatch", "state", "continuation", "obj"])
@pytest.mark.parametrize(
    ("field", "value"), [("tenant_id", "foreign"), ("request_id", "foreign"), ("invocation_id", "foreign")]
)
def test_foreign_metadata_cannot_supply_claimed_checkpoint(
    metadata_case: ClaimedCheckpointCase, row_name: str, field: str, value: str
) -> None:
    c = metadata_case
    setattr(
        {"dispatch": c.dispatch, "state": c.state, "continuation": c.continuation, "obj": c.obj}[row_name], field, value
    )
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")


@pytest.mark.parametrize(
    "fault",
    [
        "dispatch_generation",
        "local_generation",
        "checkpoint_drift",
        "lease_missing",
        "lease_expired",
        "state_waiting",
        "active_fence",
        "sealed",
        "scope_cancelled",
        "scope_expired",
    ],
)
def test_current_execution_drift_refuses_without_mutation(metadata_case: ClaimedCheckpointCase, fault: str) -> None:
    c = metadata_case
    if fault == "dispatch_generation":
        c.dispatch.generation = 2
    elif fault == "local_generation":
        c.state.generation = 2
    elif fault == "checkpoint_drift":
        c.state.checkpoint_id = "new-checkpoint"
    elif fault == "lease_missing":
        c.dispatch.claim_expires_at = None
    elif fault == "lease_expired":
        c.dispatch.claim_expires_at = NOW
    elif fault == "state_waiting":
        c.state.state = "waiting"
    elif fault == "active_fence":
        c.state.wait_reason = "configuration"
    elif fault == "sealed":
        c.request.state = "sealed"
    elif fault == "scope_cancelled":
        c.scope.cancelled = True
    else:
        c.scope.expires_at = NOW
    before = checkpoint_metadata_snapshot(c.session)
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")
    assert checkpoint_metadata_snapshot(c.session) == before


@pytest.mark.parametrize(
    "fault",
    [
        "equal_generation",
        "future_generation",
        "negative_generation",
        "digest_mismatch",
        "invalid_digest",
        "storage_mismatch",
        "missing_storage",
        "wrong_kind",
        "wrong_logical_key",
    ],
)
def test_corrupt_checkpoint_metadata_never_mints_reference(metadata_case: ClaimedCheckpointCase, fault: str) -> None:
    c = metadata_case
    if fault == "equal_generation":
        c.continuation.generation = 1
    elif fault == "future_generation":
        c.continuation.generation = 2
    elif fault == "negative_generation":
        c.continuation.generation = -1
    elif fault == "digest_mismatch":
        c.obj.payload_digest = "c" * 64
    elif fault == "invalid_digest":
        c.obj.payload_digest = c.continuation.payload_digest = "untrusted"
    elif fault == "storage_mismatch":
        c.obj.storage_key = "other-key"
    elif fault == "missing_storage":
        c.obj.storage_key = c.continuation.payload_ref = ""
    elif fault == "wrong_kind":
        c.obj.kind = "result"
    else:
        c.obj.logical_key = "wrong-generation"
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("generation", 2),
        ("context_object_id", "other-context"),
        ("app_id", "other-app"),
        ("active", False),
        ("root_revision_matches", False),
    ],
)
def test_private_authority_snapshot_must_match_current_local_owner(
    metadata_case: ClaimedCheckpointCase, monkeypatch: pytest.MonkeyPatch, field: str, value: object
) -> None:
    from dataclasses import replace

    c = metadata_case
    if field == "generation":
        assert isinstance(value, int)
        authority = replace(c.authority, generation=value)
    elif field == "context_object_id":
        assert isinstance(value, str)
        authority = replace(c.authority, context_object_id=value)
    elif field == "app_id":
        assert isinstance(value, str)
        authority = replace(c.authority, app_id=value)
    elif field == "active":
        assert isinstance(value, bool)
        authority = replace(c.authority, active=value)
    else:
        assert field == "root_revision_matches"
        assert isinstance(value, bool)
        authority = replace(c.authority, root_revision_matches=value)
    monkeypatch.setattr("services.dify_builder.native_testing.lifecycle.validate_private_read", lambda *_: authority)
    with pytest.raises(BuilderExecutionPolicyError):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")


def test_actual_permission_port_refusal_precedes_checkpoint_selection(
    metadata_case: ClaimedCheckpointCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = metadata_case

    def denied(*_: object) -> None:
        raise BuilderExecutionPolicyError("native_permission_denied")

    monkeypatch.setattr("services.dify_builder.native_testing.lifecycle.validate_private_read", denied)
    with pytest.raises(BuilderExecutionPolicyError, match="native_permission_denied"):
        c.service.claimed_resume_checkpoint(ref=c.ref, generation=1, dispatch_id="dispatch")
    assert c.events == []
