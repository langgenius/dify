"""Issue operation capabilities from already-authorized Dify product state."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import NamedTuple, Protocol, cast

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSApiCredentialStatus,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from repositories.sqlalchemy_knowledge_fs_capability_issuance_reservation_repository import (
    SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository,
)
from services.knowledge_fs.app_admission_service import KnowledgeFSAppPrincipalProfile
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.cutover_runtime_gate import KnowledgeFSWorkspaceRuntimeGatePort
from services.knowledge_fs.product_operations import (
    KNOWLEDGE_FS_PRODUCT_OPERATIONS,
    KnowledgeFSProductOperation,
    is_product_operation_ready,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.product_service import KnowledgeFSProductService
from services.knowledge_fs_capability import (
    KNOWLEDGE_FS_CAPABILITY_OPERATIONS,
    CapabilityAuthzRevision,
    CapabilityCallerKind,
    CapabilityIssueRequest,
    CapabilityResource,
    IssuedKnowledgeFSCapability,
)


class KnowledgeFSCapabilityIssuerPort(Protocol):
    def issue(self, request: CapabilityIssueRequest) -> IssuedKnowledgeFSCapability: ...


class KnowledgeFSIssuedProductCapability(NamedTuple):
    token: str
    expires_at: datetime
    operation_id: str
    knowledge_space_id: str
    knowledge_space_revision: int
    trace_id: str


class KnowledgeFSAuthorizationSnapshot(NamedTuple):
    authz_revision: CapabilityAuthzRevision
    content_policy_revision: int


class KnowledgeFSCapabilityBroker:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        cutover_gate: KnowledgeFSWorkspaceRuntimeGatePort,
        product: KnowledgeFSProductService,
        issuer: KnowledgeFSCapabilityIssuerPort | None,
    ) -> None:
        self._session_maker = session_maker
        self._cutover_gate = cutover_gate
        self._product = product
        self._issuer = issuer

    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        self._cutover_gate.require_capability_v2(tenant_id=tenant_id)
        product_operation, capability_operation_id = _operation_contract(operation_id)
        issuer = self._require_issuer()
        normalized_trace_id = _trace_id(trace_id)
        with self._session_maker.begin() as session:
            revision = _lock_authorization_revision(
                session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
            )
            authorized = self._product.authorize_control_space_in_session(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                permission=product_operation.permission,
                require_active=True,
            )
            space = authorized.control_space
            knowledge_space_id = space.knowledge_space_id
            if knowledge_space_id is None:
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS control-space is not registered")
            request = _issue_request(
                capability_operation_id=capability_operation_id,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                knowledge_space_id=knowledge_space_id,
                principal_id=account_id,
                actor=f"dify-account:{account_id}",
                caller_kind="interactive",
                credential_revision=None,
                revision=revision,
                resource_id=resource_id,
                trace_id=normalized_trace_id,
            )
            SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session).reserve(request)
            knowledge_space_revision = space.knowledge_space_revision
        return self._issue_reserved(
            issuer=issuer,
            request=request,
            operation_id=operation_id,
            knowledge_space_id=knowledge_space_id,
            knowledge_space_revision=knowledge_space_revision,
        )

    def issue_service(
        self,
        *,
        profile: KnowledgeFSServiceCredentialProfile,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        self._cutover_gate.require_capability_v2(tenant_id=profile.tenant_id)
        _, capability_operation_id = _operation_contract(operation_id)
        issuer = self._require_issuer()
        normalized_trace_id = _trace_id(trace_id)
        capability_operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[capability_operation_id]
        with self._session_maker.begin() as session:
            revision = _lock_authorization_revision(
                session,
                tenant_id=profile.tenant_id,
                control_space_id=profile.control_space_id,
            )
            credential, space, policy = _load_service_authorization(session, profile=profile)
            if (
                credential.status is not KnowledgeFSApiCredentialStatus.ACTIVE
                or credential.principal != profile.principal_id
                or (credential.expires_at is not None and credential.expires_at <= naive_utc_now())
                or policy is None
                or not policy.service_api_enabled
                or capability_operation.action not in credential.allowed_actions
                or space.state is not KnowledgeFSControlSpaceState.ACTIVE
                or space.knowledge_space_id is None
            ):
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS credential is no longer authorized")
            knowledge_space_id = space.knowledge_space_id
            request = _issue_request(
                capability_operation_id=capability_operation_id,
                tenant_id=profile.tenant_id,
                control_space_id=profile.control_space_id,
                knowledge_space_id=knowledge_space_id,
                principal_id=credential.principal,
                actor=f"dify-kfs-credential:{credential.principal}",
                caller_kind="service",
                credential_revision=credential.revision,
                revision=revision,
                resource_id=resource_id,
                trace_id=normalized_trace_id,
            )
            SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session).reserve(request)
            knowledge_space_revision = space.knowledge_space_revision
        return self._issue_reserved(
            issuer=issuer,
            request=request,
            operation_id=operation_id,
            knowledge_space_id=knowledge_space_id,
            knowledge_space_revision=knowledge_space_revision,
        )

    def issue_app(
        self,
        *,
        profile: KnowledgeFSAppPrincipalProfile,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        self._cutover_gate.require_capability_v2(tenant_id=profile.tenant_id)
        _, capability_operation_id = _operation_contract(operation_id)
        issuer = self._require_issuer()
        normalized_trace_id = _trace_id(trace_id)
        capability_operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[capability_operation_id]
        with self._session_maker.begin() as session:
            revision = _lock_authorization_revision(
                session,
                tenant_id=profile.tenant_id,
                control_space_id=profile.control_space_id,
            )
            join, space, policy = _load_app_authorization(session, profile=profile)
            caller_kind = _app_caller_kind(profile.caller_kind)
            channel_enabled = (
                policy.agent_enabled
                if profile.caller_kind is KnowledgeFSAppSpaceJoinType.AGENT
                else policy.workflow_enabled
            )
            if (
                join.status is not KnowledgeFSAppSpaceJoinStatus.ACTIVE
                or capability_operation.action != profile.action
                or not channel_enabled
                or space.state is not KnowledgeFSControlSpaceState.ACTIVE
                or space.knowledge_space_id is None
            ):
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS app binding is no longer authorized")
            knowledge_space_id = space.knowledge_space_id
            request = _issue_request(
                capability_operation_id=capability_operation_id,
                tenant_id=profile.tenant_id,
                control_space_id=profile.control_space_id,
                knowledge_space_id=knowledge_space_id,
                principal_id=profile.app_id,
                actor=f"dify-app:{profile.app_id}",
                caller_kind=caller_kind,
                credential_revision=None,
                revision=revision,
                resource_id=resource_id,
                trace_id=normalized_trace_id,
            )
            SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session).reserve(request)
            knowledge_space_revision = space.knowledge_space_revision
        return self._issue_reserved(
            issuer=issuer,
            request=request,
            operation_id=operation_id,
            knowledge_space_id=knowledge_space_id,
            knowledge_space_revision=knowledge_space_revision,
        )

    def _require_issuer(self) -> KnowledgeFSCapabilityIssuerPort:
        if self._issuer is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Capability v2 is disabled")
        return self._issuer

    def _issue_reserved(
        self,
        *,
        issuer: KnowledgeFSCapabilityIssuerPort,
        request: CapabilityIssueRequest,
        operation_id: str,
        knowledge_space_id: str,
        knowledge_space_revision: int,
    ) -> KnowledgeFSIssuedProductCapability:
        try:
            issued = issuer.issue(request)
            with self._session_maker.begin() as session:
                SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session).mark_issued(
                    tenant_id=request.namespace_id,
                    grant_id=request.grant_id,
                    issued_at=datetime.fromtimestamp(issued.claims.iat, tz=UTC).replace(tzinfo=None),
                    token_expires_at=datetime.fromtimestamp(issued.claims.exp, tz=UTC).replace(tzinfo=None),
                )
        except Exception as issuance_error:
            try:
                with self._session_maker.begin() as session:
                    SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository(session).mark_failed(
                        tenant_id=request.namespace_id,
                        grant_id=request.grant_id,
                        failed_at=naive_utc_now(),
                        failure_code=type(issuance_error).__name__,
                    )
            except Exception as terminal_error:
                raise KnowledgeFSOperationUnavailableError(
                    "KnowledgeFS capability issuance terminal state could not be persisted"
                ) from terminal_error
            raise
        return KnowledgeFSIssuedProductCapability(
            token=issued.token,
            expires_at=datetime.fromtimestamp(issued.claims.exp, tz=UTC),
            operation_id=operation_id,
            knowledge_space_id=knowledge_space_id,
            knowledge_space_revision=knowledge_space_revision,
            trace_id=request.trace_id,
        )


def _lock_authorization_revision(
    session: Session,
    *,
    tenant_id: str,
    control_space_id: str,
) -> KnowledgeFSAuthorizationSnapshot:
    revision = session.scalar(
        sa.select(KnowledgeFSAuthorizationRevision)
        .where(
            KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
            KnowledgeFSAuthorizationRevision.control_space_id == control_space_id,
        )
        .with_for_update()
    )
    if revision is None:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS authorization revision is missing")
    result = session.execute(
        sa.update(KnowledgeFSAuthorizationRevision)
        .where(
            KnowledgeFSAuthorizationRevision.id == revision.id,
            KnowledgeFSAuthorizationRevision.membership_epoch == revision.membership_epoch,
            KnowledgeFSAuthorizationRevision.space_acl_epoch == revision.space_acl_epoch,
            KnowledgeFSAuthorizationRevision.external_access_epoch == revision.external_access_epoch,
            KnowledgeFSAuthorizationRevision.content_policy_revision == revision.content_policy_revision,
            KnowledgeFSAuthorizationRevision.revoke_sequence == revision.revoke_sequence,
        )
        .values(updated_at=sa.func.current_timestamp())
    )
    if cast(CursorResult[tuple[object, ...]], result).rowcount != 1:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS authorization revision changed during issuance")
    return KnowledgeFSAuthorizationSnapshot(
        authz_revision=CapabilityAuthzRevision(
            membership_epoch=revision.membership_epoch,
            space_acl_epoch=revision.space_acl_epoch,
            external_access_epoch=revision.external_access_epoch,
            credential_revision=None,
        ),
        content_policy_revision=revision.content_policy_revision,
    )


def _load_service_authorization(
    session: Session,
    *,
    profile: KnowledgeFSServiceCredentialProfile,
) -> tuple[KnowledgeFSApiCredential, KnowledgeFSControlSpace, KnowledgeFSExternalAccessPolicy | None]:
    row = session.execute(
        sa.select(
            KnowledgeFSApiCredential,
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
        )
        .join(
            KnowledgeFSControlSpace,
            sa.and_(
                KnowledgeFSControlSpace.tenant_id == KnowledgeFSApiCredential.tenant_id,
                KnowledgeFSControlSpace.id == KnowledgeFSApiCredential.control_space_id,
            ),
        )
        .outerjoin(
            KnowledgeFSExternalAccessPolicy,
            sa.and_(
                KnowledgeFSExternalAccessPolicy.tenant_id == KnowledgeFSApiCredential.tenant_id,
                KnowledgeFSExternalAccessPolicy.control_space_id == KnowledgeFSApiCredential.control_space_id,
            ),
        )
        .where(
            KnowledgeFSApiCredential.tenant_id == profile.tenant_id,
            KnowledgeFSApiCredential.control_space_id == profile.control_space_id,
            KnowledgeFSApiCredential.id == profile.credential_id,
        )
    ).one_or_none()
    if row is None:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS credential is no longer authorized")
    return row._t


def _load_app_authorization(
    session: Session,
    *,
    profile: KnowledgeFSAppPrincipalProfile,
) -> tuple[AppKnowledgeFSSpaceJoin, KnowledgeFSControlSpace, KnowledgeFSExternalAccessPolicy]:
    row = session.execute(
        sa.select(
            AppKnowledgeFSSpaceJoin,
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
        )
        .join(
            KnowledgeFSControlSpace,
            sa.and_(
                KnowledgeFSControlSpace.tenant_id == AppKnowledgeFSSpaceJoin.tenant_id,
                KnowledgeFSControlSpace.id == AppKnowledgeFSSpaceJoin.control_space_id,
            ),
        )
        .join(
            KnowledgeFSExternalAccessPolicy,
            sa.and_(
                KnowledgeFSExternalAccessPolicy.tenant_id == AppKnowledgeFSSpaceJoin.tenant_id,
                KnowledgeFSExternalAccessPolicy.control_space_id == AppKnowledgeFSSpaceJoin.control_space_id,
            ),
        )
        .where(
            AppKnowledgeFSSpaceJoin.tenant_id == profile.tenant_id,
            AppKnowledgeFSSpaceJoin.control_space_id == profile.control_space_id,
            AppKnowledgeFSSpaceJoin.app_id == profile.app_id,
            AppKnowledgeFSSpaceJoin.id == profile.join_id,
            AppKnowledgeFSSpaceJoin.join_type == profile.caller_kind,
        )
    ).one_or_none()
    if row is None:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS app binding is no longer authorized")
    return row._t


def _issue_request(
    *,
    capability_operation_id: str,
    tenant_id: str,
    control_space_id: str,
    knowledge_space_id: str,
    principal_id: str,
    actor: str,
    caller_kind: CapabilityCallerKind,
    credential_revision: int | None,
    revision: KnowledgeFSAuthorizationSnapshot,
    resource_id: str | None,
    trace_id: str,
) -> CapabilityIssueRequest:
    capability_operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[capability_operation_id]
    if capability_operation.resource_type == "knowledge_space":
        resource = CapabilityResource(type="knowledge_space", id=knowledge_space_id)
    elif capability_operation.resource_type in {
        "document",
        "job",
        "query",
        "research_task",
        "source",
        "upload_session",
    }:
        if resource_id is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS child resource is required")
        resource = CapabilityResource(
            type=capability_operation.resource_type,
            id=resource_id,
            parent_id=knowledge_space_id,
        )
    else:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product resource resolver is not registered")
    grant_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"dify-kfs-capability:{tenant_id}:{caller_kind}:{principal_id}:{trace_id}",
        )
    )
    return CapabilityIssueRequest(
        actor=actor,
        authz_revision=revision.authz_revision.model_copy(update={"credential_revision": credential_revision}),
        caller_kind=caller_kind,
        content_policy_revision=revision.content_policy_revision,
        control_space_id=control_space_id,
        grant_id=grant_id,
        namespace_id=tenant_id,
        operation_id=capability_operation_id,
        principal_id=principal_id,
        resource=resource,
        trace_id=trace_id,
    )


def _trace_id(trace_id: str | None) -> str:
    normalized = (trace_id or str(uuid.uuid4())).strip()
    if not normalized:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS capability trace id is required")
    return normalized


def _operation_contract(operation_id: str) -> tuple[KnowledgeFSProductOperation, str]:
    product_operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(operation_id)
    if product_operation is None or not is_product_operation_ready(operation_id):
        raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")
    capability_operation_id = product_operation.capability_operation_id
    if capability_operation_id is None:
        raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")
    return product_operation, capability_operation_id


def _app_caller_kind(caller_kind: KnowledgeFSAppSpaceJoinType) -> CapabilityCallerKind:
    if caller_kind is KnowledgeFSAppSpaceJoinType.AGENT:
        return "agent"
    return "workflow"


__all__ = [
    "KnowledgeFSCapabilityBroker",
    "KnowledgeFSCapabilityIssuerPort",
    "KnowledgeFSIssuedProductCapability",
]
