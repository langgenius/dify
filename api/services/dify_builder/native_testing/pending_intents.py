"""Protected intent reader and bounded decision recheck; never a payload registry.

The reader runs current root/child permission checks and encrypted storage reads
before the decision transaction. The guard rechecks every SQL identity while
holding the existing request lock, so stale private reads confer no authority.
"""

from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeEffectOperation,
    NativeInvocationState,
    NativePendingAction,
    NativeTestScope,
)
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, Digest, canonical_digest
from services.dify_builder.native_testing.approval_contracts import NativeApprovalTerms
from services.dify_builder.native_testing.contracts import (
    ID,
    CheckpointRef,
    Counter,
    EffectIntent,
    FrozenDTO,
    NativeTestContextRef,
    operation_digest,
)
from services.dify_builder.native_testing.private_reads import validate_invocation_workflow
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import (
    OwnedNativeTest,
    OwnedNativeTestLoader,
    native_workflow_revision,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore


class ResolvedPendingIntent(FrozenDTO):
    ref: NativeTestContextRef
    generation: Counter
    checkpoint: CheckpointRef
    intent: EffectIntent


class PendingIntentPort(Protocol):
    def load(self, *, actor: Actor, request_id: str, pending_operation_id: str) -> ResolvedPendingIntent: ...


def validate_pending_snapshot(
    *,
    resolved: ResolvedPendingIntent,
    tenant_id: str,
    app_id: str,
    pending: NativePendingAction,
    operation: NativeEffectOperation,
    state: NativeInvocationState,
    continuation: NativeContinuation,
    scope_digest: str,
    expected_version: int,
) -> None:
    """Local comparisons only. Called again under the authorization owner's lock."""
    owner = (tenant_id, resolved.ref.request_id, resolved.ref.invocation_id)
    if any(
        row is None or (row.tenant_id, row.request_id, row.invocation_id) != owner
        for row in (pending, operation, state, continuation)
    ):
        raise BuilderExecutionPolicyError("native_pending_conflict")
    if (
        pending.category != "approval"
        or pending.owner_ref != app_id
        or pending.operation_id != operation.id
        or pending.reference != operation.id
        or pending.reference_digest != canonical_digest(operation.id)
        or pending.owner_version != scope_digest
        or operation.scope_digest != scope_digest
        or operation.operation_digest != operation_digest(resolved.intent.key)
        or operation.intent_digest != canonical_digest(resolved.intent.model_dump(mode="json"))
        or resolved.intent.key.invocation_id != resolved.ref.invocation_id
        or operation.state != "pending"
        or state.state != "waiting"
        or pending.id not in state.pending_ids
        or expected_version != resolved.generation + 1
        or any(row.generation != resolved.generation for row in (pending, state, continuation))
        or state.checkpoint_id != resolved.checkpoint.checkpoint_id
        or continuation.checkpoint_id != resolved.checkpoint.checkpoint_id
        or continuation.payload_digest != resolved.checkpoint.payload_digest
    ):
        raise BuilderExecutionPolicyError("native_pending_conflict")


class ProtectedPendingIntentReader:
    def __init__(self, *, loader: OwnedNativeTestLoader, state_store: NativeExecutionStateStore):
        self.loader, self.store = loader, state_store

    def load(self, *, actor: Actor, request_id: str, pending_operation_id: str) -> ResolvedPendingIntent:
        if actor != self.loader.actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        with self.loader.session_factory() as session:
            request = session.scalar(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.id == request_id,
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                )
            )
            pending = session.scalar(
                select(NativePendingAction).where(
                    NativePendingAction.id == pending_operation_id,
                    NativePendingAction.request_id == request_id,
                    NativePendingAction.tenant_id == actor.tenant_id,
                )
            )
            if request is None or pending is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            if pending.category != "approval":
                raise BuilderExecutionPolicyError("native_pending_requires_resolution")
            ref = NativeTestContextRef(
                request_id=request_id, invocation_id=pending.invocation_id, context_digest=request.context_digest
            )
            state = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.tenant_id == actor.tenant_id,
                    NativeInvocationState.request_id == request_id,
                    NativeInvocationState.invocation_id == ref.invocation_id,
                )
            )
            continuation = session.scalar(
                select(NativeContinuation).where(
                    NativeContinuation.tenant_id == actor.tenant_id,
                    NativeContinuation.request_id == request_id,
                    NativeContinuation.invocation_id == ref.invocation_id,
                    NativeContinuation.generation == pending.generation,
                )
            )
            operation = session.scalar(
                select(NativeEffectOperation).where(
                    NativeEffectOperation.id == pending.operation_id,
                    NativeEffectOperation.tenant_id == actor.tenant_id,
                    NativeEffectOperation.request_id == request_id,
                    NativeEffectOperation.invocation_id == ref.invocation_id,
                )
            )
            if state is None or continuation is None or operation is None:
                raise BuilderExecutionPolicyError("native_pending_unavailable")
            checkpoint = CheckpointRef(
                checkpoint_id=continuation.checkpoint_id, payload_digest=continuation.payload_digest
            )
            app_id = request.app_id
        # State owner validates actual child-app access before decrypting anything.
        payload = self.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        matches = [
            intent
            for journal in payload.node_journals
            for intent in journal.intents
            if operation_digest(intent.key) == operation.operation_digest
        ]
        if payload.generation != pending.generation or len(matches) != 1:
            raise BuilderExecutionPolicyError("native_pending_intent_unavailable")
        resolved = ResolvedPendingIntent(
            ref=ref, generation=payload.generation, checkpoint=checkpoint, intent=matches[0]
        )
        validate_pending_snapshot(
            resolved=resolved,
            tenant_id=actor.tenant_id,
            app_id=app_id,
            pending=pending,
            operation=operation,
            state=state,
            continuation=continuation,
            scope_digest=pending.owner_version,
            expected_version=pending.generation + 1,
        )
        return resolved

    def load_terms(self, *, resolved: ResolvedPendingIntent) -> NativeApprovalTerms:
        context = self.store.load_context(ref=resolved.ref)
        if context.generation != resolved.generation:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        # Reuses current private-read owner, including actual child permission.
        payload = self.store.read_checkpoint(ref=resolved.ref, checkpoint=resolved.checkpoint)
        if payload.generation != resolved.generation:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        if not any(intent == resolved.intent for journal in payload.node_journals for intent in journal.intents):
            raise BuilderExecutionPolicyError("native_pending_conflict")
        matches = [proposal.terms for proposal in payload.approval_proposals if proposal.key == resolved.intent.key]
        if len(matches) != 1:
            raise BuilderExecutionPolicyError("native_approval_proposal_unavailable")
        return matches[0]


class PendingDecisionGuard(FrozenDTO):
    """Server-built compare-and-save command, mandatory for the public API."""

    resolved: ResolvedPendingIntent
    pending_operation_id: ID
    expected_version: Counter
    scope_digest: Digest
    idempotency_digest: Digest
    body_digest: Digest
    receipt: NativeTestPublicReceipt
    terms: NativeApprovalTerms
    invocation_app_id: ID
    invocation_workflow_id: ID
    invocation_revision: Digest

    def recheck(self, *, session: Session, owned: OwnedNativeTest, intent: EffectIntent, scope_digest: str) -> None:
        if owned.ref != self.resolved.ref or intent != self.resolved.intent:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        pending = session.scalar(select(NativePendingAction).where(NativePendingAction.id == self.pending_operation_id))
        operation = (
            session.scalar(select(NativeEffectOperation).where(NativeEffectOperation.id == pending.operation_id))
            if pending is not None
            else None
        )
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.tenant_id == owned.tenant_id,
                NativeInvocationState.request_id == owned.ref.request_id,
                NativeInvocationState.invocation_id == owned.ref.invocation_id,
            )
        )
        continuation = session.scalar(
            select(NativeContinuation).where(
                NativeContinuation.tenant_id == owned.tenant_id,
                NativeContinuation.request_id == owned.ref.request_id,
                NativeContinuation.invocation_id == owned.ref.invocation_id,
                NativeContinuation.generation == self.resolved.generation,
            )
        )
        if scope_digest != self.scope_digest:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        if pending is None or operation is None or state is None or continuation is None:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        if (state.app_id, state.workflow_id) != (self.invocation_app_id, self.invocation_workflow_id):
            raise BuilderExecutionPolicyError("native_pending_conflict")
        workflow = validate_invocation_workflow(
            session, tenant_id=owned.tenant_id, app_id=self.invocation_app_id, workflow_id=self.invocation_workflow_id
        )
        if native_workflow_revision(workflow) != self.invocation_revision:
            raise BuilderExecutionPolicyError("native_revision_drift")
        validate_pending_snapshot(
            resolved=self.resolved,
            tenant_id=owned.tenant_id,
            app_id=owned.app_id,
            pending=pending,
            operation=operation,
            state=state,
            continuation=continuation,
            scope_digest=self.scope_digest,
            expected_version=self.expected_version,
        )
        scope = session.get(NativeTestScope, owned.ref.request_id)
        if (
            scope is None
            or scope.cancelled
            or state.generation != self.resolved.generation
            or (scope.tenant_id, scope.request_id) != (owned.tenant_id, owned.ref.request_id)
            or self.terms.max_calls > scope.max_calls
            or self.terms.max_dispatches > scope.max_dispatches
            or self.terms.max_cost_units > scope.max_cost_units
            or datetime.fromisoformat(self.terms.expires_at) > scope.expires_at
        ):
            raise BuilderExecutionPolicyError("native_pending_conflict")
        request = session.get(DifyBuilderExecutionRequest, owned.ref.request_id)
        if request is None:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        for record in request.observations:
            if (
                record.get("native_command_key") == self.idempotency_digest
                and record.get("body_digest") != self.body_digest
            ):
                raise BuilderExecutionPolicyError("native_idempotency_conflict")

    def save(self, *, session: Session, request_id: str) -> NativeTestPublicReceipt:
        """Return the canonical receipt while the decision owner holds its lock."""
        request = session.get(DifyBuilderExecutionRequest, request_id)
        if request is None:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        for record in request.observations:
            if record.get("native_command_key") == self.idempotency_digest:
                if record.get("body_digest") != self.body_digest:
                    raise BuilderExecutionPolicyError("native_idempotency_conflict")
                return NativeTestPublicReceipt.model_validate(record["receipt"])
        if len(request.observations) >= 4096:
            raise BuilderExecutionPolicyError("native_command_limit")
        request.observations = [
            *request.observations,
            {
                "native_command_key": self.idempotency_digest,
                "body_digest": self.body_digest,
                "receipt": self.receipt.model_dump(mode="json"),
            },
        ]
        return self.receipt
