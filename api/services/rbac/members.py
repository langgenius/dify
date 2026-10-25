"""Member role assignment and permission snapshots without attached ORM state."""

from typing import Literal

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from services.errors.workspace import InvalidWorkspaceMemberRoleError
from services.rbac.builtin import builtin_member_roles, builtin_permissions
from services.rbac.contracts import MemberRolesResponse, MyPermissionsResponse, RBACResourceType
from services.rbac.ports import (
    MemberRolesGateway,
    PermissionsGateway,
    RBACMembers,
    RBACSettings,
    ResourcePermissionsGateway,
    WorkspaceMemberRoles,
)


class MemberService:
    def __init__(
        self,
        *,
        members: RBACMembers,
        workspace_roles: WorkspaceMemberRoles,
        roles: MemberRolesGateway,
        permissions: PermissionsGateway,
        apps: ResourcePermissionsGateway,
        datasets: ResourcePermissionsGateway,
        settings: RBACSettings,
    ) -> None:
        self._members = members
        self._workspace_roles = workspace_roles
        self._roles = roles
        self._permissions = permissions
        self._resource_permissions = {RBACResourceType.APP: apps, RBACResourceType.DATASET: datasets}
        self._settings = settings

    def get(self, context: RequestContext, member_id: str, *, language: str | None) -> MemberRolesResponse:
        if self._settings.enabled:
            return self._roles.get(context.active_workspace_id, context.account_id, member_id, language=language)
        role = self._members.member_role(context.active_workspace_id, member_id)
        return builtin_member_roles(context.active_workspace_id, member_id, role)

    def replace(
        self, context: RequestContext, member_id: str, role_ids: list[str], *, language: str | None
    ) -> MemberRolesResponse:
        if self._settings.enabled:
            return self._roles.replace(
                context.active_workspace_id, context.account_id, member_id, role_ids, language=language
            )
        if len(role_ids) != 1:
            raise InvalidWorkspaceMemberRoleError("Workspace member role update requires exactly one role.")
        self._workspace_roles.update_role(context.active_workspace_id, member_id, role_ids[0], context.account_id)
        return builtin_member_roles(context.active_workspace_id, member_id, TenantAccountRole(role_ids[0]))

    def permissions(
        self,
        workspace_id: str,
        account_id: str | None,
        *,
        app_id: str | None = None,
        dataset_id: str | None = None,
        agent_id: str | None = None,
        language: str | None = None,
    ) -> MyPermissionsResponse:
        if self._settings.enabled:
            return self._permissions.get(
                workspace_id,
                account_id,
                app_id=app_id,
                dataset_id=dataset_id,
                agent_id=agent_id,
                language=language,
            )
        return builtin_permissions(self._members.member_role(workspace_id, account_id))

    def resource_permissions(
        self,
        workspace_id: str,
        account_id: str | None,
        kind: Literal[RBACResourceType.APP, RBACResourceType.DATASET],
        resource_ids: list[str],
    ) -> dict[str, list[str]]:
        if not resource_ids:
            return {}
        if self._settings.enabled:
            return self._resource_permissions[kind].batch_get(workspace_id, account_id, resource_ids)
        keys = self.permissions(workspace_id, account_id).resource_snapshot(kind).default_permission_keys
        return {resource_id: list(keys) for resource_id in resource_ids}
