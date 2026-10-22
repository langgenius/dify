"""SQL-boundary doubles only; actual PostgreSQL/storage/races belong to normal CI."""

from collections import UserList
from collections.abc import Container, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass, is_dataclass
from datetime import UTC, datetime, timedelta
from typing import NoReturn, cast

import pytest
from sqlalchemy import Select, inspect
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.orm.state import InstanceState
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
from services.dify_builder.native_testing.host_capacity import NativeHostCleanupVerifier
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.repository import (
    OwnedNativeTest,
    OwnedNativeTestLoader,
    native_workflow_revision,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

NOW = datetime(2026, 10, 16, tzinfo=UTC)


class Rows[T](UserList[T]):
    def all(self) -> list[T]:
        return list(self)


class SQL:
    def __init__(self, rows: Mapping[type, Sequence[object]], events: list[str]) -> None:
        assert isinstance(rows, dict)
        self.rows = cast(dict[type, list[object]], rows)
        self.events = events
        self.occupancy: list[tuple[object, ...]] = []

    def scalars[T](self, query: Select[tuple[T]]) -> Rows[T]:
        description = query.column_descriptions[0]
        model = description["entity"]
        rows = list(self.rows.get(model, []))

        def matches(expression: object, row: object) -> bool:
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
            allowed_columns = {
                "payload_digest",
                "node_id",
                "generation",
                "attempt_id",
                "app_id",
                "version",
                "kind",
                "checkpoint_id",
                "source_generation",
                "invocation_id",
                "created_by",
                "parent_invocation_id",
                "cancellation_key",
                "active",
                "node_execution_id",
                "tenant_id",
                "account_id",
                "id",
                "request_id",
                "cleanup_complete",
                "cancelled",
                "claimed_at",
                "type",
                "logical_key",
                "context_digest",
                "value_digest",
                "actor_id",
                "created_by_role",
                "test_input_id",
                "session_id",
                "triggered_from",
                "context_object_id",
                "workflow_run_id",
                "claim_expires_at",
                "owner_account_id",
                "status",
                "operation_id",
                "workflow_id",
                "expires_at",
                "scope_digest",
                "state",
            }
            if field not in allowed_columns:
                raise AssertionError(f"unsupported SQL predicate column: {field}")
            if is_dataclass(row) and not isinstance(row, type):
                values = asdict(row)
                if field not in values:
                    return True
                actual = values[field]
            else:
                state = inspect(row, raiseerr=False)
                assert isinstance(state, InstanceState), "SQL fixture requires an ORM row or declared dataclass"
                if field not in state.attrs:
                    return True
                actual = state.attrs[field].value
            if expression.operator in {operators.eq, operators.is_}:
                return actual == value
            if expression.operator in {operators.ne, operators.is_not}:
                return actual != value
            if expression.operator is operators.in_op:
                assert isinstance(value, Container)
                return actual in value
            if expression.operator is operators.not_in_op:
                assert isinstance(value, Container)
                return actual not in value
            return True

        rows = [row for row in rows if all(matches(clause, row) for clause in query._where_criteria)]
        selected: list[object] = []
        for row in rows:
            name = description["name"]
            if name in {"invocation_id", "id", "request_id"}:
                state = inspect(row, raiseerr=False)
                if isinstance(state, InstanceState):
                    selected.append(state.attrs[name].value)
                else:
                    assert is_dataclass(row)
                    assert not isinstance(row, type)
                    selected.append(asdict(row)[name])
            else:
                selected.append(row)
        return Rows(cast(list[T], selected))

    def scalar[T](self, query: Select[tuple[T]]) -> T | None:
        if query.column_descriptions[0]["entity"] is App and query._for_update_arg is not None:
            self.events.append("app")
        rows = self.scalars(query)
        return rows[0] if rows else None

    def get[T](self, model: type[T], identity: object) -> T | None:
        for row in self.rows.get(model, []):
            state = inspect(row, raiseerr=False)
            assert isinstance(state, InstanceState)
            if state.attrs["id"].value == identity:
                return cast(T, row)
        return None

    def execute[T: tuple[object, ...]](self, _query: Select[T]) -> Rows[T]:
        return Rows(cast(list[T], self.occupancy))

    def add(self, row: object) -> None:
        self.rows.setdefault(type(row), []).append(row)

    def flush(self) -> None:
        for i, row in enumerate(self.rows.get(NativeDispatch, [])):
            assert isinstance(row, NativeDispatch)
            identity: object = row.id
            if identity is None:
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
def case(monkeypatch: pytest.MonkeyPatch) -> HostCapacityCase:
    # This suite owns App/request lock ordering through an explicit SQL double.
    # Real after-commit/rollback notifications are covered with SQLite in
    # test_native_live_stream; no SQLAlchemy Session events exist on this double.
    from services.dify_builder.native_testing import host_capacity

    monkeypatch.setattr(host_capacity, "native_observation_transaction", lambda factory, **_: factory.begin())
    events: list[str] = []
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
    rows: dict[type, Sequence[object]] = {
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

    class SessionFactory:
        @contextmanager
        def __call__(self) -> Generator[SQL]:
            yield session

        @contextmanager
        def begin(self) -> Generator[SQL]:
            events.append("begin")
            yield session
            events.append("commit")

    factory = cast(sessionmaker[Session], SessionFactory())

    def load(
        _session: object, *, ref: NativeTestContextRef, lock: bool = False, **_kwargs: object
    ) -> tuple[OwnedNativeTest, NativeTestScope]:
        assert ref == owned.ref
        if lock:
            events.append("request")
        return owned, scope

    @contextmanager
    def locked(**_kwargs: object) -> Generator[tuple[SQL, OwnedNativeTest, NativeTestScope]]:
        events.append("request")
        yield session, owned, scope
        events.append("commit")

    loader = OwnedNativeTestLoader(
        factory, actor=Actor(tenant_id="tenant", account_id="actor"), resolver=NativeHttpBindingResolver()
    )
    monkeypatch.setattr(loader, "_load", load)
    monkeypatch.setattr(loader, "load", lambda **_: owned)
    monkeypatch.setattr(loader, "locked", locked)

    def load_context(**_: object) -> ResolvedNativeTestContext:
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


def test_initial_generation_claim_uses_acknowledged_context_without_fake_checkpoint(case: HostCapacityCase) -> None:
    assert case.lifecycle.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.state.state == "running"
    assert not case.state.cleanup_complete
    assert cast(list[NativeContinuation], case.session.rows[NativeContinuation]) == []
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state == "claimed"
    assert not case.lifecycle.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")


@pytest.mark.parametrize(
    "method",
    ["prepare_dispatch_claim", "consume_dispatch_claim", "enqueue_initial_dispatch", "finalize_dispatch_locked"],
)
def test_transaction_local_c03_ports_are_explicit(method: str) -> None:
    assert callable(
        {
            "prepare_dispatch_claim": NativeTestLifecycleService.prepare_dispatch_claim,
            "consume_dispatch_claim": NativeTestLifecycleService.consume_dispatch_claim,
            "enqueue_initial_dispatch": NativeTestLifecycleService.enqueue_initial_dispatch,
            "finalize_dispatch_locked": NativeTestLifecycleService.finalize_dispatch_locked,
        }[method]
    )


def test_capacity_requires_actual_cleanup_verifier(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_verifier_required"):
        NativeHostCapacity(case.lifecycle, cleanup_verifier=cast(NativeHostCleanupVerifier, None))


class OnceVerifier:
    """Local lifetime double only; no thread/host physical qualification."""

    def __init__(self, events: list[str]) -> None:
        self.events, self.used, self.current = events, False, True

    def consume_cleanup(self, **_: object) -> None:
        self.events.append("verify")
        if self.used or not self.current:
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        self.used = True


def test_capacity_commits_initial_claim_after_private_io_and_app_then_request(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert case.events.index("private") < case.events.index("app") < case.events.index("request")
    assert case.events[-1] == "commit"
    assert not owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")


@pytest.mark.parametrize("status", ["claimed", "unknown", "completed"])
@pytest.mark.parametrize("request_status", ["running", "sealed"])
def test_unclean_existing_root_holds_capacity_across_sessions_and_terminal_status(
    case: HostCapacityCase, status: str, request_status: str
) -> None:
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
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state == "queued"


def test_cleanup_is_once_exact_current_lifetime_outside_writer_and_releases_only_after_proof(
    case: HostCapacityCase,
) -> None:
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


def test_composed_recovery_refuses_unclean_history_before_requeue(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    case.state.state = "unknown"
    assert case.owned.state == "running"
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        case.lifecycle._check_recovery_authority(case.session, case.ref, case.owned, case.scope)


def test_runtime_cancel_ids_do_not_release_composed_capacity_without_verifier(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    verifier.current = False
    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")

    class UnprovenCancelRuntime:
        def run_initial(self, **_kwargs: object) -> NoReturn:
            raise AssertionError("cancellation cannot start a native run")

        def resume(self, **_kwargs: object) -> NoReturn:
            raise AssertionError("cancellation cannot resume a native run")

        def recovery_evidence(self, **_kwargs: object) -> NoReturn:
            raise AssertionError("legacy cancellation receipt cannot establish recovery evidence")

        def cancel(self, *, refs: tuple[NativeTestContextRef, ...]) -> tuple[str]:
            assert refs
            return ("root",)

    case.lifecycle.runtime = UnprovenCancelRuntime()
    result = case.lifecycle.cancel(actor=case.loader.actor, request_id="request", idempotency_key="cancel")
    assert result.status == "cancelling"
    assert not case.state.cleanup_complete


def test_transaction_local_finalize_cannot_mutate_another_requests_claim(case: HostCapacityCase) -> None:
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
    cast(list[NativeDispatch], case.session.rows[NativeDispatch]).append(foreign)
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
            session=cast(Session, case.session),
            owned=case.owned,
            scope=case.scope,
            dispatch_id=foreign.id,
            generation=0,
            outcome=outcome,
        )
    assert foreign.state == "claimed"


def test_initial_enqueue_is_real_acknowledged_idempotent_outbox_not_a_checkpoint(case: HostCapacityCase) -> None:
    case.state.state = "running"
    case.session.rows[NativeDispatch] = []
    first = case.lifecycle.enqueue_initial_dispatch(ref=case.ref)
    assert first == case.lifecycle.enqueue_initial_dispatch(ref=case.ref)
    assert (first.ref, first.generation, case.state.state) == (case.ref, 0, "queued")
    assert len(cast(list[NativeDispatch], case.session.rows[NativeDispatch])) == 1
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state == "queued"
    assert cast(list[NativeContinuation], case.session.rows[NativeContinuation]) == []


@pytest.mark.parametrize("fault", ["wrong_initial_key", "already_clean", "unrepresented_form"])
def test_initial_claim_cannot_borrow_resume_or_prior_pending_authority(case: HostCapacityCase, fault: str) -> None:

    if fault == "wrong_initial_key":
        cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].idempotency_digest = "foreign"
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
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state == "queued"


@pytest.mark.parametrize("fault", ["missing_context", "changed_input", "changed_graph", "prior_effect"])
def test_initial_enqueue_rechecks_actual_context_and_sql_inputs_before_outbox(
    case: HostCapacityCase, fault: str
) -> None:
    case.state.state = "running"
    case.session.rows[NativeDispatch] = []
    if fault == "missing_context":
        case.session.rows[NativePayloadObject] = []
    elif fault == "changed_input":
        cast(list[DifyBuilderTestInput], case.session.rows[DifyBuilderTestInput])[0].inputs = {"x": "true"}
    elif fault == "changed_graph":
        cast(list[Workflow], case.session.rows[Workflow])[0].graph = '{"changed":true}'
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
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch]) == []


def test_boolean_cleanup_result_is_not_actual_trusted_none_success(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    class BooleanCleanupVerifier:
        def consume_cleanup(self, **_kwargs: object) -> bool:
            return True

    owner = NativeHostCapacity(
        case.lifecycle, cleanup_verifier=cast(NativeHostCleanupVerifier, BooleanCleanupVerifier())
    )
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    with pytest.raises(BuilderExecutionPolicyError, match="native_cleanup_unproven"):
        owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert not case.state.cleanup_complete


def test_an_old_capacity_lifetime_cannot_claim_same_sql_ids_again_after_cleanup(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    assert owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    owner.record_cleanup(ref=case.ref, generation=0, dispatch_id="dispatch")
    # Boundary-double simulation of a requeued row, not initial crash-recovery proof.
    cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state = "queued"
    case.state.state = "queued"
    assert not owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state == "queued"
    assert case.state.cleanup_complete


def test_transaction_local_wait_finalization_requires_actual_c03_ack(case: HostCapacityCase) -> None:
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome

    dispatch = cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0]
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
            session=cast(Session, case.session),
            owned=case.owned,
            scope=case.scope,
            dispatch_id=dispatch.id,
            generation=0,
            outcome=outcome,
        )
    assert dispatch.state == "claimed"


def test_transaction_local_outcome_cannot_attach_a_foreign_private_result(case: HostCapacityCase) -> None:
    from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome

    dispatch = cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0]
    dispatch.state = "claimed"
    case.state.state = "running"
    cast(list[NativePayloadObject], case.session.rows[NativePayloadObject]).append(
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
            session=cast(Session, case.session),
            owned=case.owned,
            scope=case.scope,
            dispatch_id=dispatch.id,
            generation=0,
            outcome=outcome,
        )
    assert dispatch.state == "claimed"


def test_delayed_claim_rechecks_lifetime_after_app_lock(
    case: HostCapacityCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    owner = NativeHostCapacity(case.lifecycle, cleanup_verifier=OnceVerifier(case.events))
    original = owner.locked

    @contextmanager
    def delayed(**kwargs: object) -> Generator[tuple[Session, OwnedNativeTest, NativeTestScope]]:
        # Model another call acquiring this exact lifetime while our prepared
        # delivery waits for App, followed by same-ID SQL requeue after cleanup.
        with original(ref=cast(NativeTestContextRef, kwargs["ref"])) as value:
            owner._used = True
            yield value

    monkeypatch.setattr(owner, "locked", delayed)
    assert not owner.claim_dispatch(ref=case.ref, generation=0, dispatch_id="dispatch")
    assert cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state == "queued"


@pytest.mark.parametrize("status", ["queued", "published"])
def test_never_acquired_cancel_finishes_and_reconcile_does_not_repeat(case: HostCapacityCase, status: str) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    verifier.current = False  # No physical acquisition exists to verify.
    NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].state = status
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
def test_preclaim_cancel_refuses_uncertain_history_without_calling_physical_verifier(
    case: HostCapacityCase, fault: str
) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    verifier = OnceVerifier(case.events)
    NativeHostCapacity(case.lifecycle, cleanup_verifier=verifier)
    if fault == "missing_dispatch":
        case.session.rows[NativeDispatch] = []
    elif fault == "prior_lease":
        cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].claim_expires_at = NOW
    elif fault == "foreign_dispatch":
        cast(list[NativeDispatch], case.session.rows[NativeDispatch])[0].tenant_id = "foreign"
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


def test_code_cleanup_sql_check_precedes_consume_and_rechecks_inside_writer(case: HostCapacityCase) -> None:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity

    class CodeCleanup:
        def validate_cleanup_rows(self, **kwargs: object) -> None:
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
