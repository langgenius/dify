"""Deployment-compatible role resolution for workspace-member queries."""

from collections.abc import Mapping, Sequence
from typing import override

from configs import dify_config
from services.enterprise import rbac_service as enterprise_rbac_service
from services.workspace_member_query_service import (
    WorkspaceMemberRole,
    WorkspaceMemberRoleResolver,
    WorkspaceMemberRoleSubject,
)


class DeploymentWorkspaceMemberRoleResolver(WorkspaceMemberRoleResolver):
    """Preserve deployment-specific legacy and enterprise role behavior."""

    @override
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        role_subjects = tuple(subjects)
        if not role_subjects:
            return {}

        if not dify_config.RBAC_ENABLED:
            return {
                subject.account_id: (WorkspaceMemberRole(id=subject.legacy_role, name=subject.legacy_role),)
                for subject in role_subjects
            }

        member_roles = enterprise_rbac_service.RBACService.MemberRoles.batch_get(
            workspace_id,
            actor_account_id,
            [subject.account_id for subject in role_subjects],
        )
        return {
            item.account_id: tuple(WorkspaceMemberRole(id=role.id, name=role.name) for role in item.roles)
            for item in member_roles
        }
