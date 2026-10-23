"""Authenticated native test commands composed from the shared durable owners.

Only this owner admits a root SQL request. Runtime qualification, disclosure and
current resource metadata remain mandatory trusted collaborators; missing lanes
fail closed before admission. No default profile or ordinary executor is used.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol, cast
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession
from models.dify_builder_native_tests import (
    NativeEffectGrant,
    NativeInvocationState,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from models.enums import CreatorUserRole
from models.workflow import WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import (
    NativeTestContextRef,
    WaitReason,
)
from services.dify_builder.execution_policy_service import check_execution_permission, load_execution_owners
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile
from services.dify_builder.native_testing.input_binding import current_input_binding
from services.dify_builder.native_testing.lifecycle import (
    NativePendingResolutionPort,
    NativeRuntimePort,
    NativeTestLifecycleService,
)
from services.dify_builder.native_testing.pending_intents import (
    PendingDecisionGuard,
    ProtectedPendingIntentReader,
    ResolvedPendingIntent,
)
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt, PendingActionDisclosure
from services.dify_builder.native_testing.public_projection import decision_public_revision, project_pending_decision
from services.dify_builder.native_testing.repository import (
    NativeBindingResolver,
    OwnedNativeTestLoader,
    native_observation_transaction,
    utc_now,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore


class NativeLaunchPort(Protocol):
    """Qualified initial dispatch owner must durably deduplicate by request ID."""

    def launch(self, *, ref: NativeTestContextRef) -> None: ...


class NativeDisclosurePort(Protocol):
    """Capability owner supplies a safe, precise disclosure; never echo arbitrary input."""

    def describe(self, *, actor: Actor, resolved: ResolvedPendingIntent) -> PendingActionDisclosure: ...


@dataclass(frozen=True)
class NativeAdmissionDependencies:
    compiler: NativeAdmissionCompiler
    profile: NativeRuntimeProfile
    launch: NativeLaunchPort


class _UnavailableMetadata:
    def resolve_binding(self, **_kwargs):
        raise BuilderExecutionPolicyError("native_binding_unavailable")

    def resolve_pending(self, **_kwargs):
        raise BuilderExecutionPolicyError("native_pending_requires_resolution")


class NativeTestApiService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        actor: Actor,
        resolver: NativeBindingResolver | None,
        admission: NativeAdmissionDependencies | None,
        resolution: NativePendingResolutionPort | None,
        runtime: NativeRuntimePort | None,
        disclosure: NativeDisclosurePort | None,
    ):
        self.sessions, self.actor, self.admission, self.disclosure = session_factory, actor, admission, disclosure
        self.loader = OwnedNativeTestLoader(session_factory, actor=actor, resolver=resolver or _UnavailableMetadata())
        self.store = NativeExecutionStateStore(self.loader)
        self.pending = ProtectedPendingIntentReader(loader=self.loader, state_store=self.store)
        self.authorization = EffectAuthorizationService(self.loader)
        self.lifecycle = NativeTestLifecycleService(
            self.loader, state_store=self.store, resolution=resolution, runtime=runtime
        )

    def _actor(self, actor: Actor) -> None:
        if actor != self.actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")

    def _request(self, *, actor: Actor, session_id: str, request_id: str) -> DifyBuilderExecutionRequest:
        self._actor(actor)
        with self.sessions() as session:
            row = session.scalar(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.id == request_id,
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                )
            )
            if row is None or row.context.get("policy_version") != "builder-native-test-v1":
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            load_execution_owners(
                session,
                actor=actor,
                app_id=row.app_id,
                workflow_id=row.workflow_id,
                session_id=session_id,
                test_input_id=row.test_input_id,
            )
            if canonical_digest(row.context) != row.context_digest:
                raise BuilderExecutionPolicyError("native_context_mismatch")
            app_id = row.app_id
        check_execution_permission(actor, app_id, self.sessions)
        return row

    @staticmethod
    def _command(kind: str, body: dict, key: str) -> tuple[str, str]:
        return canonical_digest({"kind": kind, "key": key}), canonical_digest(body)

    @staticmethod
    def _saved(request: DifyBuilderExecutionRequest, key: str, body: str) -> NativeTestPublicReceipt | None:
        for record in request.observations:
            if record.get("native_command_key") == key:
                if record.get("body_digest") != body:
                    raise BuilderExecutionPolicyError("native_idempotency_conflict")
                return NativeTestPublicReceipt.model_validate(record["receipt"])
        return None

    def start(
        self,
        *,
        actor: Actor,
        session_id: str,
        test_input_id: str,
        expected_version: int,
        mode: Literal["native", "mock"],
        idempotency_key: str,
    ) -> NativeTestPublicReceipt:
        self._actor(actor)
        if self.admission is None:
            raise BuilderExecutionPolicyError("native_runtime_unavailable")
        key, body = self._command(
            "start",
            {"test_input_id": test_input_id, "expected_version": expected_version, "mode": mode},
            idempotency_key,
        )
        # The session lock serializes same-key admission without adding a second
        # idempotency table. SQL observations are bounded and never contain intent.
        with self.sessions() as session:
            builder = session.get(DifyBuilderSession, session_id)
            if builder is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            load_execution_owners(
                session, actor=actor, app_id=builder.app_id, session_id=session_id, test_input_id=test_input_id
            )
            existing = list(
                session.scalars(
                    select(DifyBuilderExecutionRequest).where(
                        DifyBuilderExecutionRequest.session_id == session_id,
                        DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                        DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    )
                )
            )
        for request in existing:
            saved = self._saved(request, key, body)
            if saved is not None:
                launched = any(
                    record.get("native_command_key") == key and record.get("admission_launched") is True
                    for record in request.observations
                )
                if launched:
                    self.get(actor=actor, session_id=session_id, request_id=request.id)
                    return saved
                # Recover a crash after SQL admission and before protected context
                # or queue acknowledgement, without allocating new identities.
                retry = self.admission.compiler.compile(
                    actor=actor,
                    session_id=session_id,
                    test_input_id=test_input_id,
                    expected_version=expected_version,
                    mode=mode,
                    request_id=request.id,
                    invocation_id=request.context["invocation_id"],
                    native_run_id=request.context["native_run_id"],
                    profile=self.admission.profile,
                )
                if retry.context.ref.context_digest != request.context_digest:
                    raise BuilderExecutionPolicyError("native_revision_drift")
                self.store.initialize_context(context=retry.context)
                self._launch(ref=retry.context.ref, command_key=key)
                return saved

        with self.sessions() as session:
            binding = current_input_binding(session=session, actor=actor, session_id=session_id)
            if (binding.test_input_id, binding.expected_version) != (test_input_id, expected_version):
                raise BuilderExecutionPolicyError("native_revision_drift")

        compilation = self.admission.compiler.compile(
            actor=actor,
            session_id=session_id,
            test_input_id=test_input_id,
            expected_version=expected_version,
            mode=mode,
            request_id=str(uuid4()),
            invocation_id=str(uuid4()),
            native_run_id=str(uuid4()),
            profile=self.admission.profile,
        )
        context, request_context = compilation.context, compilation.request_context
        receipt = NativeTestPublicReceipt(
            request_id=context.ref.request_id,
            generation=0,
            version=1,
            status="prepared",
            wait_reason=None,
            native_run_id=None,
            native_status=None,
            pending=(),
            outcome=None,
            evidence_refs=(),
        )
        with native_observation_transaction(self.sessions, session_id=lambda: session_id) as session:
            self.admission.compiler.recheck_local(session=session, actor=actor, compilation=compilation)
            for row in session.scalars(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.session_id == session_id,
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                )
            ):
                saved = self._saved(row, key, body)
                if saved is not None:
                    return saved
            current = current_input_binding(session=session, actor=actor, session_id=session_id)
            if current != binding or current.graph_revision != compilation.context.graph_revision:
                raise BuilderExecutionPolicyError("native_revision_drift")
            limits = self.admission.profile.limits
            if any(name not in limits for name in ("calls", "dispatches", "cost_units")):
                raise BuilderExecutionPolicyError("native_profile_unavailable")
            session.add(
                DifyBuilderExecutionRequest(
                    id=context.ref.request_id,
                    tenant_id=actor.tenant_id,
                    actor_id=actor.account_id,
                    app_id=context.app_id,
                    workflow_id=context.workflow_id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                    context=request_context,
                    context_digest=context.ref.context_digest,
                    state="running",
                    native_run_id=None,
                    observations=[
                        {"native_command_key": key, "body_digest": body, "receipt": receipt.model_dump(mode="json")}
                    ],
                )
            )
            session.add(
                NativeTestScope(
                    request_id=context.ref.request_id,
                    tenant_id=actor.tenant_id,
                    generation=0,
                    task_approved=True,
                    cancelled=False,
                    expires_at=utc_now() + timedelta(minutes=15),
                    max_calls=limits["calls"],
                    max_dispatches=limits["dispatches"],
                    max_cost_units=limits["cost_units"],
                    spent_calls=0,
                    spent_dispatches=0,
                    spent_cost_units=0,
                    budget_limits=limits,
                    budget_spent={},
                    profile=dict(limits),
                )
            )
            session.add(
                NativeTestInvocation(
                    tenant_id=actor.tenant_id,
                    request_id=context.ref.request_id,
                    invocation_id=context.ref.invocation_id,
                    active=True,
                    bindings={},
                )
            )
        self.store.initialize_context(context=context)
        self._launch(ref=context.ref, command_key=key)
        return receipt

    def _launch(self, *, ref: NativeTestContextRef, command_key: str) -> None:
        if self.admission is None:
            raise BuilderExecutionPolicyError("native_runtime_unavailable")
        # A queue acknowledgement can be lost; the qualified launch owner must
        # claim request_id durably before runtime execution, including retries.
        self.admission.launch.launch(ref=ref)
        with self.loader.locked(ref=ref, settlement=True) as (session, _, _):
            request = session.get(DifyBuilderExecutionRequest, ref.request_id)
            if request is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            request.observations = [
                {**record, "admission_launched": True} if record.get("native_command_key") == command_key else record
                for record in request.observations
            ]

    def get(self, *, actor: Actor, session_id: str, request_id: str) -> NativeTestPublicReceipt:
        request = self._request(actor=actor, session_id=session_id, request_id=request_id)
        with self.sessions() as session:
            states = list(
                session.scalars(
                    select(NativeInvocationState).where(
                        NativeInvocationState.tenant_id == actor.tenant_id,
                        NativeInvocationState.request_id == request_id,
                    )
                )
            )
            pending_rows = list(
                session.scalars(
                    select(NativePendingAction).where(
                        NativePendingAction.tenant_id == actor.tenant_id, NativePendingAction.request_id == request_id
                    )
                )
            )
            grants = {
                grant.scope_digest: grant
                for grant in session.scalars(
                    select(NativeEffectGrant).where(
                        NativeEffectGrant.tenant_id == actor.tenant_id,
                        NativeEffectGrant.actor_id == actor.account_id,
                        NativeEffectGrant.request_id == request_id,
                    )
                )
            }
            native_run = (
                session.scalar(
                    select(WorkflowRun).where(
                        WorkflowRun.id == (request.native_run_id or request.context.get("native_run_id")),
                        WorkflowRun.tenant_id == actor.tenant_id,
                        WorkflowRun.app_id == request.app_id,
                        WorkflowRun.workflow_id == request.workflow_id,
                        WorkflowRun.created_by == actor.account_id,
                        WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                    )
                )
                if (request.native_run_id or request.context.get("native_run_id"))
                else None
            )
            scope = session.get(NativeTestScope, request_id)
            cancellation = None
            if scope is not None and scope.cancelled:
                root_state = next((state for state in states if state.parent_invocation_id is None), None)
                if root_state is None:
                    raise BuilderExecutionPolicyError("native_state_unavailable")
                ref = NativeTestContextRef(
                    request_id=request_id, invocation_id=root_state.invocation_id, context_digest=request.context_digest
                )
                owned, scope = self.loader._load(session, ref=ref, lock=False, settlement=True)
                cancellation = self.lifecycle.cancellation_receipt(session=session, owned=owned, scope=scope)
        root = next((state for state in states if state.parent_invocation_id is None), None)

        if root is None:
            raise BuilderExecutionPolicyError("native_state_unavailable")
        for state in states:
            validate_private_read(
                self.loader,
                NativeTestContextRef(
                    request_id=request_id, invocation_id=state.invocation_id, context_digest=request.context_digest
                ),
            )
        active_pending = {
            pending_id
            for state in states
            if cancellation is None and state.state == "waiting"
            for pending_id in state.pending_ids
        }
        pending = []
        for row in pending_rows:
            if row.id not in active_pending:
                continue
            if row.category == "approval":
                if self.disclosure is None:
                    raise BuilderExecutionPolicyError("native_disclosure_unavailable")
                resolved = self.pending.load(
                    actor=actor, request_id=request_id, pending_operation_id=row.id, for_projection=True
                )
                item = PendingActionDisclosure.model_validate(
                    self.disclosure.describe(actor=actor, resolved=resolved).model_dump(mode="json")
                )
                if (item.pending_operation_id, item.wait_reason, item.version, item.scope_digest) != (
                    row.id,
                    "approval",
                    row.generation + 1,
                    row.owner_version,
                ):
                    raise BuilderExecutionPolicyError("native_disclosure_mismatch")
                if item.approval_limits != self.pending.load_terms(resolved=resolved, for_projection=True):
                    raise BuilderExecutionPolicyError("native_disclosure_mismatch")
                projected = project_pending_decision(item, grant=grants.get(row.owner_version), now=utc_now())
                if scope is not None and scope.expires_at <= utc_now() and projected.decision_status != "denied":
                    projected = projected.model_copy(update={"decision_status": "expired"})
                pending.append(projected)
            else:
                pending.append(
                    PendingActionDisclosure(
                        pending_operation_id=row.id,
                        wait_reason=cast(WaitReason, row.category),
                        version=row.generation + 1,
                        scope_digest=None,
                        account_label=None,
                        action=row.category,
                        target=None,
                        parameters_summary=None,
                        risk_notice=None,
                        required_configuration=(row.reference,) if row.category == "configuration" else (),
                        native_form_ref=row.reference if row.category == "interaction" else None,
                        approval_limits=None,
                        continuation_blocked_reason="native_resolution_unavailable",
                    )
                )
        terminal = root.state in {"completed", "stopped", "unknown"}
        outcome = None
        if cancellation is not None:
            # Accepted cancellation facts close the prior execution/wait view,
            # including any root/pending snapshot read before cancellation.
            if cancellation.status == "cancelling":
                terminal = False
            else:
                terminal = True
                outcome = cancellation.status
        elif terminal:
            outcome = "unknown" if root.state == "unknown" else "failed"
            if root.state == "completed" and (root.outcome or {}).get("native_status") == "succeeded":
                outcome = "succeeded"
        can_resume, blocked = False, "not_waiting"
        if root.state == "waiting" and cancellation is None:
            if scope is not None and scope.expires_at <= utc_now():
                blocked = "native_expired"
            elif any(item.wait_reason != "approval" for item in pending):
                blocked = "native_resolution_unavailable"
            elif any(item.decision_status != "confirmed" for item in pending):
                blocked = "approval_required"
            else:
                try:
                    self.lifecycle.check_resume(actor=actor, request_id=request_id, expected_generation=root.generation)
                    can_resume, blocked = True, None
                except Exception:
                    # Missing storage, stale identity, unknown subtree or expired
                    # authority are never a reason to offer an enabled continuation.
                    blocked = "state_unavailable"
        return NativeTestPublicReceipt(
            decision_public_revision=decision_public_revision(request.observations),
            can_resume=can_resume,
            resume_blocked_reason=blocked,
            cancellation=cancellation,
            request_id=request_id,
            generation=root.generation,
            version=root.generation + 1,
            status="terminal"
            if terminal
            else "running"
            if cancellation is not None
            else "waiting"
            if root.state == "waiting"
            else "running"
            if native_run or root.state in {"cancelled", "queued"}
            else "prepared",
            wait_reason=cast(WaitReason | None, root.wait_reason)
            if cancellation is None and root.state == "waiting"
            else None,
            native_run_id=native_run.id if native_run else None,
            native_status=native_run.status if native_run else None,
            pending=tuple(pending),
            outcome=outcome,
            evidence_refs=(native_run.id,) if native_run else (),
        )

    def decide(
        self,
        *,
        actor: Actor,
        session_id: str,
        request_id: str,
        pending_operation_id: str,
        decision: Literal["confirm", "deny"],
        scope_digest: str,
        expected_version: int,
        idempotency_key: str,
    ) -> NativeTestPublicReceipt:
        request = self._request(actor=actor, session_id=session_id, request_id=request_id)
        key, body = self._command(
            "decision",
            {
                "pending_operation_id": pending_operation_id,
                "decision": decision,
                "scope_digest": scope_digest,
                "expected_version": expected_version,
            },
            idempotency_key,
        )
        current = self.get(actor=actor, session_id=session_id, request_id=request_id)
        saved = self._saved(request, key, body)
        if saved is not None:
            return saved
        resolved = self.pending.load(actor=actor, request_id=request_id, pending_operation_id=pending_operation_id)
        terms = self.pending.load_terms(resolved=resolved)
        context = self.store.load_context(ref=resolved.ref)
        guard = PendingDecisionGuard(
            resolved=resolved,
            pending_operation_id=pending_operation_id,
            expected_version=expected_version,
            scope_digest=scope_digest,
            idempotency_digest=key,
            body_digest=body,
            receipt=current,
            terms=terms,
            invocation_app_id=context.app_id,
            invocation_workflow_id=context.workflow_id,
            invocation_revision=context.graph_revision,
        )
        return self.authorization.decide(
            ref=resolved.ref,
            intent=resolved.intent,
            decision="approved" if decision == "confirm" else "denied",
            max_calls=terms.max_calls,
            max_dispatches=terms.max_dispatches,
            max_cost_units=terms.max_cost_units,
            expires_at=datetime.fromisoformat(terms.expires_at),
            pending_guard=guard,
        )

    def resume(
        self, *, actor: Actor, session_id: str, request_id: str, expected_generation: int, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        self.lifecycle.resume(
            actor=actor, request_id=request_id, expected_generation=expected_generation, idempotency_key=idempotency_key
        )
        return self.get(actor=actor, session_id=session_id, request_id=request_id)

    def cancel(
        self, *, actor: Actor, session_id: str, request_id: str, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        self.lifecycle.cancel(actor=actor, request_id=request_id, idempotency_key=idempotency_key)
        return self.get(actor=actor, session_id=session_id, request_id=request_id)

    def snapshots(self, *, actor: Actor, session_id: str) -> tuple[NativeTestPublicReceipt, ...]:
        """Current durable snapshots for the session's versioned reconnect stream."""
        self._actor(actor)
        with self.sessions() as session:
            request_ids = tuple(
                session.scalars(
                    select(DifyBuilderExecutionRequest.id)
                    .where(
                        DifyBuilderExecutionRequest.session_id == session_id,
                        DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                        DifyBuilderExecutionRequest.actor_id == actor.account_id,
                        DifyBuilderExecutionRequest.context["policy_version"].as_string() == "builder-native-test-v1",
                    )
                    .order_by(DifyBuilderExecutionRequest.created_at.desc())
                    .limit(100)
                )
            )
        return tuple(self.get(actor=actor, session_id=session_id, request_id=request_id) for request_id in request_ids)
