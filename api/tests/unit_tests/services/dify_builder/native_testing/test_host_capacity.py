"""SQL-boundary doubles only; actual PostgreSQL/storage/races belong to normal CI."""

from collections import UserList
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import BinaryExpression, BooleanClauseList

from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.model import App
from models.workflow import Workflow
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.repository import native_workflow_revision
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext

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
            field = getattr(expression.left, "key", None)
            if field is None or not hasattr(row, field):
                return True
            value = getattr(expression.right, "value", None)
            if not hasattr(expression.right, "value"):
                value = {"true": True, "false": False, "NULL": None}.get(str(expression.right))
            actual = getattr(row, field)
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
            getattr(r, description["name"]) if description["name"] in {"invocation_id", "id", "request_id"} else r
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


@pytest.fixture
def case():
    events = []
    workflow = SimpleNamespace(
        id="workflow",
        app_id="app",
        tenant_id="tenant",
        graph="{}",
        serialized_features="{}",
        _environment_variables="[]",
        _conversation_variables="[]",
    )
    revision = native_workflow_revision(workflow)
    context_body = {"policy_version": "builder-native-test-v1", "execution_revision": revision}
    ref = NativeTestContextRef(
        request_id="request", invocation_id="root", context_digest=canonical_digest(context_body)
    )
    state = SimpleNamespace(
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
    request = SimpleNamespace(
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
    scope = SimpleNamespace(
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
            SimpleNamespace(
                id="invocation", tenant_id="tenant", request_id="request", invocation_id="root", active=True
            )
        ],
        NativeDispatch: [
            SimpleNamespace(
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
            SimpleNamespace(
                id="context",
                tenant_id="tenant",
                request_id="request",
                invocation_id="root",
                kind="context",
                value_digest=canonical_digest(context.model_dump(mode="json")),
            )
        ],
        DifyBuilderTestInput: [SimpleNamespace(id="input", inputs={"x": True})],
        Workflow: [workflow],
        App: [SimpleNamespace(id="app", tenant_id="tenant", status="normal")],
    }
    session = SQL(rows, events)
    owned = SimpleNamespace(
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

    loader = SimpleNamespace(
        session_factory=factory,
        _load=load,
        load=lambda **_: owned,
        locked=locked,
        actor=SimpleNamespace(tenant_id="tenant", account_id="actor"),
    )

    def load_context(**_):
        events.append("private")
        return context

    lifecycle = NativeTestLifecycleService(
        loader, state_store=SimpleNamespace(load_context=load_context), clock=lambda: NOW
    )
    return SimpleNamespace(
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
    assert callable(getattr(NativeTestLifecycleService, method, None))


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
    q = SimpleNamespace(
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
    r = SimpleNamespace(
        request_id=q.id,
        tenant_id="tenant",
        invocation_id="other-root",
        app_id="app",
        workflow_id="workflow",
        parent_invocation_id=None,
        cleanup_complete=False,
        state="cancelled",
    )
    d = SimpleNamespace(state=status, request_id=q.id, tenant_id=q.tenant_id, invocation_id=r.invocation_id)
    b = SimpleNamespace(tenant_id="tenant", app_id="app", owner_account_id=q.actor_id)
    invocation = SimpleNamespace(request_id=q.id, tenant_id=q.tenant_id, invocation_id=r.invocation_id)
    scope = SimpleNamespace(request_id=q.id, tenant_id=q.tenant_id)
    case.session.occupancy = [(q, d, r, invocation, scope, b, SimpleNamespace(session_id=q.session_id))]
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
    case.owned.state = "running"
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        case.lifecycle._check_recovery_authority(case.session, case.ref, case.owned, case.scope)


def test_runtime_cancel_ids_do_not_release_composed_capacity_without_verifier(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    verifier.current = False
    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    case.lifecycle.runtime = SimpleNamespace(cancel=lambda **_: ("root",))
    result = case.lifecycle.cancel(actor=case.loader.actor, request_id="request", idempotency_key="cancel")
    assert result.status == "cancelling"
    assert not case.state.cleanup_complete


def test_transaction_local_finalize_cannot_mutate_another_requests_claim(case):
    from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome

    foreign = SimpleNamespace(
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
    from models.dify_builder_native_tests import NativePendingAction

    if fault == "wrong_initial_key":
        case.session.rows[NativeDispatch][0].idempotency_digest = "foreign"
    elif fault == "already_clean":
        case.state.cleanup_complete = True
    else:
        case.session.rows[NativePendingAction] = [
            SimpleNamespace(id="pending", request_id="request", tenant_id="tenant")
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
            SimpleNamespace(id="attempt", tenant_id="tenant", request_id="request")
        ]
    with pytest.raises(BuilderExecutionPolicyError):
        case.lifecycle.enqueue_initial_dispatch(ref=case.ref)
    assert case.session.rows[NativeDispatch] == []


def test_boolean_cleanup_result_is_not_actual_trusted_none_success(case):
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=SimpleNamespace(consume_cleanup=lambda **_: True))
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
    from services.dify_builder.native_testing.contracts import CheckpointRef
    from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome

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
    from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome

    dispatch = case.session.rows[NativeDispatch][0]
    dispatch.state = "claimed"
    case.state.state = "running"
    case.session.rows[NativePayloadObject].append(
        SimpleNamespace(
            id="foreign-result", tenant_id="tenant", request_id="foreign", invocation_id="root", kind="result"
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
        case.session.rows[NativeEffectDispatchClaim] = [SimpleNamespace(id="effect", request_id="request")]
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
        "code_rows", "verify", "request", "code_rows"]
    assert case.state.cleanup_complete
