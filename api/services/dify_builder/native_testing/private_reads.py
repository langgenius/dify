"""Current private-read authority, independent of spent-operation settlement."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeInvocationState, NativeTestInvocation, NativeTestScope
from models.model import App
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.execution_policy_service import check_execution_permission, load_execution_owners
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, admitted_workflow_revision


@dataclass(frozen=True)
class PrivateReadOwner:
    tenant_id: str
    actor_id: str
    app_id: str
    workflow_id: str
    parent_invocation_id: str | None
    context_object_id: str
    generation: int
    graph_revision: str
    root_revision_matches: bool
    input_revision: str | None
    expires_at: datetime
    cancelled: bool
    active: bool
    request_state: str
    revision_context: dict | None = None


def validate_invocation_workflow(session, *, tenant_id: str, app_id: str, workflow_id: str) -> Workflow:
    """SQL lineage only; accepts actual published child workflows as well as drafts."""
    workflow = session.scalar(
        select(Workflow)
        .join(App, App.id == Workflow.app_id)
        .where(
            Workflow.id == workflow_id,
            Workflow.app_id == app_id,
            Workflow.tenant_id == tenant_id,
            App.tenant_id == tenant_id,
            App.status == "normal",
            Workflow.type == "workflow",
        )
    )
    if workflow is None:
        raise BuilderExecutionPolicyError("native_owner_mismatch")
    return workflow


def validate_private_read(loader: OwnedNativeTestLoader, ref: NativeTestContextRef) -> PrivateReadOwner:
    """Validate current local owners before external RBAC and any private payload I/O.

    Terminal/inactive invocations retain read visibility, but never inherit a
    settlement grant. Legacy rows without SQL provenance fail closed.
    """
    actor = loader.actor
    with loader.session_factory() as session:
        request = session.scalar(
            select(DifyBuilderExecutionRequest).where(
                DifyBuilderExecutionRequest.id == ref.request_id,
                DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                DifyBuilderExecutionRequest.actor_id == actor.account_id,
            )
        )
        if request is None or request.context_digest != ref.context_digest:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        if (
            request.context.get("policy_version") != ref.policy_version
            or canonical_digest(request.context) != ref.context_digest
        ):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        root = load_execution_owners(
            session,
            actor=actor,
            app_id=request.app_id,
            workflow_id=request.workflow_id,
            session_id=request.session_id,
            test_input_id=request.test_input_id,
        )
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.tenant_id == actor.tenant_id,
                NativeInvocationState.request_id == request.id,
                NativeInvocationState.invocation_id == ref.invocation_id,
            )
        )
        invocation = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.tenant_id == actor.tenant_id,
                NativeTestInvocation.request_id == request.id,
                NativeTestInvocation.invocation_id == ref.invocation_id,
            )
        )
        scope = session.scalar(
            select(NativeTestScope).where(
                NativeTestScope.tenant_id == actor.tenant_id, NativeTestScope.request_id == request.id
            )
        )
        if state is None or invocation is None or scope is None or not state.app_id or not state.workflow_id:
            raise BuilderExecutionPolicyError("native_read_owner_unavailable")
        if state.parent_invocation_id is None and (state.app_id, state.workflow_id) != (
            request.app_id,
            request.workflow_id,
        ):
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        workflow = validate_invocation_workflow(
            session, tenant_id=actor.tenant_id, app_id=state.app_id, workflow_id=state.workflow_id
        )
        assert root.test_input is not None  # required by load_execution_owners(test_input_id=...)
        owned = PrivateReadOwner(
            tenant_id=actor.tenant_id,
            actor_id=actor.account_id,
            app_id=state.app_id,
            workflow_id=state.workflow_id,
            parent_invocation_id=state.parent_invocation_id,
            context_object_id=state.context_object_id,
            generation=state.generation,
            graph_revision=admitted_workflow_revision(workflow, request.context),
            root_revision_matches=admitted_workflow_revision(root.workflow, request.context)
            == request.context.get("execution_revision"),
            input_revision=canonical_digest(root.test_input.inputs) if state.parent_invocation_id is None else None,
            expires_at=scope.expires_at,
            cancelled=scope.cancelled,
            active=invocation.active,
            request_state=request.state,
            revision_context=request.context if request.context.get("revision_basis") is not None else None,
        )
        root_app_id = request.app_id
    for app_id in dict.fromkeys((root_app_id, owned.app_id)):
        check_execution_permission(actor, app_id, loader.session_factory)
    return owned
