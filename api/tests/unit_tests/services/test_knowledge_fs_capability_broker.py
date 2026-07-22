from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Literal, cast

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSApiCredentialStatus,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSCapabilityIssuanceReservationStatus,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.app_admission_service import KnowledgeFSAppPrincipalProfile
from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.product_service import AuthorizedKnowledgeFSControlSpace
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandProducer
from services.knowledge_fs_capability import CapabilityIssueRequest


class FakeProduct:
    def __init__(self, space: KnowledgeFSControlSpace):
        self.space = space
        self.calls: list[KnowledgeFSProductPermission] = []

    def authorize_control_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> AuthorizedKnowledgeFSControlSpace:
        _ = (tenant_id, account_id, control_space_id, require_active)
        self.calls.append(permission)
        return AuthorizedKnowledgeFSControlSpace(self.space, permission, (permission,))

    def authorize_control_space_in_session(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> AuthorizedKnowledgeFSControlSpace:
        _ = session
        return self.authorize_control_space(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            permission=permission,
            require_active=require_active,
        )


class FakeIssuer:
    def __init__(self) -> None:
        self.requests: list[CapabilityIssueRequest] = []

    def issue(self, request: CapabilityIssueRequest):
        self.requests.append(request)
        return SimpleNamespace(
            token="signed-capability",
            claims=SimpleNamespace(iat=1_999_999_940, exp=2_000_000_000),
        )


class AuditFailingOnceIssuer(FakeIssuer):
    def issue(self, request: CapabilityIssueRequest):
        self.requests.append(request)
        if len(self.requests) == 1:
            raise RuntimeError("issuance audit persistence failed")
        return SimpleNamespace(
            token="signed-capability",
            claims=SimpleNamespace(iat=1_999_999_940, exp=2_000_000_000),
        )


class NarrowingIssuer(FakeIssuer):
    def __init__(
        self,
        maker: sessionmaker[Session],
        *,
        principal_kind: Literal["interactive", "service", "app"],
    ) -> None:
        super().__init__()
        self._maker = maker
        self._principal_kind = principal_kind
        self.saw_committed_reservation = False

    def issue(self, request: CapabilityIssueRequest):
        with self._maker() as session:
            reservation = session.scalar(
                sa.select(KnowledgeFSCapabilityIssuanceReservation).where(
                    KnowledgeFSCapabilityIssuanceReservation.grant_id == request.grant_id
                )
            )
            self.saw_committed_reservation = (
                reservation is not None
                and reservation.status is KnowledgeFSCapabilityIssuanceReservationStatus.RESERVED
            )
        with self._maker.begin() as session:
            revision = session.scalar(
                sa.select(KnowledgeFSAuthorizationRevision).where(
                    KnowledgeFSAuthorizationRevision.control_space_id == request.control_space_id
                )
            )
            assert revision is not None
            if self._principal_kind == "interactive":
                revision.space_acl_epoch += 1
                caller_kinds = ("interactive",)
            elif self._principal_kind == "service":
                policy = session.scalar(
                    sa.select(KnowledgeFSExternalAccessPolicy).where(
                        KnowledgeFSExternalAccessPolicy.control_space_id == request.control_space_id
                    )
                )
                assert policy is not None
                policy.service_api_enabled = False
                revision.external_access_epoch += 1
                caller_kinds = ("service",)
            else:
                join = session.scalar(
                    sa.select(AppKnowledgeFSSpaceJoin).where(
                        AppKnowledgeFSSpaceJoin.control_space_id == request.control_space_id
                    )
                )
                assert join is not None
                join.status = KnowledgeFSAppSpaceJoinStatus.REVOKED
                revision.external_access_epoch += 1
                caller_kinds = (request.caller_kind,)
            KnowledgeFSRevocationCommandProducer().enqueue_principal_grants(
                session=session,
                tenant_id=request.namespace_id,
                control_space_id=request.control_space_id,
                subject=request.actor,
                reason_code="concurrent_narrowing",
                caller_kinds=caller_kinds,
            )
        return super().issue(request)


class FakeCutoverGate:
    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled
        self.calls: list[str] = []

    def require_product_routes(self, *, tenant_id: str) -> None:
        _ = tenant_id

    def require_capability_v2(self, *, tenant_id: str) -> None:
        self.calls.append(tenant_id)
        if not self.enabled:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workspace is not cut over for product traffic")


def _seed_external_principals(
    sqlite_session: Session,
) -> tuple[KnowledgeFSControlSpace, KnowledgeFSServiceCredentialProfile, KnowledgeFSAppPrincipalProfile]:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-external",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    credential = KnowledgeFSApiCredential(
        tenant_id="tenant-1",
        control_space_id=space.id,
        credential_hash="sha256:credential",
        credential_prefix="kfs_cred",
        credential_last4="cred",
        principal="credential-principal",
        allowed_actions=["queries.create"],
    )
    join = AppKnowledgeFSSpaceJoin(
        tenant_id="tenant-1",
        control_space_id=space.id,
        app_id="app-1",
        join_type=KnowledgeFSAppSpaceJoinType.AGENT,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
                membership_epoch=1,
                space_acl_epoch=2,
                external_access_epoch=3,
                content_policy_revision=4,
            ),
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=space.id,
                service_api_enabled=True,
                agent_enabled=True,
            ),
            credential,
            join,
        ]
    )
    sqlite_session.commit()
    return (
        space,
        KnowledgeFSServiceCredentialProfile(
            tenant_id="tenant-1",
            control_space_id=space.id,
            credential_id=credential.id,
            principal_id=credential.principal,
            allowed_actions=frozenset(credential.allowed_actions),
            knowledge_space_id="space-1",
            knowledge_space_revision=0,
            membership_epoch=1,
            space_acl_epoch=2,
            external_access_epoch=3,
            content_policy_revision=4,
            credential_revision=credential.revision,
            expires_at=None,
        ),
        KnowledgeFSAppPrincipalProfile(
            tenant_id="tenant-1",
            control_space_id=space.id,
            app_id=join.app_id,
            join_id=join.id,
            caller_kind=join.join_type,
            action="queries.create",
            knowledge_space_id="space-1",
            knowledge_space_revision=0,
            membership_epoch=1,
            space_acl_epoch=2,
            external_access_epoch=3,
            content_policy_revision=4,
        ),
    )


_ISSUANCE_FENCE_MODELS = (
    KnowledgeFSControlSpace,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSApiCredential,
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSLifecycleOutbox,
)


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_upload_capability_is_bound_to_authorized_space_and_upload_session(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
                space_acl_epoch=7,
            ),
        ]
    )
    sqlite_session.commit()
    product = FakeProduct(space)
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=product,  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    issued = broker.issue_interactive(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id=space.id,
        operation_id="uploadSmallFile",
        resource_id="upload-1",
        trace_id="trace-1",
    )

    assert issued.token == "signed-capability"
    assert product.calls == [KnowledgeFSProductPermission.DOCUMENT_WRITE]
    request = issuer.requests[0]
    assert request.operation_id == "uploadSmallFile"
    assert request.resource.type == "upload_session"
    assert request.resource.id == "upload-1"
    assert request.resource.parent_id == "space-1"
    assert request.authz_revision.space_acl_epoch == 7
    assert request.actor == "dify-account:account-1"
    assert str(uuid.UUID(request.grant_id)) == request.grant_id


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_manifest_gap_fails_before_authorization_or_issuance(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    sqlite_session.add(space)
    sqlite_session.commit()
    product = FakeProduct(space)
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=product,  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="createDocument"):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id=space.id,
            operation_id="createDocument",
        )

    assert product.calls == []
    assert issuer.requests == []


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_stream_capability_binds_research_task_to_authorized_parent_space(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-stream",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
            ),
        ]
    )
    sqlite_session.commit()
    product = FakeProduct(space)
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=product,  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    broker.issue_interactive(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id=space.id,
        operation_id="streamResearchTask",
        resource_id="task-1",
        trace_id="trace-stream",
    )

    assert product.calls == [KnowledgeFSProductPermission.READ]
    request = issuer.requests[0]
    assert request.operation_id == "streamResearchTaskProgress"
    assert request.resource.type == "research_task"
    assert request.resource.id == "task-1"
    assert request.resource.parent_id == "space-1"


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_query_stream_capability_uses_existing_create_query_space_grant(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-query",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
            ),
        ]
    )
    sqlite_session.commit()
    product = FakeProduct(space)
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=product,  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    issued = broker.issue_interactive(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id=space.id,
        operation_id="createQuery",
        trace_id="trace-query",
    )

    assert issued.operation_id == "createQuery"
    assert product.calls == [KnowledgeFSProductPermission.QUERY]
    request = issuer.requests[0]
    assert request.operation_id == "createQuery"
    assert request.resource.type == "knowledge_space"
    assert request.resource.id == "space-1"


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_retry_with_same_trace_reuses_one_grant_id(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-idempotent",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
            ),
        ]
    )
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    for _ in range(2):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id=space.id,
            operation_id="createQuery",
            trace_id="trace-idempotent",
        )

    assert len(issuer.requests) == 2
    assert issuer.requests[0].grant_id == issuer.requests[1].grant_id


@pytest.mark.parametrize("principal_kind", ["interactive", "service", "app"])
@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_concurrent_narrowing_scans_committed_reservation_before_signing(
    sqlite_session: Session,
    principal_kind: Literal["interactive", "service", "app"],
) -> None:
    space, service_profile, app_profile = _seed_external_principals(sqlite_session)
    maker = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    issuer = NarrowingIssuer(maker, principal_kind=principal_kind)
    broker = KnowledgeFSCapabilityBroker(
        maker,
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    if principal_kind == "interactive":
        issued = broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id=space.id,
            operation_id="createQuery",
            trace_id="trace-concurrent",
        )
    elif principal_kind == "service":
        issued = broker.issue_service(
            profile=service_profile,
            operation_id="createQuery",
            trace_id="trace-concurrent",
        )
    else:
        issued = broker.issue_app(
            profile=app_profile,
            operation_id="createQuery",
            trace_id="trace-concurrent",
        )

    with maker() as session:
        reservation = session.scalar(sa.select(KnowledgeFSCapabilityIssuanceReservation))
        command = session.scalar(sa.select(KnowledgeFSLifecycleOutbox))
    assert issued.token == "signed-capability"
    assert issuer.saw_committed_reservation is True
    assert reservation is not None
    assert reservation.status is KnowledgeFSCapabilityIssuanceReservationStatus.ISSUED
    assert command is not None
    assert command.command_payload["grant_id"] == reservation.grant_id


@pytest.mark.parametrize("principal_kind", ["service", "app"])
@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_stale_external_profile_is_revalidated_before_reservation(
    sqlite_session: Session,
    principal_kind: Literal["service", "app"],
) -> None:
    space, service_profile, app_profile = _seed_external_principals(sqlite_session)
    if principal_kind == "service":
        credential = sqlite_session.get(KnowledgeFSApiCredential, service_profile.credential_id)
        assert credential is not None
        credential.status = KnowledgeFSApiCredentialStatus.REVOKED
    else:
        join = sqlite_session.get(AppKnowledgeFSSpaceJoin, app_profile.join_id)
        assert join is not None
        join.status = KnowledgeFSAppSpaceJoinStatus.REVOKED
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    if principal_kind == "service":
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="no longer authorized"):
            broker.issue_service(
                profile=service_profile,
                operation_id="createQuery",
                trace_id="trace-stale",
            )
    else:
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="no longer authorized"):
            broker.issue_app(
                profile=app_profile,
                operation_id="createQuery",
                trace_id="trace-stale",
            )

    assert issuer.requests == []
    assert sqlite_session.scalar(sa.select(sa.func.count(KnowledgeFSCapabilityIssuanceReservation.id))) == 0


@pytest.mark.parametrize("principal_kind", ["service", "app"])
@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_external_issuance_uses_fresh_authorization_revision(
    sqlite_session: Session,
    principal_kind: Literal["service", "app"],
) -> None:
    space, service_profile, app_profile = _seed_external_principals(sqlite_session)
    revision = sqlite_session.scalar(
        sa.select(KnowledgeFSAuthorizationRevision).where(KnowledgeFSAuthorizationRevision.control_space_id == space.id)
    )
    credential = sqlite_session.get(KnowledgeFSApiCredential, service_profile.credential_id)
    assert revision is not None
    assert credential is not None
    revision.membership_epoch = 11
    revision.space_acl_epoch = 12
    revision.external_access_epoch = 13
    revision.content_policy_revision = 14
    credential.revision = 15
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    if principal_kind == "service":
        broker.issue_service(
            profile=service_profile,
            operation_id="createQuery",
            trace_id="trace-fresh-revision",
        )
    else:
        broker.issue_app(
            profile=app_profile,
            operation_id="createQuery",
            trace_id="trace-fresh-revision",
        )

    request = issuer.requests[0]
    assert request.authz_revision.membership_epoch == 11
    assert request.authz_revision.space_acl_epoch == 12
    assert request.authz_revision.external_access_epoch == 13
    assert request.content_policy_revision == 14
    assert request.authz_revision.credential_revision == (15 if principal_kind == "service" else None)


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_audit_failure_is_terminal_and_retry_reuses_the_unique_grant(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-audit-failure",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
        ]
    )
    sqlite_session.commit()
    issuer = AuditFailingOnceIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(RuntimeError, match="audit persistence failed"):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id=space.id,
            operation_id="createQuery",
            trace_id="trace-audit-retry",
        )

    sqlite_session.expire_all()
    failed = sqlite_session.scalar(sa.select(KnowledgeFSCapabilityIssuanceReservation))
    assert failed is not None
    assert failed.status is KnowledgeFSCapabilityIssuanceReservationStatus.FAILED
    assert failed.failure_code == "RuntimeError"
    assert failed.cleanup_after is not None
    serialized = str(failed.request_summary).lower()
    assert "signed-capability" not in serialized
    assert "raw_jti" not in serialized

    issued = broker.issue_interactive(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id=space.id,
        operation_id="createQuery",
        trace_id="trace-audit-retry",
    )

    sqlite_session.expire_all()
    reservations = tuple(sqlite_session.scalars(sa.select(KnowledgeFSCapabilityIssuanceReservation)))
    assert issued.token == "signed-capability"
    assert len(reservations) == 1
    assert reservations[0].status is KnowledgeFSCapabilityIssuanceReservationStatus.ISSUED
    assert issuer.requests[0].grant_id == issuer.requests[1].grant_id == reservations[0].grant_id


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_uncutover_workspace_cannot_issue_a_product_capability(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add(space)
    sqlite_session.commit()
    product = FakeProduct(space)
    issuer = FakeIssuer()
    cutover_gate = FakeCutoverGate(enabled=False)
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=cutover_gate,
        product=product,  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id=space.id,
            operation_id="createQuery",
        )

    assert cutover_gate.calls == ["tenant-1"]
    assert product.calls == []
    assert issuer.requests == []


@pytest.mark.parametrize("principal_kind", ["service", "app"])
@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision, KnowledgeFSCapabilityIssuanceReservation)],
    indirect=True,
)
def test_uncutover_workspace_rejects_service_and_app_capabilities_before_issuance(
    sqlite_session: Session,
    principal_kind: Literal["service", "app"],
) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    product = FakeProduct(space)
    issuer = FakeIssuer()
    cutover_gate = FakeCutoverGate(enabled=False)
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=cutover_gate,
        product=product,  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    if principal_kind == "service":
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
            broker.issue_service(
                profile=cast(KnowledgeFSServiceCredentialProfile, SimpleNamespace(tenant_id="tenant-1")),
                operation_id="createQuery",
            )
    else:
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
            broker.issue_app(
                profile=cast(KnowledgeFSAppPrincipalProfile, SimpleNamespace(tenant_id="tenant-1")),
                operation_id="createQuery",
            )

    assert cutover_gate.calls == ["tenant-1"]
    assert product.calls == []
    assert issuer.requests == []
