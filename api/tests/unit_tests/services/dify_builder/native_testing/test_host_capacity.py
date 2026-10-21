"""SQL-boundary doubles only; actual PostgreSQL/storage/races belong to normal CI."""

from collections import UserList
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import (
    BinaryExpression,
    BindParameter,
    BooleanClauseList,
    ColumnClause,
    False_,
    Null,
    True_,
)

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from models.model import App
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.repository import (
    OwnedNativeTest,
    OwnedNativeTestLoader,
    native_workflow_revision,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

NOW = datetime(2026, 10, 16, tzinfo=UTC)


class Rows(UserList):
    def all(self):
        return list(self)


class SQL:
    def __init__(self, rows, events):
        self.rows, self.events, self.occupancy = rows, events, []

    def scalars(self, query):
        description = query.column_descriptions[0]
        model = description["entity"]
        rows = list(self.rows.get(model, []))

        def matches(expression, row):
            if isinstance(expression, BooleanClauseList):
                results = [matches(clause, row) for clause in expression.clauses]
                return any(results) if expression.operator is operators.or_ else all(results)
            if not isinstance(expression, BinaryExpression):
                return True
            field = expression.left.key if isinstance(expression.left, ColumnClause) else None
            if field is None:
                return True
            if isinstance(expression.right, BindParameter):
                value = expression.right.value
            elif isinstance(expression.right, (True_, False_, Null)):
                value = {True_: True, False_: False, Null: None}[type(expression.right)]
            else:
                raise AssertionError("unsupported SQL predicate operand")
            # This unit boundary only evaluates the native ownership predicates
            # represented by these explicit records; real SQL is tested separately.
            try:
                if field == "account_id":
                    actual = row.account_id
                elif field == "context_digest":
                    actual = row.context_digest
                elif field == "type":
                    actual = row.type
                elif field == "value_digest":
                    actual = row.value_digest
                elif field == "id":
                    actual = row.id
                elif field == "tenant_id":
                    actual = row.tenant_id
                elif field == "actor_id":
                    actual = row.actor_id
                elif field == "request_id":
                    actual = row.request_id
                elif field == "invocation_id":
                    actual = row.invocation_id
                elif field == "parent_invocation_id":
                    actual = row.parent_invocation_id
                elif field == "app_id":
                    actual = row.app_id
                elif field == "workflow_id":
                    actual = row.workflow_id
                elif field == "session_id":
                    actual = row.session_id
                elif field == "state":
                    actual = row.state
                elif field == "status":
                    actual = row.status
                elif field == "generation":
                    actual = row.generation
                elif field == "active":
                    actual = row.active
                elif field == "cancelled":
                    actual = row.cancelled
                elif field == "logical_key":
                    actual = row.logical_key
                elif field == "kind":
                    actual = row.kind
                elif field == "scope_digest":
                    actual = row.scope_digest
                elif field == "operation_id":
                    actual = row.operation_id
                elif field == "attempt_id":
                    actual = row.attempt_id
                elif field == "cleanup_complete":
                    actual = row.cleanup_complete
                elif field == "claim_expires_at":
                    actual = row.claim_expires_at
                elif field == "claimed_at":
                    actual = row.claimed_at
                elif field == "expires_at":
                    actual = row.expires_at
                elif field == "source_generation":
                    actual = row.source_generation
                elif field == "context_object_id":
                    actual = row.context_object_id
                elif field == "checkpoint_id":
                    actual = row.checkpoint_id
                elif field == "payload_digest":
                    actual = row.payload_digest
                elif field == "test_input_id":
                    actual = row.test_input_id
                elif field == "owner_account_id":
                    actual = row.owner_account_id
                elif field == "version":
                    actual = row.version
                elif field == "cancellation_key":
                    actual = row.cancellation_key
                elif field == "created_by":
                    actual = row.created_by
                elif field == "created_by_role":
                    actual = row.created_by_role
                elif field == "workflow_run_id":
                    actual = row.workflow_run_id
                elif field == "node_id":
                    actual = row.node_id
                elif field == "node_execution_id":
                    actual = row.node_execution_id
                elif field == "triggered_from":
                    actual = row.triggered_from
                else:
                    raise AssertionError(f"unsupported SQL predicate column: {field}")
            except AttributeError:
                return True
            if expression.operator in {operators.eq, operators.is_}:
                return actual == value
            if expression.operator in {operators.ne, operators.is_not}:
                return actual != value
            if expression.operator is operators.in_op:
                return actual in value
            if expression.operator is operators.not_in_op:
                return actual not in value
            return True

        rows = [row for row in rows if all(matches(clause, row) for clause in query._where_criteria)]
        return Rows(
            r.invocation_id
            if description["name"] == "invocation_id"
            else r.id
            if description["name"] == "id"
            else r.request_id
            if description["name"] == "request_id"
            else r
            for r in rows
        )

    def scalar(self, query):
        if query.column_descriptions[0]["entity"] is App and query._for_update_arg is not None:
            self.events.append("app")
        rows = self.scalars(query)
        return rows[0] if rows else None

    def get(self, model, identity):
        return next((r for r in self.rows.get(model, []) if r.id == identity), None)

    def execute(self, _query):
        return Rows(self.occupancy)

    def add(self, row):
        self.rows.setdefault(type(row), []).append(row)

    def flush(self):
        for i, row in enumerate(self.rows.get(NativeDispatch, [])):
            if row.id is None:
                row.id = "dispatch-" + str(i)


@dataclass
class HostCapacityCase:
    lifecycle: NativeTestLifecycleService
    loader: OwnedNativeTestLoader
    session: SQL
    state: NativeInvocationState
    scope: NativeTestScope
    request: DifyBuilderExecutionRequest
    context: ResolvedNativeTestContext
    ref: NativeTestContextRef
    events: list[str]
    owned: OwnedNativeTest


@pytest.fixture
def case(monkeypatch):
    events = []
    workflow = Workflow(
        type="workflow",
        version="draft",
        created_by="actor",
        id="workflow",
        app_id="app",
        tenant_id="tenant",
        graph="{}",
        _features="{}",
        _environment_variables="[]",
        _conversation_variables="[]",
    )
    revision = native_workflow_revision(workflow)
    context_body = {"policy_version": "builder-native-test-v1", "execution_revision": revision}
    ref = NativeTestContextRef(
        request_id="request", invocation_id="root", context_digest=canonical_digest(context_body)
    )
    state = NativeInvocationState(
        id="state",
        tenant_id="tenant",
        request_id="request",
        invocation_id="root",
        parent_invocation_id=None,
        app_id="app",
        workflow_id="workflow",
        context_object_id="context",
        generation=0,
        state="queued",
        checkpoint_id=None,
        pending_ids=[],
        wait_reason=None,
        resolution=[],
        outcome=None,
        cancellation_key=None,
        cleanup_complete=False,
    )
    request = DifyBuilderExecutionRequest(
        session_id="session",
        id="request",
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        test_input_id="input",
        context=context_body,
        context_digest=ref.context_digest,
        state="running",
    )
    scope = NativeTestScope(
        task_approved=False,
        max_calls=16,
        max_dispatches=16,
        max_cost_units=16,
        budget_limits={},
        profile={},
        request_id="request",
        tenant_id="tenant",
        cancelled=False,
        generation=0,
        expires_at=NOW + timedelta(days=1),
        spent_calls=0,
        spent_dispatches=0,
        spent_cost_units=0,
        budget_spent={},
    )
    context = ResolvedNativeTestContext(
        ref=ref,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        graph={},
        inputs={"x": True},
        graph_revision=revision,
        input_revision=canonical_digest({"x": True}),
        resource_manifest=(),
        generation=0,
        root_native_run_id="run",
        native_run_id="run",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="request",
        cancellation_ref="request",
        execution_mode="native",
    )
    rows = {
        NativeInvocationState: [state],
        DifyBuilderExecutionRequest: [request],
        NativeTestScope: [scope],
        NativeTestInvocation: [
            NativeTestInvocation(
                id="invocation",
                tenant_id="tenant",
                request_id="request",
                invocation_id="root",
                active=True,
                bindings={},
            )
        ],
        NativeDispatch: [
            NativeDispatch(
                id="dispatch",
                tenant_id="tenant",
                request_id="request",
                invocation_id="root",
                generation=0,
                state="queued",
                checkpoint_id=None,
                claim_expires_at=None,
                idempotency_digest=canonical_digest({"initial": ref.model_dump(mode="json")}),
            )
        ],
        NativeContinuation: [],
        NativeEffectOperation: [],
        NativeEffectAttempt: [],
        NativeEffectDispatchClaim: [],
        NativeEffectOutcome: [],
        NativePayloadObject: [
            NativePayloadObject(
                logical_key="context",
                storage_key="private-context",
                payload_digest="e" * 64,
                id="context",
                tenant_id="tenant",
                request_id="request",
                invocation_id="root",
                kind="context",
                value_digest=canonical_digest(context.model_dump(mode="json")),
            )
        ],
        DifyBuilderTestInput: [
            DifyBuilderTestInput(
                id="input", inputs={"x": True}, session_id="session", source="mock", start_schema_hash=""
            )
        ],
        Workflow: [workflow],
        App: [App(id="app", tenant_id="tenant", status="normal")],
    }
    session = SQL(rows, events)
    owned = OwnedNativeTest(
        session_id="session",
        bindings={},
        generation=0,
        task_approved=False,
        revision_context=None,
        ref=ref,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        test_input_id="input",
        expires_at=scope.expires_at,
        state="running",
    )

    @contextmanager
    def factory():
        yield session

    @contextmanager
    def begin():
        events.append("begin")
        yield session
        events.append("commit")

    factory.begin = begin

    def load(_session, *, ref, lock=False, **_kwargs):
        assert ref == owned.ref
        if lock:
            events.append("request")
        return owned, scope

    @contextmanager
    def locked(**_kwargs):
        events.append("request")
        yield session, owned, scope
        events.append("commit")

    loader = OwnedNativeTestLoader(factory, actor=Actor(tenant_id="tenant", account_id="actor"), resolver=object())
    monkeypatch.setattr(loader, "_load", load)
    monkeypatch.setattr(loader, "load", lambda **_: owned)
    monkeypatch.setattr(loader, "locked", locked)

    def load_context(**_):
        events.append("private")
        return context

    store = NativeExecutionStateStore(loader)
    monkeypatch.setattr(store, "load_context", load_context)
    lifecycle = NativeTestLifecycleService(loader, state_store=store, clock=lambda: NOW)
    return HostCapacityCase(
        lifecycle=lifecycle,
        loader=loader,
        session=session,
        state=state,
        scope=scope,
        request=request,
        context=context,
        ref=ref,
        events=events,
        owned=owned,
    )


def test_initial_generation_claim_uses_acknowledged_context_without_fake_checkpoint(case):
    assert case.lifecycle.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.state.state == "running"
    assert not case.state.cleanup_complete
    assert case.session.rows[NativeContinuation] == []
    assert case.session.rows[NativeDispatch][0].state == "claimed"
    assert not case.lifecycle.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")


@pytest.mark.parametrize(
    "method",
    ["prepare_dispatch_claim", "consume_dispatch_claim", "enqueue_initial_dispatch", "finalize_dispatch_locked"],
)
def test_transaction_local_c03_ports_are_explicit(method):
    assert callable(
        {
            "prepare_dispatch_claim": NativeTestLifecycleService.prepare_dispatch_claim,
            "consume_dispatch_claim": NativeTestLifecycleService.consume_dispatch_claim,
            "enqueue_initial_dispatch": NativeTestLifecycleService.enqueue_initial_dispatch,
            "finalize_dispatch_locked": NativeTestLifecycleService.finalize_dispatch_locked,
        }[method]
    )


def test_capacity_requires_actual_cleanup_verifier(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_verifier_required"):
        NativeHostCapacity(case.lifecycle, cleanup_verifier=None)


class OnceVerifier:
    """Local lifetime double only; no thread/host physical qualification."""

    def __init__(self, events):
        self.events, self.used, self.current = events, False, True

    def consume_cleanup(self, **_):
        self.events.append("verify")
        if self.used or not self.current:
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        self.used = True


def test_capacity_commits_initial_claim_after_private_io_and_app_then_request(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.events.index("private") < case.events.index("app") < case.events.index("request")
    assert case.events[-1] == "commit"
    assert not owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")


@pytest.mark.parametrize("status", ["claimed", "unknown", "completed"])
@pytest.mark.parametrize("request_status", ["running", "sealed"])
def test_unclean_existing_root_holds_capacity_across_sessions_and_terminal_status(case, status, request_status):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    q = DifyBuilderExecutionRequest(
        test_input_id="other-input",
        id="other-request",
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        actor_id="other-actor",
        session_id="other-session",
        context=case.request.context,
        context_digest=case.request.context_digest,
        state=request_status,
    )
    r = NativeInvocationState(
        context_object_id="other-context",
        generation=0,
        pending_ids=[],
        resolution=[],
        request_id=q.id,
        tenant_id="tenant",
        invocation_id="other-root",
        app_id="app",
        workflow_id="workflow",
        parent_invocation_id=None,
        cleanup_complete=False,
        state="cancelled",
    )
    d = NativeDispatch(
        state=status,
        request_id=q.id,
        tenant_id=q.tenant_id,
        invocation_id=r.invocation_id,
        generation=0,
        idempotency_digest="a" * 64,
    )
    b = DifyBuilderSession(
        id=q.session_id,
        tenant_id="tenant",
        app_id="app",
        owner_account_id=q.actor_id,
        entry_mode="new",
        current_state="build.review",
    )
    invocation = NativeTestInvocation(
        request_id=q.id, tenant_id=q.tenant_id, invocation_id=r.invocation_id, active=True, bindings={}
    )
    scope = NativeTestScope(
        request_id=q.id,
        tenant_id=q.tenant_id,
        generation=0,
        task_approved=False,
        cancelled=False,
        expires_at=NOW + timedelta(days=1),
        max_calls=16,
        max_dispatches=16,
        max_cost_units=16,
        budget_limits={},
        budget_spent={},
        profile={},
    )
    case.session.occupancy = [
        (
            q,
            d,
            r,
            invocation,
            scope,
            b,
            DifyBuilderTestInput(
                id="other-input", session_id=q.session_id, source="mock", inputs={}, start_schema_hash=""
            ),
        )
    ]
    with pytest.raises(BuilderExecutionPolicyError, match="native_capacity_busy"):
        owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.session.rows[NativeDispatch][0].state == "queued"


def test_cleanup_is_once_exact_current_lifetime_outside_writer_and_releases_only_after_proof(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    case.events.clear()
    owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.events.index("verify") < case.events.index("app") < case.events.index("request")
    assert case.state.cleanup_complete
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    # Same IDs cannot bind this old verifier to a newly acquired lifetime.
    case.state.cleanup_complete = False
    verifier.current = False
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert not case.state.cleanup_complete


def test_composed_recovery_refuses_unclean_history_before_requeue(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    case.state.state = "unknown"
    assert case.owned.state == "running"
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        case.lifecycle._check_recovery_authority(case.session, case.ref, case.owned, case.scope)


def test_runtime_cancel_ids_do_not_release_composed_capacity_without_verifier(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    verifier.current = False
    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")

    class UnprovenCancelRuntime:
        def cancel(self, *, refs):
            assert refs
            return ("root",)

    case.lifecycle.runtime = UnprovenCancelRuntime()
    result = case.lifecycle.cancel(actor=case.loader.actor, request_id="request", idempotency_key="cancel")
    assert result.status == "cancelling"
    assert not case.state.cleanup_complete


def test_transaction_local_finalize_cannot_mutate_another_requests_claim(case):
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome

    foreign = NativeDispatch(
        idempotency_digest="a" * 64,
        id="foreign-dispatch",
        tenant_id="tenant",
        request_id="foreign",
        invocation_id="root",
        generation=0,
        state="claimed",
    )
    case.session.rows[NativeDispatch].append(foreign)
    outcome = NativeWorkflowOutcome(
        status="completed",
        ref=case.ref,
        native_run_id="run",
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="succeeded",
        output_result_ref=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_conflict"):
        case.lifecycle.finalize_dispatch_locked(
            session=case.session,
            owned=case.owned,
            scope=case.scope,
            dispatch_id=foreign.id,
            generation=0,
            outcome=outcome,
        )
    assert foreign.state == "claimed"


def test_initial_enqueue_is_real_acknowledged_idempotent_outbox_not_a_checkpoint(case):
    case.state.state = "running"
    case.session.rows[NativeDispatch] = []
    first = case.lifecycle.enqueue_initial_dispatch(ref=case.ref)
    assert first == case.lifecycle.enqueue_initial_dispatch(ref=case.ref)
    assert (first.ref, first.generation, case.state.state) == (case.ref, 0, "queued")
    assert len(case.session.rows[NativeDispatch]) == 1
    assert case.session.rows[NativeDispatch][0].state == "queued"
    assert case.session.rows[NativeContinuation] == []


@pytest.mark.parametrize("fault", ["wrong_initial_key", "already_clean", "unrepresented_form"])
def test_initial_claim_cannot_borrow_resume_or_prior_pending_authority(case, fault):

    if fault == "wrong_initial_key":
        case.session.rows[NativeDispatch][0].idempotency_digest = "foreign"
    elif fault == "already_clean":
        case.state.cleanup_complete = True
    else:
        case.session.rows[NativePendingAction] = [
            NativePendingAction(
                id="pending",
                request_id="request",
                tenant_id="tenant",
                invocation_id="root",
                generation=0,
                category="approval",
                reference_digest="a" * 64,
                reference="reference",
                owner_ref="app",
                owner_version="1",
            )
        ]
    with pytest.raises(BuilderExecutionPolicyError, match="native_initial_conflict"):
        case.lifecycle.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.session.rows[NativeDispatch][0].state == "queued"


@pytest.mark.parametrize("fault", ["missing_context", "changed_input", "changed_graph", "prior_effect"])
def test_initial_enqueue_rechecks_actual_context_and_sql_inputs_before_outbox(case, fault):
    case.state.state = "running"
    case.session.rows[NativeDispatch] = []
    if fault == "missing_context":
        case.session.rows[NativePayloadObject] = []
    elif fault == "changed_input":
        case.session.rows[DifyBuilderTestInput][0].inputs = {"x": "true"}
    elif fault == "changed_graph":
        case.session.rows[Workflow][0].graph = '{"changed":true}'
    else:
        case.session.rows[NativeEffectAttempt] = [
            NativeEffectAttempt(
                id="attempt",
                tenant_id="tenant",
                request_id="request",
                invocation_id="root",
                operation_id="operation",
                grant_id="grant",
                dispatch_index=0,
                permit_digest="a" * 64,
                expires_at=NOW + timedelta(days=1),
                cost_units=1,
                budget_reservation_ref="budget",
                execution_id="execution",
                invocation_digest="b" * 64,
                budget={},
                profile={},
            )
        ]
    with pytest.raises(BuilderExecutionPolicyError):
        case.lifecycle.enqueue_initial_dispatch(ref=case.ref)
    assert case.session.rows[NativeDispatch] == []


def test_boolean_cleanup_result_is_not_actual_trusted_none_success(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    class BooleanCleanupVerifier:
        def consume_cleanup(self, **_kwargs):
            return True

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=BooleanCleanupVerifier())
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert not case.state.cleanup_complete


def test_an_old_capacity_lifetime_cannot_claim_same_sql_ids_again_after_cleanup(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    # Boundary-double simulation of a requeued row, not initial crash-recovery proof.
    case.session.rows[NativeDispatch][0].state = "queued"
    case.state.state = "queued"
    assert not owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.session.rows[NativeDispatch][0].state == "queued"
    assert case.state.cleanup_complete


def test_transaction_local_wait_finalization_requires_actual_c03_ack(case):
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome

    dispatch = case.session.rows[NativeDispatch][0]
    dispatch.state = "claimed"
    case.state.state = "running"
    outcome = NativeWorkflowOutcome(
        status="waiting",
        ref=case.ref,
        native_run_id="run",
        checkpoint_ref=CheckpointRef(checkpoint_id="missing", payload_digest="b" * 64),
        pending_operation_ids=("pending",),
        reason_code=None,
        wait_reason="approval",
        native_status=None,
        output_result_ref=None,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="checkpoint_unavailable"):
        case.lifecycle.finalize_dispatch_locked(
            session=case.session,
            owned=case.owned,
            scope=case.scope,
            dispatch_id=dispatch.id,
            generation=0,
            outcome=outcome,
        )
    assert dispatch.state == "claimed"


def test_transaction_local_outcome_cannot_attach_a_foreign_private_result(case):
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome

    dispatch = case.session.rows[NativeDispatch][0]
    dispatch.state = "claimed"
    case.state.state = "running"
    case.session.rows[NativePayloadObject].append(
        NativePayloadObject(
            logical_key="result",
            storage_key="foreign-storage",
            payload_digest="a" * 64,
            value_digest="b" * 64,
            id="foreign-result",
            tenant_id="tenant",
            request_id="foreign",
            invocation_id="root",
            kind="result",
        )
    )
    outcome = NativeWorkflowOutcome(
        status="completed",
        ref=case.ref,
        native_run_id="run",
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="succeeded",
        output_result_ref="foreign-result",
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_result_owner_mismatch"):
        case.lifecycle.finalize_dispatch_locked(
            session=case.session,
            owned=case.owned,
            scope=case.scope,
            dispatch_id=dispatch.id,
            generation=0,
            outcome=outcome,
        )
    assert dispatch.state == "claimed"


def test_delayed_claim_rechecks_lifetime_after_app_lock(case, monkeypatch):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    original = owner.locked

    @contextmanager
    def delayed(**kwargs):
        # Model another call acquiring this exact lifetime while our prepared
        # delivery waits for App, followed by same-ID SQL requeue after cleanup.
        with original(**kwargs) as value:
            owner._used = True
            yield value

    monkeypatch.setattr(owner, "locked", delayed)
    assert not owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.session.rows[NativeDispatch][0].state == "queued"


@pytest.mark.parametrize("status", ["queued", "published"])
def test_never_acquired_cancel_finishes_and_reconcile_does_not_repeat(case, status):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    verifier.current = False  # No physical acquisition exists to verify.
    NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    case.session.rows[NativeDispatch][0].state = status
    first = case.lifecycle.cancel(actor=case.loader.actor, request_id="request", idempotency_key="cancel")
    assert first.status == "cancelled"
    assert case.state.cleanup_complete
    assert case.request.state == "sealed"
    assert "verify" not in case.events
    second = case.lifecycle.cancel(actor=case.loader.actor, request_id="request", idempotency_key="cancel")
    assert second.status == "cancelled"
    assert case.lifecycle.reconcile() == 0
    assert "verify" not in case.events
    # The logical cancellation decision itself is serialized App before request.
    first_app = case.events.index("app")
    assert case.events[first_app + 1] == "request"


@pytest.mark.parametrize(
    "fault", ["missing_dispatch", "prior_lease", "foreign_dispatch", "missing_context", "effect_claim"]
)
def test_preclaim_cancel_refuses_uncertain_history_without_calling_physical_verifier(case, fault):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    if fault == "missing_dispatch":
        case.session.rows[NativeDispatch] = []
    elif fault == "prior_lease":
        case.session.rows[NativeDispatch][0].claim_expires_at = NOW
    elif fault == "foreign_dispatch":
        case.session.rows[NativeDispatch][0].tenant_id = "foreign"
    elif fault == "missing_context":
        case.session.rows[NativePayloadObject] = []
    else:
        case.session.rows[NativeEffectDispatchClaim] = [
            NativeEffectDispatchClaim(
                id="effect",
                request_id="request",
                tenant_id="tenant",
                invocation_id="root",
                operation_id="operation",
                attempt_id="attempt",
                claimed_at=NOW,
            )
        ]
    result = case.lifecycle.cancel(actor=case.loader.actor, request_id="request", idempotency_key="cancel")
    assert result.status == "cancelling"
    assert not case.state.cleanup_complete
    assert "verify" not in case.events


def test_code_cleanup_sql_check_precedes_consume_and_rechecks_inside_writer(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    class CodeCleanup:
        def validate_cleanup_rows(self, **kwargs):
            assert kwargs["session"] is case.session
            case.events.append("code_rows")

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events), code_cleanup=CodeCleanup())
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    case.events.clear()
    owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert [event for event in case.events if event in ("code_rows", "verify", "request")] == [
        "code_rows",
        "verify",
        "request",
        "code_rows",
    ]
    assert case.state.cleanup_complete
