"""Unique child identity sharing the root ledger, quotas and cancellation scope."""

import json
from typing import Protocol
from uuid import uuid4

from sqlalchemy import select

from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestInvocation
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.execution_policy_service import check_execution_permission
from services.dify_builder.native_testing.contracts import NativeTestContextRef, OperationKey, operation_digest
from services.dify_builder.native_testing.private_reads import validate_invocation_workflow
from services.dify_builder.native_testing.repository import native_workflow_revision, utc_now
from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome, ResolvedNativeTestContext
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore, invocation_state, owner_query
from services.dify_builder.native_testing.transitions import (
    dispatch_readiness,
    has_unknown_descendant,
    quarantine_unknown,
)


class NativeChildResolver(Protocol):
    def resolve_child(
        self,
        *,
        parent: ResolvedNativeTestContext,
        ref: NativeTestContextRef,
        child_app_id: str,
        child_workflow_revision: str,
        inputs: dict,
    ) -> ResolvedNativeTestContext:
        """Read real child app/workflow ownership and permission; no child execution.

        Must resolve current graph, metadata and child revision for this tenant
        and actor. A client-provided graph or capability classification is invalid.
        """
        ...


class NativeChildInvocationService:
    def __init__(self, state_store: NativeExecutionStateStore, *, resolver: NativeChildResolver):
        if resolver is None:
            raise BuilderExecutionPolicyError("native_child_resolver_required")
        self.store, self.loader, self.resolver = state_store, state_store.loader, resolver

    def get_or_create(
        self,
        *,
        parent_ref: NativeTestContextRef,
        key: OperationKey,
        child_app_id: str,
        child_workflow_revision: str,
        input_digest: str,
        input_result_ref: str,
    ) -> NativeTestContextRef:
        if key.invocation_id != parent_ref.invocation_id:
            raise BuilderExecutionPolicyError("native_child_owner_mismatch")
        owned = self.loader.load(ref=parent_ref)
        occurrence = operation_digest(key)
        identity = canonical_digest(
            {
                "app": child_app_id,
                "revision": child_workflow_revision,
                "input_ref": input_result_ref,
                "input_digest": input_digest,
            }
        )
        with self.loader.session_factory() as session:
            existing = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.tenant_id == owned.tenant_id,
                    NativeInvocationState.request_id == parent_ref.request_id,
                    NativeInvocationState.parent_invocation_id == parent_ref.invocation_id,
                    NativeInvocationState.parent_operation_digest == occurrence,
                )
            )
            if existing is not None and existing.child_identity_digest != identity:
                raise BuilderExecutionPolicyError("native_child_conflict")
            replay = (
                existing is not None and existing.state in {"completed", "stopped"} and existing.outcome is not None
            )
            if not replay:
                dispatch_readiness(session, ref=parent_ref, tenant_id=owned.tenant_id, now=utc_now())
                if existing is not None:
                    dispatch_readiness(
                        session,
                        ref=parent_ref.model_copy(update={"invocation_id": existing.invocation_id}),
                        tenant_id=owned.tenant_id,
                        now=utc_now(),
                    )
            existing_ref = parent_ref.model_copy(update={"invocation_id": existing.invocation_id}) if existing else None
        # Existing lookup/replay retains the actual parent's current permission,
        # protected context revision and input authority, all outside the writer.
        parent = self.store.load_context(ref=parent_ref)
        inputs = self.store.load_result(ref=parent_ref, result_ref=input_result_ref)
        if not isinstance(inputs, dict) or canonical_digest(inputs) != input_digest:
            raise BuilderExecutionPolicyError("native_child_input_mismatch")
        if existing_ref is not None:
            return existing_ref
        child_ref = parent_ref.model_copy(update={"invocation_id": str(uuid4())})
        child = self.resolver.resolve_child(
            parent=parent,
            ref=child_ref,
            child_app_id=child_app_id,
            child_workflow_revision=child_workflow_revision,
            inputs=inputs,
        )
        child = ResolvedNativeTestContext.model_validate(child.model_dump(mode="json"))
        if (
            child.ref,
            child.tenant_id,
            child.actor_id,
            child.parent_invocation_id,
            child.call_depth,
            child.budget_ref,
            child.cancellation_ref,
            child.app_id,
            child.graph_revision,
            child.input_revision,
            child.execution_mode,
            child.root_native_run_id,
        ) != (
            child_ref,
            parent.tenant_id,
            parent.actor_id,
            parent_ref.invocation_id,
            parent.call_depth + 1,
            parent.budget_ref,
            parent.cancellation_ref,
            child_app_id,
            child_workflow_revision,
            input_digest,
            parent.execution_mode,
            parent.root_native_run_id,
        ) or canonical_digest(child.inputs) != input_digest:
            raise BuilderExecutionPolicyError("native_child_owner_mismatch")
        with self.loader.session_factory() as session:
            workflow = validate_invocation_workflow(
                session, tenant_id=parent.tenant_id, app_id=child.app_id, workflow_id=child.workflow_id
            )
            if native_workflow_revision(workflow) != child.graph_revision or json.loads(workflow.graph) != child.graph:
                raise BuilderExecutionPolicyError("native_revision_drift")
        check_execution_permission(self.loader.actor, child.app_id, self.loader.session_factory)
        receipt = self.store.prepare_object(
            ref=child_ref,
            tenant_id=parent.tenant_id,
            kind="context",
            logical_key="context",
            payload=child.model_dump(mode="json"),
        )
        with self.loader.locked(ref=parent_ref) as (session, owned, _):
            dispatch_readiness(session, ref=parent_ref, tenant_id=owned.tenant_id, now=utc_now())
            state = invocation_state(session, parent_ref, owned.tenant_id)
            if state.generation != parent.generation or state.state != "running":
                raise BuilderExecutionPolicyError("native_generation_conflict")
            existing = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.tenant_id == parent.tenant_id,
                    NativeInvocationState.request_id == parent_ref.request_id,
                    NativeInvocationState.parent_invocation_id == parent_ref.invocation_id,
                    NativeInvocationState.parent_operation_digest == occurrence,
                )
            )
            if existing is not None:
                if existing.child_identity_digest != identity:
                    raise BuilderExecutionPolicyError("native_child_conflict")
                if existing.state not in {"completed", "stopped"} or existing.outcome is None:
                    dispatch_readiness(
                        session,
                        ref=parent_ref.model_copy(update={"invocation_id": existing.invocation_id}),
                        tenant_id=owned.tenant_id,
                        now=utc_now(),
                    )
                return parent_ref.model_copy(update={"invocation_id": existing.invocation_id})
            obj = self.store.acknowledge_object(session, receipt)
            session.add(
                NativeTestInvocation(
                    tenant_id=owned.tenant_id,
                    request_id=parent_ref.request_id,
                    invocation_id=child_ref.invocation_id,
                    active=True,
                    bindings={},
                )
            )
            session.add(
                NativeInvocationState(
                    tenant_id=owned.tenant_id,
                    request_id=parent_ref.request_id,
                    invocation_id=child_ref.invocation_id,
                    context_object_id=obj.id,
                    app_id=child.app_id,
                    workflow_id=child.workflow_id,
                    parent_invocation_id=parent_ref.invocation_id,
                    parent_operation_digest=occurrence,
                    child_identity_digest=identity,
                    generation=parent.generation,
                    state="running",
                    checkpoint_id=None,
                    pending_ids=[],
                    wait_reason=None,
                    outcome=None,
                    resolution=[],
                    cancellation_key=None,
                )
            )
        return child_ref

    def get_outcome(self, *, child_ref: NativeTestContextRef) -> NativeWorkflowOutcome | None:
        """Replay the same child's durable outcome and protected result reference."""
        context = self.store.load_recovery_context(ref=child_ref)
        if context.parent_invocation_id is None:
            raise BuilderExecutionPolicyError("native_child_owner_mismatch")
        with self.loader.session_factory() as session:
            state = invocation_state(session, child_ref, context.tenant_id)
            raw = state.outcome
        if raw is None:
            return None
        outcome = NativeWorkflowOutcome.model_validate(raw)
        if outcome.ref != child_ref or outcome.native_run_id != context.native_run_id:
            raise BuilderExecutionPolicyError("native_child_outcome_conflict")
        return outcome

    def complete(self, *, child_ref: NativeTestContextRef, outcome: NativeWorkflowOutcome) -> None:
        outcome = NativeWorkflowOutcome.model_validate(outcome.model_dump(mode="json"))
        context = self.store.load_recovery_context(ref=child_ref)
        if outcome.ref != child_ref or outcome.native_run_id != context.native_run_id:
            raise BuilderExecutionPolicyError("native_child_owner_mismatch")
        if outcome.status == "waiting":
            from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService

            context = self.store.load_context(ref=child_ref)
            NativeTestLifecycleService(self.loader, state_store=self.store).pause(
                ref=child_ref,
                checkpoint=outcome.checkpoint_ref,
                pending_operation_ids=outcome.pending_operation_ids,
                expected_generation=context.generation,
            )
            return
        if outcome.output_result_ref is not None:
            self.store.load_result(ref=child_ref, result_ref=outcome.output_result_ref)
        with self.loader.locked(ref=child_ref, settlement=True) as (session, owned, scope):
            state = invocation_state(session, child_ref, owned.tenant_id)
            if state.parent_invocation_id is None:
                raise BuilderExecutionPolicyError("native_child_owner_mismatch")
            raw = outcome.model_dump(mode="json")
            if state.outcome is not None:
                if state.outcome != raw:
                    raise BuilderExecutionPolicyError("native_child_outcome_conflict")
                return
            if outcome.status == "unknown":
                quarantine_unknown(session, ref=child_ref, tenant_id=owned.tenant_id, outcome=raw)
                return
            state.outcome, state.state = raw, outcome.status
            invocation = session.scalar(owner_query(NativeTestInvocation, child_ref, owned.tenant_id))
            invocation.active = False
            parent_ref = child_ref.model_copy(update={"invocation_id": state.parent_invocation_id})
            parent = invocation_state(session, parent_ref, owned.tenant_id)
            # A still-running parent observes the durable child outcome itself.
            # Only a checkpointed parent is eligible for another native launch.
            if (
                scope.cancelled
                or parent.state != "waiting"
                or parent.checkpoint_id is None
                or has_unknown_descendant(session, parent_ref, owned.tenant_id)
            ):
                return
            from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService

            parent_owned, _ = self.loader._load(session, ref=parent_ref, lock=False)
            try:
                resolutions = NativeTestLifecycleService(self.loader, state_store=self.store)._resolve_pending(
                    session, parent_owned, parent
                )
            except BuilderExecutionPolicyError as error:
                if error.reason_code in {"native_pending_unresolved", "native_pending_resolver_required"}:
                    # Config/form completion needs its qualified C04 owner.
                    # Child evidence alone cannot authenticate a parent resume.
                    return
                raise
            scope.generation += 1
            parent.generation, parent.state = scope.generation, "queued"
            parent.resolution = [resolution.model_dump(mode="json") for resolution in resolutions]
            session.add(
                NativeDispatch(
                    tenant_id=owned.tenant_id,
                    request_id=child_ref.request_id,
                    invocation_id=parent_ref.invocation_id,
                    generation=scope.generation,
                    idempotency_digest=canonical_digest({"child_complete": child_ref.invocation_id}),
                    state="queued",
                    checkpoint_id=parent.checkpoint_id,
                    claim_expires_at=None,
                )
            )
