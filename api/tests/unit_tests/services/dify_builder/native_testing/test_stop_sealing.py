"""Real lifecycle control with labeled SQL-boundary doubles, not locking proof."""

from collections import UserList
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeDispatch,
    NativeInvocationState,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

REF = NativeTestContextRef(request_id="request", invocation_id="root", context_digest="a" * 64)


def control_owner(owner_state: str) -> OwnedNativeTest:
    return OwnedNativeTest(
        ref=REF,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=3,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state=owner_state,
    )


def state_snapshots(states):
    return deepcopy(
        [
            tuple(inspect(row).attrs[column.key].value for column in inspect(NativeInvocationState).column_attrs)
            for row in states
        ]
    )


class Rows(UserList):
    def all(self):
        return list(self)


class SQLBoundary:
    """Explicit owner rows; deliberately does not pretend to evaluate SQL joins."""

    def __init__(self):
        self.request = DifyBuilderExecutionRequest(
            id="request",
            tenant_id="tenant",
            state="running",
            app_id="app",
            workflow_id="workflow",
            actor_id="actor",
            session_id="session",
            test_input_id="input",
            context={},
            context_digest=REF.context_digest,
        )
        self.states = [
            NativeInvocationState(
                context_object_id="context-" + identity,
                resolution=[],
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
            NativeTestInvocation(
                request_id="request", tenant_id="tenant", invocation_id=s.invocation_id, active=True, bindings={}
            )
            for s in self.states
        ]
        self.dispatches = [
            NativeDispatch(
                idempotency_digest="b" * 64,
                id=identity,
                request_id="request",
                tenant_id="tenant",
                invocation_id=invocation,
                generation=3,
                state=state,
                claim_expires_at=datetime(2030, 1, 1, tzinfo=UTC),
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
        self.scope = NativeTestScope(
            cancelled=False,
            generation=27,
            tenant_id="tenant",
            request_id="request",
            task_approved=False,
            max_calls=16,
            max_dispatches=16,
            max_cost_units=16,
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            budget_limits={},
            budget_spent={},
            profile={},
        )

    @contextmanager
    def locked(self, *, ref, settlement):
        assert ref == REF
        assert settlement is True
        self.events.append("writer-enter")
        owned = control_owner(self.sql.request.state)
        yield self.sql, owned, self.scope
        self.events.append("committed")
        if self.commit_error:
            raise self.commit_error


@dataclass
class StopSealCase:
    sql: SQLBoundary
    loader: Loader
    lifecycle: NativeTestLifecycleService


@pytest.fixture
def case(monkeypatch):
    sql = SQLBoundary()
    loader = Loader(sql)
    # These labeled boundary objects grant no physical, SQL, or storage proof.
    owner_loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id="tenant", account_id="actor"), resolver=NativeHttpBindingResolver()
    )
    monkeypatch.setattr(owner_loader, "locked", loader.locked)
    lifecycle = NativeTestLifecycleService(owner_loader, state_store=NativeExecutionStateStore(owner_loader))
    return StopSealCase(sql=sql, loader=loader, lifecycle=lifecycle)


def seal(case, **changes):
    values = {"ref": REF, "expected_generation": 3, "dispatch_id": "dispatch", "reason_code": "effect_denied"}
    values.update(changes)
    return case.lifecycle.seal_stop(**values)


def test_stop_seals_authority_after_commit_without_claiming_physical_cleanup(case):
    states_before = state_snapshots(case.sql.states)
    assert seal(case) is None
    assert case.loader.events == ["writer-enter", "committed"]
    assert case.sql.request.state == "sealed"
    assert not any(s.active for s in case.sql.invocations)
    assert state_snapshots(case.sql.states) == states_before
    assert case.sql.dispatches[0].state == "claimed"
    assert case.sql.dispatches[0].claim_expires_at == datetime(2030, 1, 1, tzinfo=UTC)
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
    rows = [case.sql.request, case.loader.scope, *case.sql.states, *case.sql.invocations, *case.sql.dispatches]
    before = deepcopy(
        [tuple(inspect(row).attrs[column.key].value for column in inspect(type(row)).column_attrs) for row in rows]
    )

    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        seal(case)

    assert [
        tuple(inspect(row).attrs[column.key].value for column in inspect(type(row)).column_attrs) for row in rows
    ] == before
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
    owned = control_owner("sealed")
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
