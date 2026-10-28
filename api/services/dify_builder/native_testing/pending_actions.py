"""Configuration/form waits preserve native ownership without inventing effects."""

from sqlalchemy import select

from models.dify_builder_native_tests import NativePendingAction
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import ApprovalWait, NativeTestContextRef
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, PendingOwner, utc_now
from services.dify_builder.native_testing.state_store import invocation_state
from services.dify_builder.native_testing.transitions import dispatch_readiness


class NativePendingActionService:
    def __init__(self, loader: OwnedNativeTestLoader):
        self.loader = loader

    def configuration(
        self, *, ref: NativeTestContextRef, requirements_ref: str, expected_generation: int
    ) -> ApprovalWait:
        return self._wait(ref, "configuration", requirements_ref, expected_generation)

    def interaction(self, *, ref: NativeTestContextRef, native_form_ref: str, expected_generation: int) -> ApprovalWait:
        return self._wait(ref, "interaction", native_form_ref, expected_generation)

    def _wait(self, ref, category, reference, generation):
        self.loader.load(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, _):
            state = invocation_state(session, ref, owned.tenant_id)
            if type(generation) is not int or generation != state.generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            fence = dispatch_readiness(session, ref=ref, tenant_id=owned.tenant_id, now=utc_now(), coalesce_self=True)
            owner = self.loader.resolver.resolve_pending(
                session=session, owned=owned, category=category, reference=reference
            )
            owner = PendingOwner.model_validate(owner.model_dump(mode="json"))
            if owner.category != category or owner.reference != reference:
                raise BuilderExecutionPolicyError("pending_owner_mismatch")
            if fence is not None:
                return ApprovalWait(pending_operation_id=fence.id, wait_reason=fence.category)
            digest = canonical_digest({"reference": reference, "owner": owner.owner_ref, "version": owner.version})
            pending = session.scalar(
                select(NativePendingAction).where(
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == ref.request_id,
                    NativePendingAction.invocation_id == ref.invocation_id,
                    NativePendingAction.generation == generation,
                    NativePendingAction.category == category,
                    NativePendingAction.reference_digest == digest,
                )
            )
            if pending is None:
                pending = NativePendingAction(
                    tenant_id=owned.tenant_id,
                    request_id=ref.request_id,
                    invocation_id=ref.invocation_id,
                    generation=generation,
                    category=category,
                    reference_digest=digest,
                    reference=reference,
                    owner_ref=owner.owner_ref,
                    owner_version=owner.version,
                    operation_id=None,
                )
                session.add(pending)
                session.flush()
            result = ApprovalWait(pending_operation_id=pending.id, wait_reason=category)
        return result
