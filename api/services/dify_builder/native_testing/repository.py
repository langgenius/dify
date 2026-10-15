"""Complete ownership loading and trusted native metadata boundaries.

A ref is only a lookup key. C03 creates the scope and invocation rows after
native admission; only its server cursor producer may populate ``bindings``.
The mandatory resolver rereads resource/credential *metadata* from their real
owners without decrypting credentials, OAuth, model, network or other I/O.
"""

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Annotated, Literal, Protocol

from pydantic import Field, StrictBool
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeTestInvocation, NativeTestScope
from models.model import App
from models.workflow import Workflow
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import ID, Counter, FrozenDTO, NativeTestContextRef, OperationKey

Limits = dict[ID, Annotated[int, Field(strict=True, ge=0, le=2**63 - 1)]]


class NativeBinding(FrozenDTO):
    """Secret-free server classification of one persisted logical cursor.

    ``intent_digest`` binds typed parameters and target at the real call site.
    resource/credential versions are opaque metadata versions, never ciphertext
    or secret values. No account binding is created for a configuration wait.
    """

    intent_digest: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    kind: Literal["code", "model", "http", "tool", "oauth", "knowledge", "file", "shell", "bootstrap"]
    resource_ref: ID
    implementation_revision: ID
    account_ref: ID | None
    capability_digest: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    resource_version: ID
    credential_version: ID | None
    isolated: StrictBool
    egress: StrictBool
    new_data: StrictBool
    destructive: StrictBool
    cost_units: Counter
    budget: Limits
    execution_id: ID
    invocation_digest: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class PendingOwner(FrozenDTO):
    category: Literal["configuration", "interaction"]
    owner_ref: ID
    version: ID
    reference: ID


@dataclass(frozen=True)
class OwnedNativeTest:
    ref: NativeTestContextRef
    tenant_id: str
    actor_id: str
    app_id: str
    workflow_id: str
    session_id: str
    test_input_id: str
    bindings: dict
    generation: int
    task_approved: bool
    expires_at: datetime
    state: str


class NativeBindingResolver(Protocol):
    """Mandatory trusted collaborator. Methods must perform local metadata reads only.

    Return a fresh binding from native resource/configuration owners; never echo
    a client classification. The stored binding is compared against this current
    snapshot before spending. Resolver implementations must propagate tenant,
    app, actor and invocation ownership to every underlying metadata query.
    """

    def resolve_binding(self, *, session: Session, owned: OwnedNativeTest, key: OperationKey) -> NativeBinding: ...

    def resolve_pending(
        self,
        *,
        session: Session,
        owned: OwnedNativeTest,
        category: Literal["configuration", "interaction"],
        reference: str,
    ) -> PendingOwner: ...


def native_workflow_revision(workflow: Workflow) -> str:
    """Hash serialized fields only: accessing resolved variable properties decrypts."""
    return canonical_digest(
        {
            "graph": workflow.graph,
            "features": workflow.serialized_features,
            "environment": workflow._environment_variables,
            "conversation": workflow._conversation_variables,
        }
    )


class OwnedNativeTestLoader:
    def __init__(self, session_factory: sessionmaker[Session], *, actor: Actor, resolver: NativeBindingResolver):
        if resolver is None:
            raise BuilderExecutionPolicyError("native_resolver_required")
        self.session_factory = session_factory
        self.actor = actor
        self.resolver = resolver

    def load(self, *, ref: NativeTestContextRef) -> OwnedNativeTest:
        from services.dify_builder.execution_policy_service import check_execution_permission

        with self.session_factory() as session:
            owned, _ = self._load(session, ref=ref, lock=False)
        # RBAC may use RPC; the database read transaction has closed first.
        check_execution_permission(self.actor, owned.app_id, self.session_factory)
        return owned

    @contextmanager
    def locked(
        self, *, ref: NativeTestContextRef, settlement: bool = False
    ) -> Generator[tuple[Session, OwnedNativeTest, NativeTestScope]]:
        with self.session_factory.begin() as session:
            owned, scope = self._load(session, ref=ref, lock=True, settlement=settlement)
            yield session, owned, scope

    def _load(
        self, session: Session, *, ref: NativeTestContextRef, lock: bool, settlement: bool = False
    ) -> tuple[OwnedNativeTest, NativeTestScope]:
        from services.dify_builder.execution_policy_service import load_execution_owners

        query = select(DifyBuilderExecutionRequest).where(
            DifyBuilderExecutionRequest.id == ref.request_id,
            DifyBuilderExecutionRequest.tenant_id == self.actor.tenant_id,
            DifyBuilderExecutionRequest.actor_id == self.actor.account_id,
        )
        if lock:
            query = query.with_for_update()
        request = session.scalar(query)
        if request is None or request.context_digest != ref.context_digest:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        if (
            request.context.get("policy_version") != ref.policy_version
            or canonical_digest(request.context) != request.context_digest
        ):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        if settlement:
            # An already-spent permit can report its result after revocation,
            # cancellation or draft drift. This writes evidence, never new I/O.
            owner_exists = session.scalar(
                select(DifyBuilderSession.id)
                .join(App, App.id == DifyBuilderSession.app_id)
                .join(Workflow, Workflow.app_id == App.id)
                .join(DifyBuilderTestInput, DifyBuilderTestInput.session_id == DifyBuilderSession.id)
                .where(
                    DifyBuilderSession.id == request.session_id,
                    DifyBuilderSession.tenant_id == request.tenant_id,
                    DifyBuilderSession.owner_account_id == request.actor_id,
                    App.id == request.app_id,
                    App.tenant_id == request.tenant_id,
                    Workflow.id == request.workflow_id,
                    Workflow.tenant_id == request.tenant_id,
                    DifyBuilderTestInput.id == request.test_input_id,
                )
            )
            if owner_exists is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
        else:
            owners = load_execution_owners(
                session,
                actor=self.actor,
                app_id=request.app_id,
                workflow_id=request.workflow_id,
                session_id=request.session_id,
                test_input_id=request.test_input_id,
            )
            if native_workflow_revision(owners.workflow) != request.context.get("execution_revision"):
                raise BuilderExecutionPolicyError("native_revision_drift")
        scope = session.scalar(
            select(NativeTestScope).where(
                NativeTestScope.request_id == request.id, NativeTestScope.tenant_id == request.tenant_id
            )
        )
        invocation = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.tenant_id == request.tenant_id,
                NativeTestInvocation.request_id == request.id,
                NativeTestInvocation.invocation_id == ref.invocation_id,
            )
        )
        if scope is None or invocation is None or (not settlement and not invocation.active):
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        if scope.cancelled and not settlement:
            raise BuilderExecutionPolicyError("native_cancelled")
        if request.state not in {"running", "waiting"} and not settlement:
            raise BuilderExecutionPolicyError("native_request_terminal")
        return OwnedNativeTest(
            ref=ref,
            tenant_id=request.tenant_id,
            actor_id=request.actor_id,
            app_id=request.app_id,
            workflow_id=request.workflow_id,
            session_id=request.session_id,
            test_input_id=request.test_input_id,
            bindings=invocation.bindings,
            generation=scope.generation,
            task_approved=scope.task_approved,
            expires_at=scope.expires_at,
            state=request.state,
        ), scope


@dataclass(frozen=True)
class BudgetReservation:
    """A projection of already-spent quota. The reference itself grants nothing."""

    budget_reservation_ref: str
    execution_id: str
    invocation_digest: str
    expires_at: datetime
    limits: Mapping[str, int]
    profile: Mapping[str, int]

    def __post_init__(self) -> None:
        object.__setattr__(self, "limits", MappingProxyType(dict(self.limits)))
        object.__setattr__(self, "profile", MappingProxyType(dict(self.profile)))

    def authorize(
        self, *, execution_id: str, invocation_digest: str, requested: Mapping[str, int], now: datetime
    ) -> dict[str, int]:
        if (
            execution_id != self.execution_id
            or invocation_digest != self.invocation_digest
            or now >= self.expires_at
            or not requested
        ):
            raise BuilderExecutionPolicyError("invalid_budget_reservation")
        for name, value in requested.items():
            limit, profile = self.limits.get(name), self.profile.get(name)
            if (
                type(value) is not int
                or type(limit) is not int
                or type(profile) is not int
                or value < 0
                or value > min(limit, profile)
            ):
                raise BuilderExecutionPolicyError("invalid_budget_reservation")
        return dict(requested)


def utc_now() -> datetime:
    return datetime.now(UTC)
