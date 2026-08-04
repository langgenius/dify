"""Compatibility adapters for the workspace-member application service."""

from collections.abc import Mapping, Sequence
from typing import override

from configs import dify_config
from services.enterprise import rbac_service as enterprise_rbac_service
from services.workspace_member_query_service import (
    WorkspaceMemberRecord,
    WorkspaceMemberRole,
    WorkspaceMemberRoleGateway,
)


class LegacyWorkspaceMemberRoleGateway(WorkspaceMemberRoleGateway):
    """Preserve deployment-specific legacy and enterprise role behavior."""

    @override
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        members: Sequence[WorkspaceMemberRecord],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        records = tuple(members)
        if not records:
            return {}

        if not dify_config.RBAC_ENABLED:
            return {
                member.id: (WorkspaceMemberRole(id=member.legacy_role, name=member.legacy_role),)
                if member.legacy_role
                else ()
                for member in records
            }

        member_roles = enterprise_rbac_service.RBACService.MemberRoles.batch_get(
            workspace_id,
            actor_account_id,
            [member.id for member in records],
        )
        return {
            item.account_id: tuple(WorkspaceMemberRole(id=role.id, name=role.name) for role in item.roles)
            for item in member_roles
        }
