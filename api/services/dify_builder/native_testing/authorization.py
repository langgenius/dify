"""Scoped approval and atomic append-only dispatch spends.

Every real transport attempt (including OAuth, redirects and retries) needs its
own persisted native cursor. A permit authorizes exactly one dispatch; uncertain
or failed attempts never refund quota and cannot be reissued under another key.
"""

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeEffectAttempt,
    NativeEffectGrant,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativePendingAction,
    NativeTestScope,
)
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectDecision,
    EffectIntent,
    EffectReceipt,
    NativeTestContextRef,
    Outcome,
    PolicyStop,
    RecordedResult,
    operation_digest,
)
from services.dify_builder.native_testing.pending_intents import PendingDecisionGuard
from services.dify_builder.native_testing.repository import (
    BudgetReservation,
    NativeBinding,
    OwnedNativeTest,
    OwnedNativeTestLoader,
    utc_now,
)


def validate_binding(intent: EffectIntent, binding: NativeBinding) -> None:
    if canonical_digest(intent.model_dump(mode="json")) != binding.intent_digest or any(
        getattr(intent, field) != getattr(binding, field)
        for field in ("kind", "resource_ref", "implementation_revision", "account_ref", "capability_digest")
    ):
        raise BuilderExecutionPolicyError("native_binding_mismatch")
    if binding.destructive:
        raise BuilderExecutionPolicyError("destructive_effect_forbidden")


def task_grant_allowed(binding: NativeBinding, *, task_approved: bool) -> bool:
    return (
        task_approved
        and binding.kind in {"code", "file"}
        and binding.isolated
        and not binding.egress
        and not binding.new_data
        and not binding.destructive
    )


def _scope_digest(intent: EffectIntent, binding: NativeBinding) -> str:
    # Logical occurrence is excluded so an explicitly approved count can cover
    # repeated identical calls. All account/target/typed parameter/version scope remains.
    return canonical_digest(
        {
            "intent": intent.model_dump(mode="json", exclude={"key"}),
            "binding": binding.model_dump(mode="json", exclude={"intent_digest", "execution_id", "invocation_digest"}),
        }
    )


def _owner(owned: OwnedNativeTest) -> dict[str, str]:
    return {"tenant_id": owned.tenant_id, "request_id": owned.ref.request_id, "invocation_id": owned.ref.invocation_id}


def _owned_query(model, owned: OwnedNativeTest):
    return select(model).where(
        model.tenant_id == owned.tenant_id,
        model.request_id == owned.ref.request_id,
        model.invocation_id == owned.ref.invocation_id,
    )


class EffectAuthorizationService:
    def __init__(self, loader: OwnedNativeTestLoader, *, clock: Callable[[], datetime] = utc_now):
        self.loader = loader
        self.clock = clock

    def _binding(self, session: Session, owned: OwnedNativeTest, intent: EffectIntent) -> NativeBinding:
        if intent.key.invocation_id != owned.ref.invocation_id:
            raise BuilderExecutionPolicyError("native_binding_mismatch")
        raw = owned.bindings.get(operation_digest(intent.key))
        if raw is None:
            raise BuilderExecutionPolicyError("native_cursor_mismatch")
        try:
            frozen = NativeBinding.model_validate(raw)
            current = self.loader.resolver.resolve_binding(session=session, owned=owned, key=intent.key)
            current = NativeBinding.model_validate(current.model_dump(mode="json"))
        except (ValidationError, AttributeError, TypeError):
            raise BuilderExecutionPolicyError("native_binding_mismatch") from None
        if current != frozen:
            raise BuilderExecutionPolicyError("native_binding_drift")
        validate_binding(intent, current)
        return current

    def before_call(self, *, ref: NativeTestContextRef, intent: EffectIntent) -> EffectDecision:
        try:
            # Revalidate DTOs after in-process model_copy/model_construct boundaries.
            ref = NativeTestContextRef.model_validate(ref.model_dump(mode="json"))
            intent = EffectIntent.model_validate(intent.model_dump(mode="json"))
            self.loader.load(ref=ref)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                result = self._claim(session, owned, scope, intent)
            # The transaction committed before the permit crosses the I/O boundary.
            return result
        except BuilderExecutionPolicyError as error:
            return PolicyStop(reason_code=error.reason_code)
        except (ValidationError, AttributeError, TypeError):
            return PolicyStop(reason_code="invalid_native_effect")

    def _claim(
        self, session: Session, owned: OwnedNativeTest, scope: NativeTestScope, intent: EffectIntent
    ) -> EffectDecision:
        now = self.clock()
        operation = session.scalar(
            _owned_query(NativeEffectOperation, owned).where(
                NativeEffectOperation.operation_digest == operation_digest(intent.key)
            )
        )
        digest = canonical_digest(intent.model_dump(mode="json"))
        if operation is not None and operation.intent_digest != digest:
            return PolicyStop(reason_code="native_intent_conflict")
        binding = self._binding(session, owned, intent)
        scoped = _scope_digest(intent, binding)
        if operation is not None and operation.state != "pending":
            return self._existing(session, owned, operation, now)
        if now >= scope.expires_at:
            return PolicyStop(reason_code="native_scope_expired")
        if operation is None:
            operation = NativeEffectOperation(
                **_owner(owned),
                operation_digest=operation_digest(intent.key),
                intent_digest=digest,
                scope_digest=scoped,
                state="pending",
                result_ref=None,
            )
            session.add(operation)
            session.flush()
        grant = session.scalar(
            select(NativeEffectGrant).where(
                NativeEffectGrant.tenant_id == owned.tenant_id,
                NativeEffectGrant.request_id == owned.ref.request_id,
                NativeEffectGrant.scope_digest == scoped,
            )
        )
        if grant is None and task_grant_allowed(binding, task_approved=owned.task_approved):
            grant = NativeEffectGrant(
                tenant_id=owned.tenant_id,
                request_id=owned.ref.request_id,
                actor_id=owned.actor_id,
                scope_digest=scoped,
                decision="approved",
                expires_at=scope.expires_at,
                max_calls=scope.max_calls,
                max_dispatches=scope.max_dispatches,
                max_cost_units=scope.max_cost_units,
                spent_calls=0,
                spent_dispatches=0,
                spent_cost_units=0,
            )
            session.add(grant)
            session.flush()
        if grant is not None and grant.decision == "denied":
            operation.state = "denied"
            return PolicyStop(reason_code="effect_denied")
        if grant is None or grant.expires_at <= now or not self._fits(grant, binding.cost_units):
            return self._pending(session, owned, operation)
        if not self._fits(scope, binding.cost_units):
            return PolicyStop(reason_code="native_budget_exhausted")
        spent = dict(scope.budget_spent)
        for name, amount in binding.budget.items():
            limit, profile, previous = scope.budget_limits.get(name), scope.profile.get(name), spent.get(name, 0)
            if (
                type(limit) is not int
                or type(profile) is not int
                or type(previous) is not int
                or min(limit, profile, previous) < 0
                or amount > profile
                or previous + amount > limit
            ):
                return PolicyStop(reason_code="native_budget_exhausted")
            spent[name] = previous + amount
        for quota in (scope, grant):
            quota.spent_calls += 1
            quota.spent_dispatches += 1
            quota.spent_cost_units += binding.cost_units
        scope.budget_spent = spent
        permit_id = str(uuid4())
        attempt = NativeEffectAttempt(
            **_owner(owned),
            operation_id=operation.id,
            grant_id=grant.id,
            dispatch_index=1,
            permit_digest=canonical_digest(permit_id),
            expires_at=min(now + timedelta(minutes=5), grant.expires_at, scope.expires_at),
            cost_units=binding.cost_units,
            budget_reservation_ref=str(uuid4()),
            execution_id=binding.execution_id,
            invocation_digest=binding.invocation_digest,
            budget=dict(binding.budget),
            profile=dict(scope.profile),
        )
        session.add(attempt)
        operation.state = "claimed"
        session.flush()
        return DispatchPermit(
            permit_id=permit_id,
            attempt_id=attempt.id,
            operation_id=operation.id,
            expires_at=attempt.expires_at.isoformat(),
        )

    @staticmethod
    def _fits(quota, cost_units: int) -> bool:
        return (
            quota.spent_calls < quota.max_calls
            and quota.spent_dispatches < quota.max_dispatches
            and quota.spent_cost_units + cost_units <= quota.max_cost_units
        )

    def _existing(
        self, session: Session, owned: OwnedNativeTest, operation: NativeEffectOperation, now: datetime
    ) -> EffectDecision:
        if operation.state == "completed" and operation.result_ref is not None:
            return RecordedResult(operation_id=operation.id, result_ref=operation.result_ref)
        if operation.state == "claimed":
            attempt = session.scalar(
                _owned_query(NativeEffectAttempt, owned).where(NativeEffectAttempt.operation_id == operation.id)
            )
            if attempt is None:
                raise BuilderExecutionPolicyError("native_ledger_inconsistent")
            if attempt.expires_at > now:
                return PolicyStop(reason_code="dispatch_in_progress")
            self._append_outcome(session, owned, operation, attempt, "unknown", None)
            return PolicyStop(reason_code="outcome_unknown")
        return PolicyStop(
            reason_code={"unknown": "outcome_unknown", "denied": "effect_denied", "cancelled": "native_cancelled"}.get(
                operation.state, "effect_already_spent"
            )
        )

    @staticmethod
    def _pending(session: Session, owned: OwnedNativeTest, operation: NativeEffectOperation) -> ApprovalWait:
        pending = session.scalar(
            _owned_query(NativePendingAction, owned).where(
                NativePendingAction.operation_id == operation.id, NativePendingAction.generation == owned.generation
            )
        )
        if pending is None:
            pending = NativePendingAction(
                **_owner(owned),
                generation=owned.generation,
                category="approval",
                reference_digest=canonical_digest(operation.id),
                reference=operation.id,
                owner_ref=owned.app_id,
                owner_version=operation.scope_digest,
                operation_id=operation.id,
            )
            session.add(pending)
            session.flush()
        return ApprovalWait(pending_operation_id=pending.id)

    def decide(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        decision: Literal["approved", "denied"],
        max_calls: int,
        max_dispatches: int,
        max_cost_units: int,
        expires_at: datetime,
        pending_guard: PendingDecisionGuard | None = None,
    ) -> str:
        """Internal C04 command boundary; caller authenticates explicit user confirmation.

        Public API callers must supply pending_guard; existing trusted internal
        ledger callers omit it and retain their original command contract.
        Existing grants are immutable, including limits and expiry. Repeated
        decisions are idempotent; a retry cannot mint a new quota allowance.
        """
        self.loader.load(ref=ref)
        if decision not in {"approved", "denied"} or any(
            type(v) is not int or v < 0 or v > 2**63 - 1 for v in (max_calls, max_dispatches, max_cost_units)
        ):
            raise BuilderExecutionPolicyError("invalid_native_grant")
        with self.loader.locked(ref=ref) as (session, owned, scope):
            if expires_at.tzinfo is None or not self.clock() < expires_at <= scope.expires_at:
                raise BuilderExecutionPolicyError("invalid_native_grant")
            binding = self._binding(session, owned, intent)
            digest = _scope_digest(intent, binding)
            if pending_guard is not None:
                terms = pending_guard.terms
                if (max_calls, max_dispatches, max_cost_units, expires_at) != (
                    terms.max_calls,
                    terms.max_dispatches,
                    terms.max_cost_units,
                    datetime.fromisoformat(terms.expires_at),
                ):
                    raise BuilderExecutionPolicyError("native_pending_conflict")
                pending_guard.recheck(session=session, owned=owned, intent=intent, scope_digest=digest)
            grant = session.scalar(
                select(NativeEffectGrant).where(
                    NativeEffectGrant.tenant_id == owned.tenant_id,
                    NativeEffectGrant.request_id == ref.request_id,
                    NativeEffectGrant.scope_digest == digest,
                )
            )
            fields = {
                "decision": decision,
                "max_calls": max_calls,
                "max_dispatches": max_dispatches,
                "max_cost_units": max_cost_units,
                "expires_at": expires_at,
            }
            if grant is not None:
                if any(getattr(grant, name) != value for name, value in fields.items()):
                    raise BuilderExecutionPolicyError("native_grant_conflict")
                if pending_guard is not None:
                    pending_guard.save(session=session, request_id=ref.request_id)
                return grant.id
            grant = NativeEffectGrant(
                tenant_id=owned.tenant_id,
                request_id=ref.request_id,
                actor_id=owned.actor_id,
                scope_digest=digest,
                spent_calls=0,
                spent_dispatches=0,
                spent_cost_units=0,
                **fields,
            )
            session.add(grant)
            session.flush()
            if pending_guard is not None:
                pending_guard.save(session=session, request_id=ref.request_id)
            return grant.id

    def _permit_ref(self, permit: DispatchPermit) -> NativeTestContextRef:
        with self.loader.session_factory() as session:
            row = session.execute(
                select(NativeEffectAttempt, DifyBuilderExecutionRequest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeEffectAttempt.request_id)
                .where(
                    NativeEffectAttempt.id == permit.attempt_id,
                    NativeEffectAttempt.operation_id == permit.operation_id,
                    NativeEffectAttempt.permit_digest == canonical_digest(permit.permit_id),
                    NativeEffectAttempt.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                )
            ).one_or_none()
            if row is None:
                raise BuilderExecutionPolicyError("invalid_dispatch_permit")
            attempt, request = row
            if attempt.expires_at != datetime.fromisoformat(permit.expires_at):
                raise BuilderExecutionPolicyError("invalid_dispatch_permit")
            return NativeTestContextRef(
                request_id=request.id, invocation_id=attempt.invocation_id, context_digest=request.context_digest
            )

    def _attempt(self, session: Session, owned: OwnedNativeTest, permit: DispatchPermit) -> NativeEffectAttempt:
        attempt = session.scalar(
            _owned_query(NativeEffectAttempt, owned).where(
                NativeEffectAttempt.id == permit.attempt_id,
                NativeEffectAttempt.operation_id == permit.operation_id,
                NativeEffectAttempt.permit_digest == canonical_digest(permit.permit_id),
            )
        )
        if attempt is None:
            raise BuilderExecutionPolicyError("invalid_dispatch_permit")
        return attempt

    def record_outcome(self, *, permit: DispatchPermit, outcome: Outcome, result_ref: str | None) -> EffectReceipt:
        receipt = EffectReceipt(
            operation_id=permit.operation_id, attempt_id=permit.attempt_id, outcome=outcome, result_ref=result_ref
        )
        if outcome == "completed" and result_ref is None:
            raise BuilderExecutionPolicyError("completed_result_required")
        ref = self._permit_ref(permit)
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _):
            attempt = self._attempt(session, owned, permit)
            operation = session.scalar(
                _owned_query(NativeEffectOperation, owned).where(NativeEffectOperation.id == permit.operation_id)
            )
            if operation is None:
                raise BuilderExecutionPolicyError("invalid_dispatch_permit")
            existing = session.scalar(
                _owned_query(NativeEffectOutcome, owned).where(NativeEffectOutcome.attempt_id == attempt.id)
            )
            if existing is not None:
                if existing.outcome != outcome or existing.result_ref != result_ref:
                    raise BuilderExecutionPolicyError("outcome_conflict")
                return receipt
            self._append_outcome(session, owned, operation, attempt, outcome, result_ref)
        return receipt

    @staticmethod
    def _append_outcome(session, owned, operation, attempt, outcome, result_ref):
        session.add(
            NativeEffectOutcome(
                **_owner(owned),
                operation_id=operation.id,
                attempt_id=attempt.id,
                outcome=outcome,
                result_ref=result_ref,
            )
        )
        operation.state, operation.result_ref = outcome, result_ref

    def resolve_budget_reservation(
        self, *, permit: DispatchPermit, execution_id: str, invocation_digest: str
    ) -> BudgetReservation:
        ref = self._permit_ref(permit)
        self.loader.load(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, _):
            attempt = self._attempt(session, owned, permit)
            return self._reservation(session, owned, attempt, execution_id, invocation_digest)

    def resolve_budget_reference(
        self, *, ref: NativeTestContextRef, budget_reservation_ref: str, execution_id: str, invocation_digest: str
    ) -> BudgetReservation:
        """CS6 authenticated server bridge; a supplied reference is never authority."""
        self.loader.load(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, _):
            attempt = session.scalar(
                _owned_query(NativeEffectAttempt, owned).where(
                    NativeEffectAttempt.budget_reservation_ref == budget_reservation_ref
                )
            )
            if attempt is None:
                raise BuilderExecutionPolicyError("invalid_budget_reservation")
            return self._reservation(session, owned, attempt, execution_id, invocation_digest)

    def _reservation(self, session, owned, attempt, execution_id, invocation_digest) -> BudgetReservation:
        operation = session.scalar(
            _owned_query(NativeEffectOperation, owned).where(NativeEffectOperation.id == attempt.operation_id)
        )
        if (
            attempt.execution_id != execution_id
            or attempt.invocation_digest != invocation_digest
            or attempt.expires_at <= self.clock()
            or operation is None
            or operation.state != "claimed"
        ):
            raise BuilderExecutionPolicyError("invalid_budget_reservation")
        return BudgetReservation(
            budget_reservation_ref=attempt.budget_reservation_ref,
            execution_id=attempt.execution_id,
            invocation_digest=attempt.invocation_digest,
            expires_at=attempt.expires_at,
            limits=dict(attempt.budget),
            profile=dict(attempt.profile),
        )
