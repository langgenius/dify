"""Reconstruct private native test state before crossing a native runtime boundary.

References carry no authority. The state owner checks the complete ownership,
current permissions, revisions and cancellation before returning protected data.
This adapter never includes an underlying exception or configuration in errors.
"""

import json
from typing import Literal, Protocol

from pydantic import Field, StrictInt
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
from models.workflow import Workflow
from runtime_contracts.builder.execution import canonical_digest
from runtime_contracts.builder.native.contracts import ID, Counter, FrozenDTO, JsonValue, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import NativeStatePort, ResolvedNativeTestContext
from services.dify_builder.execution_policy_service import check_execution_permission, load_execution_owners
from services.dify_builder.native_testing.repository import admitted_workflow_revision, native_workflow_revision


class NativeContextUnavailable(RuntimeError):  # noqa: N818 - frozen NW2 protocol name
    """Fixed public reason; protected owner failures are deliberately not chained."""

    def __init__(self, reason_code: str):
        self.reason_code = reason_code
        super().__init__(reason_code)


def resolve_native_context(
    *, required: bool, ref: NativeTestContextRef | None, state: NativeStatePort
) -> ResolvedNativeTestContext | None:
    if ref is None:
        if required:
            raise NativeContextUnavailable("native_context_missing")
        return None
    if ref.policy_version != "builder-native-test-v1":
        raise NativeContextUnavailable("native_context_version")
    try:
        checked_ref = NativeTestContextRef.model_validate(ref.model_dump(mode="json"))
        context = state.load_context(ref=checked_ref)
        # Frozen DTOs contain mutable JSON. Revalidation copies the snapshot and
        # rejects objects created via unchecked model_construct/model_copy.
        context = ResolvedNativeTestContext.model_validate(context.model_dump(mode="json"))
    except Exception:
        raise NativeContextUnavailable("native_context_unavailable") from None
    if context.ref != checked_ref:
        raise NativeContextUnavailable("native_context_mismatch")
    return context


# Admission is read-only. C04 owns the one durable request/scope/invocation
# transaction; C03 alone writes the protected compiled context afterward.


class NativeRuntimeProfile(FrozenDTO):
    """Server-owned qualification identity and finite shared root limits."""

    profile_id: ID
    implementation_revision: ID
    limits: dict[ID, Counter] = Field(min_length=1)


class NativeAdmissionCompilation(FrozenDTO):
    context: ResolvedNativeTestContext
    request_context: dict[str, JsonValue]
    session_id: ID
    test_input_id: ID
    expected_version: StrictInt
    start_schema_hash: str


class NativeResourceSnapshot(Protocol):
    """Trusted metadata owner, never credential materialization or capability I/O.

    Must revalidate pinned Agent/config identities and current reference access.
    Runs outside the compiler's SQL session. Missing capability producers must
    refuse, never return invented resource bindings or permission flags.
    """

    def __call__(
        self,
        *,
        actor: Actor,
        app_id: str,
        workflow_id: str,
        graph: dict[str, JsonValue],
        profile: NativeRuntimeProfile,
    ) -> tuple[dict[str, JsonValue], ...]: ...


class NativeAdmissionCompiler:
    def __init__(self, *, session_factory: sessionmaker[Session], resources: NativeResourceSnapshot):
        if resources is None:
            raise NativeContextUnavailable("native_resources_unavailable")
        self._sessions = session_factory
        self._resources = resources

    def compile(
        self,
        *,
        actor: Actor,
        session_id: str,
        test_input_id: str,
        expected_version: int,
        mode: Literal["native", "mock"],
        request_id: str,
        invocation_id: str,
        native_run_id: str,
        profile: NativeRuntimeProfile,
        revision_basis: Literal["confirmed-canvas-v1"] | None = None,
    ) -> NativeAdmissionCompilation:
        if type(expected_version) is not int or expected_version < 1 or mode not in ("native", "mock"):
            raise NativeContextUnavailable("native_admission_invalid")
        profile = NativeRuntimeProfile.model_validate(profile.model_dump(mode="json"))
        with self._sessions() as session:
            builder = session.get(DifyBuilderSession, session_id)
            if builder is None:
                raise NativeContextUnavailable("native_owner_mismatch")
            owner = load_execution_owners(
                session,
                app_id=builder.app_id,
                actor=actor,
                session_id=session_id,
                test_input_id=test_input_id,
            )
            if owner.session is None or owner.test_input is None or owner.session.version != expected_version:
                raise NativeContextUnavailable("native_revision_drift")
            if owner.app.mode != "workflow" or owner.workflow.kind_or_standard != "standard":
                raise NativeContextUnavailable("native_mode_unavailable")
            app_id, workflow_id = owner.app.id, owner.workflow.id
            graph = json.loads(owner.workflow.graph)
            inputs = json.loads(json.dumps(owner.test_input.inputs))
            revision = (
                admitted_workflow_revision(
                    owner.workflow,
                    {
                        "revision_basis": revision_basis,
                        "profile": profile.model_dump(mode="json"),
                        "workflow_id": workflow_id,
                    },
                )
                if revision_basis is not None
                else native_workflow_revision(owner.workflow)
            )
            schema_hash = owner.test_input.start_schema_hash
        check_execution_permission(actor, app_id, self._sessions)
        manifest = self._resources(
            actor=actor,
            app_id=app_id,
            workflow_id=workflow_id,
            graph=graph,
            profile=profile,
        )
        request_context: dict[str, JsonValue] = {
            "policy_version": "builder-native-test-v1",
            "request_id": request_id,
            "invocation_id": invocation_id,
            "native_run_id": native_run_id,
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "app_id": app_id,
            "workflow_id": workflow_id,
            "session_id": session_id,
            "test_input_id": test_input_id,
            "expected_version": expected_version,
            "execution_revision": revision,
            "input_revision": canonical_digest(inputs),
            "start_schema_hash": schema_hash,
            "mode": mode,
            "profile": profile.model_dump(mode="json"),
            "resource_manifest_digest": canonical_digest(list(manifest)),
        }
        if revision_basis is not None:
            request_context["revision_basis"] = revision_basis
        ref = NativeTestContextRef(
            request_id=request_id,
            invocation_id=invocation_id,
            context_digest=canonical_digest(request_context),
        )
        context = ResolvedNativeTestContext(
            ref=ref,
            tenant_id=actor.tenant_id,
            actor_id=actor.account_id,
            app_id=app_id,
            workflow_id=workflow_id,
            graph=graph,
            inputs=inputs,
            graph_revision=revision,
            input_revision=canonical_digest(inputs),
            resource_manifest=manifest,
            generation=0,
            root_native_run_id=native_run_id,
            native_run_id=native_run_id,
            parent_invocation_id=None,
            call_depth=0,
            budget_ref=request_id,
            cancellation_ref=request_id,
            execution_mode=mode,
        )
        return NativeAdmissionCompilation(
            context=context,
            request_context=request_context,
            session_id=session_id,
            test_input_id=test_input_id,
            expected_version=expected_version,
            start_schema_hash=schema_hash,
        )

    @staticmethod
    def recheck_local(*, session: Session, actor: Actor, compilation: NativeAdmissionCompilation) -> None:
        """C04 calls inside its bounded transaction, before inserting any admission rows.

        Lock/reload actual source rows; do not call resource/RBAC/storage owners
        under this write lock. No commit and no admission writes happen here.
        """
        context = compilation.context
        if (context.tenant_id, context.actor_id) != (actor.tenant_id, actor.account_id) or canonical_digest(
            compilation.request_context
        ) != context.ref.context_digest:
            raise NativeContextUnavailable("native_context_mismatch")
        for model, identifier in (
            (DifyBuilderSession, compilation.session_id),
            (Workflow, context.workflow_id),
            (DifyBuilderTestInput, compilation.test_input_id),
        ):
            session.scalar(
                select(model).where(model.id == identifier).with_for_update().execution_options(populate_existing=True)
            )
        try:
            owner = load_execution_owners(
                session,
                app_id=context.app_id,
                actor=actor,
                workflow_id=context.workflow_id,
                session_id=compilation.session_id,
                test_input_id=compilation.test_input_id,
            )
        except Exception:
            raise NativeContextUnavailable("native_owner_mismatch") from None
        if (
            owner.session is None
            or owner.test_input is None
            or owner.session.version != compilation.expected_version
            or (
                admitted_workflow_revision(owner.workflow, compilation.request_context)
                if compilation.request_context.get("revision_basis") is not None
                else native_workflow_revision(owner.workflow)
            )
            != context.graph_revision
            or canonical_digest(owner.test_input.inputs) != context.input_revision
            or owner.test_input.start_schema_hash != compilation.start_schema_hash
        ):
            raise NativeContextUnavailable("native_revision_drift")
