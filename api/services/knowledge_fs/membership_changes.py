"""Transactional KnowledgeFS authorization effects of Dify Workspace membership changes."""

from __future__ import annotations

from collections.abc import Sequence
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
)
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandProducer

_MAX_SAFE_INTEGER = 2**53 - 1


class KnowledgeFSWorkspaceMembershipChange(StrEnum):
    MEMBER_ADDED = "member_added"
    MEMBER_REMOVED = "member_removed"
    ROLE_CHANGED = "role_changed"


class KnowledgeFSMembershipChangeInvariantError(RuntimeError):
    """Workspace membership state cannot be applied safely to KnowledgeFS authorization."""


def knowledge_fs_membership_schema_installed(session: Session) -> bool:
    """Support additive rollout and lightweight tests before the control-plane table exists."""
    return sa.inspect(session.connection()).has_table(KnowledgeFSControlSpace.__tablename__)


def apply_workspace_membership_change(
    *,
    session: Session,
    tenant_id: str,
    actor_account_id: str,
    account_ids: Sequence[str],
    change: KnowledgeFSWorkspaceMembershipChange,
    removed_account_id: str | None = None,
    replacement_owner_account_id: str | None = None,
) -> None:
    """Advance every Space epoch and append revokes in the caller's membership transaction."""
    normalized_tenant_id = _identifier(tenant_id, "tenant_id")
    normalized_actor_id = _identifier(actor_account_id, "actor_account_id")
    normalized_accounts = tuple(dict.fromkeys(_identifier(value, "account_id") for value in account_ids))
    if not normalized_accounts:
        raise KnowledgeFSMembershipChangeInvariantError("Membership change requires an affected account")
    normalized_removed_id = _optional_identifier(removed_account_id, "removed_account_id")
    normalized_replacement_id = _optional_identifier(
        replacement_owner_account_id,
        "replacement_owner_account_id",
    )
    if change is KnowledgeFSWorkspaceMembershipChange.MEMBER_REMOVED:
        if normalized_removed_id not in normalized_accounts or normalized_replacement_id is None:
            raise KnowledgeFSMembershipChangeInvariantError(
                "Member removal requires the removed account and replacement Workspace owner"
            )
        if normalized_removed_id == normalized_replacement_id:
            raise KnowledgeFSMembershipChangeInvariantError("Removed member cannot remain the replacement owner")
    elif normalized_removed_id is not None or normalized_replacement_id is not None:
        raise KnowledgeFSMembershipChangeInvariantError("Owner replacement is valid only for member removal")

    if not knowledge_fs_membership_schema_installed(session):
        return
    spaces, revisions = _lock_workspace_authorization(session, normalized_tenant_id)
    if not spaces:
        return

    producer = KnowledgeFSRevocationCommandProducer()
    for space in spaces:
        revision = revisions[space.id]
        if revision.membership_epoch >= _MAX_SAFE_INTEGER:
            raise KnowledgeFSMembershipChangeInvariantError("KnowledgeFS membership epoch is exhausted")
        revision.membership_epoch += 1

        acl_changed = False
        if normalized_removed_id is not None and normalized_replacement_id is not None:
            acl_changed = _remove_space_member(
                session=session,
                space=space,
                removed_account_id=normalized_removed_id,
                replacement_owner_account_id=normalized_replacement_id,
                actor_account_id=normalized_actor_id,
            )
            if acl_changed:
                if revision.space_acl_epoch >= _MAX_SAFE_INTEGER:
                    raise KnowledgeFSMembershipChangeInvariantError("KnowledgeFS Space ACL epoch is exhausted")
                revision.space_acl_epoch += 1

        if change is KnowledgeFSWorkspaceMembershipChange.MEMBER_ADDED:
            continue
        reason_code = (
            "workspace_membership_removed"
            if change is KnowledgeFSWorkspaceMembershipChange.MEMBER_REMOVED
            else "workspace_role_changed"
        )
        for account_id in normalized_accounts:
            producer.enqueue_principal_grants(
                session=session,
                tenant_id=normalized_tenant_id,
                control_space_id=space.id,
                subject=f"dify-account:{account_id}",
                reason_code=reason_code,
                caller_kinds=("interactive",),
            )


def apply_workspace_rbac_role_change(*, session: Session, tenant_id: str) -> None:
    """Advance Workspace membership epochs and revoke every interactive grant.

    Custom Enterprise RBAC role edits can affect any member bound to the role,
    while Dify deliberately does not mirror those bindings locally. The safe
    invalidation therefore scans durable grant provenance per control-space
    instead of relying on a potentially incomplete member list.
    """
    normalized_tenant_id = _identifier(tenant_id, "tenant_id")
    if not knowledge_fs_membership_schema_installed(session):
        return
    spaces, revisions = _lock_workspace_authorization(session, normalized_tenant_id)
    if not spaces:
        return

    producer = KnowledgeFSRevocationCommandProducer()
    for space in spaces:
        revision = revisions[space.id]
        if revision.membership_epoch >= _MAX_SAFE_INTEGER:
            raise KnowledgeFSMembershipChangeInvariantError("KnowledgeFS membership epoch is exhausted")
        revision.membership_epoch += 1
        producer.enqueue_control_space_grants(
            session=session,
            tenant_id=normalized_tenant_id,
            control_space_id=space.id,
            reason_code="workspace_rbac_role_changed",
            caller_kinds=("interactive",),
        )


def _lock_workspace_authorization(
    session: Session,
    tenant_id: str,
) -> tuple[tuple[KnowledgeFSControlSpace, ...], dict[str, KnowledgeFSAuthorizationRevision]]:
    spaces = tuple(
        session.scalars(
            sa.select(KnowledgeFSControlSpace)
            .where(KnowledgeFSControlSpace.tenant_id == tenant_id)
            .order_by(KnowledgeFSControlSpace.id)
            .with_for_update()
        )
    )
    if not spaces:
        return (), {}
    revisions = {
        revision.control_space_id: revision
        for revision in session.scalars(
            sa.select(KnowledgeFSAuthorizationRevision)
            .where(
                KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
                KnowledgeFSAuthorizationRevision.control_space_id.in_(space.id for space in spaces),
            )
            .order_by(KnowledgeFSAuthorizationRevision.control_space_id)
            .with_for_update()
        )
    }
    if len(revisions) != len(spaces):
        raise KnowledgeFSMembershipChangeInvariantError("KnowledgeFS authorization revision is missing")
    return spaces, revisions


def _remove_space_member(
    *,
    session: Session,
    space: KnowledgeFSControlSpace,
    removed_account_id: str,
    replacement_owner_account_id: str,
    actor_account_id: str,
) -> bool:
    permissions = {
        permission.account_id: permission
        for permission in session.scalars(
            sa.select(KnowledgeFSControlSpacePermission)
            .where(
                KnowledgeFSControlSpacePermission.tenant_id == space.tenant_id,
                KnowledgeFSControlSpacePermission.control_space_id == space.id,
                KnowledgeFSControlSpacePermission.account_id.in_((removed_account_id, replacement_owner_account_id)),
            )
            .with_for_update()
        )
    }
    changed = False
    now = naive_utc_now()
    removed_permission = permissions.get(removed_account_id)
    if removed_permission is not None and (removed_permission.status is KnowledgeFSControlSpacePermissionStatus.ACTIVE):
        removed_permission.status = KnowledgeFSControlSpacePermissionStatus.REVOKED
        removed_permission.revision += 1
        removed_permission.revoked_at = now
        removed_permission.revoked_by_account_id = actor_account_id
        changed = True

    if space.owner_account_id != removed_account_id:
        return changed
    space.owner_account_id = replacement_owner_account_id
    space.resource_version += 1
    replacement_permission = permissions.get(replacement_owner_account_id)
    if replacement_permission is None:
        session.add(
            KnowledgeFSControlSpacePermission(
                tenant_id=space.tenant_id,
                control_space_id=space.id,
                account_id=replacement_owner_account_id,
                role=KnowledgeFSControlSpacePermissionRole.OWNER,
                granted_by_account_id=actor_account_id,
            )
        )
    elif (
        replacement_permission.role is not KnowledgeFSControlSpacePermissionRole.OWNER
        or replacement_permission.status is not KnowledgeFSControlSpacePermissionStatus.ACTIVE
    ):
        replacement_permission.role = KnowledgeFSControlSpacePermissionRole.OWNER
        replacement_permission.status = KnowledgeFSControlSpacePermissionStatus.ACTIVE
        replacement_permission.revision += 1
        replacement_permission.revoked_at = None
        replacement_permission.revoked_by_account_id = None
    return True


def _identifier(value: str, field: str) -> str:
    normalized = value.strip()
    if not normalized or normalized != value or len(normalized) > 255:
        raise KnowledgeFSMembershipChangeInvariantError(f"{field} must be a normalized identifier")
    return normalized


def _optional_identifier(value: str | None, field: str) -> str | None:
    return None if value is None else _identifier(value, field)


__all__ = [
    "KnowledgeFSMembershipChangeInvariantError",
    "KnowledgeFSWorkspaceMembershipChange",
    "apply_workspace_membership_change",
    "apply_workspace_rbac_role_change",
    "knowledge_fs_membership_schema_installed",
]
