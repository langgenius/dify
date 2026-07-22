"""Dify-owned visibility, role, and enterprise RBAC authorization for KnowledgeFS."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session

from configs import dify_config
from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
)
from services.enterprise.rbac_service import RBACService
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission

logger = logging.getLogger(__name__)


class KnowledgeFSProductNotFoundError(RuntimeError):
    """A missing and an unauthorized control-space deliberately share one error."""


class KnowledgeFSProductRBACPort(Protocol):
    def permission_keys_by_control_space(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_ids: Sequence[str],
    ) -> dict[str, frozenset[KnowledgeFSProductPermission]]: ...

    def filter_authorized_control_space_ids(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_ids: Sequence[str],
        permission: KnowledgeFSProductPermission,
    ) -> frozenset[str]: ...

    def workspace_permission_allowed(
        self,
        *,
        tenant_id: str,
        account_id: str,
        permission: KnowledgeFSProductPermission,
    ) -> bool: ...


class DifyKnowledgeFSProductRBACPort:
    """Use one Enterprise batch request for a page; fail closed if it is unavailable."""

    def permission_keys_by_control_space(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_ids: Sequence[str],
    ) -> dict[str, frozenset[KnowledgeFSProductPermission]]:
        if not control_space_ids:
            return {}
        try:
            permissions = RBACService.KnowledgeFSPermissions.batch_get(
                tenant_id,
                account_id,
                list(control_space_ids),
                session=session,
            )
        except Exception:
            logger.warning("KnowledgeFS enterprise RBAC batch lookup failed for tenant_id=%s", tenant_id, exc_info=True)
            return {}
        return {
            control_space_id: frozenset(
                permission
                for permission in KnowledgeFSProductPermission
                if permission.value in permissions.get(control_space_id, ())
            )
            for control_space_id in control_space_ids
        }

    def filter_authorized_control_space_ids(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_ids: Sequence[str],
        permission: KnowledgeFSProductPermission,
    ) -> frozenset[str]:
        permissions = self.permission_keys_by_control_space(
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_ids=control_space_ids,
        )
        return frozenset(
            control_space_id
            for control_space_id, permission_keys in permissions.items()
            if permission in permission_keys
        )

    def workspace_permission_allowed(
        self,
        *,
        tenant_id: str,
        account_id: str,
        permission: KnowledgeFSProductPermission,
    ) -> bool:
        if not dify_config.RBAC_ENABLED:
            return True
        return RBACService.CheckAccess.check(
            tenant_id,
            account_id,
            scene=permission.value,
            resource_type=None,
            resource_id=None,
        )


_ROLE_PERMISSIONS: dict[KnowledgeFSControlSpacePermissionRole, frozenset[KnowledgeFSProductPermission]] = {
    KnowledgeFSControlSpacePermissionRole.OWNER: frozenset(KnowledgeFSProductPermission),
    KnowledgeFSControlSpacePermissionRole.EDITOR: frozenset(
        {
            KnowledgeFSProductPermission.READ,
            KnowledgeFSProductPermission.EDIT,
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            KnowledgeFSProductPermission.QUERY,
        }
    ),
    KnowledgeFSControlSpacePermissionRole.VIEWER: frozenset(
        {KnowledgeFSProductPermission.READ, KnowledgeFSProductPermission.QUERY}
    ),
}


def visible_control_space_statement(*, tenant_id: str, account_id: str) -> sa.Select[tuple[KnowledgeFSControlSpace]]:
    """Build the SQL visibility filter before pagination or any KFS request."""

    active_permission = sa.exists().where(
        KnowledgeFSControlSpacePermission.tenant_id == KnowledgeFSControlSpace.tenant_id,
        KnowledgeFSControlSpacePermission.control_space_id == KnowledgeFSControlSpace.id,
        KnowledgeFSControlSpacePermission.account_id == account_id,
        KnowledgeFSControlSpacePermission.status == KnowledgeFSControlSpacePermissionStatus.ACTIVE,
    )
    return sa.select(KnowledgeFSControlSpace).where(
        KnowledgeFSControlSpace.tenant_id == tenant_id,
        KnowledgeFSControlSpace.state != KnowledgeFSControlSpaceState.DELETED,
        sa.or_(
            KnowledgeFSControlSpace.owner_account_id == account_id,
            KnowledgeFSControlSpace.visibility == KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
            sa.and_(
                KnowledgeFSControlSpace.visibility == KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
                active_permission,
            ),
        ),
    )


def resolve_local_role(
    session: Session,
    *,
    control_space: KnowledgeFSControlSpace,
    account_id: str,
) -> KnowledgeFSControlSpacePermissionRole | None:
    if control_space.owner_account_id == account_id:
        return KnowledgeFSControlSpacePermissionRole.OWNER
    permission = session.scalar(
        sa.select(KnowledgeFSControlSpacePermission).where(
            KnowledgeFSControlSpacePermission.tenant_id == control_space.tenant_id,
            KnowledgeFSControlSpacePermission.control_space_id == control_space.id,
            KnowledgeFSControlSpacePermission.account_id == account_id,
            KnowledgeFSControlSpacePermission.status == KnowledgeFSControlSpacePermissionStatus.ACTIVE,
        )
    )
    if permission is not None:
        return permission.role
    if control_space.visibility is KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS:
        return KnowledgeFSControlSpacePermissionRole.VIEWER
    return None


def resolve_local_roles(
    session: Session,
    *,
    control_spaces: Sequence[KnowledgeFSControlSpace],
    account_id: str,
) -> dict[str, KnowledgeFSControlSpacePermissionRole | None]:
    if not control_spaces:
        return {}
    control_space_ids = tuple(control_space.id for control_space in control_spaces)
    tenant_ids = tuple({control_space.tenant_id for control_space in control_spaces})
    explicit_roles = {
        (permission.tenant_id, permission.control_space_id): permission.role
        for permission in session.scalars(
            sa.select(KnowledgeFSControlSpacePermission).where(
                KnowledgeFSControlSpacePermission.tenant_id.in_(tenant_ids),
                KnowledgeFSControlSpacePermission.control_space_id.in_(control_space_ids),
                KnowledgeFSControlSpacePermission.account_id == account_id,
                KnowledgeFSControlSpacePermission.status == KnowledgeFSControlSpacePermissionStatus.ACTIVE,
            )
        )
    }
    return {
        control_space.id: (
            KnowledgeFSControlSpacePermissionRole.OWNER
            if control_space.owner_account_id == account_id
            else explicit_roles.get((control_space.tenant_id, control_space.id))
            or (
                KnowledgeFSControlSpacePermissionRole.VIEWER
                if control_space.visibility is KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS
                else None
            )
        )
        for control_space in control_spaces
    }


def local_role_allows(
    role: KnowledgeFSControlSpacePermissionRole | None,
    permission: KnowledgeFSProductPermission,
) -> bool:
    return role is not None and permission in _ROLE_PERMISSIONS[role]


def effective_product_permissions(
    role: KnowledgeFSControlSpacePermissionRole | None,
    rbac_permissions: frozenset[KnowledgeFSProductPermission],
) -> tuple[KnowledgeFSProductPermission, ...]:
    if role is None:
        return ()
    return tuple(
        permission
        for permission in KnowledgeFSProductPermission
        if permission is not KnowledgeFSProductPermission.CREATE
        and permission in _ROLE_PERMISSIONS[role]
        and permission in rbac_permissions
    )


__all__ = [
    "DifyKnowledgeFSProductRBACPort",
    "KnowledgeFSProductNotFoundError",
    "KnowledgeFSProductRBACPort",
    "effective_product_permissions",
    "local_role_allows",
    "resolve_local_role",
    "resolve_local_roles",
    "visible_control_space_statement",
]
