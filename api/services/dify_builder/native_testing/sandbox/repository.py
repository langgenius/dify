"""One-shot Code physical evidence under the existing request ownership lock.

No remote I/O, payload storage, recovery, capacity release or production factory.
The local transaction seam delegates loading to OwnedNativeTestLoader._load after
setting PostgreSQL lock/statement timeouts. Pool checkout and commit response
are not covered by those per-statement limits. Any uncertain return refuses I/O.
"""

from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import datetime
from math import isfinite
from time import monotonic
from typing import Never, Protocol

from models.dify_builder_native_code import NativeCodePhysicalOperation
from models.dify_builder_native_tests import (
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeInvocationState,
    NativeTestScope,
)
from pydantic import TypeAdapter
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from services.dify_builder.execution_contracts import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from services.dify_builder.native_testing.authorization import (
    EffectAuthorizationService,
)
from services.dify_builder.native_testing.contracts import (
    Counter,
    DispatchPermit,
    EffectIntent,
    NativeTestContextRef,
    OperationKey,
)
from services.dify_builder.native_testing.repository import (
    OwnedNativeTest,
    OwnedNativeTestLoader,
    utc_now,
)
from services.dify_builder.native_testing.sandbox.contracts import (
    CodeAcquisitionOwner,
    CodeAcquisitionRef,
    CodePhysicalRef,
    CodeScopeSpec,
    JobID,
    UUIDString,
)

_MUTABLE = frozenset(
    {
        "scope_create_acked",
        "job_reserved",
        "job_id",
        "input_may_have_been_sent",
        "observed_output_offset",
        "ambiguous",
        "destroyed_at",
    }
)


def _refuse() -> Never:
    raise BuilderExecutionPolicyError("native_code_physical_conflict")


def _validate(model, value):
    return model.model_validate(value.model_dump(mode="python"), strict=True)


class CodeIdentity(Protocol):
    @property
    def operation_ref(self) -> str: ...
    @property
    def scope_id(self) -> str: ...
    @property
    def generation(self) -> int: ...


class NativeCodePhysicalRepository:
    def __init__(
        self, loader: OwnedNativeTestLoader, *, acquisition_owner: CodeAcquisitionOwner,
        transaction_deadline: Callable[[bool], float]
    ):
        if acquisition_owner is None or not callable(
            getattr(acquisition_owner, "check_current", None)
        ):
            raise BuilderExecutionPolicyError("native_code_acquisition_owner_required")
        if not callable(transaction_deadline):
            raise BuilderExecutionPolicyError("native_code_transaction_deadline_required")
        self._transaction_deadline = transaction_deadline
        self._deadline_caps: dict[bool, float] = {}
        self.loader = loader
        self.acquisition_owner = acquisition_owner
        self.authorization = EffectAuthorizationService(loader)
        # Delivery-local retained arguments only; never a durable retry recipe.
        self._bindings: dict[str, tuple[EffectIntent, DispatchPermit]] = {}
        self._attempted_scopes: set[str] = set()
        self._attempted_jobs: set[str] = set()
        self._attempted_inputs: set[str] = set()

    def _remaining_ms(self, *, settlement: bool) -> int:
        """Origin-worker local deadline; never extend an observed operation budget.

        True selects cleanup allowance, not the expired execution permit. Pool
        checkout, RBAC and commit still need their separate whole-wall gate.
        """
        deadline = self._transaction_deadline(settlement)
        if type(deadline) not in (int, float) or not isfinite(deadline):
            _refuse()
        deadline = min(deadline, self._deadline_caps.get(settlement, deadline))
        self._deadline_caps[settlement] = deadline
        remaining = min(1000, int((deadline - monotonic()) * 1000))
        if remaining <= 0:
            _refuse()
        return remaining

    @contextmanager
    def _transaction(
        self,
        *,
        ref: NativeTestContextRef,
        acquisition: CodeAcquisitionRef,
        settlement: bool,
        deadline: datetime | None = None,
    ) -> Generator[tuple[Session, OwnedNativeTest, NativeTestScope]]:
        ref = _validate(NativeTestContextRef, ref)
        acquisition = _validate(CodeAcquisitionRef, acquisition)
        if (ref.request_id, ref.context_digest) != (
            acquisition.ref.request_id,
            acquisition.ref.context_digest,
        ):
            _refuse()
        self.acquisition_owner.check_current(acquisition)
        self._remaining_ms(settlement=settlement)
        if not settlement:
            self.loader.load(ref=ref)  # RBAC/RPC closes before the writer.
            self.acquisition_owner.check_current(acquisition)
        self._remaining_ms(settlement=settlement)
        with self.loader.session_factory.begin() as session:
            if session.get_bind().dialect.name != "postgresql":
                raise BuilderExecutionPolicyError("native_code_postgresql_required")
            remaining = self._remaining_ms(settlement=settlement)
            if deadline is not None:
                remaining = min(remaining, int((deadline - utc_now()).total_seconds() * 1000))
            if remaining <= 0:
                _refuse()
            # Transaction-local settings precede the initial request FOR UPDATE.
            session.execute(
                text(
                    "SELECT set_config('lock_timeout', :limit, true), "
                    "set_config('statement_timeout', :limit, true)"
                ),
                {"limit": f"{remaining}ms"},
            )
            owned, scope = self.loader._load(
                session, ref=ref, lock=True, settlement=settlement
            )
            if not settlement:
                remaining = min(
                    remaining,
                    int((scope.expires_at - utc_now()).total_seconds() * 1000),
                )
                if remaining <= 0:
                    _refuse()
                session.execute(
                    text(
                        "SELECT set_config('lock_timeout', :limit, true), "
                        "set_config('statement_timeout', :limit, true)"
                    ),
                    {"limit": f"{remaining}ms"},
                )
            yield session, owned, scope
            if not settlement and utc_now() >= min(
                deadline or scope.expires_at, scope.expires_at
            ):
                _refuse()
            self.acquisition_owner.check_current(acquisition)
            self._remaining_ms(settlement=settlement)
        self.acquisition_owner.check_current(acquisition)

    def _chain(
        self,
        *,
        session: Session,
        owned: OwnedNativeTest,
        acquisition: CodeAcquisitionRef,
        operation_id: str,
        attempt_id: str,
        settlement: bool,
    ):
        operation = session.get(NativeEffectOperation, operation_id)
        attempt = session.get(NativeEffectAttempt, attempt_id)
        claim = session.scalar(
            select(NativeEffectDispatchClaim).where(
                NativeEffectDispatchClaim.operation_id == operation_id
            )
        )
        owner = (owned.tenant_id, owned.ref.request_id, owned.ref.invocation_id)
        if operation is None or attempt is None or claim is None:
            _refuse()
        for item in (operation, attempt, claim):
            if (
                item is None
                or (item.tenant_id, item.request_id, item.invocation_id) != owner
            ):
                _refuse()
        if attempt.operation_id != operation.id or (
            claim.operation_id,
            claim.attempt_id,
        ) != (operation.id, attempt.id):
            _refuse()
        dispatch = session.get(NativeDispatch, acquisition.root_dispatch_id)
        states = {
            state.invocation_id: state
            for state in session.scalars(
                select(NativeInvocationState).where(
                    NativeInvocationState.tenant_id == owned.tenant_id,
                    NativeInvocationState.request_id == owned.ref.request_id,
                )
            )
        }
        state = states.get(owned.ref.invocation_id)
        selected, visited = state, set()
        while selected is not None:
            if (
                selected.invocation_id in visited
                or (selected.tenant_id, selected.request_id) != owner[:2]
            ):
                _refuse()
            visited.add(selected.invocation_id)
            if selected.parent_invocation_id is None:
                break
            selected = states.get(selected.parent_invocation_id)
        if (
            state is None
            or selected is None
            or selected.invocation_id != acquisition.ref.invocation_id
            or dispatch is None
            or (
                dispatch.tenant_id,
                dispatch.request_id,
                dispatch.invocation_id,
                dispatch.generation,
            )
            != (*owner[:2], selected.invocation_id, acquisition.generation)
            or selected.generation != acquisition.generation
            or selected.cleanup_complete
            or dispatch.state
            not in (
                {"claimed", "unknown", "completed", "cancelled"}
                if settlement
                else {"claimed"}
            )
        ):
            _refuse()
        if not settlement and (
            dispatch.claim_expires_at is None or dispatch.claim_expires_at <= utc_now()
        ):
            _refuse()
        return operation, attempt, claim, state

    @staticmethod
    def _snapshot(
        row: NativeCodePhysicalOperation, ref: NativeTestContextRef
    ) -> CodePhysicalRef:
        data = {
            column.name: getattr(row, column.name) for column in row.__table__.columns
        }
        acquisition = CodeAcquisitionRef(
            ref=ref.model_copy(
                update={"invocation_id": data.pop("root_invocation_id")}
            ),
            root_dispatch_id=data.pop("host_dispatch_id"),
            generation=data.pop("host_generation"),
            acquisition_id=data.pop("host_acquisition_id"),
        )
        data.pop("request_id")
        data.pop("invocation_id")
        return CodePhysicalRef(ref=ref, acquisition=acquisition, **data)

    def reserve_scope(
        self,
        *,
        ref: NativeTestContextRef,
        key: OperationKey,
        permit: DispatchPermit,
        acquisition: CodeAcquisitionRef,
        spec: CodeScopeSpec,
        intent: EffectIntent,
        payload_digest: str,
        profile_digest: str,
        physical_deadline: datetime,
    ) -> CodePhysicalRef:
        ref = _validate(NativeTestContextRef, ref)
        key = _validate(OperationKey, key)
        permit = _validate(DispatchPermit, permit)
        intent = _validate(EffectIntent, intent)
        spec = _validate(CodeScopeSpec, spec)
        acquisition = _validate(CodeAcquisitionRef, acquisition)
        if (
            type(physical_deadline) is not datetime
            or physical_deadline.tzinfo is None
            or not 0 < (physical_deadline - utc_now()).total_seconds() <= 30
        ):
            _refuse()
        if (
            intent.key != key
            or key.invocation_id != ref.invocation_id
            or intent.kind != "code"
        ):
            _refuse()
        admitted = {
            "scope_spec_digest": canonical_digest(spec.native.model_dump(mode="json")),
            "environment_digest": spec.environment_digest,
            "base_snapshot_ref": spec.native.base_snapshot_ref,
            "base_snapshot_digest": spec.base_snapshot_digest,
            "payload_digest": payload_digest,
            "profile_digest": profile_digest,
        }
        if (
            not isinstance(intent.target, dict)
            or intent.target.get("code_physical") != admitted
        ):
            _refuse()
        if permit.operation_id in self._attempted_scopes:
            _refuse()
        # Even a rolled-back/uncertain writer cannot be retried by this delivery.
        # Committed row uniqueness remains the cross-instance durable fence.
        self._attempted_scopes.add(permit.operation_id)
        deadline = min(
            physical_deadline,
            spec.native.deadline,
            datetime.fromisoformat(permit.expires_at),
        )
        with self._transaction(
            ref=ref, acquisition=acquisition, settlement=False, deadline=deadline
        ) as (session, owned, scope):
            attempt = self.authorization._validate_dispatch_locked(
                session=session, owned=owned, scope=scope, intent=intent, permit=permit
            )
            operation, current_attempt, claim, state = self._chain(
                session=session,
                owned=owned,
                acquisition=acquisition,
                operation_id=permit.operation_id,
                attempt_id=permit.attempt_id,
                settlement=False,
            )
            if (
                current_attempt.id != attempt.id
                or spec.native.capability_digest != intent.capability_digest
                or key.occurrence_path != (attempt.execution_id,)
            ):
                _refuse()
            root = session.get(NativeDispatch, acquisition.root_dispatch_id)
            # _chain verified this exact root and its live claim. Logical intent
            # keeps its original ceiling; only this row owns the admitted wire spec.
            if root is None or root.claim_expires_at is None:
                _refuse()
            deadline = min(
                deadline, attempt.expires_at, scope.expires_at, root.claim_expires_at
            )
            if (
                not 0
                < (deadline - utc_now()).total_seconds()
                <= spec.native.limits.wall_seconds
            ):
                _refuse()
            wire = spec.native.model_copy(update={"deadline": deadline})
            admitted["scope_spec_digest"] = canonical_digest(
                wire.model_dump(mode="json")
            )
            TypeAdapter(UUIDString).validate_python(attempt.execution_id)
            existing = session.scalar(
                select(NativeCodePhysicalOperation.id).where(
                    or_(
                        NativeCodePhysicalOperation.operation_id == operation.id,
                        NativeCodePhysicalOperation.attempt_id == attempt.id,
                        NativeCodePhysicalOperation.effect_claim_id == claim.id,
                        NativeCodePhysicalOperation.scope_id == spec.native.scope_id,
                    )
                )
            )
            if existing is not None:
                _refuse()
            row = NativeCodePhysicalOperation(
                tenant_id=owned.tenant_id,
                actor_id=owned.actor_id,
                request_id=ref.request_id,
                invocation_id=ref.invocation_id,
                operation_id=operation.id,
                attempt_id=attempt.id,
                effect_claim_id=claim.id,
                host_dispatch_id=acquisition.root_dispatch_id,
                host_acquisition_id=acquisition.acquisition_id,
                root_invocation_id=acquisition.ref.invocation_id,
                host_generation=acquisition.generation,
                invocation_generation=state.generation,
                native_execution_id=attempt.execution_id,
                operation_digest=operation.operation_digest,
                intent_digest=operation.intent_digest,
                scope_id=spec.native.scope_id,
                scope_generation=spec.native.generation,
                scope_expires_at=deadline,
                **admitted,
            )
            result = self._snapshot(row, ref)
            session.add(row)
            session.flush()
            if utc_now() >= deadline:
                _refuse()
        self._bindings[result.id] = (intent, permit)
        return result

    def _physical_row(
        self, *, session, owned, scope, physical, settlement, intent=None, permit=None
    ):
        physical = _validate(CodePhysicalRef, physical)
        row = session.get(NativeCodePhysicalOperation, physical.id)
        if row is None:
            _refuse()
        actual = self._snapshot(row, owned.ref)
        for name in CodePhysicalRef.model_fields:
            if name not in _MUTABLE and getattr(actual, name) != getattr(
                physical, name
            ):
                _refuse()
        if (row.tenant_id, row.actor_id, row.request_id, row.invocation_id) != (
            owned.tenant_id,
            owned.actor_id,
            owned.ref.request_id,
            owned.ref.invocation_id,
        ):
            _refuse()
        operation, attempt, claim, state = self._chain(
            session=session,
            owned=owned,
            acquisition=physical.acquisition,
            operation_id=row.operation_id,
            attempt_id=row.attempt_id,
            settlement=settlement,
        )
        if (
            claim.id,
            state.generation,
            attempt.execution_id,
            operation.operation_digest,
            operation.intent_digest,
        ) != (
            row.effect_claim_id,
            row.invocation_generation,
            row.native_execution_id,
            row.operation_digest,
            row.intent_digest,
        ):
            _refuse()
        if not settlement:
            if intent is None or permit is None:
                binding = self._bindings.get(row.id)
                if binding is None:
                    _refuse()
                intent, permit = binding
            intent = _validate(EffectIntent, intent)
            permit = _validate(DispatchPermit, permit)
            if (permit.operation_id, permit.attempt_id) != (
                row.operation_id,
                row.attempt_id,
            ):
                _refuse()
            self.authorization._validate_dispatch_locked(
                session=session, owned=owned, scope=scope, intent=intent, permit=permit
            )
            if (
                row.scope_expires_at <= utc_now()
                or row.ambiguous
                or row.destroyed_at is not None
            ):
                _refuse()
        return row

    @contextmanager
    def _mutation(self, physical, *, settlement, intent=None, permit=None):
        physical = _validate(CodePhysicalRef, physical)
        deadline = None if settlement else physical.scope_expires_at
        if permit is not None and deadline is not None:
            deadline = min(deadline, datetime.fromisoformat(permit.expires_at))
        with self._transaction(
            ref=physical.ref,
            acquisition=physical.acquisition,
            settlement=settlement,
            deadline=deadline,
        ) as (session, owned, scope):
            row = self._physical_row(
                session=session,
                owned=owned,
                scope=scope,
                physical=physical,
                settlement=settlement,
                intent=intent,
                permit=permit,
            )
            if not settlement and (row.ambiguous or row.destroyed_at is not None):
                _refuse()
            yield row
            session.flush()

    def ack_scope(
        self, *, physical: CodePhysicalRef, scope_id: str, generation: int
    ) -> None:
        if type(generation) is not int or (scope_id, generation) != (
            physical.scope_id,
            physical.scope_generation,
        ):
            _refuse()
        with self._mutation(physical, settlement=False) as row:
            if row.scope_create_acked:
                _refuse()
            row.scope_create_acked = True

    def assert_claim(
        self, *, physical: CodePhysicalRef, intent: EffectIntent, permit: DispatchPermit
    ) -> None:
        with self._mutation(physical, settlement=False, intent=intent, permit=permit):
            pass

    def reserve_dispatch(
        self,
        *,
        physical: CodePhysicalRef,
        intent: EffectIntent,
        permit: DispatchPermit,
        payload_digest: str,
        profile_digest: str,
    ) -> None:
        if physical.id in self._attempted_jobs:
            _refuse()
        self._attempted_jobs.add(physical.id)
        with self._mutation(
            physical, settlement=False, intent=intent, permit=permit
        ) as row:
            if (
                not row.scope_create_acked
                or row.job_reserved
                or (payload_digest, profile_digest)
                != (row.payload_digest, row.profile_digest)
            ):
                _refuse()
            row.job_reserved = True

    def associate_job(
        self,
        *,
        physical: CodePhysicalRef,
        intent: EffectIntent,
        permit: DispatchPermit,
        job_id: str,
    ) -> None:
        job_id = TypeAdapter(JobID).validate_python(job_id)
        if physical.id in self._attempted_inputs:
            _refuse()
        self._attempted_inputs.add(physical.id)
        with self._mutation(
            physical, settlement=False, intent=intent, permit=permit
        ) as row:
            if (
                not row.scope_create_acked
                or not row.job_reserved
                or row.job_id is not None
            ):
                _refuse()
            row.job_id = job_id
            row.input_may_have_been_sent = True

    def mark_unknown(self, *, physical: CodePhysicalRef) -> None:
        with self._mutation(physical, settlement=True) as row:
            if row.destroyed_at is not None and not row.ambiguous:
                _refuse()
            row.ambiguous = True

    def observe_output(
        self,
        *,
        physical: CodePhysicalRef,
        job_id: str,
        expected_offset: int,
        next_offset: int,
    ) -> None:
        TypeAdapter(Counter).validate_python(expected_offset)
        TypeAdapter(Counter).validate_python(next_offset)
        with self._mutation(physical, settlement=True) as row:
            if (
                row.destroyed_at is not None
                or row.job_id != job_id
                or row.job_id is None
                or row.observed_output_offset != expected_offset
                or next_offset < expected_offset
            ):
                _refuse()
            row.observed_output_offset = next_offset

    def ack_destroyed(self, *, physical: CodePhysicalRef) -> None:
        """Record the trusted caller's ACK for this exact scope, never release capacity."""
        with self._mutation(physical, settlement=True) as row:
            if row.destroyed_at is None:
                row.destroyed_at = utc_now()

    def load_for_settlement(
        self,
        *,
        ref: NativeTestContextRef,
        operation_id: str,
        acquisition: CodeAcquisitionRef,
    ) -> CodePhysicalRef:
        operation_id = TypeAdapter(UUIDString).validate_python(operation_id)
        with self._transaction(ref=ref, acquisition=acquisition, settlement=True) as (
            session,
            owned,
            scope,
        ):
            row = session.scalar(
                select(NativeCodePhysicalOperation).where(
                    NativeCodePhysicalOperation.operation_id == operation_id,
                    NativeCodePhysicalOperation.tenant_id == owned.tenant_id,
                    NativeCodePhysicalOperation.request_id == ref.request_id,
                    NativeCodePhysicalOperation.invocation_id == ref.invocation_id,
                )
            )
            if row is None:
                _refuse()
            result = self._snapshot(row, ref)
            if result.acquisition != acquisition:
                _refuse()
            self._physical_row(
                session=session,
                owned=owned,
                scope=scope,
                physical=result,
                settlement=True,
            )
        return result

    def bind(
        self, *, physical: CodePhysicalRef, intent: EffectIntent, permit: DispatchPermit
    ):
        self.assert_claim(physical=physical, intent=intent, permit=permit)
        return BoundCodeDurableOwner(
            self,
            _validate(CodePhysicalRef, physical),
            _validate(EffectIntent, intent),
            _validate(DispatchPermit, permit),
        )


class BoundCodeDurableOwner:
    """Structural NativeCodeDurableOwner signatures; reviewed adapter stays independent."""

    def __init__(self, repository, physical, intent, permit):
        self.repository, self.physical, self.intent, self.permit = (
            repository,
            physical,
            intent,
            permit,
        )

    def _identity(self, identity: CodeIdentity) -> None:
        if type(identity.generation) is not int or (
            identity.operation_ref,
            identity.scope_id,
            identity.generation,
        ) != (
            self.physical.operation_id,
            self.physical.scope_id,
            self.physical.scope_generation,
        ):
            _refuse()

    def assert_claim(self, identity: CodeIdentity) -> None:
        self._identity(identity)
        self.repository.assert_claim(
            physical=self.physical, intent=self.intent, permit=self.permit
        )

    def reserve_dispatch(
        self, identity: CodeIdentity, *, payload_digest: str, profile_digest: str
    ) -> None:
        self._identity(identity)
        self.repository.reserve_dispatch(
            physical=self.physical,
            intent=self.intent,
            permit=self.permit,
            payload_digest=payload_digest,
            profile_digest=profile_digest,
        )

    def associate_job(self, identity: CodeIdentity, job_id: str) -> None:
        self._identity(identity)
        self.repository.associate_job(
            physical=self.physical,
            intent=self.intent,
            permit=self.permit,
            job_id=job_id,
        )

    def mark_unknown(self, identity: CodeIdentity) -> None:
        self._identity(identity)
        self.repository.mark_unknown(physical=self.physical)
