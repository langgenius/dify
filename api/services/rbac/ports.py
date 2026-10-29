"""Ports required by the RBAC use cases; implementations live in gateways and repositories."""

from collections.abc import Sequence
from typing import Protocol

from enums.account import TenantAccountRole
from services.rbac.contracts import (
    AccessMatrixItem,
    AccessPolicy,
    AccessPolicyBindingState,
    AccessPolicyCreate,
    AccessPolicyUpdate,
    AgentAccessMatrix,
    AppAccessMatrix,
    DatasetAccessMatrix,
    DeleteMemberBindings,
    ListOption,
    MemberBindingsResponse,
    MemberRolesResponse,
    MembersInRole,
    MyPermissionsResponse,
    Paginated,
    PermissionCatalogResponse,
    RBACResourceType,
    RBACRole,
    ReplaceBindings,
    ReplaceMemberBindings,
    ReplaceUserAccessPolicies,
    ReplaceUserAccessPoliciesResponse,
    ResourceUserAccessPoliciesResponse,
    ResourceWhitelist,
    ResourceWhitelistConfig,
    RoleBindingsResponse,
    RoleMutation,
    WorkspaceAccessMatrix,
)
from services.workspace.contracts import WorkspaceMemberRecord


class RolesGateway(Protocol):
    def list(
        self,
        tenant_id: str,
        account_id: str | None = None,
        include_owner: int | None = None,
        biiling_enabled: bool | None = None,
        *,
        options: ListOption | None = None,
        language: str | None = None,
    ) -> Paginated[RBACRole]: ...

    def list_members_by_role(
        self,
        tenant_id: str,
        role_id: str | None = None,
        *,
        options: ListOption | None = None,
        language: str | None = None,
    ) -> Paginated[MembersInRole]: ...

    def get(
        self,
        tenant_id: str,
        account_id: str | None,
        role_id: str,
        billing_enabled: bool = True,
        *,
        language: str | None = None,
    ) -> RBACRole: ...

    def create(
        self, tenant_id: str, account_id: str | None, payload: RoleMutation, *, language: str | None = None
    ) -> RBACRole: ...

    def update(
        self,
        tenant_id: str,
        account_id: str | None,
        role_id: str,
        payload: RoleMutation,
        *,
        language: str | None = None,
    ) -> RBACRole: ...

    def delete(self, tenant_id: str, account_id: str | None, role_id: str, *, language: str | None = None) -> None: ...

    def copy(
        self,
        tenant_id: str,
        account_id: str | None,
        role_id: str,
        copy_member: bool = True,
        *,
        language: str | None = None,
    ) -> RBACRole: ...


class PoliciesGateway(Protocol):
    def list(
        self,
        tenant_id: str,
        account_id: str | None = None,
        *,
        resource_type: RBACResourceType | str | None = None,
        options: ListOption | None = None,
        language: str | None = None,
    ) -> Paginated[AccessPolicy]: ...

    def get(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> AccessPolicy: ...

    def create(
        self, tenant_id: str, account_id: str | None, payload: AccessPolicyCreate, *, language: str | None = None
    ) -> AccessPolicy: ...

    def update(
        self,
        tenant_id: str,
        account_id: str | None,
        policy_id: str,
        payload: AccessPolicyUpdate,
        *,
        language: str | None = None,
    ) -> AccessPolicy: ...

    def copy(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> AccessPolicy: ...

    def delete(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> None: ...


class PolicyBindingsGateway(Protocol):
    def lock(
        self, tenant_id: str, account_id: str | None, binding_id: str, *, language: str | None = None
    ) -> AccessPolicyBindingState: ...

    def unlock(
        self, tenant_id: str, account_id: str | None, binding_id: str, *, language: str | None = None
    ) -> AccessPolicyBindingState: ...


class CatalogGateway(Protocol):
    def workspace(
        self, tenant_id: str, account_id: str | None = None, *, language: str | None = None
    ) -> PermissionCatalogResponse: ...

    def app(
        self, tenant_id: str, account_id: str | None = None, *, language: str | None = None
    ) -> PermissionCatalogResponse: ...

    def dataset(
        self, tenant_id: str, account_id: str | None = None, *, language: str | None = None
    ) -> PermissionCatalogResponse: ...

    def agent(
        self, tenant_id: str, account_id: str | None = None, *, language: str | None = None
    ) -> PermissionCatalogResponse: ...


class ResourceAccessGateway(Protocol):
    def user_access_policies(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        *,
        options: ListOption | None = None,
        language: str | None = None,
    ) -> ResourceUserAccessPoliciesResponse: ...

    def replace_user_access_policies(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        target_account_id: str | None,
        payload: ReplaceUserAccessPolicies,
        *,
        language: str | None = None,
    ) -> ReplaceUserAccessPoliciesResponse: ...

    def whitelist(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> ResourceWhitelist: ...

    def whitelist_config(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> ResourceWhitelistConfig: ...

    def replace_whitelist(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        payload: ReplaceMemberBindings,
        *,
        language: str | None = None,
    ) -> ResourceWhitelist: ...

    def matrix(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> AppAccessMatrix | DatasetAccessMatrix | AgentAccessMatrix: ...

    def list_role_bindings(
        self, tenant_id: str, account_id: str | None, resource_id: str, policy_id: str, *, language: str | None = None
    ) -> RoleBindingsResponse: ...

    def list_member_bindings(
        self, tenant_id: str, account_id: str | None, resource_id: str, policy_id: str, *, language: str | None = None
    ) -> MemberBindingsResponse: ...

    def delete_member_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
        payload: DeleteMemberBindings,
        *,
        language: str | None = None,
    ) -> None: ...


class WorkspaceAccessGateway(Protocol):
    def matrix(
        self,
        tenant_id: str,
        account_id: str | None = None,
        *,
        options: ListOption | None = None,
        language: str | None = None,
    ) -> WorkspaceAccessMatrix: ...

    def list_role_bindings(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> RoleBindingsResponse: ...

    def list_member_bindings(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> MemberBindingsResponse: ...

    def replace_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        policy_id: str,
        payload: ReplaceBindings,
        *,
        language: str | None = None,
    ) -> AccessMatrixItem: ...


class RBACSettings(Protocol):
    @property
    def enabled(self) -> bool: ...
    @property
    def billing_enabled(self) -> bool: ...
    @property
    def dataset_operator_enabled(self) -> bool: ...


class ResourceAccessClients(Protocol):
    def resource(self, kind: RBACResourceType) -> ResourceAccessGateway: ...
    def workspace(self, kind: RBACResourceType) -> WorkspaceAccessGateway: ...
    def catalog(
        self, kind: RBACResourceType, tenant_id: str, account_id: str, *, language: str | None
    ) -> PermissionCatalogResponse: ...


class RBACMembers(Protocol):
    def member_role(self, workspace_id: str, account_id: str | None) -> TenantAccountRole | None: ...
    def list_for_workspace(
        self, workspace_id: str, *, account_ids: Sequence[str]
    ) -> Sequence[WorkspaceMemberRecord]: ...


class WorkspaceMemberRoles(Protocol):
    def update_role(self, workspace_id: str, member_id: str, new_role: str, operator_id: str) -> None: ...


class ResourceMaintainers(Protocol):
    def get_maintainer_id(self, workspace_id: str, resource_id: str) -> str | None: ...


class AccessInitializer(Protocol):
    def initialize(self, tenant_id: str, account_id: str, kind: RBACResourceType, resource_id: str) -> None: ...


class MemberRolesGateway(Protocol):
    def get(
        self, tenant_id: str, account_id: str | None, member_account_id: str, *, language: str | None = None
    ) -> MemberRolesResponse: ...
    def replace(
        self,
        tenant_id: str,
        account_id: str | None,
        member_account_id: str,
        role_ids: list[str],
        *,
        language: str | None = None,
    ) -> MemberRolesResponse: ...


class PermissionsGateway(Protocol):
    def get(
        self,
        tenant_id: str,
        account_id: str | None,
        *,
        app_id: str | None = None,
        dataset_id: str | None = None,
        agent_id: str | None = None,
        language: str | None = None,
    ) -> MyPermissionsResponse: ...


class ResourcePermissionsGateway(Protocol):
    def batch_get(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_ids: list[str],
        /,
        *,
        language: str | None = None,
    ) -> dict[str, list[str]]: ...
