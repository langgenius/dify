from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from configs import dify_config
from services.enterprise.base import EnterpriseRequest
from services.rbac.contracts import (
    AccessMatrixItem,
    AccessPolicy,
    AccessPolicyBindingState,
    AccessPolicyCreate,
    AccessPolicyMemberBinding,
    AccessPolicyUpdate,
    AgentAccessMatrix,
    AgentMigrationReport,
    AppAccessMatrix,
    AppendAgentWhitelistMembersBatchItem,
    AppendAppWhitelistMembersBatchItem,
    AppendDatasetWhitelistMembersBatchItem,
    ConfiguredAgentIDs,
    DatasetAccessMatrix,
    DeleteMemberBindings,
    ListOption,
    MemberBindingsResponse,
    MemberRolesResponse,
    MembersInRole,
    MyPermissionsResponse,
    Paginated,
    Pagination,
    PermissionCatalogResponse,
    RBACResourceType,
    RBACRole,
    RBACRoleAccount,
    ReplaceBindings,
    ReplaceMemberBindings,
    ReplaceUserAccessPolicies,
    ReplaceUserAccessPoliciesResponse,
    ResourceUserAccessPoliciesResponse,
    ResourceWhitelist,
    ResourceWhitelistConfig,
    ResourceWhitelistConfigResource,
    ResourceWhitelistConfigsResponse,
    ResourceWhitelistResources,
    RoleBindingsResponse,
    RoleMutation,
    WorkspaceAccessMatrix,
    _RBACModel,
    _ResourceAccessRoute,
    _ResourceWhitelistConfigSnapshot,
)

logger = logging.getLogger(__name__)


_INNER_PREFIX = "/rbac"


def _inner_call(
    method: str,
    endpoint: str,
    *,
    tenant_id: str,
    account_id: str | None = None,
    json: Any | None = None,
    params: dict[str, Any] | None = None,
    language: str | None = None,
) -> Any:
    """Send an Enterprise request with localization supplied by the caller."""
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
    def __init__(
        self,
        route: _ResourceAccessRoute,
        matrix_model: type[MatrixT],
        *,
        replace_user_policies_exclude_unset: bool = False,
    ) -> None:
        self._route = route
        self._matrix_model = matrix_model
        self._replace_user_policies_exclude_unset = replace_user_policies_exclude_unset

    def _path(self, suffix: str) -> str:
        return f"{_INNER_PREFIX}/{self._route.segment}/{suffix}"

    def _params(self, resource_id: str, policy_id: str | None = None) -> dict[str, object]:
        params: dict[str, object] = {self._route.id_param: resource_id}
        if policy_id is not None:
            params["policy_id"] = policy_id
        return params

    def whitelist_resources(
        self, tenant_id: str, account_id: str | None, *, language: str | None = None
    ) -> ResourceWhitelistResources:
        data = _inner_call(
            "GET", self._path("whitelist/resources"), tenant_id=tenant_id, account_id=account_id, language=language
        )
        return ResourceWhitelistResources.model_validate(data or {})

    def user_access_policies(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        *,
        options: ListOption | None = None,
        language: str | None = None,
    ) -> ResourceUserAccessPoliciesResponse:
        params = (options or ListOption()).to_params({self._route.id_param: resource_id})
        data = _inner_call(
            "GET",
            self._path("user-access-policies"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=params,
            language=language,
        )
        return ResourceUserAccessPoliciesResponse.model_validate(data or {})

    def replace_user_access_policies(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        target_account_id: str | None,
        payload: ReplaceUserAccessPolicies,
        *,
        language: str | None = None,
    ) -> ReplaceUserAccessPoliciesResponse:
        params = self._params(resource_id)
        params["account_id"] = target_account_id
        data = _inner_call(
            "PUT",
            self._path("user-access-policies"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=params,
            json=payload.model_dump(mode="json", exclude_unset=self._replace_user_policies_exclude_unset),
            language=language,
        )
        return ReplaceUserAccessPoliciesResponse.model_validate(data or {})

    def whitelist(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> ResourceWhitelist:
        data = _inner_call(
            "GET",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
            language=language,
        )
        return ResourceWhitelist.model_validate(data or {})

    def whitelist_config(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> ResourceWhitelistConfig:
        data = _inner_call(
            "GET",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
            language=language,
        )
        return ResourceWhitelistConfig.model_validate(data or {})

    def legacy_whitelist_config(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> _ResourceWhitelistConfigSnapshot:
        data = _inner_call(
            "GET",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
            language=language,
        )
        return _ResourceWhitelistConfigSnapshot.model_validate(data or {})

    def replace_whitelist(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        payload: ReplaceMemberBindings,
        *,
        language: str | None = None,
    ) -> ResourceWhitelist:
        data = _inner_call(
            "PUT",
            self._path("whitelist"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
            json=payload.model_dump(mode="json"),
            language=language,
        )
        return ResourceWhitelist.model_validate(data or {})

    def append_whitelist_members_batch(
        self, tenant_id: str, account_id: str | None, data: Sequence[_RBACModel], *, language: str | None = None
    ) -> None:
        _inner_call(
            "POST",
            self._path("whitelist/members/batch"),
            tenant_id=tenant_id,
            account_id=account_id,
            json={"data": [item.model_dump(mode="json") for item in data]},
            language=language,
        )

    def matrix(
        self, tenant_id: str, account_id: str | None, resource_id: str, *, language: str | None = None
    ) -> MatrixT:
        data = _inner_call(
            "GET",
            self._path("access-policy"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id),
            language=language,
        )
        return self._matrix_model.model_validate(data or {})

    def list_role_bindings(
        self, tenant_id: str, account_id: str | None, resource_id: str, policy_id: str, *, language: str | None = None
    ) -> RoleBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/role-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
            language=language,
        )
        return RoleBindingsResponse.model_validate(data or {})

    def list_member_bindings(
        self, tenant_id: str, account_id: str | None, resource_id: str, policy_id: str, *, language: str | None = None
    ) -> MemberBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/member-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
            language=language,
        )
        return MemberBindingsResponse.model_validate(data or {})

    def delete_member_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        resource_id: str,
        policy_id: str,
        payload: DeleteMemberBindings,
        *,
        language: str | None = None,
    ) -> None:
        _inner_call(
            "DELETE",
            self._path("access-policy/member-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=self._params(resource_id, policy_id),
            json=payload.model_dump(mode="json"),
            language=language,
        )


class _WorkspaceAccessClient:
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
        language: str | None = None,
    ) -> WorkspaceAccessMatrix:
        data = _inner_call(
            "GET",
            self._path("access-policy"),
            tenant_id=tenant_id,
            account_id=account_id,
            params=(options or ListOption()).to_params() or None,
            language=language,
        )
        return WorkspaceAccessMatrix.model_validate(data or {})

    def list_role_bindings(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> RoleBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/role-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
            language=language,
        )
        return RoleBindingsResponse.model_validate(data or {})

    def list_member_bindings(
        self, tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
    ) -> MemberBindingsResponse:
        data = _inner_call(
            "GET",
            self._path("access-policy/member-bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
            language=language,
        )
        return MemberBindingsResponse.model_validate(data or {})

    def replace_bindings(
        self,
        tenant_id: str,
        account_id: str | None,
        policy_id: str,
        payload: ReplaceBindings,
        *,
        language: str | None = None,
    ) -> AccessMatrixItem:
        data = _inner_call(
            "PUT",
            self._path("access-policy/bindings"),
            tenant_id=tenant_id,
            account_id=account_id,
            params={"policy_id": policy_id},
            json=payload.model_dump(mode="json"),
            language=language,
        )
        return AccessMatrixItem.model_validate(data or {})


_APP_ACCESS = _ResourceAccessClient(RBACResourceType.APP.route, AppAccessMatrix)
_DATASET_ACCESS = _ResourceAccessClient(
    RBACResourceType.DATASET.route, DatasetAccessMatrix, replace_user_policies_exclude_unset=True
)
_AGENT_ACCESS = _ResourceAccessClient(RBACResourceType.AGENT.route, AgentAccessMatrix)
_WORKSPACE_APP_ACCESS = _WorkspaceAccessClient(RBACResourceType.APP.route)
_WORKSPACE_DATASET_ACCESS = _WorkspaceAccessClient(RBACResourceType.DATASET.route)
_WORKSPACE_AGENT_ACCESS = _WorkspaceAccessClient(RBACResourceType.AGENT.route)


def _resource_permission_catalog(
    resource_type: RBACResourceType, tenant_id: str, account_id: str | None, *, language: str | None = None
) -> PermissionCatalogResponse:
    data = _inner_call(
        "GET",
        f"{_INNER_PREFIX}/role-permissions/catalog/{resource_type.value}",
        tenant_id=tenant_id,
        account_id=account_id,
        language=language,
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
        def workspace(
            tenant_id: str, account_id: str | None = None, *, language: str | None = None
        ) -> PermissionCatalogResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/role-permissions/catalog",
                tenant_id=tenant_id,
                account_id=account_id,
                language=language,
            )
            return PermissionCatalogResponse.model_validate(data or {})

        @staticmethod
        def app(
            tenant_id: str, account_id: str | None = None, *, language: str | None = None
        ) -> PermissionCatalogResponse:
            return _resource_permission_catalog(RBACResourceType.APP, tenant_id, account_id, language=language)

        @staticmethod
        def dataset(
            tenant_id: str, account_id: str | None = None, *, language: str | None = None
        ) -> PermissionCatalogResponse:
            return _resource_permission_catalog(RBACResourceType.DATASET, tenant_id, account_id, language=language)

        @staticmethod
        def agent(
            tenant_id: str, account_id: str | None = None, *, language: str | None = None
        ) -> PermissionCatalogResponse:
            return _resource_permission_catalog(RBACResourceType.AGENT, tenant_id, account_id, language=language)

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
            language: str | None = None,
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
                language=language,
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
            language: str | None = None,
        ) -> Paginated[MembersInRole]:
            params = (options or ListOption()).to_params({"role_id": role_id})
            data = _inner_call(
                "GET", f"{_INNER_PREFIX}/roles/members", tenant_id=tenant_id, params=params or None, language=language
            )
            data = data or {}
            return Paginated[MembersInRole](
                data=[MembersInRole.model_validate(item) for item in data.get("data") or []],
                pagination=Pagination.model_validate(data["pagination"]) if data.get("pagination") else None,
            )

        @staticmethod
        def get(
            tenant_id: str,
            account_id: str | None,
            role_id: str,
            billing_enabled: bool = True,
            *,
            language: str | None = None,
        ) -> RBACRole:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id, "billing_enabled": billing_enabled},
                language=language,
            )
            return RBACRole.model_validate(data or {})

        @staticmethod
        def create(
            tenant_id: str, account_id: str | None, payload: RoleMutation, *, language: str | None = None
        ) -> RBACRole:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/roles",
                tenant_id=tenant_id,
                account_id=account_id,
                json=payload.model_dump(mode="json"),
                language=language,
            )
            return RBACRole.model_validate(data or {})

        @staticmethod
        def update(
            tenant_id: str, account_id: str | None, role_id: str, payload: RoleMutation, *, language: str | None = None
        ) -> RBACRole:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id},
                json=payload.model_dump(mode="json"),
                language=language,
            )
            return RBACRole.model_validate(data or {})

        @staticmethod
        def delete(tenant_id: str, account_id: str | None, role_id: str, *, language: str | None = None) -> None:
            _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/roles/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": role_id},
                language=language,
            )

        @staticmethod
        def copy(
            tenant_id: str,
            account_id: str | None,
            role_id: str,
            copy_member: bool = True,
            *,
            language: str | None = None,
        ) -> RBACRole:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/roles/copy",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"copy_member": copy_member},
                params={"id": role_id},
                language=language,
            )

            return RBACRole.model_validate(data or {})

        @staticmethod
        def members(
            tenant_id: str,
            account_id: str | None,
            role_id: str,
            *,
            options: ListOption | None = None,
            language: str | None = None,
        ) -> Paginated[RBACRoleAccount]:
            params = (options or ListOption()).to_params({"role_id": role_id})
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/roles/members",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params,
                language=language,
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
            language: str | None = None,
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
                language=language,
            )
            data = data or {}
            return Paginated[AccessPolicy](
                data=[AccessPolicy.model_validate(item) for item in data.get("data") or []],
                pagination=Pagination.model_validate(data["pagination"]) if data.get("pagination") else None,
            )

        @staticmethod
        def get(tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None) -> AccessPolicy:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/access-policies/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
                language=language,
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def create(
            tenant_id: str, account_id: str | None, payload: AccessPolicyCreate, *, language: str | None = None
        ) -> AccessPolicy:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/access-policies",
                tenant_id=tenant_id,
                account_id=account_id,
                json=payload.model_dump(mode="json"),
                language=language,
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def update(
            tenant_id: str,
            account_id: str | None,
            policy_id: str,
            payload: AccessPolicyUpdate,
            *,
            language: str | None = None,
        ) -> AccessPolicy:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policies/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
                json=payload.model_dump(mode="json"),
                language=language,
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def copy(
            tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None
        ) -> AccessPolicy:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/access-policies/copy",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
                language=language,
            )
            return AccessPolicy.model_validate(data or {})

        @staticmethod
        def delete(tenant_id: str, account_id: str | None, policy_id: str, *, language: str | None = None) -> None:
            _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/access-policies/item",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"id": policy_id},
                language=language,
            )

        @staticmethod
        def sync_creator_access_policy_member_bindings(
            tenant_id: str,
            account_id: str | None,
            *,
            resource_type: RBACResourceType | str,
            resource_id: str,
            language: str | None = None,
        ) -> Sequence[AccessPolicyMemberBinding]:
            params = _resource_id_params(resource_type, resource_id)
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policies/creator-member-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params=params,
                language=language,
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
        def lock(
            tenant_id: str, account_id: str | None, binding_id: str, *, language: str | None = None
        ) -> AccessPolicyBindingState:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policy-bindings/lock",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"binding_id": binding_id},
                language=language,
            )
            return AccessPolicyBindingState.model_validate(data or {})

        @staticmethod
        def unlock(
            tenant_id: str, account_id: str | None, binding_id: str, *, language: str | None = None
        ) -> AccessPolicyBindingState:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/access-policy-bindings/unlock",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"binding_id": binding_id},
                language=language,
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
            *,
            language: str | None = None,
        ) -> ResourceWhitelistConfigsResponse:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/whitelist/configs",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"resources": [resource.model_dump(mode="json") for resource in resources]},
                language=language,
            )
            return ResourceWhitelistConfigsResponse.model_validate(data or {})

    # ------------------------------------------------------------------
    # Per-app access (screenshot 1: App Access Config).
    # ------------------------------------------------------------------
    class AppAccess:
        @staticmethod
        def whitelist_resources(
            tenant_id: str, account_id: str | None, *, language: str | None = None
        ) -> ResourceWhitelistResources:
            return _APP_ACCESS.whitelist_resources(tenant_id, account_id, language=language)

        @staticmethod
        def replace_user_access_policies(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            target_account_id: str | None,
            payload: ReplaceUserAccessPolicies,
            *,
            language: str | None = None,
        ) -> ReplaceUserAccessPoliciesResponse:
            return _APP_ACCESS.replace_user_access_policies(
                tenant_id, account_id, app_id, target_account_id, payload, language=language
            )

        @staticmethod
        def legacy_whitelist_config(
            tenant_id: str, account_id: str | None, app_id: str, *, language: str | None = None
        ) -> _ResourceWhitelistConfigSnapshot:
            return _APP_ACCESS.legacy_whitelist_config(tenant_id, account_id, app_id, language=language)

        @staticmethod
        def replace_whitelist(
            tenant_id: str,
            account_id: str | None,
            app_id: str,
            payload: ReplaceMemberBindings,
            *,
            language: str | None = None,
        ) -> ResourceWhitelist:
            return _APP_ACCESS.replace_whitelist(tenant_id, account_id, app_id, payload, language=language)

        @staticmethod
        def append_whitelist_members_batch(
            tenant_id: str,
            account_id: str | None,
            data: Sequence[AppendAppWhitelistMembersBatchItem],
            *,
            language: str | None = None,
        ) -> None:
            _APP_ACCESS.append_whitelist_members_batch(tenant_id, account_id, data, language=language)

    # ------------------------------------------------------------------
    # Per-dataset access (screenshot 1: Knowledge Base Access Config).
    # ------------------------------------------------------------------
    class DatasetAccess:
        @staticmethod
        def whitelist_resources(
            tenant_id: str, account_id: str | None, *, language: str | None = None
        ) -> ResourceWhitelistResources:
            return _DATASET_ACCESS.whitelist_resources(tenant_id, account_id, language=language)

        @staticmethod
        def replace_user_access_policies(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            target_account_id: str | None,
            payload: ReplaceUserAccessPolicies,
            *,
            language: str | None = None,
        ) -> ReplaceUserAccessPoliciesResponse:
            return _DATASET_ACCESS.replace_user_access_policies(
                tenant_id, account_id, dataset_id, target_account_id, payload, language=language
            )

        @staticmethod
        def legacy_whitelist_config(
            tenant_id: str, account_id: str | None, dataset_id: str, *, language: str | None = None
        ) -> _ResourceWhitelistConfigSnapshot:
            return _DATASET_ACCESS.legacy_whitelist_config(tenant_id, account_id, dataset_id, language=language)

        @staticmethod
        def replace_whitelist(
            tenant_id: str,
            account_id: str | None,
            dataset_id: str,
            payload: ReplaceMemberBindings,
            *,
            language: str | None = None,
        ) -> ResourceWhitelist:
            return _DATASET_ACCESS.replace_whitelist(tenant_id, account_id, dataset_id, payload, language=language)

        @staticmethod
        def append_whitelist_members_batch(
            tenant_id: str,
            account_id: str | None,
            data: Sequence[AppendDatasetWhitelistMembersBatchItem],
            *,
            language: str | None = None,
        ) -> None:
            _DATASET_ACCESS.append_whitelist_members_batch(tenant_id, account_id, data, language=language)

    class AgentAccess:
        @staticmethod
        def whitelist_resources(
            tenant_id: str, account_id: str | None, *, language: str | None = None
        ) -> ResourceWhitelistResources:
            return _AGENT_ACCESS.whitelist_resources(tenant_id, account_id, language=language)

        @staticmethod
        def replace_user_access_policies(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            target_account_id: str | None,
            payload: ReplaceUserAccessPolicies,
            *,
            language: str | None = None,
        ) -> ReplaceUserAccessPoliciesResponse:
            return _AGENT_ACCESS.replace_user_access_policies(
                tenant_id, account_id, agent_id, target_account_id, payload, language=language
            )

        @staticmethod
        def legacy_whitelist_config(
            tenant_id: str, account_id: str | None, agent_id: str, *, language: str | None = None
        ) -> _ResourceWhitelistConfigSnapshot:
            return _AGENT_ACCESS.legacy_whitelist_config(tenant_id, account_id, agent_id, language=language)

        @staticmethod
        def replace_whitelist(
            tenant_id: str,
            account_id: str | None,
            agent_id: str,
            payload: ReplaceMemberBindings,
            *,
            language: str | None = None,
        ) -> ResourceWhitelist:
            return _AGENT_ACCESS.replace_whitelist(tenant_id, account_id, agent_id, payload, language=language)

        @staticmethod
        def append_whitelist_members_batch(
            tenant_id: str,
            account_id: str | None,
            data: Sequence[AppendAgentWhitelistMembersBatchItem],
            *,
            language: str | None = None,
        ) -> None:
            _AGENT_ACCESS.append_whitelist_members_batch(tenant_id, account_id, data, language=language)

    class MemberRoles:
        """Remote member-role bindings. Local membership belongs to WorkspaceRepository."""

        @staticmethod
        def get(
            tenant_id: str,
            account_id: str | None,
            member_account_id: str,
            *,
            language: str | None = None,
        ) -> MemberRolesResponse:
            data = _inner_call(
                "GET",
                f"{_INNER_PREFIX}/members/rbac-roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": member_account_id},
                language=language,
            )
            return MemberRolesResponse.model_validate(data or {})

        @staticmethod
        def batch_get(
            tenant_id: str, account_id: str | None, member_account_ids: list[str], *, language: str | None = None
        ) -> list[MemberRolesResponse]:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/members/rbac-roles/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"member_ids": member_account_ids},
                language=language,
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
            language: str | None = None,
        ) -> MemberRolesResponse:
            data = _inner_call(
                "PUT",
                f"{_INNER_PREFIX}/members/rbac-roles",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": member_account_id},
                json={"role_ids": role_ids},
                language=language,
            )
            return MemberRolesResponse.model_validate(data or {})

        @staticmethod
        def delete_rbac_bindings(tenant_id: str, account_id: str, *, language: str | None = None):
            data = _inner_call(
                "DELETE",
                f"{_INNER_PREFIX}/members/rbac-bindings",
                tenant_id=tenant_id,
                account_id=account_id,
                params={"account_id": account_id},
                language=language,
            )
            return data

    class Migrations:
        @staticmethod
        def migrate_agent_manage_roles(
            tenant_id: str, *, apply: bool, language: str | None = None
        ) -> AgentMigrationReport:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/migrations/agent-manage-roles",
                tenant_id=tenant_id,
                json={"apply": apply},
                language=language,
            )
            return AgentMigrationReport.model_validate(data or {})

        @staticmethod
        def list_configured_agent_ids(
            tenant_id: str, agent_ids: list[str], *, language: str | None = None
        ) -> list[str]:
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/migrations/agent-access-state",
                tenant_id=tenant_id,
                json={"agent_ids": agent_ids},
                language=language,
            )
            return ConfiguredAgentIDs.model_validate(data or {}).configured_agent_ids

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
            language: str | None = None,
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
                language=language,
            )
            return bool(data.get("allowed", False))

    class AppPermissions:
        @staticmethod
        def batch_get(
            tenant_id: str, account_id: str | None, app_ids: list[str], *, language: str | None = None
        ) -> dict[str, list[str]]:
            if not app_ids:
                return {}
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/apps/permission-keys/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"app_ids": app_ids},
                language=language,
            )
            return _parse_resource_permission_keys_batch(data, resource_id_key="app_id")

    class DatasetPermissions:
        @staticmethod
        def batch_get(
            tenant_id: str,
            account_id: str | None,
            dataset_ids: list[str],
            *,
            language: str | None = None,
        ) -> dict[str, list[str]]:
            if not dataset_ids:
                return {}
            data = _inner_call(
                "POST",
                f"{_INNER_PREFIX}/datasets/permission-keys/batch",
                tenant_id=tenant_id,
                account_id=account_id,
                json={"dataset_ids": dataset_ids},
                language=language,
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
            language: str | None = None,
        ) -> MyPermissionsResponse:
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
                language=language,
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
