"""Real lifecycle control with labeled SQL-boundary doubles, not locking proof."""

from collections import UserList
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import cast

import pytest

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestInvocation
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

REF = NativeTestContextRef(request_id="request", invocation_id="root", context_digest="a" * 64)


class Rows(UserList):
    def all(self):
        return list(self)


class SQLBoundary:
    """Explicit owner rows; deliberately does not pretend to evaluate SQL joins."""

    def __init__(self):
        self.request = SimpleNamespace(id="request", tenant_id="tenant", state="running")
        self.states = [
            SimpleNamespace(
                request_id="request",
                tenant_id="tenant",
                invocation_id=identity,
                parent_invocation_id=parent,
                generation=3,
                state="running",
                app_id="app",
                workflow_id="workflow",
                cleanup_complete=False,
                pending_ids=["pending"],
                wait_reason="approval",
                checkpoint_id="retained",
            )
            for identity, parent in (("root", None), ("child", "root"))
        ]
        self.invocations = [
            SimpleNamespace(request_id="request", tenant_id="tenant", invocation_id=s.invocation_id, active=True)
            for s in self.states
        ]
        self.dispatches = [
            SimpleNamespace(
                id=identity,
                request_id="request",
                tenant_id="tenant",
                invocation_id=invocation,
                generation=3,
                state=state,
                claim_expires_at="retained-lease",
            )
            for identity, invocation, state in (("dispatch", "root", "claimed"), ("queued", "child", "queued"))
        ]

    def scalars(self, statement):
        model = statement.column_descriptions[0]["entity"]
        return Rows(
            {
                NativeInvocationState: self.states,
                NativeTestInvocation: self.invocations,
                NativeDispatch: self.dispatches,
            }[model]
        )

    def scalar(self, statement):
        model = statement.column_descriptions[0]["entity"]
        if model is NativeInvocationState:
            return self.states[0]
        if model is NativeDispatch:
            return self.dispatches[0]
        if model is NativeTestInvocation:
            if statement.column_descriptions[0]["name"] == "id":
                return next((s.invocation_id for s in self.invocations[1:] if s.active), None)
            return self.invocations[0]
        raise AssertionError("unexpected SQL boundary")

    def get(self, model, identity):
        assert model is DifyBuilderExecutionRequest
        assert identity == "request"
        return self.request


class Loader:
    def __init__(self, sql):
        self.sql = sql
        self.events = []
        self.commit_error = None
        self.scope = SimpleNamespace(cancelled=False, generation=27)

    @contextmanager
    def locked(self, *, ref, settlement):
        assert ref == REF
        assert settlement is True
        self.events.append("writer-enter")
        owned = SimpleNamespace(
            ref=ref, tenant_id="tenant", app_id="app", workflow_id="workflow", state=self.sql.request.state
        )
        yield self.sql, owned, self.scope
        self.events.append("committed")
        if self.commit_error:
            raise self.commit_error


@pytest.fixture
def case():
    sql = SQLBoundary()
    loader = Loader(sql)
    # These labeled boundary objects grant no physical, SQL, or storage proof.
    lifecycle = NativeTestLifecycleService(
        cast(OwnedNativeTestLoader, loader), state_store=cast(NativeExecutionStateStore, SimpleNamespace())
    )
    return SimpleNamespace(sql=sql, loader=loader, lifecycle=lifecycle)


def seal(case, **changes):
    values = {"ref": REF, "expected_generation": 3, "dispatch_id": "dispatch", "reason_code": "effect_denied"}
    values.update(changes)
    return case.lifecycle.seal_stop(**values)


def test_stop_seals_authority_after_commit_without_claiming_physical_cleanup(case):
    states_before = deepcopy([vars(s) for s in case.sql.states])
    assert seal(case) is None
    assert case.loader.events == ["writer-enter", "committed"]
    assert case.sql.request.state == "sealed"
    assert not any(s.active for s in case.sql.invocations)
    assert [vars(s) for s in case.sql.states] == states_before
    assert case.sql.dispatches[0].state == "claimed"
    assert case.sql.dispatches[0].claim_expires_at == "retained-lease"
    assert case.sql.dispatches[1].state == "cancelled"
    assert not case.loader.scope.cancelled


@pytest.mark.parametrize(
    "change",
    [
        {"expected_generation": 27},
        {"expected_generation": True},
        {"dispatch_id": "other"},
        {"reason_code": ""},
        {"reason_code": "raw\nsecret"},
    ],
)
def test_stop_rejects_foreign_or_malformed_control_without_mutation(case, change):
    with pytest.raises(BuilderExecutionPolicyError):
        seal(case, **change)
    assert case.sql.request.state == "running"
    assert all(s.active for s in case.sql.invocations)


@pytest.mark.parametrize("corruption", ["dispatch-tenant", "state-tenant", "missing-invocation", "disconnected-child"])
def test_stop_rejects_incomplete_or_foreign_tree_before_authority_changes(case, corruption):
    if corruption == "dispatch-tenant":
        case.sql.dispatches[0].tenant_id = "foreign"
    elif corruption == "state-tenant":
        case.sql.states[1].tenant_id = "foreign"
    elif corruption == "missing-invocation":
        case.sql.invocations.pop()
    else:
        case.sql.states[1].parent_invocation_id = "missing-parent"
    with pytest.raises(BuilderExecutionPolicyError):
        seal(case)
    assert case.sql.request.state == "running"
    assert all(s.active for s in case.sql.invocations)


@pytest.mark.parametrize("dispatch_state", ["queued", "published", "claimed"])
def test_stop_rejects_orphan_dispatch_before_any_authority_or_outbox_mutation(case, dispatch_state):
    orphan = deepcopy(case.sql.dispatches[1])
    orphan.id, orphan.invocation_id, orphan.state = "orphan-dispatch", "missing-invocation", dispatch_state
    case.sql.dispatches.append(orphan)
    before = deepcopy(
        [vars(case.sql.request), vars(case.loader.scope)]
        + [vars(row) for row in (*case.sql.states, *case.sql.invocations, *case.sql.dispatches)]
    )

    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        seal(case)

    assert (
        [vars(case.sql.request), vars(case.loader.scope)]
        + [vars(row) for row in (*case.sql.states, *case.sql.invocations, *case.sql.dispatches)]
    ) == before
    assert case.loader.events == ["writer-enter"]


def test_lost_stop_commit_ack_is_not_retried_into_acceptance(case):
    case.loader.commit_error = RuntimeError("synthetic lost acknowledgment")
    with pytest.raises(RuntimeError, match="synthetic lost acknowledgment"):
        seal(case)
    assert case.sql.request.state == "sealed"
    case.loader.commit_error = None
    with pytest.raises(BuilderExecutionPolicyError):
        seal(case)
    assert case.loader.events.count("committed") == 1


@pytest.mark.parametrize("status", ["completed", "waiting"])
def test_sealed_request_cannot_be_finalized_as_completed_or_resumable_wait(case, status):
    case.sql.request.state = "sealed"
    for invocation in case.sql.invocations:
        invocation.active = False
    owned = SimpleNamespace(ref=REF, tenant_id="tenant", state="sealed")
    outcome = NativeWorkflowOutcome(
        status=status,
        ref=REF,
        native_run_id="run",
        checkpoint_ref={"checkpoint_id": "checkpoint", "payload_digest": "b" * 64} if status == "waiting" else None,
        pending_operation_ids=("pending",) if status == "waiting" else (),
        reason_code=None,
        wait_reason="approval" if status == "waiting" else None,
        native_status="succeeded" if status == "completed" else None,
        output_result_ref=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_request_sealed"):
        case.lifecycle.finalize_dispatch_locked(
            session=case.sql,
            owned=owned,
            scope=case.loader.scope,
            dispatch_id="dispatch",
            generation=3,
            outcome=outcome,
        )
    assert case.sql.dispatches[0].state == "claimed"
