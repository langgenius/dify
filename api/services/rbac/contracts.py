"""RBAC data shared by applications and gateways, independent of their implementations."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class _RBACModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Pagination(_RBACModel):
    total_count: int = 0
    per_page: int = 0
    current_page: int = 0
    total_pages: int = 0


class Paginated[T](_RBACModel):
    data: list[T] = Field(default_factory=list)
    pagination: Pagination | None = None


class MembersInRole(_RBACModel):
    account_id: str = ""
    account_name: str = ""


@dataclass(frozen=True)
class _ResourceAccessRoute:
    segment: str
    id_param: str


class RBACResourceType(StrEnum):
    """Resource types understood by access policies."""

    APP = "app"
    DATASET = "dataset"
    AGENT = "agent"

    @property
    def route(self) -> _ResourceAccessRoute:
        routes = {
            RBACResourceType.APP: _ResourceAccessRoute("apps", "app_id"),
            RBACResourceType.DATASET: _ResourceAccessRoute("datasets", "dataset_id"),
            RBACResourceType.AGENT: _ResourceAccessRoute("agents", "agent_id"),
        }
        return routes[self]


class RBACRoleType(StrEnum):
    """The only concrete role type after the access-policy refactor."""

    WORKSPACE = "workspace"


class PermissionCatalogItem(_RBACModel):
    key: str
    name: str
    description: str = ""


class PermissionCatalogGroup(_RBACModel):
    group_key: str
    group_name: str
    description: str = ""
    permissions: list[PermissionCatalogItem] = Field(default_factory=list)


class PermissionCatalogResponse(_RBACModel):
    groups: list[PermissionCatalogGroup] = Field(default_factory=list)


class RBACRole(_RBACModel):
    id: str
    tenant_id: str | None = None
    type: str
    category: str = ""
    name: str
    description: str = ""
    is_builtin: bool = False
    permission_keys: list[str] = Field(default_factory=list)
    role_tag: str = ""

    @field_validator("permission_keys", mode="before")
    @classmethod
    def _coerce_permission_keys(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class RBACRoleAccount(_RBACModel):
    account_id: str
    account_name: str = ""
    email: str = ""
    avatar: str = ""


class ResourcePermissionKeys(_RBACModel):
    resource_id: str
    permission_keys: list[str] = Field(default_factory=list)


class AccessPolicy(_RBACModel):
    id: str
    tenant_id: str = ""
    resource_type: str
    policy_key: str = ""
    name: str
    description: str = ""
    permission_keys: list[str] = Field(default_factory=list)
    is_builtin: bool = False
    category: str = ""
    created_at: int = 0
    updated_at: int = 0

    @field_validator("permission_keys", mode="before")
    @classmethod
    def _coerce_permission_keys(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class AccessPolicyRoleBinding(_RBACModel):
    id: str
    tenant_id: str = ""
    access_policy_id: str
    resource_type: str
    resource_id: str = ""
    role_id: str
    role_name: str = ""
    created_at: int = 0


class AccessPolicyMemberBinding(_RBACModel):
    id: str
    tenant_id: str = ""
    access_policy_id: str
    resource_type: str
    resource_id: str = ""
    account_id: str
    account_name: str = ""
    created_at: int = 0


class AccessPolicyBindingState(_RBACModel):
    binding_id: str
    is_locked: bool = False


class AccessPolicyRole(BaseModel):
    role_id: str
    role_name: str
    binding_id: str
    is_locked: bool = False
    role_tag: str = ""


class AccessPolicyAccount(BaseModel):
    account_id: str
    account_name: str
    binding_id: str
    is_locked: bool = False
    avatar: str = ""
    email: str = ""


class AccessMatrixItem(_RBACModel):
    policy: AccessPolicy | None = None
    roles: list[AccessPolicyRole] = Field(default_factory=list)
    accounts: list[AccessPolicyAccount] = Field(default_factory=list)

    @field_validator("roles", "accounts", mode="before")
    @classmethod
    def _coerce_empty_lists(cls, value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []
        return value


class AppAccessMatrix(_RBACModel):
    app_id: str = Field(default="", validation_alias=AliasChoices("app_id", "resource_id"))
    items: list[AccessMatrixItem] = Field(default_factory=list)


class DatasetAccessMatrix(_RBACModel):
    dataset_id: str = Field(default="", validation_alias=AliasChoices("dataset_id", "resource_id"))
    items: list[AccessMatrixItem] = Field(default_factory=list)


class AgentAccessMatrix(_RBACModel):
    agent_id: str = Field(default="", validation_alias=AliasChoices("agent_id", "resource_id"))
    items: list[AccessMatrixItem] = Field(default_factory=list)


class WorkspaceAccessMatrix(_RBACModel):
    items: list[AccessMatrixItem] = Field(default_factory=list)
    pagination: Pagination | None = None


class RoleBindingsResponse(_RBACModel):
    data: list[AccessPolicyRoleBinding] = Field(default_factory=list)


class MemberBindingsResponse(_RBACModel):
    data: list[AccessPolicyMemberBinding] = Field(default_factory=list)


class ResourceWhitelist(_RBACModel):
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class ResourceWhitelistConfig(_RBACModel):
    automatic_include_workspace_members: bool


class ResourceWhitelistConfigResource(_RBACModel):
    resource_type: RBACResourceType
    resource_id: str


class ResourceWhitelistConfigItem(_RBACModel):
    resource_type: RBACResourceType
    resource_id: str
    automatic_include_workspace_members: bool = False
    account_ids: list[str] = Field(default_factory=list)
    rbac_whitelist_scope: str | None = Field(
        default=None, validation_alias=AliasChoices("rbac_whitelist_scope", "scope")
    )

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class ResourceWhitelistConfigsResponse(_RBACModel):
    data: list[ResourceWhitelistConfigItem] = Field(default_factory=list)


class _ResourceWhitelistConfigSnapshot(_RBACModel):
    """RBAC service's pre-toggle whitelist payload, used only by data migrations."""

    account_ids: list[str] = Field(default_factory=list)
    rbac_whitelist_scope: str | None = Field(
        default=None, validation_alias=AliasChoices("rbac_whitelist_scope", "scope")
    )

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class AgentRoleMigration(_RBACModel):
    role_id: str
    role_name: str = ""
    added_keys: list[str] = Field(default_factory=list)
    removed_keys: list[str] = Field(default_factory=list)
    bound_policies: list[str] = Field(default_factory=list)
    skipped: str = ""


class AgentMigrationReport(_RBACModel):
    roles: list[AgentRoleMigration] = Field(default_factory=list)
    role_templates: list[AgentRoleMigration] = Field(default_factory=list)


class ConfiguredAgentIDs(_RBACModel):
    configured_agent_ids: list[str] = Field(default_factory=list)


class ResourceWhitelistResources(_RBACModel):
    unrestricted: bool = False
    resource_ids: list[str] = Field(default_factory=list)

    @field_validator("resource_ids", mode="before")
    @classmethod
    def _coerce_resource_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class ResourceUserAccessPolicies(_RBACModel):
    account: RBACRoleAccount
    roles: list[RBACRole] = Field(default_factory=list)
    access_policies: list[AccessPolicy] = Field(default_factory=list)

    @field_validator("access_policies", "roles", mode="before")
    @classmethod
    def _coerce_none_to_list(cls, value: Any) -> Any:
        if value is None:
            return []
        return value


class ResourceUserAccessPoliciesResponse(_RBACModel):
    data: list[ResourceUserAccessPolicies] = Field(default_factory=list)
    pagination: Pagination | None = None


class ReplaceUserAccessPolicies(_RBACModel):
    access_policy_ids: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("access_policy_ids", mode="before")
    @classmethod
    def _coerce_access_policy_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class ReplaceUserAccessPoliciesResponse(_RBACModel):
    access_policies: list[AccessPolicy] = Field(default_factory=list)


class AppendAppWhitelistMembersBatchItem(_RBACModel):
    app_id: str
    account_ids: list[str] = Field(default_factory=list)
    policy_id: str


class AppendDatasetWhitelistMembersBatchItem(_RBACModel):
    dataset_id: str
    account_ids: list[str] = Field(default_factory=list)
    policy_id: str


class AppendAgentWhitelistMembersBatchItem(_RBACModel):
    agent_id: str
    account_ids: list[str] = Field(default_factory=list)
    policy_id: str


class MemberRolesResponse(_RBACModel):
    account_id: str
    roles: list[RBACRole] = Field(default_factory=list)


class WorkspacePermissionSnapshot(_RBACModel):
    permission_keys: list[str] = Field(default_factory=list)


class ResourcePermissionSnapshot(_RBACModel):
    default_permission_keys: list[str] = Field(default_factory=list)
    overrides: list[ResourcePermissionKeys] = Field(default_factory=list)

    def permission_keys_by_resource_ids(self, resource_ids: list[str]) -> dict[str, list[str]]:
        result = {str(resource_id): list(self.default_permission_keys) for resource_id in resource_ids}
        for override in self.overrides:
            resource_id = str(override.resource_id)
            if resource_id in result:
                result[resource_id] = list(override.permission_keys)
        return result


class MyPermissionsResponse(_RBACModel):
    workspace: WorkspacePermissionSnapshot = Field(default_factory=WorkspacePermissionSnapshot)
    app: ResourcePermissionSnapshot = Field(default_factory=ResourcePermissionSnapshot)
    dataset: ResourcePermissionSnapshot = Field(default_factory=ResourcePermissionSnapshot)
    agent: ResourcePermissionSnapshot = Field(default_factory=ResourcePermissionSnapshot)

    def resource_snapshot(self, resource_type: RBACResourceType) -> ResourcePermissionSnapshot:
        return {
            RBACResourceType.APP: self.app,
            RBACResourceType.DATASET: self.dataset,
            RBACResourceType.AGENT: self.agent,
        }[resource_type]


class RoleMutation(_RBACModel):
    """Payload shared by role create & update.

    ``type`` defaults to ``workspace`` because that is the only concrete role
    type supported by the enterprise backend today (see biz.RBACRoleType).
    """

    name: str
    description: str = ""
    permission_keys: list[str] = Field(default_factory=list)
    type: RBACRoleType = RBACRoleType.WORKSPACE


class AccessPolicyCreate(_RBACModel):
    name: str
    resource_type: RBACResourceType
    description: str = ""
    permission_keys: list[str] = Field(default_factory=list)


class AccessPolicyUpdate(_RBACModel):
    name: str
    description: str = ""
    permission_keys: list[str] = Field(default_factory=list)


class ReplaceMemberBindings(_RBACModel):
    automatic_include_workspace_members: bool = Field(default=False)


class DeleteMemberBindings(_RBACModel):
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class ReplaceBindings(_RBACModel):
    role_ids: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("role_ids", "account_ids", mode="before")
    @classmethod
    def _coerce_bindings(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class ListOption(_RBACModel):
    page_number: int | None = None
    results_per_page: int | None = None
    reverse: bool | None = None

    def to_params(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if self.page_number is not None:
            params["page_number"] = self.page_number
        if self.results_per_page is not None:
            params["results_per_page"] = self.results_per_page
        if self.reverse is not None:
            # httpx renders `True` as the string "True"; we want the inner
            # handler to match on the lowercase form it compares against.
            params["reverse"] = "true" if self.reverse else "false"
        if extra:
            params.update({k: v for k, v in extra.items() if v is not None})
        return params
