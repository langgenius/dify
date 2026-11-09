from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, override

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.enums import ApiTokenType
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
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
    KnowledgeFSUpgradeDocument,
    KnowledgeFSUpgradeJobStatus,
)
from models.model import ApiToken
from services.knowledge_fs.app_admission_service import KnowledgeFSAppPrincipalProfile
from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, KnowledgeFSProductPermission
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.product_service import AuthorizedKnowledgeFSControlSpace
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandProducer
from services.knowledge_fs.service_api_authorization import (
    KnowledgeFSServiceApiProfile,
    KnowledgeFSServiceApiScopeError,
)
from services.knowledge_fs_capability import CapabilityIssueRequest
from tests.helpers.unit.services.knowledge_fs_fakes import revoke_payload
from tests.helpers.unit.services.knowledge_fs_services_a_fakes import upgrade_job


class FakeProduct:
    def __init__(self, space: KnowledgeFSControlSpace) -> None:
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


@dataclass(frozen=True)
class _IssuedClaims:
    iat: int
    exp: int


@dataclass(frozen=True)
class _IssuedCapability:
    token: str
    claims: _IssuedClaims


def _signed_capability() -> _IssuedCapability:
    return _IssuedCapability(token="signed-capability", claims=_IssuedClaims(iat=1_999_999_940, exp=2_000_000_000))


class FakeIssuer:
    def __init__(self) -> None:
        self.requests: list[CapabilityIssueRequest] = []

    def issue(self, request: CapabilityIssueRequest) -> _IssuedCapability:
        self.requests.append(request)
        return _signed_capability()


class AuditFailingOnceIssuer(FakeIssuer):
    @override
    def issue(self, request: CapabilityIssueRequest) -> _IssuedCapability:
        self.requests.append(request)
        if len(self.requests) == 1:
            raise RuntimeError("issuance audit persistence failed")
        return _signed_capability()


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

    @override
    def issue(self, request: CapabilityIssueRequest) -> _IssuedCapability:
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
) -> tuple[KnowledgeFSControlSpace, KnowledgeFSServiceApiProfile, KnowledgeFSAppPrincipalProfile]:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-external",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    api_token = ApiToken(tenant_id="tenant-1", type=ApiTokenType.DATASET, token="dataset-token")
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
            api_token,
            join,
        ]
    )
    sqlite_session.commit()
    return (
        space,
        KnowledgeFSServiceApiProfile(
            tenant_id="tenant-1",
            control_space_id=space.id,
            api_token_id=api_token.id,
            principal_id=api_token.id,
            knowledge_space_id="space-1",
            knowledge_space_revision=0,
            membership_epoch=1,
            space_acl_epoch=2,
            external_access_epoch=3,
            content_policy_revision=4,
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
    ApiToken,
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSUpgradeDocument,
    KnowledgeFSUpgradeJobStatus,
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
def test_document_upload_operation_authorizes_and_issues_capability(sqlite_session: Session) -> None:
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
        operation_id="createDocument",
    )

    assert issued.token == "signed-capability"
    assert product.calls == [KnowledgeFSProductPermission.DOCUMENT_WRITE]
    assert issuer.requests[0].operation_id == "uploadDocument"


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
    assert revoke_payload(command)["grant_id"] == reservation.grant_id


@pytest.mark.parametrize("principal_kind", ["service", "app"])
@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_stale_external_profile_is_revalidated_before_reservation(
    sqlite_session: Session,
    principal_kind: Literal["service", "app"],
) -> None:
    space, service_profile, app_profile = _seed_external_principals(sqlite_session)
    if principal_kind == "service":
        api_token = sqlite_session.get(ApiToken, service_profile.api_token_id)
        assert api_token is not None
        sqlite_session.delete(api_token)
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
        with pytest.raises(KnowledgeFSServiceApiScopeError, match="no longer authorized"):
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


@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_service_issuance_rejects_a_space_disabled_after_authorization(sqlite_session: Session) -> None:
    space, service_profile, _ = _seed_external_principals(sqlite_session)
    policy = sqlite_session.scalar(
        sa.select(KnowledgeFSExternalAccessPolicy).where(
            KnowledgeFSExternalAccessPolicy.control_space_id == service_profile.control_space_id
        )
    )
    assert policy is not None
    policy.service_api_enabled = False
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSServiceApiScopeError, match="no longer authorized"):
        broker.issue_service(
            profile=service_profile,
            operation_id="createQuery",
            trace_id="trace-disabled-service-api",
        )

    assert issuer.requests == []
    assert sqlite_session.scalar(sa.select(sa.func.count(KnowledgeFSCapabilityIssuanceReservation.id))) == 0


@pytest.mark.parametrize(
    ("operation_id", "issuer", "trace_id", "message"),
    [
        ("unknownOperation", FakeIssuer(), "trace-invalid-operation", "operation is unavailable"),
        ("createQuery", None, "trace-disabled-capability", "Capability v2 is disabled"),
        ("createQuery", FakeIssuer(), " ", "trace id is required"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_interactive_issuance_rejects_invalid_preflight_inputs(
    sqlite_session: Session,
    operation_id: str,
    issuer: FakeIssuer | None,
    trace_id: str,
    message: str,
) -> None:
    space, _, _ = _seed_external_principals(sqlite_session)
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match=message):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id=space.id,
            operation_id=operation_id,
            trace_id=trace_id,
        )


@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_workflow_app_issuance_uses_the_workflow_caller_kind(sqlite_session: Session) -> None:
    space, _, app_profile = _seed_external_principals(sqlite_session)
    join = sqlite_session.get(AppKnowledgeFSSpaceJoin, app_profile.join_id)
    assert join is not None
    join.join_type = KnowledgeFSAppSpaceJoinType.WORKFLOW
    policy = sqlite_session.scalar(
        sa.select(KnowledgeFSExternalAccessPolicy).where(
            KnowledgeFSExternalAccessPolicy.control_space_id == app_profile.control_space_id
        )
    )
    assert policy is not None
    policy.workflow_enabled = True
    sqlite_session.commit()
    app_profile = app_profile._replace(caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW)
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    broker.issue_app(
        profile=app_profile,
        operation_id="createQuery",
        trace_id="trace-workflow-app",
    )

    assert issuer.requests[0].caller_kind == "workflow"


def _bump_space_acl_epoch(revision: KnowledgeFSAuthorizationRevision) -> None:
    revision.space_acl_epoch += 1


def _bump_content_policy_revision(revision: KnowledgeFSAuthorizationRevision) -> None:
    revision.content_policy_revision += 1


@pytest.mark.parametrize("change_revision", [_bump_space_acl_epoch, _bump_content_policy_revision])
@pytest.mark.parametrize("sqlite_session", [_ISSUANCE_FENCE_MODELS], indirect=True)
def test_investigation_authorization_matches_retrieval_until_scope_changes(
    sqlite_session: Session, change_revision: Callable[[KnowledgeFSAuthorizationRevision], None]
) -> None:
    space, _, profile = _seed_external_principals(sqlite_session)
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=FakeIssuer(),  # type: ignore[arg-type]
    )
    retrieved = broker.issue_app(
        profile=profile._replace(action="queries.retrieval_test"),
        operation_id="retrieveEvidence",
    )
    capture_profile = profile._replace(action="queries.agent_investigation.capture")
    captured = broker.issue_app(profile=capture_profile, operation_id="captureAgentKnowledgeInvestigation")
    assert retrieved.authorization_fingerprint
    assert captured.authorization_fingerprint == retrieved.authorization_fingerprint

    revision = sqlite_session.scalar(
        sa.select(KnowledgeFSAuthorizationRevision).where(KnowledgeFSAuthorizationRevision.control_space_id == space.id)
    )
    assert revision is not None
    change_revision(revision)
    sqlite_session.commit()
    changed = broker.issue_app(profile=capture_profile, operation_id="captureAgentKnowledgeInvestigation")
    assert changed.authorization_fingerprint != retrieved.authorization_fingerprint


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
    assert revision is not None
    revision.membership_epoch = 11
    revision.space_acl_epoch = 12
    revision.external_access_epoch = 13
    revision.content_policy_revision = 14
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
    assert request.authz_revision.credential_revision is None


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
                profile=KnowledgeFSServiceApiProfile(
                    tenant_id="tenant-1",
                    control_space_id="control-space-1",
                    api_token_id="api-token-1",
                    principal_id="api-token-1",
                    knowledge_space_id="space-1",
                    knowledge_space_revision=0,
                    membership_epoch=1,
                    space_acl_epoch=2,
                    external_access_epoch=3,
                    content_policy_revision=4,
                ),
                operation_id="createQuery",
            )
    else:
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
            broker.issue_app(
                profile=KnowledgeFSAppPrincipalProfile(
                    tenant_id="tenant-1",
                    control_space_id="control-space-1",
                    app_id="app-1",
                    join_id="join-1",
                    caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
                    action="queries.create",
                    knowledge_space_id="space-1",
                    knowledge_space_revision=0,
                    membership_epoch=1,
                    space_acl_epoch=2,
                    external_access_epoch=3,
                    content_policy_revision=4,
                ),
                operation_id="createQuery",
            )

    assert cutover_gate.calls == ["tenant-1"]
    assert product.calls == []
    assert issuer.requests == []


@pytest.mark.parametrize("caller", ["interactive", "service", "agent", "workflow"])
@pytest.mark.parametrize(
    "operation_id",
    ["createQuery", "retrieveEvidence", "createResearchTask", "createQualityReplay", "matchGoldenQuestionEvidence"],
)
@pytest.mark.parametrize("job_status", list(KnowledgeFSUpgradeJobStatus))
def test_upgrade_retrieval_waits_for_disabled_documents_across_all_callers(
    sqlite_session: Session, caller: str, job_status: KnowledgeFSUpgradeJobStatus, operation_id: str
) -> None:
    space, service_profile, app_profile = _seed_external_principals(sqlite_session)
    operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
    assert operation.action is not None
    app_profile = app_profile._replace(action=operation.action)
    if caller == "workflow":
        join = sqlite_session.get(AppKnowledgeFSSpaceJoin, app_profile.join_id)
        assert join is not None
        join.join_type = KnowledgeFSAppSpaceJoinType.WORKFLOW
        policy = sqlite_session.scalar(
            sa.select(KnowledgeFSExternalAccessPolicy).where(
                KnowledgeFSExternalAccessPolicy.control_space_id == space.id
            )
        )
        assert policy is not None
        policy.workflow_enabled = True
        app_profile = app_profile._replace(caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW)
    job = upgrade_job(job_id=str(uuid.uuid4()), old_dataset_id=str(uuid.uuid4()))
    job.new_control_space_id = space.id
    job.status = job_status
    document = KnowledgeFSUpgradeDocument(
        job_id=job.id,
        tenant_id=space.tenant_id,
        old_document_id=str(uuid.uuid4()),
        name="archived.txt",
        data_source_type="upload_file",
        data_source_info={},
        metadata_snapshot={},
        desired_enabled=False,
        legacy_archived=True,
        legacy_indexing_status="completed",
    )
    sqlite_session.add_all([job, document])
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )

    def issue() -> None:
        if caller == "interactive":
            broker.issue_interactive(
                tenant_id=space.tenant_id,
                account_id=space.owner_account_id,
                control_space_id=space.id,
                operation_id=operation_id,
            )
        elif caller == "service":
            broker.issue_service(profile=service_profile, operation_id=operation_id)
        else:
            broker.issue_app(profile=app_profile, operation_id=operation_id)

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="availability is still pending"):
        issue()
    assert issuer.requests == []
    assert sqlite_session.scalar(sa.select(sa.func.count(KnowledgeFSCapabilityIssuanceReservation.id))) == 0

    # Reads/writes needed by the reconciler remain available.
    broker.issue_interactive(
        tenant_id=space.tenant_id,
        account_id=space.owner_account_id,
        control_space_id=space.id,
        operation_id="listLogicalDocuments",
    )
    document.availability_reconciled_at = naive_utc_now()
    sqlite_session.commit()
    issue()
    assert issuer.requests[-1].operation_id == operation.capability_operation_id
    assert document.state_reconciled_at is None  # Metadata is not a retrieval gate.


@pytest.mark.parametrize("mismatch", ["tenant", "space", "enabled"])
def test_upgrade_availability_gate_ignores_unrelated_or_enabled_documents(
    sqlite_session: Session, mismatch: str
) -> None:
    space, _, _ = _seed_external_principals(sqlite_session)
    job = upgrade_job(
        job_id=str(uuid.uuid4()),
        old_dataset_id=str(uuid.uuid4()),
        tenant_id="other-tenant" if mismatch == "tenant" else space.tenant_id,
    )
    job.new_control_space_id = str(uuid.uuid4()) if mismatch == "space" else space.id
    sqlite_session.add(job)
    sqlite_session.add(
        KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=job.tenant_id,
            old_document_id=str(uuid.uuid4()),
            name="guide.txt",
            data_source_type="website_crawl",
            data_source_info={},
            metadata_snapshot={},
            desired_enabled=mismatch == "enabled",
            legacy_archived=False,
            legacy_indexing_status="completed",
        )
    )
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        product=FakeProduct(space),  # type: ignore[arg-type]
        issuer=issuer,  # type: ignore[arg-type]
    )
    broker.issue_interactive(
        tenant_id=space.tenant_id,
        account_id=space.owner_account_id,
        control_space_id=space.id,
        operation_id="createQuery",
    )
    assert len(issuer.requests) == 1
