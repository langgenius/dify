"""Dify-owned KnowledgeFS members, visibility, and external-access mutations."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models import TenantAccountJoin
from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSExternalAccessPolicy,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSExternalAccessResponse,
    KnowledgeFSMemberBindingPayload,
    KnowledgeFSPermissionListResponse,
    KnowledgeFSPermissionResponse,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_service import KnowledgeFSProductService
from services.knowledge_fs.revocation_commands import (
    KnowledgeFSRevocationCommandPort,
    KnowledgeFSRevocationCommandProducer,
)


class KnowledgeFSControlPlaneInvariantError(RuntimeError):
    """Required authorization revision state is absent or inconsistent."""


class KnowledgeFSWorkspaceMemberPort(Protocol):
    def are_active_members(self, *, session: Session, tenant_id: str, account_ids: Sequence[str]) -> bool: ...


class SQLKnowledgeFSWorkspaceMemberPort:
    def are_active_members(self, *, session: Session, tenant_id: str, account_ids: Sequence[str]) -> bool:
        unique_ids = frozenset(account_ids)
        if not unique_ids:
            return True
        found = frozenset(
            session.scalars(
                sa.select(TenantAccountJoin.account_id).where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id.in_(unique_ids),
                )
            )
        )
        return found == unique_ids


class KnowledgeFSControlPlaneService:
    """Mutate Dify authorization state after product authorization succeeds."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        product: KnowledgeFSProductService,
        members: KnowledgeFSWorkspaceMemberPort,
        revocations: KnowledgeFSRevocationCommandPort | None = None,
    ) -> None:
        self._session_maker = session_maker
        self._product = product
        self._members = members
        self._revocations = revocations or KnowledgeFSRevocationCommandProducer()

    def list_permissions(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
    ) -> KnowledgeFSPermissionListResponse:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.ACCESS_CONFIG,
        )
        with self._session_maker() as session:
            permissions = tuple(
                session.scalars(
                    sa.select(KnowledgeFSControlSpacePermission)
                    .where(
                        KnowledgeFSControlSpacePermission.tenant_id == tenant_id,
                        KnowledgeFSControlSpacePermission.control_space_id == control_space_id,
                    )
                    .order_by(KnowledgeFSControlSpacePermission.account_id)
                )
            )
        return KnowledgeFSPermissionListResponse(
            data=[
                KnowledgeFSPermissionResponse(
                    account_id=permission.account_id,
                    role=permission.role,
                    status=permission.status.value,
                    revision=permission.revision,
                )
                for permission in permissions
            ]
        )

    def replace_members(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        members: Sequence[KnowledgeFSMemberBindingPayload],
    ) -> KnowledgeFSPermissionListResponse:
        authorized = self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.ACCESS_CONFIG,
        )
        desired = {member.account_id: member.role for member in members}
        if len(desired) != len(members) or authorized.control_space.owner_account_id in desired:
            raise KnowledgeFSControlPlaneInvariantError("Member bindings must be unique and exclude the owner")
        with self._session_maker.begin() as session:
            control_space = session.scalar(
                sa.select(KnowledgeFSControlSpace)
                .where(
                    KnowledgeFSControlSpace.tenant_id == tenant_id,
                    KnowledgeFSControlSpace.id == control_space_id,
                )
                .with_for_update()
            )
            if control_space is None:
                raise KnowledgeFSControlPlaneInvariantError("Control-space disappeared during member update")
            if not self._members.are_active_members(
                session=session,
                tenant_id=tenant_id,
                account_ids=tuple(desired),
            ):
                raise KnowledgeFSControlPlaneInvariantError("Every KnowledgeFS member must belong to the workspace")
            existing = {
                permission.account_id: permission
                for permission in session.scalars(
                    sa.select(KnowledgeFSControlSpacePermission).where(
                        KnowledgeFSControlSpacePermission.tenant_id == tenant_id,
                        KnowledgeFSControlSpacePermission.control_space_id == control_space_id,
                        KnowledgeFSControlSpacePermission.account_id != control_space.owner_account_id,
                    )
                )
            }
            now = naive_utc_now()
            revoke_reasons_by_account: dict[str, str] = {}
            for account_id, permission in existing.items():
                role = desired.pop(account_id, None)
                if role is None:
                    if permission.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE:
                        permission.status = KnowledgeFSControlSpacePermissionStatus.REVOKED
                        permission.revision += 1
                        permission.revoked_at = now
                        permission.revoked_by_account_id = actor_account_id
                        revoke_reasons_by_account[account_id] = "permission_revoked"
                elif (
                    permission.role is not role
                    or permission.status is not KnowledgeFSControlSpacePermissionStatus.ACTIVE
                ):
                    previous_role = permission.role
                    was_active = permission.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE
                    permission.role = role
                    permission.status = KnowledgeFSControlSpacePermissionStatus.ACTIVE
                    permission.revision += 1
                    permission.revoked_at = None
                    permission.revoked_by_account_id = None
                    if was_active and _permission_role_is_narrower(previous_role, role):
                        revoke_reasons_by_account[account_id] = "permission_role_narrowed"
            for account_id, role in desired.items():
                session.add(
                    KnowledgeFSControlSpacePermission(
                        tenant_id=tenant_id,
                        control_space_id=control_space_id,
                        account_id=account_id,
                        role=role,
                        granted_by_account_id=actor_account_id,
                    )
                )
            revision = _authorization_revision(session, tenant_id=tenant_id, control_space_id=control_space_id)
            revision.space_acl_epoch += 1
            for account_id, reason_code in revoke_reasons_by_account.items():
                self._revocations.enqueue_principal_grants(
                    session=session,
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    subject=f"dify-account:{account_id}",
                    reason_code=reason_code,
                    caller_kinds=("interactive",),
                )
        return self.list_permissions(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )

    def update_visibility(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        visibility: KnowledgeFSControlSpaceVisibility,
    ) -> None:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.ACCESS_CONFIG,
        )
        with self._session_maker.begin() as session:
            control_space = session.scalar(
                sa.select(KnowledgeFSControlSpace)
                .where(
                    KnowledgeFSControlSpace.tenant_id == tenant_id,
                    KnowledgeFSControlSpace.id == control_space_id,
                )
                .with_for_update()
            )
            if control_space is None:
                raise KnowledgeFSControlPlaneInvariantError("Control-space disappeared during visibility update")
            if control_space.visibility is visibility:
                return
            previous_visibility = control_space.visibility
            control_space.visibility = visibility
            control_space.resource_version += 1
            revision = _authorization_revision(session, tenant_id=tenant_id, control_space_id=control_space_id)
            revision.space_acl_epoch += 1
            if _visibility_is_narrower(previous_visibility, visibility):
                active_member_subjects = {
                    f"dify-account:{account_id}"
                    for account_id in session.scalars(
                        sa.select(KnowledgeFSControlSpacePermission.account_id).where(
                            KnowledgeFSControlSpacePermission.tenant_id == tenant_id,
                            KnowledgeFSControlSpacePermission.control_space_id == control_space_id,
                            KnowledgeFSControlSpacePermission.status == KnowledgeFSControlSpacePermissionStatus.ACTIVE,
                            KnowledgeFSControlSpacePermission.account_id != control_space.owner_account_id,
                        )
                    )
                }
                if previous_visibility is KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS:
                    allowed_subjects = {f"dify-account:{control_space.owner_account_id}"}
                    if visibility is KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS:
                        allowed_subjects.update(active_member_subjects)
                    self._revocations.enqueue_control_space_grants(
                        session=session,
                        tenant_id=tenant_id,
                        control_space_id=control_space_id,
                        reason_code="visibility_narrowed",
                        caller_kinds=("interactive",),
                        excluded_subjects=tuple(sorted(allowed_subjects)),
                    )
                else:
                    for subject in sorted(active_member_subjects):
                        self._revocations.enqueue_principal_grants(
                            session=session,
                            tenant_id=tenant_id,
                            control_space_id=control_space_id,
                            subject=subject,
                            reason_code="visibility_narrowed",
                            caller_kinds=("interactive",),
                        )

    def get_external_access(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
    ) -> KnowledgeFSExternalAccessResponse:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.ACCESS_CONFIG,
        )
        with self._session_maker() as session:
            policy = session.scalar(
                sa.select(KnowledgeFSExternalAccessPolicy).where(
                    KnowledgeFSExternalAccessPolicy.tenant_id == tenant_id,
                    KnowledgeFSExternalAccessPolicy.control_space_id == control_space_id,
                )
            )
        return _external_access_response(policy)

    def update_external_access(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        payload: KnowledgeFSExternalAccessPayload,
    ) -> KnowledgeFSExternalAccessResponse:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.ACCESS_CONFIG,
        )
        with self._session_maker.begin() as session:
            policy = session.scalar(
                sa.select(KnowledgeFSExternalAccessPolicy)
                .where(
                    KnowledgeFSExternalAccessPolicy.tenant_id == tenant_id,
                    KnowledgeFSExternalAccessPolicy.control_space_id == control_space_id,
                )
                .with_for_update()
            )
            if policy is None:
                policy = KnowledgeFSExternalAccessPolicy(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                )
                session.add(policy)
                session.flush()
            previous_channels = {
                "service": policy.service_api_enabled,
                "agent": policy.agent_enabled,
                "workflow": policy.workflow_enabled,
                "mcp": policy.mcp_enabled,
            }
            requested_channels = {
                "service": payload.service_api_enabled,
                "agent": payload.agent_enabled,
                "workflow": payload.workflow_enabled,
                "mcp": payload.mcp_enabled,
            }
            if previous_channels == requested_channels:
                return _external_access_response(policy)
            policy.service_api_enabled = payload.service_api_enabled
            policy.agent_enabled = payload.agent_enabled
            policy.workflow_enabled = payload.workflow_enabled
            policy.mcp_enabled = payload.mcp_enabled
            policy.revision += 1
            policy.updated_by_account_id = actor_account_id
            revision = _authorization_revision(session, tenant_id=tenant_id, control_space_id=control_space_id)
            revision.external_access_epoch += 1
            disabled_callers = tuple(
                caller_kind
                for caller_kind, was_enabled in previous_channels.items()
                if was_enabled and not requested_channels[caller_kind]
            )
            if disabled_callers:
                self._revocations.enqueue_control_space_grants(
                    session=session,
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    reason_code="external_access_revoked",
                    caller_kinds=disabled_callers,
                )
            session.flush()
            response = _external_access_response(policy)
        return response


def _permission_role_is_narrower(
    previous: KnowledgeFSControlSpacePermissionRole,
    current: KnowledgeFSControlSpacePermissionRole,
) -> bool:
    rank = {
        KnowledgeFSControlSpacePermissionRole.VIEWER: 0,
        KnowledgeFSControlSpacePermissionRole.EDITOR: 1,
        KnowledgeFSControlSpacePermissionRole.OWNER: 2,
    }
    return rank[current] < rank[previous]


def _authorization_revision(
    session: Session,
    *,
    tenant_id: str,
    control_space_id: str,
) -> KnowledgeFSAuthorizationRevision:
    revision = session.scalar(
        sa.select(KnowledgeFSAuthorizationRevision)
        .where(
            KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
            KnowledgeFSAuthorizationRevision.control_space_id == control_space_id,
        )
        .with_for_update()
    )
    if revision is None:
        raise KnowledgeFSControlPlaneInvariantError("KnowledgeFS authorization revision is missing")
    return revision


def _visibility_is_narrower(
    previous: KnowledgeFSControlSpaceVisibility,
    requested: KnowledgeFSControlSpaceVisibility,
) -> bool:
    return (
        previous is KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS
        and requested
        in {
            KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
            KnowledgeFSControlSpaceVisibility.ONLY_ME,
        }
    ) or (
        previous is KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS
        and requested is KnowledgeFSControlSpaceVisibility.ONLY_ME
    )


def _external_access_response(policy: KnowledgeFSExternalAccessPolicy | None) -> KnowledgeFSExternalAccessResponse:
    return KnowledgeFSExternalAccessResponse(
        service_api_enabled=policy.service_api_enabled if policy else False,
        agent_enabled=policy.agent_enabled if policy else False,
        workflow_enabled=policy.workflow_enabled if policy else False,
        mcp_enabled=policy.mcp_enabled if policy else False,
        revision=policy.revision if policy else 0,
    )


__all__ = [
    "KnowledgeFSControlPlaneInvariantError",
    "KnowledgeFSControlPlaneService",
    "KnowledgeFSWorkspaceMemberPort",
    "SQLKnowledgeFSWorkspaceMemberPort",
]
