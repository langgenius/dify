"""Deterministic SQL-boundary doubles; real locking/storage evidence is normal CI only."""

from collections import UserList
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectGrant,
    NativeEffectOperation,
    NativeInvocationState,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.lifecycle import NativePendingResolution
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import context as sample_context

NOW = datetime(2026, 10, 15, tzinfo=UTC)
REF = NativeTestContextRef(request_id="request", invocation_id="root", context_digest="a" * 64)


def fence_owner(
    *,
    ref: NativeTestContextRef = REF,
    tenant_id: str = "tenant",
    actor_id: str = "actor",
    app_id: str = "app",
    generation: int = 3,
    task_approved: bool = False,
    expires_at: datetime = NOW + timedelta(days=1),
) -> OwnedNativeTest:
    """Owned invocation DTO for the isolated dispatch fence boundary."""
    return OwnedNativeTest(
        ref=ref,
        tenant_id=tenant_id,
        actor_id=actor_id,
        app_id=app_id,
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=generation,
        task_approved=task_approved,
        expires_at=expires_at,
        state="running",
    )


@dataclass
class SavedPendingResolution:
    resolution: NativePendingResolution

    def resolve(self, **_kwargs):
        return self.resolution


class ForbiddenChildResolution:
    def resolve_child(self, **_kwargs):
        pytest.fail("existing child must not resolve/create new work")


class Rows(UserList):
    def all(self):
        return list(self)


class SQLDouble:
    """Return explicit owner rows by selected ORM entity; no SQL engine/race claim."""

    def __init__(self, states, pending=()):
        self.rows = {
            NativeInvocationState: list(states),
            NativeTestInvocation: [
                NativeTestInvocation(
                    tenant_id="tenant", request_id="request", invocation_id=s.invocation_id, active=True, bindings={}
                )
                for s in states
            ],
            NativePendingAction: list(pending),
            DifyBuilderExecutionRequest: [
                DifyBuilderExecutionRequest(
                    actor_id="actor",
                    session_id="session",
                    test_input_id="input",
                    context={},
                    id="request",
                    tenant_id="tenant",
                    context_digest=REF.context_digest,
                    app_id="app",
                    workflow_id="workflow",
                )
            ],
            NativeTestScope: [
                NativeTestScope(
                    tenant_id="tenant",
                    request_id="request",
                    cancelled=False,
                    expires_at=NOW + timedelta(days=1),
                    generation=3,
                    task_approved=False,
                    max_calls=16,
                    max_dispatches=16,
                    max_cost_units=16,
                    budget_limits={},
                    budget_spent={},
                    profile={},
                )
            ],
        }

    def scalars(self, statement):
        description = statement.column_descriptions[0]
        rows = self.rows[description["entity"]]
        return Rows([row.invocation_id for row in rows] if description["name"] == "invocation_id" else rows)

    def scalar(self, statement):
        rows = self.scalars(statement)
        return rows[0] if rows else None

    def get(self, model, _identity):
        rows = self.rows[model]
        return rows[0] if rows else None


def state(identity="root", parent=None, **changes):
    return NativeInvocationState(
        **{
            "context_object_id": "context",
            "resolution": {},
            "tenant_id": "tenant",
            "request_id": "request",
            "invocation_id": identity,
            "parent_invocation_id": parent,
            "state": "running",
            "generation": 3,
            "pending_ids": [],
            "wait_reason": "approval" if changes.get("pending_ids") else None,
            "checkpoint_id": None,
            "app_id": "app",
            "workflow_id": "workflow",
            **changes,
        }
    )


def pending(identity="pending", **changes):
    return NativePendingAction(
        **{
            "reference_digest": "c" * 64,
            "reference": "reference",
            "owner_ref": "app",
            "owner_version": "1",
            "id": identity,
            "tenant_id": "tenant",
            "request_id": "request",
            "invocation_id": "root",
            "generation": 3,
            "category": "approval",
            **changes,
        },
    )


def readiness(session, *, ref=REF, coalesce=False):
    from services.dify_builder.native_testing import transitions

    assert hasattr(transitions, "dispatch_readiness"), "durable dispatch-readiness SQL guard is missing"
    return transitions.dispatch_readiness(session, ref=ref, tenant_id="tenant", now=NOW, coalesce_self=coalesce)


def test_active_unfenced_lineage_allows_dispatch_without_requiring_global_generation_equality():
    root, child = state(), state("child", "root", generation=1)
    assert readiness(SQLDouble([root, child]), ref=REF.model_copy(update={"invocation_id": "child"})) is None


@pytest.mark.parametrize("status", ["waiting", "queued", "unknown", "cancelled", "completed", "stopped"])
@pytest.mark.parametrize("selected", ["self", "ancestor"])
def test_closed_self_or_ancestor_refuses_fresh_dispatch(status, selected):
    root, child = state(), state("child", "root")
    (child if selected == "self" else root).state = status
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(SQLDouble([root, child]), ref=REF.model_copy(update={"invocation_id": "child"}))


@pytest.mark.parametrize("category", ["approval", "configuration", "interaction"])
def test_same_invocation_fence_preserves_real_pending_identity_and_category(category):
    row = pending(category=category)
    session = SQLDouble([state(pending_ids=[row.id], wait_reason=category)], [row])
    assert readiness(session, coalesce=True) is row
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(session)


@pytest.mark.parametrize(
    "change",
    [
        {"tenant_id": "foreign"},
        {"request_id": "foreign"},
        {"invocation_id": "child"},
        {"generation": 2},
        {"category": "unknown"},
        {"id": "unrepresented"},
    ],
)
def test_fence_never_coalesces_foreign_stale_or_invalid_pending_row(change):
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(SQLDouble([state(pending_ids=["pending"])], [pending(**change)]), coalesce=True)


@pytest.mark.parametrize("ids", [["pending", "pending"], ["missing"], [True]])
def test_malformed_or_missing_fence_membership_fails_closed(ids):
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(SQLDouble([state(pending_ids=ids)], [pending()]), coalesce=True)


def test_child_cannot_coalesce_an_ancestor_pending_id_as_its_own_wait():
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(
            SQLDouble([state(pending_ids=["pending"]), state("child", "root")], [pending()]),
            ref=REF.model_copy(update={"invocation_id": "child"}),
            coalesce=True,
        )


@pytest.mark.parametrize("fault", ["missing", "cycle", "foreign", "inactive", "root_owner", "expired", "cancelled"])
def test_incomplete_or_revoked_lineage_never_authorizes_dispatch(fault):
    root, child = state(), state("child", "root")
    session = SQLDouble([root, child])
    if fault == "missing":
        session.rows[NativeInvocationState] = [child]
    elif fault == "cycle":
        root.parent_invocation_id = "child"
    elif fault == "foreign":
        root.tenant_id = "foreign"
    elif fault == "inactive":
        session.rows[NativeTestInvocation][0].active = False
    elif fault == "root_owner":
        root.app_id = "other-app"
    elif fault == "expired":
        session.rows[NativeTestScope][0].expires_at = NOW
    else:
        session.rows[NativeTestScope][0].cancelled = True
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(session, ref=REF.model_copy(update={"invocation_id": "child"}))


def test_existing_c02_coalesces_fenced_sibling_before_any_operation_write(monkeypatch):
    from models.dify_builder_native_tests import NativeEffectOperation
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding, intent

    row = pending(category="configuration")
    session = SQLDouble([state(pending_ids=[row.id], wait_reason="configuration")], [row])
    session.rows.update({NativeEffectOperation: [], NativeEffectGrant: []})
    writes = []
    session.add = writes.append
    session.flush = lambda: None
    effect = intent().model_copy(update={"key": intent().key.model_copy(update={"invocation_id": "root"})})
    owned = fence_owner(ref=REF, tenant_id="tenant", actor_id="actor", app_id="app", generation=3, task_approved=False)
    service = EffectAuthorizationService(None, clock=lambda: NOW)
    # This test isolates the ordered admission guard after current binding validation.
    monkeypatch.setattr(service, "_binding", lambda *_args: binding(effect))
    result = service._claim(session, owned, session.rows[NativeTestScope][0], effect)
    assert result == ApprovalWait(pending_operation_id=row.id, wait_reason="configuration")
    assert writes == []


def test_pause_cannot_discard_a_late_running_fence(monkeypatch):
    from contextlib import contextmanager

    from runtime_contracts.builder.native.contracts import CheckpointRef
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService

    selected = state(pending_ids=["late"], checkpoint_id=None, wait_reason="approval")
    session = SQLDouble([selected], [pending()])
    session.rows[NativeContinuation] = [
        NativeContinuation(
            checkpoint_id="checkpoint",
            generation=3,
            tenant_id="tenant",
            request_id="request",
            invocation_id="root",
            payload_digest="b" * 64,
            payload_ref="private-checkpoint",
        )
    ]
    owned = fence_owner(tenant_id="tenant", ref=REF, expires_at=NOW + timedelta(days=1))

    @contextmanager
    def locked(**_kwargs):
        yield session, owned, session.rows[NativeTestScope][0]

    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload

    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id="tenant", account_id="actor"), resolver=object()
    )
    monkeypatch.setattr(loader, "locked", locked)
    store = NativeExecutionStateStore(loader)
    payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id="run",
        generation=3,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(),
        child_refs=(),
        input_result_refs=(),
    )
    monkeypatch.setattr(store, "read_checkpoint", lambda **_kwargs: payload)
    service = NativeTestLifecycleService(loader, state_store=store, clock=lambda: NOW)
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_mismatch"):
        service.pause(
            ref=REF,
            checkpoint=CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64),
            pending_operation_ids=("pending",),
            expected_generation=3,
        )
    assert selected.state == "running"
    assert selected.pending_ids == ["late"]


def test_approval_pending_uses_actual_local_generation_after_shared_scope_advance():
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService

    session = SQLDouble([state()])
    session.rows[NativePendingAction] = []
    writes = []
    session.add = writes.append
    session.flush = lambda: setattr(writes[-1], "id", "pending")
    owned = fence_owner(ref=REF, tenant_id="tenant", generation=9, app_id="app")
    EffectAuthorizationService._pending(
        session,
        owned,
        NativeEffectOperation(
            id="operation",
            scope_digest="b" * 64,
            tenant_id="tenant",
            request_id="request",
            invocation_id="root",
            operation_digest="c" * 64,
            intent_digest="d" * 64,
            state="pending",
        ),
    )
    assert writes[0].generation == 3


@pytest.mark.parametrize("category", ["configuration", "interaction"])
def test_native_pending_owner_uses_local_generation_after_shared_scope_advance(monkeypatch, category):
    from contextlib import contextmanager

    from services.dify_builder.native_testing import pending_actions
    from services.dify_builder.native_testing.repository import PendingOwner

    row = pending(category=category)
    session = SQLDouble([state()], [row])
    owned = fence_owner(ref=REF, tenant_id="tenant", generation=9)

    @contextmanager
    def locked(**_kwargs):
        yield session, owned, session.rows[NativeTestScope][0]

    resolver = NativeHttpBindingResolver()
    monkeypatch.setattr(
        resolver,
        "resolve_pending",
        lambda **_kw: PendingOwner(category=category, owner_ref="app", version="1", reference="reference"),
    )
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id=owned.tenant_id, account_id=owned.actor_id), resolver=resolver
    )
    monkeypatch.setattr(loader, "load", lambda **_kw: owned)
    monkeypatch.setattr(loader, "locked", locked)
    monkeypatch.setattr(pending_actions, "utc_now", lambda: NOW, raising=False)
    service = pending_actions.NativePendingActionService(loader)
    result = service._wait(REF, category, "reference", 3)
    assert result.pending_operation_id == row.id
    assert result.wait_reason == category


@pytest.mark.parametrize("category", ["approval", "configuration", "interaction"])
def test_fence_pending_acknowledges_after_commit_without_changing_running_state(monkeypatch, category):
    from contextlib import contextmanager

    from services.dify_builder.native_testing import lifecycle

    assert hasattr(lifecycle.NativeTestLifecycleService, "fence_pending"), "durable pending fence command missing"
    selected = state(context_object_id="context", checkpoint_id=None, wait_reason=None)
    row = pending(category=category)
    session = SQLDouble([selected], [row])
    owned = fence_owner(ref=REF, tenant_id="tenant", expires_at=NOW + timedelta(days=1))
    committed = []

    @contextmanager
    def locked(**_kwargs):
        yield session, owned, session.rows[NativeTestScope][0]
        committed.append(True)

    authority = PrivateReadOwner(
        tenant_id="tenant",
        actor_id="actor",
        parent_invocation_id=None,
        root_revision_matches=True,
        input_revision=None,
        expires_at=NOW + timedelta(days=1),
        cancelled=False,
        active=True,
        request_state="running",
        revision_context=None,
        app_id="app",
        workflow_id="workflow",
        generation=3,
        context_object_id="context",
        graph_revision="revision",
    )
    monkeypatch.setattr(lifecycle, "validate_private_read", lambda *_args: authority, raising=False)
    monkeypatch.setattr(lifecycle, "validate_invocation_workflow", lambda *_args, **_kw: object(), raising=False)
    monkeypatch.setattr(lifecycle, "native_workflow_revision", lambda _workflow: "revision", raising=False)
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id="tenant", account_id="actor"), resolver=object()
    )
    monkeypatch.setattr(loader, "locked", locked)
    service = lifecycle.NativeTestLifecycleService(loader, state_store=object(), clock=lambda: NOW)
    assert service.fence_pending(ref=REF, pending_operation_ids=(row.id,), expected_generation=3) is None
    assert committed == [True]
    assert (selected.state, selected.checkpoint_id, selected.wait_reason, selected.pending_ids) == (
        "running",
        None,
        category,
        [row.id],
    )
    assert service.fence_pending(ref=REF, pending_operation_ids=(row.id,), expected_generation=3) is None
    assert selected.pending_ids == [row.id]


def test_child_creation_checks_fence_before_protected_input_or_resolver_work(monkeypatch):
    from contextlib import contextmanager

    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.contracts import OperationKey
    from services.dify_builder.native_testing import child_invocations
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService

    class ChildSQL(SQLDouble):
        def scalar(self, statement):
            if statement.column_descriptions[0]["entity"] is NativeInvocationState:
                return None  # no existing child at the selected parent occurrence
            return super().scalar(statement)

    session = ChildSQL([state(pending_ids=["pending"])], [pending()])

    @contextmanager
    def factory():
        yield session

    touched = []
    parent = fence_owner(tenant_id="tenant", ref=REF)
    loader = OwnedNativeTestLoader(
        factory,
        actor=Actor(tenant_id=parent.tenant_id, account_id=parent.actor_id),
        resolver=NativeHttpBindingResolver(),
    )
    monkeypatch.setattr(loader, "load", lambda **_kw: parent)
    store = NativeExecutionStateStore(loader)
    monkeypatch.setattr(store, "load_context", lambda **_kw: touched.append("context") or parent)
    monkeypatch.setattr(store, "load_result", lambda **_kw: touched.append("input") or {})

    def resolve_child(**_kwargs):
        touched.append("resolver")
        raise BuilderExecutionPolicyError("test_resolver_reached")

    resolver = ForbiddenChildResolution()
    monkeypatch.setattr(resolver, "resolve_child", resolve_child)
    service = NativeChildInvocationService(store, resolver=resolver)
    monkeypatch.setattr(child_invocations, "utc_now", lambda: NOW)
    with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_fenced"):
        service.get_or_create(
            parent_ref=REF,
            key=OperationKey(invocation_id="root", occurrence_path=("child",), cursor=0),
            child_app_id="app",
            child_workflow_revision="revision",
            input_digest=canonical_digest({}),
            input_result_ref="input",
        )
    assert touched == []


def test_retained_acknowledged_historical_ids_do_not_coalesce_or_close_admission():

    selected = state(pending_ids=["pending"], wait_reason=None, checkpoint_id="checkpoint")
    session = SQLDouble([selected], [pending(generation=2)])
    session.rows[NativeContinuation] = [
        NativeContinuation(
            payload_digest="b" * 64,
            payload_ref="private-checkpoint",
            tenant_id="tenant",
            request_id="request",
            invocation_id="root",
            generation=2,
            checkpoint_id="checkpoint",
        )
    ]
    session.rows[NativeDispatch] = [
        NativeDispatch(
            idempotency_digest="a" * 64,
            tenant_id="tenant",
            request_id="request",
            invocation_id="root",
            generation=3,
            state="claimed",
            checkpoint_id="checkpoint",
        )
    ]
    assert readiness(session, coalesce=True) is None
    assert readiness(session) is None


@pytest.mark.parametrize("saved", [False, True])
def test_generation_claim_requires_actual_saved_configuration_resolution(saved, monkeypatch):
    from contextlib import contextmanager

    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload
    from services.dify_builder.native_testing.lifecycle import NativePendingResolution, NativeTestLifecycleService

    selected = state(
        state="queued",
        generation=4,
        pending_ids=["pending"],
        wait_reason="configuration",
        checkpoint_id="checkpoint",
        resolution=[],
    )
    row = pending(generation=3, category="configuration", owner_ref="app", reference="config")
    session = SQLDouble([selected], [row])
    dispatch = NativeDispatch(
        idempotency_digest="a" * 64,
        id="dispatch",
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        state="queued",
        generation=4,
        checkpoint_id="checkpoint",
        claim_expires_at=None,
    )
    session.rows[NativeDispatch] = [dispatch]
    session.rows[NativeContinuation] = [
        NativeContinuation(
            payload_ref="private-checkpoint",
            tenant_id="tenant",
            request_id="request",
            invocation_id="root",
            generation=3,
            checkpoint_id="checkpoint",
            payload_digest="b" * 64,
        )
    ]
    owned = fence_owner(ref=REF, tenant_id="tenant", expires_at=NOW + timedelta(days=1))

    @contextmanager
    def factory():
        yield session

    @contextmanager
    def locked(**_kwargs):
        yield session, owned, session.rows[NativeTestScope][0]

    loader = OwnedNativeTestLoader(
        factory, actor=Actor(tenant_id=owned.tenant_id, account_id=owned.actor_id), resolver=NativeHttpBindingResolver()
    )
    monkeypatch.setattr(loader, "_load", lambda *_args, **_kw: (owned, session.rows[NativeTestScope][0]))
    monkeypatch.setattr(loader, "load", lambda **_kw: owned)
    monkeypatch.setattr(loader, "locked", locked)
    payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id="native-run",
        generation=3,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(),
        child_refs=(),
        input_result_refs=(),
    )
    store = NativeExecutionStateStore(loader)
    context = sample_context().model_copy(update={"ref": REF, "native_run_id": "native-run", "tenant_id": "tenant"})
    monkeypatch.setattr(store, "load_context", lambda **_kw: context)
    monkeypatch.setattr(store, "read_checkpoint", lambda **_kw: payload)
    resolution = NativePendingResolution(
        category="configuration",
        invocation_id="root",
        pending_action_id="pending",
        owner_ref="app",
        reference="config",
        resolved=True,
        account_ref="actual-account",
        answer_result_ref=None,
    )
    service = NativeTestLifecycleService(
        loader, state_store=store, resolution=SavedPendingResolution(resolution), clock=lambda: NOW
    )
    if saved:
        selected.resolution = [resolution.model_dump(mode="json")]
        assert service.claim_dispatch(ref=REF, generation=4, dispatch_id="dispatch")
        assert (selected.state, selected.wait_reason, selected.pending_ids) == ("running", None, ["pending"])
        assert dispatch.state == "claimed"
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            service.claim_dispatch(ref=REF, generation=4, dispatch_id="dispatch")
        assert (selected.state, selected.wait_reason, selected.pending_ids) == ("queued", "configuration", ["pending"])
        assert dispatch.state == "queued"


def test_coalesced_native_wait_still_validates_requested_pending_owner(monkeypatch):
    from contextlib import contextmanager

    from services.dify_builder.native_testing import pending_actions
    from services.dify_builder.native_testing.repository import PendingOwner

    row = pending(category="configuration")
    session = SQLDouble([state(pending_ids=[row.id], wait_reason="configuration")], [row])
    owned = fence_owner(ref=REF, tenant_id="tenant", generation=9)

    @contextmanager
    def locked(**_kwargs):
        yield session, owned, session.rows[NativeTestScope][0]

    resolver = NativeHttpBindingResolver()
    monkeypatch.setattr(
        resolver,
        "resolve_pending",
        lambda **_kw: PendingOwner(
            category="configuration", owner_ref="app", version="1", reference="changed-reference"
        ),
    )
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id=owned.tenant_id, account_id=owned.actor_id), resolver=resolver
    )
    monkeypatch.setattr(loader, "load", lambda **_kw: owned)
    monkeypatch.setattr(loader, "locked", locked)
    monkeypatch.setattr(pending_actions, "utc_now", lambda: NOW)
    with pytest.raises(BuilderExecutionPolicyError, match="pending_owner_mismatch"):
        pending_actions.NativePendingActionService(loader)._wait(REF, "configuration", "reference", 3)


@pytest.mark.parametrize(
    "changes",
    [
        {"wait_reason": "interaction", "pending_ids": ["pending"]},
        {"wait_reason": "approval", "pending_ids": []},
        {"wait_reason": "invalid", "pending_ids": ["pending"]},
        {"wait_reason": None, "pending_ids": ["pending"], "checkpoint_id": None},
        {"wait_reason": None, "pending_ids": None},
        {"wait_reason": None, "pending_ids": {}},
    ],
)
def test_inconsistent_reason_ids_or_unacknowledged_current_rows_never_open_dispatch(changes):
    with pytest.raises(BuilderExecutionPolicyError):
        readiness(SQLDouble([state(**changes)], [pending()]), coalesce=True)


@pytest.mark.parametrize("child_status", ["running", "completed", "stopped"])
@pytest.mark.parametrize("fault", [None, "permission", "revision", "input"])
def test_existing_nested_child_lookup_requires_actual_parent_private_authority(monkeypatch, child_status, fault):
    """Boundary doubles: root app A authority must not substitute for parent app B."""
    from contextlib import contextmanager

    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.contracts import OperationKey
    from services.dify_builder.native_testing import child_invocations
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService

    parent_ref = REF.model_copy(update={"invocation_id": "parent-B"})
    child_ref = REF.model_copy(update={"invocation_id": "existing-C"})
    inputs = {"nested": True}
    identity = canonical_digest(
        {
            "app": "app-C",
            "revision": "revision-C",
            "input_ref": "protected-input-B",
            "input_digest": canonical_digest(inputs),
        }
    )
    child = state(
        "existing-C",
        "parent-B",
        app_id="app-C",
        workflow_id="workflow-C",
        state=child_status,
        child_identity_digest=identity,
        outcome=None if child_status == "running" else {"status": child_status},
    )

    class ExistingChildSQL(SQLDouble):
        def scalar(self, statement):
            if statement.column_descriptions[0]["entity"] is NativeInvocationState:
                return child  # exact existing child selected by parent occurrence
            return super().scalar(statement)

    session = ExistingChildSQL([state(), state("parent-B", "root", app_id="app-B", workflow_id="workflow-B"), child])

    @contextmanager
    def factory():
        yield session

    # Root request loader remains authorized in every case, including local B revocation.
    owned = fence_owner(tenant_id="tenant", app_id="app", ref=parent_ref)
    loader = OwnedNativeTestLoader(
        factory, actor=Actor(tenant_id=owned.tenant_id, account_id=owned.actor_id), resolver=NativeHttpBindingResolver()
    )
    monkeypatch.setattr(loader, "load", lambda **_kw: owned)

    def load_context(*, ref):
        assert ref == parent_ref
        if fault in {"permission", "revision"}:
            raise BuilderExecutionPolicyError(
                "execution_permission_denied" if fault == "permission" else "native_revision_drift"
            )
        return fence_owner(ref=ref, app_id="app-B")

    def load_result(*, ref, result_ref):
        assert (ref, result_ref) == (parent_ref, "protected-input-B")
        return {"nested": "corrupt"} if fault == "input" else inputs

    store = NativeExecutionStateStore(loader)
    monkeypatch.setattr(store, "load_context", load_context)
    monkeypatch.setattr(store, "load_result", load_result)
    resolver = ForbiddenChildResolution()
    service = NativeChildInvocationService(store, resolver=resolver)
    monkeypatch.setattr(child_invocations, "utc_now", lambda: NOW)
    args = {
        "parent_ref": parent_ref,
        "key": OperationKey(invocation_id="parent-B", occurrence_path=("existing",), cursor=0),
        "child_app_id": "app-C",
        "child_workflow_revision": "revision-C",
        "input_digest": canonical_digest(inputs),
        "input_result_ref": "protected-input-B",
    }
    if fault is None:
        assert service.get_or_create(**args) == child_ref
    else:
        reason = {
            "permission": "execution_permission_denied",
            "revision": "native_revision_drift",
            "input": "native_child_input_mismatch",
        }[fault]
        with pytest.raises(BuilderExecutionPolicyError, match=reason):
            service.get_or_create(**args)


@pytest.mark.parametrize("has_operation", [False, True])
@pytest.mark.parametrize("decision", ["denied", "approved"])
def test_waiting_immutable_denial_is_negative_evidence_without_fresh_admission(monkeypatch, has_operation, decision):
    from models.dify_builder_native_tests import NativeEffectOperation
    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.contracts import PolicyStop
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding, intent

    effect = intent().model_copy(update={"key": intent().key.model_copy(update={"invocation_id": "root"})})
    operation = NativeEffectOperation(
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        state="pending",
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        operation_digest="a" * 64,
        scope_digest="b" * 64,
    )
    session = SQLDouble([state(state="waiting", pending_ids=["pending"], checkpoint_id="checkpoint")], [pending()])
    session.rows.update(
        {
            NativeEffectGrant: [
                NativeEffectGrant(
                    decision=decision,
                    tenant_id="tenant",
                    request_id="request",
                    actor_id="actor",
                    scope_digest="b" * 64,
                    expires_at=NOW + timedelta(hours=1),
                    max_calls=16,
                    max_dispatches=16,
                    max_cost_units=16,
                )
            ],
            NativeEffectOperation: [operation] if has_operation else [],
        }
    )
    writes = []
    session.add = writes.append
    session.flush = lambda: None
    scope = session.rows[NativeTestScope][0]
    scope.spent_calls = scope.spent_dispatches = scope.spent_cost_units = 0
    owned = fence_owner(ref=REF, tenant_id="tenant", actor_id="actor", app_id="app", task_approved=False)
    service = EffectAuthorizationService(None, clock=lambda: NOW)
    monkeypatch.setattr(service, "_binding", lambda *_: binding(effect))
    if decision == "denied":
        assert service._claim(session, owned, scope, effect) == PolicyStop(reason_code="effect_denied")
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_closed"):
            service._claim(session, owned, scope, effect)
    assert writes == []
    assert (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units) == (0, 0, 0)
    assert operation.state == "pending"


@pytest.mark.parametrize("ancestor_state", ["unknown", "cancelled", "completed"])
@pytest.mark.parametrize("fault", [None, "intent", "permit"])
def test_physical_claim_validates_permit_then_preserves_ancestor_refusal(monkeypatch, ancestor_state, fault):
    from models.dify_builder_native_tests import NativeEffectOperation
    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.contracts import DispatchPermit, operation_digest
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService, _scope_digest
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding, intent

    child_ref = REF.model_copy(update={"invocation_id": "child"})
    effect = intent().model_copy(update={"key": intent().key.model_copy(update={"invocation_id": "child"})})
    trusted = binding(effect)
    operation = NativeEffectOperation(
        tenant_id="tenant",
        request_id="request",
        invocation_id="child",
        operation_digest=operation_digest(effect.key),
        intent_digest="wrong" if fault == "intent" else canonical_digest(effect.model_dump(mode="json")),
        scope_digest=_scope_digest(effect, trusted),
        state="claimed",
    )
    session = SQLDouble([state(state=ancestor_state), state("child", "root")])
    session.rows[NativeEffectOperation] = [operation]
    scope = session.rows[NativeTestScope][0]
    attempt = NativeEffectAttempt(
        expires_at=NOW + timedelta(hours=1),
        tenant_id="tenant",
        request_id="request",
        invocation_id="child",
        operation_id="operation",
        grant_id="grant",
        dispatch_index=0,
        permit_digest="a" * 64,
        cost_units=1,
        budget_reservation_ref="budget",
        execution_id="execution",
        invocation_digest="b" * 64,
        budget={},
        profile={},
    )
    permit = DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at=attempt.expires_at.isoformat()
    )
    service = EffectAuthorizationService(None, clock=lambda: NOW)

    def load_attempt(*_):
        if fault == "permit":
            raise BuilderExecutionPolicyError("invalid_dispatch_permit")
        return attempt

    monkeypatch.setattr(service, "_attempt", load_attempt)
    monkeypatch.setattr(service, "_binding", lambda *_: trusted)
    expected = "invalid_dispatch_permit" if fault else "native_ancestor_quarantined"
    with pytest.raises(BuilderExecutionPolicyError, match=expected):
        service._validate_dispatch_locked(
            session=session,
            owned=fence_owner(ref=child_ref, tenant_id="tenant"),
            scope=scope,
            intent=effect,
            permit=permit,
        )


@pytest.mark.parametrize("category", ["configuration", "interaction"])
def test_terminal_child_settlement_without_resolution_owner_commits_and_keeps_parent_waiting(category, monkeypatch):
    from contextlib import contextmanager

    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
    from services.dify_builder.native_testing.child_invocations import NativeChildInvocationService

    child_ref = REF.model_copy(update={"invocation_id": "child"})
    root = state(
        state="waiting", pending_ids=["pending"], wait_reason=category, checkpoint_id="parent-checkpoint", outcome=None
    )
    child = state(
        "child",
        "root",
        state="waiting",
        pending_ids=["pending"],
        wait_reason=category,
        checkpoint_id="child-checkpoint",
        outcome=None,
    )

    class SettlementSQL(SQLDouble):
        def scalar(self, statement):
            entity = statement.column_descriptions[0]["entity"]
            if entity in {NativeInvocationState, NativeTestInvocation}:
                rows = self.rows[entity]
                params = statement.compile().params
                if "invocation_id_1" in params:
                    rows = [r for r in rows if r.invocation_id == params["invocation_id_1"]]
                if "state_1" in params:
                    rows = [r for r in rows if r.state == params["state_1"]]
                return rows[0] if rows else None
            return super().scalar(statement)

    session = SettlementSQL([root, child], [pending(invocation_id="child", category=category)])
    writes, committed = [], []
    session.add = writes.append
    owned = fence_owner(ref=child_ref, tenant_id="tenant")
    scope = session.rows[NativeTestScope][0]
    scope.generation = 3

    @contextmanager
    def locked(**_):
        yield session, owned, scope
        committed.append(True)

    def load(_session, *, ref, **_):
        current = next(row for row in session.rows[NativeTestInvocation] if row.invocation_id == ref.invocation_id)
        if not current.active:
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        return fence_owner(ref=ref, tenant_id="tenant"), scope

    loader = OwnedNativeTestLoader(
        sessionmaker(),
        actor=Actor(tenant_id=owned.tenant_id, account_id=owned.actor_id),
        resolver=NativeHttpBindingResolver(),
    )
    monkeypatch.setattr(loader, "locked", locked)
    monkeypatch.setattr(loader, "_load", load)
    store = NativeExecutionStateStore(loader)
    context = sample_context().model_copy(update={"ref": child_ref, "native_run_id": "child-run"})
    monkeypatch.setattr(store, "load_recovery_context", lambda **_: context)
    service = NativeChildInvocationService(store, resolver=ForbiddenChildResolution())
    outcome = NativeWorkflowOutcome(
        status="completed",
        ref=child_ref,
        native_run_id="child-run",
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="succeeded",
        output_result_ref=None,
    )
    service.complete(child_ref=child_ref, outcome=outcome)
    assert committed == [True]
    assert (child.state, child.outcome) == ("completed", outcome.model_dump(mode="json"))
    assert (root.state, root.pending_ids, root.checkpoint_id) == ("waiting", ["pending"], "parent-checkpoint")
    assert not session.rows[NativeTestInvocation][1].active
    assert writes == []
