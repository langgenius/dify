from __future__ import annotations

from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

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
    role_key: str
    name: str
    description: str = ""
    is_builtin: bool = False
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


class AccessPolicyRoleBinding(_RBACModel):
    id: str
    tenant_id: str = ""
    access_policy_id: str
    resource_type: str
    resource_id: str = ""
    role_key: str
    created_at: int = 0


class AccessPolicyMemberBinding(_RBACModel):
    id: str
    tenant_id: str = ""
    access_policy_id: str
    resource_type: str
    resource_id: str = ""
    account_id: str
    created_at: int = 0


class AccessMatrixItem(_RBACModel):
    policy: AccessPolicy | None = None
    role_keys: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)


class AppAccessMatrix(_RBACModel):
    app_id: str = ""
    items: list[AccessMatrixItem] = Field(default_factory=list)


class DatasetAccessMatrix(_RBACModel):
    dataset_id: str = ""
    items: list[AccessMatrixItem] = Field(default_factory=list)


class WorkspaceAccessMatrix(_RBACModel):
    items: list[AccessMatrixItem] = Field(default_factory=list)


class RoleBindingsResponse(_RBACModel):
    data: list[AccessPolicyRoleBinding] = Field(default_factory=list)


class MemberBindingsResponse(_RBACModel):
    data: list[AccessPolicyMemberBinding] = Field(default_factory=list)


class MemberRolesResponse(_RBACModel):
    account_id: str
    roles: list[RBACRole] = Field(default_factory=list)


# ---------- Mutation request models ----------


class RoleMutation(_RBACModel):
    """Payload shared by role create & update.

    ``type`` defaults to ``workspace`` because that is the only concrete role
    type supported by the enterprise backend today (see biz.RBACRoleType).
    """

    name: str
    role_key: str
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
    role_keys: list[str] = Field(default_factory=list)


class ReplaceMemberBindings(_RBACModel):
    account_ids: list[str] = Field(default_factory=list)


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

    # ------------------------------------------------------------------
    # Workspace-level access (screenshot 2: Settings > Access Rules).
    # ------------------------------------------------------------------
    class WorkspaceAccess:
        @staticmethod
        def app_matrix(tenant_id: str, account_id: str | None = None) -> WorkspaceAccessMatrix:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/apps/access-policy",
                tenant_id=tenant_id,
                account_id=account_id,
            )
            return WorkspaceAccessMatrix.model_validate(data or {})

        @staticmethod
        def dataset_matrix(tenant_id: str, account_id: str | None = None) -> WorkspaceAccessMatrix:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/workspace/datasets/access-policy",
                tenant_id=tenant_id,
                account_id=account_id,
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
            return MemberRolesResponse.model_validate(data or {})

        @staticmethod
        def replace(
            tenant_id: str,
            account_id: str | None,
            member_account_id: str,
            role_keys: list[str],
        ) -> MemberRolesResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/members/rbac-roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": member_account_id},
                json={"role_keys": role_keys},
            )
            return MemberRolesResponse.model_validate(data or {})
