from __future__ import annotations

from enum import StrEnum
from typing import Any, Generic, TypeVar

from sqlalchemy import select
from pydantic import BaseModel, ConfigDict, Field, field_validator

from configs import dify_config
from core.db.session_factory import session_factory
from models import TenantAccountJoin, TenantAccountRole
from services.enterprise.base import EnterpriseRequest

T = TypeVar("T")


class _RBACModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Pagination(_RBACModel):
    total_count: int = 0
    per_page: int = 0
    current_page: int = 0
    total_pages: int = 0


class Paginated(_RBACModel, Generic[T]):
    data: list[T] = Field(default_factory=list)
    pagination: Pagination | None = None


class RBACResourceType(StrEnum):
    """Resource types understood by access policies."""

    APP = "app"
    DATASET = "dataset"


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


class AccessMatrixItem(_RBACModel):
    policy: AccessPolicy | None = None
    roles: list[dict[str, Any]] = Field(default_factory=list)
    accounts: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("roles", "accounts", mode="before")
    @classmethod
    def _coerce_empty_lists(cls, value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []
        return value


class AppAccessMatrix(_RBACModel):
    app_id: str = ""
    items: list[AccessMatrixItem] = Field(default_factory=list)


class DatasetAccessMatrix(_RBACModel):
    dataset_id: str = ""
    items: list[AccessMatrixItem] = Field(default_factory=list)


class WorkspaceAccessMatrix(_RBACModel):
    items: list[AccessMatrixItem] = Field(default_factory=list)
    pagination: Pagination | None = None


class RoleBindingsResponse(_RBACModel):
    data: list[AccessPolicyRoleBinding] = Field(default_factory=list)


class MemberBindingsResponse(_RBACModel):
    data: list[AccessPolicyMemberBinding] = Field(default_factory=list)


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


class MyPermissionsResponse(_RBACModel):
    workspace: WorkspacePermissionSnapshot = Field(default_factory=WorkspacePermissionSnapshot)
    app: ResourcePermissionSnapshot = Field(default_factory=ResourcePermissionSnapshot)
    dataset: ResourcePermissionSnapshot = Field(default_factory=ResourcePermissionSnapshot)


_LEGACY_WORKSPACE_OWNER_KEYS: list[str] = [
    "workspace.member.view",
    "workspace.member.manage",
    "workspace.role.view",
    "workspace.role.manage",
    "data_source.manage",
    "api_extension.manage",
    "customization.manage",
    "page.explore.access",
    "page.datasets.access",
    "page.tool.access",
    "plugin.install",
    "plugin.manage",
    "plugin.uninstall",
    "plugin.preference.manage",
    "model.manage",
    "credential.use",
    "credential.manage",
    "app_library.access",
    "app.create",
    "app.tag.manage",
    "app.access_config",
    "app.monitor.access",
    "app.log.access",
    "app.monitor.tracking_config",
    "dataset.create",
    "dataset.tag.manage",
    "dataset.external.connect",
    "dataset.access_config",
    "tool.manage",
    "mcp.manage",
]

_LEGACY_WORKSPACE_ADMIN_KEYS: list[str] = [
    "workspace.member.view",
    "workspace.member.manage",
    "workspace.role.view",
    "workspace.role.manage",
    "data_source.manage",
    "api_extension.manage",
    "customization.manage",
    "page.explore.access",
    "page.datasets.access",
    "page.tool.access",
    "plugin.install",
    "plugin.uninstall",
    "plugin.preference.manage",
    "model.manage",
    "credential.use",
    "credential.manage",
    "app_library.access",
    "app.create",
    "app.tag.manage",
    "app.access_config",
    "app.monitor.access",
    "app.log.access",
    "app.monitor.tracking_config",
    "dataset.create",
    "dataset.tag.manage",
    "dataset.external.connect",
    "dataset.access_config",
    "tool.manage",
    "mcp.manage",
]

_LEGACY_WORKSPACE_EDITOR_KEYS: list[str] = [
    "workspace.member.view",
    "workspace.member.manage",
    "api_extension.manage",
    "page.explore.access",
    "page.datasets.access",
    "page.tool.access",
    "plugin.install",
    "plugin.uninstall",
    "app_library.access",
    "app.create",
    "app.tag.manage",
    "app.monitor.access",
    "app.log.access",
    "app.monitor.tracking_config",
    "dataset.create",
    "dataset.tag.manage",
    "dataset.external.connect",
]

_LEGACY_WORKSPACE_NORMAL_KEYS: list[str] = [
    "api_extension.manage",
    "page.explore.access",
    "page.datasets.access",
    "page.tool.access",
    "plugin.install",
    "plugin.uninstall",
    "app_library.access",
    "app.monitor.access",
]

_LEGACY_WORKSPACE_DATASET_OPERATOR_KEYS: list[str] = [
    "page.datasets.access",
    "plugin.install",
    "plugin.uninstall",
    "dataset.create",
    "dataset.external.connect",
]

_LEGACY_APP_OWNER_KEYS: list[str] = [
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.access_config",
]

_LEGACY_APP_ADMIN_KEYS: list[str] = [
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.access_config",
]

_LEGACY_APP_EDITOR_KEYS: list[str] = [
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
]

_LEGACY_APP_NORMAL_KEYS: list[str] = [
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.monitor",
]

_LEGACY_DATASET_OWNER_KEYS: list[str] = [
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
]

_LEGACY_DATASET_ADMIN_KEYS: list[str] = [
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
]

_LEGACY_DATASET_EDITOR_KEYS: list[str] = [
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
    "dataset.acl.delete",
]

_LEGACY_MY_PERMISSIONS: dict[TenantAccountRole, dict[str, list[str]]] = {
    TenantAccountRole.OWNER: {
        "workspace": _LEGACY_WORKSPACE_OWNER_KEYS,
        "app": _LEGACY_APP_OWNER_KEYS,
        "dataset": _LEGACY_DATASET_OWNER_KEYS,
    },
    TenantAccountRole.ADMIN: {
        "workspace": _LEGACY_WORKSPACE_ADMIN_KEYS,
        "app": _LEGACY_APP_ADMIN_KEYS,
        "dataset": _LEGACY_DATASET_ADMIN_KEYS,
    },
    TenantAccountRole.EDITOR: {
        "workspace": _LEGACY_WORKSPACE_EDITOR_KEYS,
        "app": _LEGACY_APP_EDITOR_KEYS,
        "dataset": _LEGACY_DATASET_EDITOR_KEYS,
    },
    TenantAccountRole.NORMAL: {
        "workspace": _LEGACY_WORKSPACE_NORMAL_KEYS,
        "app": _LEGACY_APP_NORMAL_KEYS,
    },
    TenantAccountRole.DATASET_OPERATOR: {
        "workspace": _LEGACY_WORKSPACE_DATASET_OPERATOR_KEYS,
        "dataset": _LEGACY_DATASET_DATASET_OPERATOR_KEYS,
    },
}


def _legacy_my_permissions(tenant_id: str, account_id: str | None) -> MyPermissionsResponse:
    if not account_id:
        return MyPermissionsResponse()

    with session_factory.create_session() as session:
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

    permissions = _LEGACY_MY_PERMISSIONS.get(tenant_role, {})
    return MyPermissionsResponse(
        workspace=WorkspacePermissionSnapshot(permission_keys=list(permissions.get("workspace", []))),
        app=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("app", []))),
        dataset=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("dataset", []))),
    )


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
    return EnterpriseRequest.send_inner_rbac_request(
        method,
        endpoint,
        tenant_id=tenant_id,
        account_id=account_id,
        json=json,
        params=params,
    )


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
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/role-permissions/catalog/app",
                tenant_id=tenant_id,
                account_id=account_id,
            )
            return PermissionCatalogResponse.model_validate(data or {})

        @staticmethod
        def dataset(tenant_id: str, account_id: str | None = None) -> PermissionCatalogResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/role-permissions/catalog/dataset",
                tenant_id=tenant_id,
                account_id=account_id,
            )
            return PermissionCatalogResponse.model_validate(data or {})

    # ------------------------------------------------------------------
    # Role CRUD (Settings > Permissions).
    # ------------------------------------------------------------------
    class Roles:
        @staticmethod
        def list(
            tenant_id: str,
            account_id: str | None = None,
            *,
            options: ListOption | None = None,
        ) -> Paginated[RBACRole]:
            params = (options or ListOption()).to_params()
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
        def get(tenant_id: str, account_id: str | None, role_id: str) -> RBACRole:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id},
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
        def copy(tenant_id: str, account_id: str | None, role_id: str) -> RBACRole:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/roles/copy",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id},
            )
            return RBACRole.model_validate(data or {})

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

    # ------------------------------------------------------------------
    # Per-app access (screenshot 1: App Access Config).
    # ------------------------------------------------------------------
    class AppAccess:
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
        def replace_member_bindings(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            policy_id: str,
            payload: ReplaceMemberBindings,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/apps/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"app_id": app_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return MemberBindingsResponse.model_validate(data or {})

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
        def replace_member_bindings(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            policy_id: str,
            payload: ReplaceMemberBindings,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/datasets/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"dataset_id": dataset_id, "policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return MemberBindingsResponse.model_validate(data or {})

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
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/apps/access-policy",
                tenant_id=tenant_id,
                account_id=account_id,
                params=(options or ListOption()).to_params() or None,
            )
            return WorkspaceAccessMatrix.model_validate(data or {})

        @staticmethod
        def dataset_matrix(
            tenant_id: str,
            account_id: str | None = None,
            *,
            options: ListOption | None = None,
        ) -> WorkspaceAccessMatrix:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy",
                tenant_id=tenant_id,
                account_id=account_id,
                params=(options or ListOption()).to_params() or None,
            )
            return WorkspaceAccessMatrix.model_validate(data or {})

        @staticmethod
        def list_app_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/apps/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_app_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/workspace/apps/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def list_app_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/apps/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
            )
            return MemberBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_app_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceMemberBindings,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/workspace/apps/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return MemberBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_app_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/workspace/apps/access-policy/bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return AccessMatrixItem.model_validate(data or {})

        @staticmethod
        def list_dataset_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_dataset_role_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceRoleBindings,
        ) -> RoleBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy/role-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return RoleBindingsResponse.model_validate(data or {})

        @staticmethod
        def list_dataset_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
            )
            return MemberBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_dataset_member_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceMemberBindings,
        ) -> MemberBindingsResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy/member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return MemberBindingsResponse.model_validate(data or {})

        @staticmethod
        def replace_dataset_bindings(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: ReplaceBindings,
        ) -> AccessMatrixItem:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy/bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"policy_id": policy_id},
                json=payload.model_dump(mode="json"),
            )
            return AccessMatrixItem.model_validate(data or {})

    # ------------------------------------------------------------------
    # Member ↔ role bindings (screenshot 3: Settings > Members > Assign roles).
    # ------------------------------------------------------------------
    class MemberRoles:
        @staticmethod
        def get(tenant_id: str, account_id: str | None, member_account_id: str) -> MemberRolesResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/members/rbac-roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": member_account_id},
            )
            rst = MemberRolesResponse.model_validate(data or {})
            for role in rst.roles:
                if role.name in ("所有者", "owner"):
                    role.role_tag = "owner"
            return rst

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
                for role in tmp.roles:
                    if role.name in ("所有者", "owner"):
                        role.role_tag = "owner"
                rst.append(tmp)
            return rst

        @staticmethod
        def replace(
            tenant_id: str,
            account_id: str | None,
            member_account_id: str,
            role_ids: list[str],
        ) -> MemberRolesResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/members/rbac-roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": member_account_id},
                json={"role_ids": role_ids},
            )
            return MemberRolesResponse.model_validate(data or {})

    class AppPermissions:
        @staticmethod
        def batch_get(
            tenant_id: str,
            account_id: str | None,
            app_ids: list[str],
        ) -> dict[str, list[str]]:
            if not app_ids:
                return {}
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
        ) -> dict[str, list[str]]:
            if not dataset_ids:
                return {}
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
        ) -> MyPermissionsResponse:
            if not dify_config.RBAC_ENABLED:
                return _legacy_my_permissions(tenant_id, account_id)

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
            items = [
                {"resource_id": key, "permission_keys": value}
                for key, value in items.items()
            ]
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
