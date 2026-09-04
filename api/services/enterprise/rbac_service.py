from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, TypeVar

from flask import has_request_context, request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from models import App, Dataset, TenantAccountJoin, TenantAccountRole
from services.enterprise.base import EnterpriseRequest

T = TypeVar("T")
logger = logging.getLogger(__name__)


def app_maintainer_id(tenant_id: str, app_id: str) -> str | None:
    with session_factory.create_session() as session:
        return session.scalar(select(App.maintainer).where(App.id == app_id, App.tenant_id == tenant_id))


def dataset_maintainer_id(tenant_id: str, dataset_id: str) -> str | None:
    with session_factory.create_session() as session:
        return session.scalar(
            select(Dataset.maintainer).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id)
        )


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
    """Where one resource type lives in the inner RBAC API."""

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


class MemberRoleSummary(_RBACModel):
    id: str
    name: str


class ResourcePermissionKeys(_RBACModel):
    resource_id: str
    permission_keys: list[str] = Field(default_factory=list)


class ResourcePermissionKeysBatchResponse(_RBACModel):
    data: list[ResourcePermissionKeys] = Field(default_factory=list)


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
    # Absent on RBAC services older than the agent bootstrap migration; true only when a
    # stored scope row backs this response, false when the service fabricated the default.
    configured: bool | None = None


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


class _LegacyResourceWhitelistConfig(_RBACModel):
    """RBAC service's pre-toggle whitelist payload, used only by data migrations."""

    account_ids: list[str] = Field(default_factory=list)
    rbac_whitelist_scope: str | None = Field(
        default=None, validation_alias=AliasChoices("rbac_whitelist_scope", "scope")
    )
    # Absent on RBAC services older than the agent bootstrap migration; true only when a
    # stored scope row backs this response, false when the service fabricated the default.
    configured: bool | None = None

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class LegacyAgentRoleMigration(_RBACModel):
    """One custom role's outcome from the RBAC service's agent.manage migration."""

    role_id: str
    role_name: str = ""
    added_keys: list[str] = Field(default_factory=list)
    removed_keys: list[str] = Field(default_factory=list)
    bound_policies: list[str] = Field(default_factory=list)
    skipped: str = ""


class LegacyAgentMigrationReport(_RBACModel):
    """Outcome of the RBAC service's agent.manage migration: tenant roles plus global role templates."""

    roles: list[LegacyAgentRoleMigration] = Field(default_factory=list)
    role_templates: list[LegacyAgentRoleMigration] = Field(default_factory=list)


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


class MemberRolesBatchResponse(_RBACModel):
    data: list[MemberRolesResponse] = Field(default_factory=list)


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


# Fallback permission snapshots for legacy Dify tenant roles when external RBAC is disabled.
# Keep these keys aligned with langgenius/rbac's built-in workspace roles and access policies.
_LEGACY_WORKSPACE_OWNER_KEYS: list[str] = [
    "skill.view",
    "skill.edit",
    "skill.publish",
    "skill.delete",
    "workspace.member.manage",
    "workspace.role.manage",
    "data_source.manage",
    "api_extension.manage",
    "customization.manage",
    "plugin.install",
    "plugin.plugin_preferences",
    "plugin.model_config",
    "plugin.delete",
    "plugin.debug",
    "credential.use",
    "credential.create",
    "credential.manage",
    "app.acl.preview",
    "app_library.access",
    "app.create_and_management",
    "app.tag.manage",
    "dataset.acl.preview",
    "dataset.create_and_management",
    "dataset.tag.manage",
    "dataset.external.connect",
    "dataset.api_key.manage",
    "snippets.create_and_modify",
    "snippets.management",
    "tool.manage",
    "mcp.manage",
    "agent.create",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_LEGACY_WORKSPACE_ADMIN_KEYS: list[str] = [
    "skill.view",
    "skill.edit",
    "skill.publish",
    "skill.delete",
    "workspace.member.manage",
    "workspace.role.manage",
    "data_source.manage",
    "api_extension.manage",
    "customization.manage",
    "plugin.install",
    "plugin.plugin_preferences",
    "plugin.model_config",
    "plugin.delete",
    "plugin.debug",
    "credential.use",
    "credential.create",
    "credential.manage",
    "app_library.access",
    "app.create_and_management",
    "app.tag.manage",
    "dataset.create_and_management",
    "dataset.tag.manage",
    "dataset.external.connect",
    "dataset.api_key.manage",
    "snippets.create_and_modify",
    "snippets.management",
    "tool.manage",
    "mcp.manage",
    "agent.create",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_LEGACY_WORKSPACE_EDITOR_KEYS: list[str] = [
    "skill.view",
    "skill.edit",
    "skill.publish",
    "skill.delete",
    "api_extension.manage",
    "plugin.install",
    "credential.use",
    "app_library.access",
    "app.create_and_management",
    "app.tag.manage",
    "dataset.create_and_management",
    "dataset.tag.manage",
    "dataset.external.connect",
    "snippets.create_and_modify",
    "tool.manage",
    "agent.create",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_LEGACY_WORKSPACE_NORMAL_KEYS: list[str] = [
    "skill.view",
    "api_extension.manage",
    "plugin.install",
    "credential.use",
    "app_library.access",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_LEGACY_WORKSPACE_DATASET_OPERATOR_KEYS: list[str] = [
    "skill.view",
    "plugin.install",
    "dataset.create_and_management",
    "dataset.external.connect",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_LEGACY_APP_OWNER_KEYS: list[str] = [
    "app.acl.preview",
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.access_config",
    "app.acl.tracing_config",
    "app.acl.log_and_annotation",
    "app.acl.access_point_manage",
    "app.acl.access_point_view",
]

_LEGACY_APP_ADMIN_KEYS: list[str] = [
    "app.acl.preview",
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.access_config",
    "app.acl.access_config",
    "app.acl.tracing_config",
    "app.acl.log_and_annotation",
    "app.acl.access_point_manage",
    "app.acl.access_point_view",
]

_LEGACY_APP_EDITOR_KEYS: list[str] = [
    "app.acl.preview",
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.log_and_annotation",
    "app.acl.access_config",
    "app.acl.access_point_manage",
    "app.acl.access_point_view",
]

_LEGACY_APP_NORMAL_KEYS: list[str] = [
    "app.acl.monitor",
    "app.acl.access_point_view",
]

_LEGACY_APP_DATASET_OPERATOR_KEYS: list[str] = [
    "app.acl.access_point_view",
]

_LEGACY_DATASET_OWNER_KEYS: list[str] = [
    "dataset.acl.preview",
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
    "dataset.acl.delete",
    "dataset.acl.access_config",
    "dataset.api_key.manage",
]

_LEGACY_DATASET_ADMIN_KEYS: list[str] = [
    "dataset.acl.preview",
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
    "dataset.acl.delete",
    "dataset.acl.access_config",
    "dataset.api_key.manage",
]

_LEGACY_DATASET_EDITOR_KEYS: list[str] = [
    "dataset.acl.preview",
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
]

_LEGACY_DATASET_DATASET_OPERATOR_KEYS: list[str] = [
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
]

# Agent resource keys mirror langgenius/rbac's built-in agent access policies:
# owner/admin/editor inherit full access, everyone else keeps the preview pair
# that also sits in the workspace lists above.
_LEGACY_AGENT_FULL_ACCESS_KEYS: list[str] = [
    "agent.acl.preview",
    "agent.acl.edit",
    "agent.acl.test_and_run",
    "agent.acl.release_and_version",
    "agent.acl.access_point_view",
    "agent.acl.access_point_manage",
    "agent.acl.log_manage",
    "agent.acl.monitor",
    "agent.acl.access_config",
    "agent.acl.import_export_dsl",
    "agent.acl.delete",
]

_LEGACY_AGENT_PREVIEW_KEYS: list[str] = [
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_LEGACY_MY_PERMISSIONS: dict[TenantAccountRole, dict[str, list[str]]] = {
    TenantAccountRole.OWNER: {
        "workspace": _LEGACY_WORKSPACE_OWNER_KEYS,
        "app": _LEGACY_APP_OWNER_KEYS,
        "dataset": _LEGACY_DATASET_OWNER_KEYS,
        "agent": _LEGACY_AGENT_FULL_ACCESS_KEYS,
    },
    TenantAccountRole.ADMIN: {
        "workspace": _LEGACY_WORKSPACE_ADMIN_KEYS,
        "app": _LEGACY_APP_ADMIN_KEYS,
        "dataset": _LEGACY_DATASET_ADMIN_KEYS,
        "agent": _LEGACY_AGENT_FULL_ACCESS_KEYS,
    },
    TenantAccountRole.EDITOR: {
        "workspace": _LEGACY_WORKSPACE_EDITOR_KEYS,
        "app": _LEGACY_APP_EDITOR_KEYS,
        "dataset": _LEGACY_DATASET_EDITOR_KEYS,
        "agent": _LEGACY_AGENT_FULL_ACCESS_KEYS,
    },
    TenantAccountRole.NORMAL: {
        "workspace": _LEGACY_WORKSPACE_NORMAL_KEYS,
        "app": _LEGACY_APP_NORMAL_KEYS,
        "agent": _LEGACY_AGENT_PREVIEW_KEYS,
    },
    TenantAccountRole.DATASET_OPERATOR: {
        "workspace": _LEGACY_WORKSPACE_DATASET_OPERATOR_KEYS,
        "app": _LEGACY_APP_DATASET_OPERATOR_KEYS,
        "dataset": _LEGACY_DATASET_DATASET_OPERATOR_KEYS,
        "agent": _LEGACY_AGENT_PREVIEW_KEYS,
    },
}


def _legacy_role_permission_keys(role: TenantAccountRole) -> list[str]:
    permissions = _LEGACY_MY_PERMISSIONS.get(role, {})
    return list(
        dict.fromkeys(
            [
                *permissions.get("workspace", []),
                *permissions.get("app", []),
                *permissions.get("dataset", []),
                *permissions.get("agent", []),
            ]
        )
    )


def _legacy_member_roles_response(
    tenant_id: str, member_account_id: str, role: TenantAccountRole | str | None
) -> MemberRolesResponse:
    if not role:
        return MemberRolesResponse(account_id=member_account_id, roles=[])

    tenant_role = TenantAccountRole(role)
    role_value = tenant_role.value
    return MemberRolesResponse(
        account_id=member_account_id,
        roles=[
            RBACRole(
                id=role_value,
                name=role_value,
                description="",
                is_builtin=True,
                type="",
                permission_keys=_legacy_role_permission_keys(tenant_role),
                role_tag="owner" if tenant_role == TenantAccountRole.OWNER else role_value,
                tenant_id=tenant_id,
            )
        ],
    )


def _legacy_my_permissions(tenant_id: str, account_id: str | None, *, session: Session) -> MyPermissionsResponse:
    if not account_id:
        return MyPermissionsResponse()

    try:
        role = session.scalar(
            select(TenantAccountJoin.role).where(
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == account_id,
            )
        )
        if not role:
            return MyPermissionsResponse()

        try:
            tenant_role = TenantAccountRole(role)
        except ValueError:
            return MyPermissionsResponse()
    except SQLAlchemyError:
        return MyPermissionsResponse()

    permissions = _LEGACY_MY_PERMISSIONS.get(tenant_role, {})
    return MyPermissionsResponse(
        workspace=WorkspacePermissionSnapshot(permission_keys=list(permissions.get("workspace", []))),
        app=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("app", []))),
        dataset=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("dataset", []))),
        agent=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("agent", []))),
    )


def _legacy_resource_permission_keys_batch(
    tenant_id: str,
    account_id: str | None,
    resource_ids: list[str],
    resource_type: RBACResourceType,
    *,
    session: Session,
) -> dict[str, list[str]]:
    snapshot = _legacy_my_permissions(tenant_id, account_id, session=session)
    permission_keys = snapshot.resource_snapshot(resource_type).default_permission_keys
    return {str(resource_id): list(permission_keys) for resource_id in resource_ids}


# ---------- Mutation request models ----------


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


class ReplaceRoleBindings(_RBACModel):
    role_ids: list[str] = Field(default_factory=list)

    @field_validator("role_ids", mode="before")
    @classmethod
    def _coerce_role_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


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


_INNER_PREFIX = "/rbac"


def _request_language_param() -> str | None:
    if not has_request_context():
        return None
    language = (request.args.get("language") or "").strip().lower()
    if language in {"en", "ja", "zh"}:
        return language
    return None


def _inner_call(
    method: str,
    endpoint: str,
    *,
    tenant_id: str,
    account_id: str | None = None,
    json: Any | None = None,
    params: dict[str, Any] | None = None,
) -> Any:
    """Thin wrapper around `EnterpriseRequest.send_inner_rbac_request`.

    Kept as a module-level helper (rather than a nested-class method) so that
    unit tests can monkey-patch this single entry point instead of every
    individual `Roles.*`, `AccessPolicies.*`, … method.
    """
    language = _request_language_param()
    if language and (not params or "language" not in params):
        params = dict(params or {})
        params["language"] = language
    return EnterpriseRequest.send_inner_rbac_request(
        method,
        endpoint,
        tenant_id=tenant_id,
        account_id=account_id,
        json=json,
        params=params,
        timeout=dify_config.ENTERPRISE_RBAC_REQUEST_TIMEOUT,
    )


def _resource_id_params(resource_type: RBACResourceType | str, resource_id: str) -> dict[str, str]:
    resolved = resource_type if isinstance(resource_type, RBACResourceType) else RBACResourceType(resource_type)
    return {"resource_type": resolved.value, resolved.route.id_param: resource_id.strip()}


def try_sync_creator_access_policy_member_bindings(
    tenant_id: str,
    account_id: str,
    resource_type: RBACResourceType | str,
    resource_id: str,
) -> None:
    if not dify_config.RBAC_ENABLED:
        return
    try:
        RBACService.AccessPolicies.sync_creator_access_policy_member_bindings(
            tenant_id,
            account_id,
            resource_type=resource_type,
            resource_id=resource_id,
        )
    except Exception:
        logger.warning(
            "Failed to sync creator access policy member binding for "
            "tenant_id=%s resource_type=%s resource_id=%s account_id=%s",
            tenant_id,
            resource_type.value if isinstance(resource_type, RBACResourceType) else resource_type,
            resource_id,
            account_id,
            exc_info=True,
        )


class _ResourceAccessClient[MatrixT: _RBACModel]:
    """Per-resource access-policy calls for one resource type.

    `AppAccess`/`DatasetAccess` predate this and still spell every call out; new
    resource types are wired up by instantiating this with the type's route.
    """

    def __init__(self, route: _ResourceAccessRoute, matrix_model: type[MatrixT]) -> None:
        self._route = route
        self._matrix_model = matrix_model

    def _path(self, suffix: str) -> str:
        return f"{_INNER_PREFIX}/{self._route.segment}/{suffix}"

    def _params(self, resource_id: str, policy_id: str | None = None) -> dict[str, object]:
        params: dict[str, object] = {self._route.id_param: resource_id}
        if policy_id is not None:
            params["policy_id"] = policy_id
        return params

    def whitelist_resources(self, tenant_id: str, account_id: str | None) -> ResourceWhitelistResources:
        data = _inner_call(
            "GET",
            self._path("whitelist/resources"),
            tenant_id=tenant_id,
            account_id=account_id,
        )
        return ResourceWhitelistResources.model_validate(data or {})

    def user_access_policies(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        *,
        options: ListOption | None = None,
    ) -> ResourceUserAccessPoliciesResponse:
        params = (options or ListOption()).to_params({self._route.id_param: resource_id})
        data = _inner_call(
            "GET",
            self._path("user-access-policies"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=params,
        )
        return ResourceUserAccessPoliciesResponse.model_validate(data or {})

    def replace_user_access_policies(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        target_account_id: str | None,
        payload: ReplaceUserAccessPolicies,
    ) -> ReplaceUserAccessPoliciesResponse:
        params = self._params(resource_id)
        params["account_id"] = target_account_id
        data = _inner_call(
            "PUT",
            self._path("user-access-policies"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=params,
            json=payload.model_dump(mode="json"),
        )
        return ReplaceUserAccessPoliciesResponse.model_validate(data or {})

    def whitelist(self, tenant_id: str, account_id: str | None, resource_id: str) -> ResourceWhitelist:
        data = _inner_call(
            "GET",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
        )
        return ResourceWhitelist.model_validate(data or {})

    def whitelist_config(self, tenant_id: str, account_id: str | None, resource_id: str) -> ResourceWhitelistConfig:
        data = _inner_call(
            "GET",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
        )
        return ResourceWhitelistConfig.model_validate(data or {})

    def legacy_whitelist_config(
        self, tenant_id: str, account_id: str | None, resource_id: str
    ) -> _LegacyResourceWhitelistConfig:
        data = _inner_call(
            "GET",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
        )
        return _LegacyResourceWhitelistConfig.model_validate(data or {})

    def replace_whitelist(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        payload: ReplaceMemberBindings,
    ) -> ResourceWhitelist:
        data = _inner_call(
            "PUT",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
            json=payload.model_dump(mode="json"),
        )
        return ResourceWhitelist.model_validate(data or {})

    def append_whitelist_members_batch(
        self,
        tenant_id: str,
        account_id: str | None,
        data: Sequence[_RBACModel],
    ) -> None:
        _inner_call(
            "POST",
            self._path("whitelist/members/batch"),
            tenant_id=tenant_id,
            account_id=account_id,
            json={"data": [item.model_dump(mode="json") for item in data]},
        )

    def matrix(self, tenant_id: str, account_id: str | None, resource_id: str) -> MatrixT:
        data = _inner_call(
            "GET",
            self._path("access-policy"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
        )
        return self._matrix_model.model_validate(data or {})

    def list_role_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
    ) -> RoleBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/role-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
        )
        return RoleBindingsResponse.model_validate(data or {})

    def replace_role_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
        payload: ReplaceRoleBindings,
    ) -> RoleBindingsResponse:
        data = _inner_call(
            "PUT",
            self._path("access-policy/role-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
            json=payload.model_dump(mode="json"),
        )
        return RoleBindingsResponse.model_validate(data or {})

    def list_member_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
    ) -> MemberBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/member-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
        )
        return MemberBindingsResponse.model_validate(data or {})

    def delete_member_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
        payload: DeleteMemberBindings,
    ) -> None:
        _inner_call(
            "DELETE",
            self._path("access-policy/member-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
            json=payload.model_dump(mode="json"),
        )

    def replace_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
        payload: ReplaceBindings,
    ) -> AccessMatrixItem:
        data = _inner_call(
            "PUT",
            self._path("access-policy/bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
            json=payload.model_dump(mode="json"),
        )
        return AccessMatrixItem.model_validate(data or {})


class _WorkspaceAccessClient:
    """Workspace-wide access-policy calls for one resource type."""

    def __init__(self, route: _ResourceAccessRoute) -> None:
        self._route = route

    def _path(self, suffix: str) -> str:
        return f"{_INNER_PREFIX}/workspace/{self._route.segment}/{suffix}"

    def matrix(
        self,
        tenant_id: str,
        account_id: str | None = None,
        *,
        options: ListOption | None = None,
    ) -> WorkspaceAccessMatrix:
        data = _inner_call(
            "GET",
            self._path("access-policy"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=(options or ListOption()).to_params() or None,
        )
        return WorkspaceAccessMatrix.model_validate(data or {})

    def list_role_bindings(self, tenant_id: str, account_id: str | None, policy_id: str) -> RoleBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/role-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
        )
        return RoleBindingsResponse.model_validate(data or {})

    def replace_role_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        policy_id: str,
        payload: ReplaceRoleBindings,
    ) -> RoleBindingsResponse:
        data = _inner_call(
            "PUT",
            self._path("access-policy/role-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
            json=payload.model_dump(mode="json"),
        )
        return RoleBindingsResponse.model_validate(data or {})

    def list_member_bindings(self, tenant_id: str, account_id: str | None, policy_id: str) -> MemberBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/member-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
        )
        return MemberBindingsResponse.model_validate(data or {})

    def replace_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        policy_id: str,
        payload: ReplaceBindings,
    ) -> AccessMatrixItem:
        data = _inner_call(
            "PUT",
            self._path("access-policy/bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
            json=payload.model_dump(mode="json"),
        )
        return AccessMatrixItem.model_validate(data or {})


_AGENT_ACCESS = _ResourceAccessClient(RBACResourceType.AGENT.route, AgentAccessMatrix)
_WORKSPACE_APP_ACCESS = _WorkspaceAccessClient(RBACResourceType.APP.route)
_WORKSPACE_DATASET_ACCESS = _WorkspaceAccessClient(RBACResourceType.DATASET.route)
_WORKSPACE_AGENT_ACCESS = _WorkspaceAccessClient(RBACResourceType.AGENT.route)


def _resource_permission_catalog(
    resource_type: RBACResourceType, tenant_id: str, account_id: str | None
) -> PermissionCatalogResponse:
    data = _inner_call(
        "GET",
        f"{_INNER_PREFIX}/role-permissions/catalog/{resource_type.value}",
        tenant_id=tenant_id,
        account_id=account_id,
    )
    return PermissionCatalogResponse.model_validate(data or {})


class RBACService:
    """Single entry point grouping every inner RBAC call by feature area.

    Each nested class keeps the classmethods tightly scoped to one URL family
    so call sites read naturally (e.g. ``RBACService.Roles.create(tenant_id,
    account_id, payload)``).
    """

    # ------------------------------------------------------------------
    # Permission catalog (screenshot 3: 新增/编辑角色 弹窗内的权限列表).
    # ------------------------------------------------------------------
    class Catalog:
        @staticmethod
        def workspace(tenant_id: str, account_id: str | None = None) -> PermissionCatalogResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/role-permissions/catalog",
                tenant_id=tenant_id,
                account_id=account_id,
            )
            return PermissionCatalogResponse.model_validate(data or {})

        @staticmethod
        def app(tenant_id: str, account_id: str | None = None) -> PermissionCatalogResponse:
            return _resource_permission_catalog(RBACResourceType.APP, tenant_id, account_id)

        @staticmethod
        def dataset(tenant_id: str, account_id: str | None = None) -> PermissionCatalogResponse:
            return _resource_permission_catalog(RBACResourceType.DATASET, tenant_id, account_id)

        @staticmethod
        def agent(tenant_id: str, account_id: str | None = None) -> PermissionCatalogResponse:
            return _resource_permission_catalog(RBACResourceType.AGENT, tenant_id, account_id)

    # ------------------------------------------------------------------
    # Role CRUD (Settings > Permissions).
    # ------------------------------------------------------------------
    class Roles:
        @staticmethod
        def list(
            tenant_id: str,
            account_id: str | None = None,
            include_owner: int | None = None,
            biiling_enabled: bool | None = None,
            *,
            options: ListOption | None = None,
        ) -> Paginated[RBACRole]:
            params = (options or ListOption()).to_params(
                {"include_owner": include_owner, "biiling_enabled": biiling_enabled}
            )
            params["dataset_operator_enabled"] = dify_config.DATASET_OPERATOR_ENABLED
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params or None,
            )
            data = data or {}
            return Paginated[RBACRole](
                data=[RBACRole.model_validate(item) for item in data.get("data") or []],
                pagination=Pagination.model_validate(data["pagination"]) if data.get("pagination") else None,
            )

        @staticmethod
        def list_members_by_role(
            tenant_id: str,
            role_id: str | None = None,
            *,
            options: ListOption | None = None,
        ) -> Paginated[MembersInRole]:
            params = (options or ListOption()).to_params({"role_id": role_id})
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles/members",
                tenant_id=tenant_id,
                params=params or None,
            )
            data = data or {}
            return Paginated[MembersInRole](
                data=[MembersInRole.model_validate(item) for item in data.get("data") or []],
                pagination=Pagination.model_validate(data["pagination"]) if data.get("pagination") else None,
            )

        @staticmethod
        def get(tenant_id: str, account_id: str | None, role_id: str, billing_enabled: bool = True) -> RBACRole:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id, "billing_enabled": billing_enabled},
            )
            return RBACRole.model_validate(data or {})

        @staticmethod
        def create(tenant_id: str, account_id: str | None, payload: RoleMutation) -> RBACRole:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/roles",
                tenant_id=tenant_id,
                account_id=account_id,
                json=payload.model_dump(mode="json"),
            )
            return RBACRole.model_validate(data or {})

        @staticmethod
        def update(tenant_id: str, account_id: str | None, role_id: str, payload: RoleMutation) -> RBACRole:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id},
                json=payload.model_dump(mode="json"),
            )
            return RBACRole.model_validate(data or {})

        @staticmethod
        def delete(tenant_id: str, account_id: str | None, role_id: str) -> None:
            _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id},
            )

        @staticmethod
        def copy(tenant_id: str, account_id: str | None, role_id: str, copy_member: bool = True) -> RBACRole:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/roles/copy",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"copy_member": copy_member},
                params={"id": role_id},
            )

            return RBACRole.model_validate(data or {})

        @staticmethod
        def members(
            tenant_id: str,
            account_id: str | None,
            role_id: str,
            *,
            options: ListOption | None = None,
        ) -> Paginated[RBACRoleAccount]:
            params = (options or ListOption()).to_params({"role_id": role_id})
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles/members",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params,
            )
            data = data or {}
            return Paginated[RBACRoleAccount](
                data=[RBACRoleAccount.model_validate(item) for item in data.get("data") or []],
                pagination=Pagination.model_validate(data["pagination"]) if data.get("pagination") else None,
            )

    # ------------------------------------------------------------------
    # Access policies (Settings > Access Rules: create/edit permission sets).
    # ------------------------------------------------------------------
    class AccessPolicies:
        @staticmethod
        def list(
            tenant_id: str,
            account_id: str | None = None,
            *,
            resource_type: RBACResourceType | str | None = None,
            options: ListOption | None = None,
        ) -> Paginated[AccessPolicy]:
            extra: dict[str, Any] = {}
            if resource_type is not None:
                extra["resource_type"] = (
                    resource_type.value if isinstance(resource_type, RBACResourceType) else resource_type
                )
            params = (options or ListOption()).to_params(extra)
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params or None,
            )
            data = data or {}
            return Paginated[AccessPolicy](
                data=[AccessPolicy.model_validate(item) for item in data.get("data") or []],
                pagination=Pagination.model_validate(data["pagination"]) if data.get("pagination") else None,
            )

        @staticmethod
        def get(tenant_id: str, account_id: str | None, policy_id: str) -> AccessPolicy:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/access-policies/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def create(tenant_id: str, account_id: str | None, payload: AccessPolicyCreate) -> AccessPolicy:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                json=payload.model_dump(mode="json"),
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def update(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: AccessPolicyUpdate,
        ) -> AccessPolicy:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policies/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def copy(tenant_id: str, account_id: str | None, policy_id: str) -> AccessPolicy:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/access-policies/copy",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def delete(tenant_id: str, account_id: str | None, policy_id: str) -> None:
            _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/access-policies/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
            )

        @staticmethod
        def sync_creator_access_policy_member_bindings(
            tenant_id: str,
            account_id: str | None,
            *,
            resource_type: RBACResourceType | str,
            resource_id: str,
        ) -> Sequence[AccessPolicyMemberBinding]:
            params = _resource_id_params(resource_type, resource_id)
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policies/creator-member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params,
            )
            items: list[Any] = []
            if isinstance(data, dict):
                items = data.get("data") or []
            return [AccessPolicyMemberBinding.model_validate(item) for item in items]

    # ------------------------------------------------------------------
    # Access-policy bindings (lock / unlock a single binding).
    # ------------------------------------------------------------------
    class AccessPolicyBindings:
        @staticmethod
        def lock(tenant_id: str, account_id: str | None, binding_id: str) -> AccessPolicyBindingState:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policy-bindings/lock",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"binding_id": binding_id},
            )
            return AccessPolicyBindingState.model_validate(data or {})

        @staticmethod
        def unlock(tenant_id: str, account_id: str | None, binding_id: str) -> AccessPolicyBindingState:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policy-bindings/unlock",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"binding_id": binding_id},
            )
            return AccessPolicyBindingState.model_validate(data or {})

    # ------------------------------------------------------------------
    # Mixed-resource whitelist config helpers.
    # ------------------------------------------------------------------
    class ResourceWhitelistConfigs:
        @staticmethod
        def batch_get(
            tenant_id: str,
            account_id: str | None,
            resources: Sequence[ResourceWhitelistConfigResource],
        ) -> ResourceWhitelistConfigsResponse:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/whitelist/configs",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"resources": [resource.model_dump(mode="json") for resource in resources]},
            )
            return ResourceWhitelistConfigsResponse.model_validate(data or {})

    # ------------------------------------------------------------------
    # Per-app access (screenshot 1: App Access Config).
    # ------------------------------------------------------------------
    class AppAccess:
        @staticmethod
        def whitelist_resources(tenant_id: str, account_id: str | None) -> ResourceWhitelistResources:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/whitelist/resources",
                tenant_id=tenant_id,
                account_id=account_id,
            )
            return ResourceWhitelistResources.model_validate(data or {})

        @staticmethod
        def user_access_policies(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            *,
            options: ListOption | None = None,
        ) -> ResourceUserAccessPoliciesResponse:
            params = (options or ListOption()).to_params({"app_id": app_id})
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/user-access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params,
            )
            return ResourceUserAccessPoliciesResponse.model_validate(data or {})

        @staticmethod
        def replace_user_access_policies(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            target_account_id: str | None,
            payload: ReplaceUserAccessPolicies,
        ) -> ReplaceUserAccessPoliciesResponse:
            request_data = payload.model_dump(mode="json")
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/apps/user-access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "account_id": target_account_id},
                json=request_data,
            )
            return ReplaceUserAccessPoliciesResponse.model_validate(data or {})

        @staticmethod
        def whitelist(tenant_id: str, account_id: str | None, app_id: str) -> ResourceWhitelist:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id},
            )
            return ResourceWhitelist.model_validate(data or {})

        @staticmethod
        def whitelist_config(tenant_id: str, account_id: str | None, app_id: str) -> ResourceWhitelistConfig:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id},
            )
            return ResourceWhitelistConfig.model_validate(data or {})

        @staticmethod
        def legacy_whitelist_config(
            tenant_id: str, account_id: str | None, app_id: str
        ) -> _LegacyResourceWhitelistConfig:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id},
            )
            return _LegacyResourceWhitelistConfig.model_validate(data or {})

        @staticmethod
        def replace_whitelist(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            payload: ReplaceMemberBindings,
        ) -> ResourceWhitelist:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/apps/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id},
                json=payload.model_dump(mode="json"),
            )
            return ResourceWhitelist.model_validate(data or {})

        @staticmethod
        def append_whitelist_members_batch(
            tenant_id: str,
            account_id: str | None,
            data: Sequence[AppendAppWhitelistMembersBatchItem],
        ) -> None:
            _inner_call(
                "POST",
                f"{_INNER_PREFIX}/apps/whitelist/members/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"data": [item.model_dump(mode="json") for item in data]},
            )

        @staticmethod
        def matrix(tenant_id: str, account_id: str | None, app_id: str) -> AppAccessMatrix:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/access-policy",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id},
            )
            return AppAccessMatrix.model_validate(data or {})

        @staticmethod
        def list_role_bindings(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            policy_id: str,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "policy_id": policy_id},
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_role_bindings(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/apps/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def list_member_bindings(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            policy_id: str,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/apps/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "policy_id": policy_id},
            )
            return MemberBindingsResponse.model_validate(data or {})

        @staticmethod
        def delete_member_bindings(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            policy_id: str,
            payload: DeleteMemberBindings,
        ) -> None:
            _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/apps/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )

        @staticmethod
        def replace_bindings(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/apps/access-policy/bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return AccessMatrixItem.model_validate(data or {})

    # ------------------------------------------------------------------
    # Per-dataset access (screenshot 1: Knowledge Base Access Config).
    # ------------------------------------------------------------------
    class DatasetAccess:
        @staticmethod
        def whitelist_resources(tenant_id: str, account_id: str | None) -> ResourceWhitelistResources:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/whitelist/resources",
                tenant_id=tenant_id,
                account_id=account_id,
            )
            return ResourceWhitelistResources.model_validate(data or {})

        @staticmethod
        def user_access_policies(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            *,
            options: ListOption | None = None,
        ) -> ResourceUserAccessPoliciesResponse:
            params = (options or ListOption()).to_params({"dataset_id": dataset_id})
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/user-access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params,
            )
            return ResourceUserAccessPoliciesResponse.model_validate(data or {})

        @staticmethod
        def replace_user_access_policies(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            target_account_id: str | None,
            payload: ReplaceUserAccessPolicies,
        ) -> ReplaceUserAccessPoliciesResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/datasets/user-access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "account_id": target_account_id},
                json=payload.model_dump(mode="json", exclude_unset=True),
            )
            return ReplaceUserAccessPoliciesResponse.model_validate(data or {})

        @staticmethod
        def whitelist(tenant_id: str, account_id: str | None, dataset_id: str) -> ResourceWhitelist:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id},
            )
            return ResourceWhitelist.model_validate(data or {})

        @staticmethod
        def whitelist_config(tenant_id: str, account_id: str | None, dataset_id: str) -> ResourceWhitelistConfig:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id},
            )
            return ResourceWhitelistConfig.model_validate(data or {})

        @staticmethod
        def legacy_whitelist_config(
            tenant_id: str, account_id: str | None, dataset_id: str
        ) -> _LegacyResourceWhitelistConfig:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id},
            )
            return _LegacyResourceWhitelistConfig.model_validate(data or {})

        @staticmethod
        def replace_whitelist(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            payload: ReplaceMemberBindings,
        ) -> ResourceWhitelist:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/datasets/whitelist",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id},
                json=payload.model_dump(mode="json"),
            )
            return ResourceWhitelist.model_validate(data or {})

        @staticmethod
        def append_whitelist_members_batch(
            tenant_id: str,
            account_id: str | None,
            data: Sequence[AppendDatasetWhitelistMembersBatchItem],
        ) -> None:
            _inner_call(
                "POST",
                f"{_INNER_PREFIX}/datasets/whitelist/members/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"data": [item.model_dump(mode="json") for item in data]},
            )

        @staticmethod
        def matrix(tenant_id: str, account_id: str | None, dataset_id: str) -> DatasetAccessMatrix:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/access-policy",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id},
            )
            return DatasetAccessMatrix.model_validate(data or {})

        @staticmethod
        def list_role_bindings(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            policy_id: str,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "policy_id": policy_id},
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_role_bindings(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/datasets/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def list_member_bindings(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            policy_id: str,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/datasets/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "policy_id": policy_id},
            )
            return MemberBindingsResponse.model_validate(data or {})

        @staticmethod
        def delete_member_bindings(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            policy_id: str,
            payload: DeleteMemberBindings,
        ) -> None:
            _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/datasets/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )

        @staticmethod
        def replace_bindings(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/datasets/access-policy/bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return AccessMatrixItem.model_validate(data or {})

    # ------------------------------------------------------------------
    # Per-agent access, delegating to the generic resource-access client.
    # ------------------------------------------------------------------
    class AgentAccess:
        @staticmethod
        def whitelist_resources(tenant_id: str, account_id: str | None) -> ResourceWhitelistResources:
            return _AGENT_ACCESS.whitelist_resources(tenant_id, account_id)

        @staticmethod
        def user_access_policies(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            *,
            options: ListOption | None = None,
        ) -> ResourceUserAccessPoliciesResponse:
            return _AGENT_ACCESS.user_access_policies(tenant_id, account_id, agent_id, options=options)

        @staticmethod
        def replace_user_access_policies(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            target_account_id: str | None,
            payload: ReplaceUserAccessPolicies,
        ) -> ReplaceUserAccessPoliciesResponse:
            return _AGENT_ACCESS.replace_user_access_policies(
                tenant_id, account_id, agent_id, target_account_id, payload
            )

        @staticmethod
        def whitelist(tenant_id: str, account_id: str | None, agent_id: str) -> ResourceWhitelist:
            return _AGENT_ACCESS.whitelist(tenant_id, account_id, agent_id)

        @staticmethod
        def whitelist_config(tenant_id: str, account_id: str | None, agent_id: str) -> ResourceWhitelistConfig:
            return _AGENT_ACCESS.whitelist_config(tenant_id, account_id, agent_id)

        @staticmethod
        def legacy_whitelist_config(
            tenant_id: str, account_id: str | None, agent_id: str
        ) -> _LegacyResourceWhitelistConfig:
            return _AGENT_ACCESS.legacy_whitelist_config(tenant_id, account_id, agent_id)

        @staticmethod
        def replace_whitelist(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            payload: ReplaceMemberBindings,
        ) -> ResourceWhitelist:
            return _AGENT_ACCESS.replace_whitelist(tenant_id, account_id, agent_id, payload)

        @staticmethod
        def append_whitelist_members_batch(
            tenant_id: str,
            account_id: str | None,
            data: Sequence[AppendAgentWhitelistMembersBatchItem],
        ) -> None:
            _AGENT_ACCESS.append_whitelist_members_batch(tenant_id, account_id, data)

        @staticmethod
        def matrix(tenant_id: str, account_id: str | None, agent_id: str) -> AgentAccessMatrix:
            return _AGENT_ACCESS.matrix(tenant_id, account_id, agent_id)

        @staticmethod
        def list_role_bindings(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            policy_id: str,
        ) -> RoleBindingsResponse:
            return _AGENT_ACCESS.list_role_bindings(tenant_id, account_id, agent_id, policy_id)

        @staticmethod
        def replace_role_bindings(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            return _AGENT_ACCESS.replace_role_bindings(tenant_id, account_id, agent_id, policy_id, payload)

        @staticmethod
        def list_member_bindings(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            policy_id: str,
        ) -> MemberBindingsResponse:
            return _AGENT_ACCESS.list_member_bindings(tenant_id, account_id, agent_id, policy_id)

        @staticmethod
        def delete_member_bindings(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            policy_id: str,
            payload: DeleteMemberBindings,
        ) -> None:
            _AGENT_ACCESS.delete_member_bindings(tenant_id, account_id, agent_id, policy_id, payload)

        @staticmethod
        def replace_bindings(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            return _AGENT_ACCESS.replace_bindings(tenant_id, account_id, agent_id, policy_id, payload)

    # ------------------------------------------------------------------
    # Workspace-level access (screenshot 2: Settings > Access Rules).
    # ------------------------------------------------------------------
    class WorkspaceAccess:
        @staticmethod
        def app_matrix(
            tenant_id: str,
            account_id: str | None = None,
            *,
            options: ListOption | None = None,
        ) -> WorkspaceAccessMatrix:
            return _WORKSPACE_APP_ACCESS.matrix(tenant_id, account_id, options=options)

        @staticmethod
        def dataset_matrix(
            tenant_id: str,
            account_id: str | None = None,
            *,
            options: ListOption | None = None,
        ) -> WorkspaceAccessMatrix:
            return _WORKSPACE_DATASET_ACCESS.matrix(tenant_id, account_id, options=options)

        @staticmethod
        def agent_matrix(
            tenant_id: str,
            account_id: str | None = None,
            *,
            options: ListOption | None = None,
        ) -> WorkspaceAccessMatrix:
            return _WORKSPACE_AGENT_ACCESS.matrix(tenant_id, account_id, options=options)

        @staticmethod
        def list_app_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> RoleBindingsResponse:
            return _WORKSPACE_APP_ACCESS.list_role_bindings(tenant_id, account_id, policy_id)

        @staticmethod
        def replace_app_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            return _WORKSPACE_APP_ACCESS.replace_role_bindings(tenant_id, account_id, policy_id, payload)

        @staticmethod
        def list_app_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> MemberBindingsResponse:
            return _WORKSPACE_APP_ACCESS.list_member_bindings(tenant_id, account_id, policy_id)

        @staticmethod
        def replace_app_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            return _WORKSPACE_APP_ACCESS.replace_bindings(tenant_id, account_id, policy_id, payload)

        @staticmethod
        def list_dataset_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> RoleBindingsResponse:
            return _WORKSPACE_DATASET_ACCESS.list_role_bindings(tenant_id, account_id, policy_id)

        @staticmethod
        def replace_dataset_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            return _WORKSPACE_DATASET_ACCESS.replace_role_bindings(tenant_id, account_id, policy_id, payload)

        @staticmethod
        def list_dataset_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> MemberBindingsResponse:
            return _WORKSPACE_DATASET_ACCESS.list_member_bindings(tenant_id, account_id, policy_id)

        @staticmethod
        def replace_dataset_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            return _WORKSPACE_DATASET_ACCESS.replace_bindings(tenant_id, account_id, policy_id, payload)

        @staticmethod
        def list_agent_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> RoleBindingsResponse:
            return _WORKSPACE_AGENT_ACCESS.list_role_bindings(tenant_id, account_id, policy_id)

        @staticmethod
        def replace_agent_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            return _WORKSPACE_AGENT_ACCESS.replace_role_bindings(tenant_id, account_id, policy_id, payload)

        @staticmethod
        def list_agent_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> MemberBindingsResponse:
            return _WORKSPACE_AGENT_ACCESS.list_member_bindings(tenant_id, account_id, policy_id)

        @staticmethod
        def replace_agent_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            return _WORKSPACE_AGENT_ACCESS.replace_bindings(tenant_id, account_id, policy_id, payload)

    class MemberRoles:
        @staticmethod
        def get(
            tenant_id: str, account_id: str | None, member_account_id: str, *, session: Session
        ) -> MemberRolesResponse:
            if dify_config.RBAC_ENABLED:
                data = _inner_call(
                    "GET",
                    f"{_INNER_PREFIX}/members/rbac-roles",
                    tenant_id=tenant_id,
                    account_id=account_id,
                    params={"account_id": member_account_id},
                )
                rst = MemberRolesResponse.model_validate(data or {})
                return rst
            else:
                role = session.scalar(
                    select(TenantAccountJoin.role).where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.account_id == member_account_id,
                    )
                )
                return _legacy_member_roles_response(tenant_id, member_account_id, role)

        @staticmethod
        def batch_get(
            tenant_id: str,
            account_id: str | None,
            member_account_ids: list[str],
        ) -> list[MemberRolesResponse]:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/members/rbac-roles/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"member_ids": member_account_ids},
            )
            items = []
            if isinstance(data, dict):
                items = [{"account_id": account_id, "roles": roles} for account_id, roles in data.items()]
            rst = []
            for item in items:
                tmp = MemberRolesResponse.model_validate(item)
                rst.append(tmp)
            return rst

        @staticmethod
        def replace(
            tenant_id: str,
            account_id: str | None,
            member_account_id: str,
            role_ids: list[str],
            *,
            session: Session,
        ) -> MemberRolesResponse:
            if not dify_config.RBAC_ENABLED:
                if len(role_ids) != 1:
                    raise ValueError("Legacy workspace member role update requires exactly one role.")

                tenant_role = TenantAccountRole(role_ids[0])
                target_member_join = session.scalar(
                    select(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.account_id == member_account_id,
                    )
                )
                if not target_member_join:
                    raise ValueError("Member not in tenant.")

                if tenant_role == TenantAccountRole.OWNER:
                    current_owner_join = session.scalar(
                        select(TenantAccountJoin).where(
                            TenantAccountJoin.tenant_id == tenant_id,
                            TenantAccountJoin.role == TenantAccountRole.OWNER,
                        )
                    )
                    if current_owner_join and current_owner_join.account_id != member_account_id:
                        current_owner_join.role = TenantAccountRole.NORMAL

                target_member_join.role = tenant_role
                session.commit()

                return _legacy_member_roles_response(tenant_id, member_account_id, tenant_role)

            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/members/rbac-roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": member_account_id},
                json={"role_ids": role_ids},
            )
            return MemberRolesResponse.model_validate(data or {})

        @staticmethod
        def delete_rbac_bindings(tenant_id: str, account_id: str):
            data = _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/members/rbac-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": account_id},
            )
            return data

    class Migrations:
        @staticmethod
        def migrate_agent_manage_roles(tenant_id: str, *, apply: bool) -> LegacyAgentMigrationReport:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/migrations/agent-manage-roles",
                tenant_id=tenant_id,
                json={"apply": apply},
            )
            return LegacyAgentMigrationReport.model_validate(data or {})

    class CheckAccess:
        """Call the ``/inner/api/rbac/check-access`` endpoint."""

        @staticmethod
        def check(
            tenant_id: str,
            account_id: str | None,
            *,
            scene: str,
            resource_type: str | None = None,
            resource_id: str | None = None,
        ) -> bool:
            """Return ``True`` if the account is allowed, ``False`` otherwise."""
            if not dify_config.RBAC_ENABLED:
                return True

            payload: dict[str, Any] = {
                "account_id": account_id or "",
                "tenant_id": tenant_id,
                "scene": scene,
            }
            if resource_type:
                payload["resource_type"] = resource_type
            if resource_id:
                payload["resource_id"] = resource_id

            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/check-access",
                tenant_id=tenant_id,
                account_id=account_id,
                json=payload,
            )
            return bool(data.get("allowed", False))

    class AppPermissions:
        @staticmethod
        def batch_get(
            tenant_id: str,
            account_id: str | None,
            app_ids: list[str],
            *,
            session: Session,
        ) -> dict[str, list[str]]:
            if not app_ids:
                return {}
            if not dify_config.RBAC_ENABLED:
                return _legacy_resource_permission_keys_batch(
                    tenant_id, account_id, app_ids, RBACResourceType.APP, session=session
                )
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/apps/permission-keys/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"app_ids": app_ids},
            )
            return _parse_resource_permission_keys_batch(data, resource_id_key="app_id")

    class DatasetPermissions:
        @staticmethod
        def batch_get(
            tenant_id: str,
            account_id: str | None,
            dataset_ids: list[str],
            *,
            session: Session,
        ) -> dict[str, list[str]]:
            if not dataset_ids:
                return {}
            if not dify_config.RBAC_ENABLED:
                return _legacy_resource_permission_keys_batch(
                    tenant_id, account_id, dataset_ids, RBACResourceType.DATASET, session=session
                )
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/datasets/permission-keys/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"dataset_ids": dataset_ids},
            )
            return _parse_resource_permission_keys_batch(data, resource_id_key="dataset_id")

    class MyPermissions:
        @staticmethod
        def get(
            tenant_id: str,
            account_id: str | None,
            *,
            app_id: str | None = None,
            dataset_id: str | None = None,
            agent_id: str | None = None,
            session: Session,
        ) -> MyPermissionsResponse:
            if not dify_config.RBAC_ENABLED:
                return _legacy_my_permissions(tenant_id, account_id, session=session)

            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/my-permissions",
                tenant_id=tenant_id,
                account_id=account_id,
                params={
                    k: v
                    for k, v in {
                        "app_id": app_id,
                        "dataset_id": dataset_id,
                        "agent_id": agent_id,
                    }.items()
                    if v is not None
                }
                or None,
            )
            return MyPermissionsResponse.model_validate(data or {})


def _parse_resource_permission_keys_batch(data: Any, *, resource_id_key: str) -> dict[str, list[str]]:
    if not data:
        return {}

    if isinstance(data, dict):
        permissions = data.get("permissions")
        if isinstance(permissions, dict):
            return {str(key): [str(item) for item in (value or [])] for key, value in permissions.items()}

        items = data.get("data")
        if items is None:
            items = data.get("items")
        if items is None:
            items = data.get("apps") if resource_id_key == "app_id" else data.get("datasets")
        if isinstance(items, dict):
            items = [{"resource_id": key, "permission_keys": value} for key, value in items.items()]
    elif isinstance(data, list):
        items = data
    else:
        items = []

    result: dict[str, list[str]] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        resource_id = item.get("resource_id") or item.get(resource_id_key)
        if not resource_id:
            continue
        permission_keys = item.get("permission_keys") or []
        result[str(resource_id)] = [str(permission_key) for permission_key in permission_keys]
    return result
