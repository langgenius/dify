from __future__ import annotations

from typing import Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from configs import dify_config
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    edit_permission_required,
    is_admin_or_owner_required,
    model_validate,
    rbac_permission_required,
)
from core.db.session_factory import session_factory
from core.rbac import RBACResourceWhitelistScope
from enums import DeploymentEdition
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import Account, TenantAccountJoin
from services.enterprise import rbac_service as svc
from services.errors.account import (
    CannotOperateSelfError,
    MemberNotInTenantError,
    NoPermissionError,
    RoleAlreadyAssignedError,
)
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


class _RBACRoleList(svc.Paginated[svc.RBACRole]):
    pass


class _MembersInRoleList(svc.Paginated[svc.MembersInRole]):
    pass


class _AccessPolicyList(svc.Paginated[svc.AccessPolicy]):
    pass


register_response_schema_models(
    console_ns,
    svc.PermissionCatalogResponse,
    svc.RBACRole,
    _RBACRoleList,
    _MembersInRoleList,
    svc.AccessPolicy,
    _AccessPolicyList,
    svc.AccessPolicyBindingState,
    svc.MyPermissionsResponse,
    svc.AppAccessMatrix,
    svc.DatasetAccessMatrix,
    svc.WorkspaceAccessMatrix,
    svc.ResourceWhitelist,
    svc.ResourceUserAccessPoliciesResponse,
    svc.ReplaceUserAccessPoliciesResponse,
    svc.RoleBindingsResponse,
    svc.MemberBindingsResponse,
    svc.MemberRolesResponse,
    svc.AccessMatrixItem,
)

_LEGACY_ROLE_PERMISSION_KEYS: dict[str, list[str]] = {
    # This is a compatibility projection from the pre-RBAC workspace roles into
    # the 2.0 permission matrix documented in "权限整理2.0". It intentionally
    # models the product-facing role surface for the new RBAC UI instead of the
    # legacy backend's exact hard-authorization checks.
    "owner": [
        *svc._LEGACY_WORKSPACE_OWNER_KEYS,
        *svc._LEGACY_APP_OWNER_KEYS,
        *svc._LEGACY_DATASET_OWNER_KEYS,
    ],
    "admin": [
        *svc._LEGACY_WORKSPACE_ADMIN_KEYS,
        *svc._LEGACY_APP_ADMIN_KEYS,
        *svc._LEGACY_DATASET_ADMIN_KEYS,
    ],
    "editor": [
        *svc._LEGACY_WORKSPACE_EDITOR_KEYS,
        *svc._LEGACY_APP_EDITOR_KEYS,
        *svc._LEGACY_DATASET_EDITOR_KEYS,
    ],
    "normal": [
        *svc._LEGACY_WORKSPACE_NORMAL_KEYS,
        *svc._LEGACY_APP_NORMAL_KEYS,
    ],
    "dataset_operator": [
        *svc._LEGACY_WORKSPACE_DATASET_OPERATOR_KEYS,
        *svc._LEGACY_DATASET_DATASET_OPERATOR_KEYS,
    ],
}


def _current_ids() -> tuple[str, str]:
    """Return ``(tenant_id, account_id)`` for the authenticated user, or
    raise a 404 when no tenant is associated with the session.
    """

    user, tenant_id = current_account_with_tenant()
    if not tenant_id:
        raise NotFound("Current workspace not found")
    return tenant_id, user.id


def _payload(model: type[BaseModel]) -> Any:
    """Validate the JSON body against ``model`` or raise ``ValidationError``.

    ``ValidationError`` bubbles up as HTTP 400 thanks to
    ``controllers/common/helpers.py`` error handling.
    """
    try:
        return model.model_validate(console_ns.payload or {})
    except ValidationError as exc:
        # Re-raise as-is so the upstream error handler renders a 400.
        raise exc


def _dump(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(mode="json")


def _account_names_by_ids(tenant_id: str, account_ids: list[str]) -> dict[str, dict[str, str]]:
    ids = sorted({account_id.strip() for account_id in account_ids if account_id and account_id.strip()})
    if not ids:
        return {}

    with session_factory.create_session() as session:
        rows = session.execute(
            select(Account.id, Account.name, Account.avatar, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == tenant_id, Account.id.in_(ids))
        ).all()

    return {
        account_id: {
            "name": name or "",
            "avatar": avatar or "",
            "email": email or "",
        }
        for account_id, name, avatar, email in rows
    }


def _hydrate_access_matrix_account_names(tenant_id: str, items: list[svc.AccessMatrixItem]) -> None:
    account_names = _account_names_by_ids(
        tenant_id,
        [account.account_id for item in items for account in item.accounts],
    )

    for item in items:
        item.accounts = [account for account in item.accounts if account.account_id in account_names]
        for account in item.accounts:
            account_data = account_names[account.account_id]
            account.account_name = account_data["name"]
            account.avatar = account_data["avatar"]
            account.email = account_data["email"]


def _hydrate_resource_user_account_names(tenant_id: str, items: list[svc.ResourceUserAccessPolicies]) -> None:
    account_names = _account_names_by_ids(tenant_id, [item.account.account_id for item in items])
    items[:] = [item for item in items if item.account.account_id in account_names]
    for item in items:
        account_id = item.account.account_id
        account_data = account_names[account_id]
        item.account.account_name = account_data["name"]
        item.account.avatar = account_data["avatar"]
        item.account.email = account_data["email"]


def _filter_resource_whitelist(tenant_id: str, whitelist: svc.ResourceWhitelist) -> None:
    tenant_account_ids = _account_names_by_ids(tenant_id, whitelist.account_ids)
    whitelist.account_ids = [account_id for account_id in whitelist.account_ids if account_id in tenant_account_ids]


def _hydrate_member_bindings(tenant_id: str, bindings: svc.MemberBindingsResponse) -> None:
    account_names = _account_names_by_ids(tenant_id, [binding.account_id for binding in bindings.data])
    bindings.data = [binding for binding in bindings.data if binding.account_id in account_names]
    for binding in bindings.data:
        binding.account_name = account_names[binding.account_id]["name"]


def _hydrate_role_members(tenant_id: str, members: svc.Paginated[svc.MembersInRole]) -> None:
    account_names = _account_names_by_ids(tenant_id, [member.account_id for member in members.data])
    members.data = [member for member in members.data if member.account_id in account_names]
    for member in members.data:
        member.account_name = account_names[member.account_id]["name"]


class _PaginationQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page_number: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("page", "page_number"))
    results_per_page: int | None = Field(
        default=None, ge=1, le=99999, validation_alias=AliasChoices("limit", "results_per_page")
    )
    reverse: bool | None = None

    def to_inner_options(self) -> svc.ListOption:
        return svc.ListOption.model_validate(self.model_dump())


class _RolesListQuery(_PaginationQuery):
    include_owner: int = Field(default=0, ge=0, le=1)


class CopyRoleParam(BaseModel):
    copy_member: bool = True


def _pagination_options() -> svc.ListOption:
    return _PaginationQuery.model_validate(request.args.to_dict(flat=True)).to_inner_options()


def _legacy_workspace_roles(
    options: svc.ListOption | None = None, *, include_owner: int = 0, billing_enabled: bool = True
) -> svc.Paginated[svc.RBACRole]:
    """Return the built-in legacy workspace roles in the RBAC list shape.

    This keeps the new `/rbac/roles` endpoint compatible with the original
    Dify role model when enterprise RBAC is disabled.
    """
    legacy_roles = []
    for role_name in ("owner", "admin", "editor", "normal", "dataset_operator"):
        if not dify_config.DATASET_OPERATOR_ENABLED and role_name == "dataset_operator":
            continue

        permission_keys = _LEGACY_ROLE_PERMISSION_KEYS[role_name]
        valid_permission_keys = []
        for permission_key in permission_keys:
            if not billing_enabled and "billing" in permission_key:
                continue
            valid_permission_keys.append(permission_key)

        legacy_roles.append(
            svc.RBACRole(
                id=role_name,
                tenant_id="",
                type=svc.RBACRoleType.WORKSPACE.value,
                category="global_system_default",
                name=role_name,
                description="",
                is_builtin=True,
                permission_keys=valid_permission_keys,
                role_tag="owner" if role_name == "owner" else "",
            )
        )

    if not include_owner:
        legacy_roles = [r for r in legacy_roles if r.name != "owner"]

    page_number = options.page_number if options and options.page_number is not None else 1
    results_per_page = (
        options.results_per_page if options and options.results_per_page is not None else len(legacy_roles)
    )
    reverse = options.reverse if options and options.reverse is not None else False

    ordered_roles = list(reversed(legacy_roles)) if reverse else legacy_roles
    start = max(page_number - 1, 0) * results_per_page
    end = start + results_per_page
    paged_roles = ordered_roles[start:end]
    total_count = len(legacy_roles)
    total_pages = (total_count + results_per_page - 1) // results_per_page if results_per_page > 0 else 0

    return svc.Paginated[svc.RBACRole](
        data=paged_roles,
        pagination=svc.Pagination(
            total_count=total_count,
            per_page=results_per_page,
            current_page=page_number,
            total_pages=total_pages,
        ),
    )


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog")
class RBACWorkspaceCatalogApi(Resource):
    @login_required
    @console_ns.response(200, "Success", console_ns.models[svc.PermissionCatalogResponse.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.workspace(tenant_id, account_id))


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog/app")
class RBACAppCatalogApi(Resource):
    @login_required
    @console_ns.response(200, "Success", console_ns.models[svc.PermissionCatalogResponse.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.app(tenant_id, account_id))


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog/dataset")
class RBACDatasetCatalogApi(Resource):
    @login_required
    @console_ns.response(200, "Success", console_ns.models[svc.PermissionCatalogResponse.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.dataset(tenant_id, account_id))


# ---------------------------------------------------------------------------
# Roles.
# ---------------------------------------------------------------------------


class _WorkspaceRoleManageResource(Resource):
    # Flask-RESTX wraps this list in order, so the last decorator runs first.
    method_decorators = [
        rbac_permission_required(
            RBACResourceScope.WORKSPACE,
            RBACPermission.WORKSPACE_ROLE_MANAGE,
            resource_required=False,
        ),
        is_admin_or_owner_required,
        login_required,
    ]


class _RoleUpsertRequest(BaseModel):
    """Accepts the payload sent by the Create/Edit Role dialog."""

    name: str
    description: str = ""
    permission_keys: list[str] = []

    def to_mutation(self) -> svc.RoleMutation:
        return svc.RoleMutation(
            name=self.name,
            description=self.description,
            permission_keys=list(self.permission_keys),
        )


@console_ns.route("/workspaces/current/rbac/roles")
class RBACRolesApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[_RBACRoleList.__name__])
    @model_validate(_RolesListQuery)
    def get(self, req_data: _RolesListQuery):
        tenant_id, account_id = _current_ids()
        options = req_data.to_inner_options()
        if not dify_config.RBAC_ENABLED:
            result = _legacy_workspace_roles(
                options,
                include_owner=req_data.include_owner,
                billing_enabled=dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD,
            )
        else:
            result = svc.RBACService.Roles.list(
                tenant_id,
                account_id,
                include_owner=req_data.include_owner,
                biiling_enabled=dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD,
                options=options,
            )

        return _dump(result)

    @console_ns.response(201, "Role created", console_ns.models[svc.RBACRole.__name__])
    def post(self):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.create(tenant_id, account_id, request.to_mutation())
        return _dump(role), 201


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>")
class RBACRoleItemApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.RBACRole.__name__])
    def get(self, role_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.Roles.get(
                tenant_id,
                account_id,
                role_id,
                billing_enabled=dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD,
            )
        )

    @console_ns.response(200, "Success", console_ns.models[svc.RBACRole.__name__])
    def put(self, role_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.update(tenant_id, account_id, str(role_id), request.to_mutation())
        return _dump(role)

    @console_ns.response(200, "Success", console_ns.models[svc.RBACRole.__name__])
    def delete(self, role_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.Roles.delete(tenant_id, account_id, str(role_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/copy")
class RBACRoleCopyApi(_WorkspaceRoleManageResource):
    @console_ns.response(201, "Role copied", console_ns.models[svc.RBACRole.__name__])
    def post(self, role_id):
        tenant_id, account_id = _current_ids()
        request = _payload(CopyRoleParam)
        role = svc.RBACService.Roles.copy(tenant_id, account_id, str(role_id), copy_member=request.copy_member)
        return _dump(role), 201


class _AccessPolicyCreateRequest(BaseModel):
    name: str
    resource_type: svc.RBACResourceType
    description: str = ""
    permission_keys: list[str] = []


class _AccessPolicyUpdateRequest(BaseModel):
    name: str
    description: str = ""
    permission_keys: list[str] = []


@console_ns.route("/workspaces/current/rbac/access-policies")
class RBACAccessPoliciesApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[_AccessPolicyList.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        # `resource_type` is exposed as a query argument so the UI can show
        # only app-scoped or only dataset-scoped permission sets.
        resource_type = request.args.get("resource_type") or None
        return _dump(
            svc.RBACService.AccessPolicies.list(
                tenant_id,
                account_id,
                resource_type=resource_type,
                options=_pagination_options(),
            )
        )

    @console_ns.response(201, "Policy created", console_ns.models[svc.AccessPolicy.__name__])
    def post(self):
        tenant_id, account_id = _current_ids()
        request = _payload(_AccessPolicyCreateRequest)
        policy = svc.RBACService.AccessPolicies.create(
            tenant_id,
            account_id,
            svc.AccessPolicyCreate(
                name=request.name,
                resource_type=request.resource_type,
                description=request.description,
                permission_keys=list(request.permission_keys),
            ),
        )
        return _dump(policy), 201


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>")
class RBACAccessPolicyItemApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicy.__name__])
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicies.get(tenant_id, account_id, str(policy_id)))

    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicy.__name__])
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_AccessPolicyUpdateRequest)
        policy = svc.RBACService.AccessPolicies.update(
            tenant_id,
            account_id,
            str(policy_id),
            svc.AccessPolicyUpdate(
                name=request.name,
                description=request.description,
                permission_keys=list(request.permission_keys),
            ),
        )
        return _dump(policy)

    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicy.__name__])
    def delete(self, policy_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.AccessPolicies.delete(tenant_id, account_id, str(policy_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>/copy")
class RBACAccessPolicyCopyApi(_WorkspaceRoleManageResource):
    @console_ns.response(201, "Policy copied", console_ns.models[svc.AccessPolicy.__name__])
    def post(self, policy_id):
        tenant_id, account_id = _current_ids()
        policy = svc.RBACService.AccessPolicies.copy(tenant_id, account_id, str(policy_id))
        return _dump(policy), 201


@console_ns.route("/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/lock")
class RBACAccessPolicyBindingLockApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicyBindingState.__name__])
    def put(self, binding_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicyBindings.lock(tenant_id, account_id, str(binding_id)))


@console_ns.route("/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/unlock")
class RBACAccessPolicyBindingUnlockApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicyBindingState.__name__])
    def put(self, binding_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicyBindings.unlock(tenant_id, account_id, str(binding_id)))


# ---------------------------------------------------------------------------
# Per-app access (App Access Config).
# ---------------------------------------------------------------------------


class _AppAccessConfigResource(Resource):
    method_decorators = [
        rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_ACCESS_CONFIG),
        edit_permission_required,
        login_required,
    ]


class _ResourceAccessScopeRequest(BaseModel):
    scope: RBACResourceWhitelistScope


class _ReplaceBindingsRequest(BaseModel):
    role_ids: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("role_ids", "account_ids", mode="before")
    @classmethod
    def _coerce_bindings(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class _ReplaceUserAccessPoliciesPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_policy_ids: list[str] = Field(default_factory=list)

    @field_validator("access_policy_ids", mode="before")
    @classmethod
    def _coerce_access_policy_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class _DeleteMemberBindingsRequest(BaseModel):
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class _AccessControlLanguageQuery(BaseModel):
    language: Literal["en", "ja", "zh"] | None = Field(default=None, description="Localized policy label language")


register_schema_models(
    console_ns,
    _ResourceAccessScopeRequest,
    _ReplaceBindingsRequest,
    _ReplaceUserAccessPoliciesPayload,
    _DeleteMemberBindingsRequest,
    _AccessControlLanguageQuery,
)


@console_ns.route("/workspaces/current/rbac/my-permissions")
class RBACMyPermissionsApi(Resource):
    @login_required
    @console_ns.response(200, "Success", console_ns.models[svc.MyPermissionsResponse.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.MyPermissions.get(
                tenant_id,
                account_id,
                app_id=request.args.get("app_id") or None,
                dataset_id=request.args.get("dataset_id") or None,
                session=db.session(),
            )
        )


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policy")
class RBACAppMatrixApi(_AppAccessConfigResource):
    @console_ns.doc(params=query_params_from_model(_AccessControlLanguageQuery))
    @console_ns.response(200, "Success", console_ns.models[svc.AppAccessMatrix.__name__])
    def get(self, app_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.AppAccess.matrix(tenant_id, account_id, str(app_id))
        _hydrate_access_matrix_account_names(tenant_id, result.items)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/whitelist")
class RBACAppWhitelistApi(_AppAccessConfigResource):
    @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelist.__name__])
    def get(self, app_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.AppAccess.whitelist(tenant_id, account_id, str(app_id))
        _filter_resource_whitelist(tenant_id, result)
        return _dump(result)

    @console_ns.expect(console_ns.models[_ResourceAccessScopeRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelist.__name__])
    def put(self, app_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ResourceAccessScopeRequest)
        result = svc.RBACService.AppAccess.replace_whitelist(
            tenant_id,
            account_id,
            str(app_id),
            svc.ReplaceMemberBindings(scope=request.scope.value),
        )
        if dify_config.RBAC_ENABLED and request.scope is RBACResourceWhitelistScope.ALL:
            initialize_created_app_rbac_access_task.delay(tenant_id, account_id, str(app_id))
        _filter_resource_whitelist(tenant_id, result)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/user-access-policies")
class RBACAppUserAccessPoliciesApi(_AppAccessConfigResource):
    @console_ns.doc(params=query_params_from_model(_AccessControlLanguageQuery))
    @console_ns.response(200, "Success", console_ns.models[svc.ResourceUserAccessPoliciesResponse.__name__])
    def get(self, app_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.AppAccess.user_access_policies(tenant_id, account_id, str(app_id))
        _hydrate_resource_user_account_names(tenant_id, result.data)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/users/<uuid:target_account_id>/access-policies")
class RBACAppUserAccessPolicyAssignmentApi(_AppAccessConfigResource):
    @console_ns.expect(console_ns.models[_ReplaceUserAccessPoliciesPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.ReplaceUserAccessPoliciesResponse.__name__])
    def put(self, app_id, target_account_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceUserAccessPoliciesPayload)
        try:
            result = svc.RBACService.AppAccess.replace_user_access_policies(
                tenant_id,
                account_id,
                app_id,
                target_account_id,
                svc.ReplaceUserAccessPolicies(access_policy_ids=request.access_policy_ids),
            )
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc)) from exc
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<uuid:policy_id>/role-bindings")
class RBACAppRoleBindingsApi(_AppAccessConfigResource):
    @console_ns.response(200, "Success", console_ns.models[svc.RoleBindingsResponse.__name__])
    def get(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AppAccess.list_role_bindings(tenant_id, account_id, str(app_id), str(policy_id)))


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<string:policy_id>/member-bindings")
class RBACAppMemberBindingsApi(_AppAccessConfigResource):
    @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
    def get(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.AppAccess.list_member_bindings(tenant_id, account_id, str(app_id), str(policy_id))
        _hydrate_member_bindings(tenant_id, result)
        return _dump(result)

    @console_ns.expect(console_ns.models[_DeleteMemberBindingsRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
    def delete(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        request_body = _payload(_DeleteMemberBindingsRequest)
        svc.RBACService.AppAccess.delete_member_bindings(
            tenant_id,
            account_id,
            str(app_id),
            str(policy_id),
            svc.DeleteMemberBindings(account_ids=request_body.account_ids),
        )
        return {"result": "success"}


# ---------------------------------------------------------------------------
# Per-dataset access (Knowledge Base Access Config).
# ---------------------------------------------------------------------------


class _DatasetAccessConfigResource(Resource):
    # Legacy editors and dataset operators do not own dataset access configuration.
    method_decorators = [
        rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_ACCESS_CONFIG),
        is_admin_or_owner_required,
        login_required,
    ]


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policy")
class RBACDatasetMatrixApi(_DatasetAccessConfigResource):
    @console_ns.doc(params=query_params_from_model(_AccessControlLanguageQuery))
    @console_ns.response(200, "Success", console_ns.models[svc.DatasetAccessMatrix.__name__])
    def get(self, dataset_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.DatasetAccess.matrix(tenant_id, account_id, str(dataset_id))
        _hydrate_access_matrix_account_names(tenant_id, result.items)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/whitelist")
class RBACDatasetWhitelistApi(_DatasetAccessConfigResource):
    @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelist.__name__])
    def get(self, dataset_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.DatasetAccess.whitelist(tenant_id, account_id, str(dataset_id))
        _filter_resource_whitelist(tenant_id, result)
        return _dump(result)

    @console_ns.expect(console_ns.models[_ResourceAccessScopeRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelist.__name__])
    def put(self, dataset_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ResourceAccessScopeRequest)
        result = svc.RBACService.DatasetAccess.replace_whitelist(
            tenant_id,
            account_id,
            str(dataset_id),
            svc.ReplaceMemberBindings(scope=request.scope.value),
        )
        # Widening the scope only records it: the members still need the default access policy
        # before they can reach the dataset, same as the app whitelist route above.
        if dify_config.RBAC_ENABLED and request.scope is RBACResourceWhitelistScope.ALL:
            initialize_created_app_rbac_access_task.delay(tenant_id, account_id, dataset_id=str(dataset_id))
        _filter_resource_whitelist(tenant_id, result)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/user-access-policies")
class RBACDatasetUserAccessPoliciesApi(_DatasetAccessConfigResource):
    @console_ns.doc(params=query_params_from_model(_AccessControlLanguageQuery))
    @console_ns.response(200, "Success", console_ns.models[svc.ResourceUserAccessPoliciesResponse.__name__])
    def get(self, dataset_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.DatasetAccess.user_access_policies(tenant_id, account_id, str(dataset_id))
        _hydrate_resource_user_account_names(tenant_id, result.data)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/users/<uuid:target_account_id>/access-policies")
class RBACDatasetUserAccessPolicyAssignmentApi(_DatasetAccessConfigResource):
    @console_ns.expect(console_ns.models[_ReplaceUserAccessPoliciesPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.ReplaceUserAccessPoliciesResponse.__name__])
    def put(self, dataset_id, target_account_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceUserAccessPoliciesPayload)
        try:
            result = svc.RBACService.DatasetAccess.replace_user_access_policies(
                tenant_id,
                account_id,
                str(dataset_id),
                str(target_account_id),
                svc.ReplaceUserAccessPolicies(access_policy_ids=request.access_policy_ids),
            )
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc)) from exc
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<uuid:policy_id>/role-bindings")
class RBACDatasetRoleBindingsApi(_DatasetAccessConfigResource):
    @console_ns.response(200, "Success", console_ns.models[svc.RoleBindingsResponse.__name__])
    def get(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.DatasetAccess.list_role_bindings(tenant_id, account_id, str(dataset_id), str(policy_id))
        )


@console_ns.route(
    "/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<string:policy_id>/member-bindings"
)
class RBACDatasetMemberBindingsApi(_DatasetAccessConfigResource):
    @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
    def get(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.DatasetAccess.list_member_bindings(
            tenant_id, account_id, str(dataset_id), str(policy_id)
        )
        _hydrate_member_bindings(tenant_id, result)
        return _dump(result)

    @console_ns.expect(console_ns.models[_DeleteMemberBindingsRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
    def delete(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        request_body = _payload(_DeleteMemberBindingsRequest)
        svc.RBACService.DatasetAccess.delete_member_bindings(
            tenant_id,
            account_id,
            str(dataset_id),
            str(policy_id),
            svc.DeleteMemberBindings(account_ids=request_body.account_ids),
        )
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policy")
class RBACWorkspaceAppMatrixApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.WorkspaceAccessMatrix.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        result = svc.RBACService.WorkspaceAccess.app_matrix(tenant_id, account_id, options=options)
        _hydrate_access_matrix_account_names(tenant_id, result.items)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/role-bindings")
class RBACWorkspaceAppRoleBindingsApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.RoleBindingsResponse.__name__])
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.WorkspaceAccess.list_app_role_bindings(tenant_id, account_id, str(policy_id)))


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/bindings")
class RBACWorkspaceAppBindingsApi(_WorkspaceRoleManageResource):
    @console_ns.expect(console_ns.models[_ReplaceBindingsRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.AccessMatrixItem.__name__])
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceBindingsRequest)
        try:
            result = svc.RBACService.WorkspaceAccess.replace_app_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceBindings(role_ids=list(request.role_ids), account_ids=list(request.account_ids)),
            )
        except MemberNotInTenantError as exc:
            raise BadRequest(str(exc)) from exc
        _hydrate_access_matrix_account_names(tenant_id, [result])
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/member-bindings")
class RBACWorkspaceAppMemberBindingsApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.WorkspaceAccess.list_app_member_bindings(tenant_id, account_id, str(policy_id))
        _hydrate_member_bindings(tenant_id, result)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policy")
class RBACWorkspaceDatasetMatrixApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.WorkspaceAccessMatrix.__name__])
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        result = svc.RBACService.WorkspaceAccess.dataset_matrix(tenant_id, account_id, options=options)
        _hydrate_access_matrix_account_names(tenant_id, result.items)
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/role-bindings")
class RBACWorkspaceDatasetRoleBindingsApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.RoleBindingsResponse.__name__])
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.WorkspaceAccess.list_dataset_role_bindings(tenant_id, account_id, str(policy_id)))


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/bindings")
class RBACWorkspaceDatasetBindingsApi(_WorkspaceRoleManageResource):
    @console_ns.expect(console_ns.models[_ReplaceBindingsRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.AccessMatrixItem.__name__])
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceBindingsRequest)
        try:
            result = svc.RBACService.WorkspaceAccess.replace_dataset_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceBindings(role_ids=list(request.role_ids), account_ids=list(request.account_ids)),
            )
        except MemberNotInTenantError as exc:
            raise BadRequest(str(exc)) from exc
        _hydrate_access_matrix_account_names(tenant_id, [result])
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/member-bindings")
class RBACWorkspaceDatasetMemberBindingsApi(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.WorkspaceAccess.list_dataset_member_bindings(tenant_id, account_id, str(policy_id))
        _hydrate_member_bindings(tenant_id, result)
        return _dump(result)


# ---------------------------------------------------------------------------
# Member ↔ role bindings (Settings > Members > Assign roles).
# ---------------------------------------------------------------------------


class _ReplaceMemberRolesRequest(BaseModel):
    role_ids: list[str] = []

    @field_validator("role_ids", mode="before")
    @classmethod
    def _coerce_role_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


register_schema_models(console_ns, _ReplaceMemberRolesRequest)


@console_ns.route("/workspaces/current/rbac/members/<uuid:member_id>/rbac-roles")
class RBACMemberRolesApi(Resource):
    @login_required
    @console_ns.response(200, "Success", console_ns.models[svc.MemberRolesResponse.__name__])
    def get(self, member_id):
        tenant_id, account_id = _current_ids()
        try:
            result = svc.RBACService.MemberRoles.get(tenant_id, account_id, str(member_id), session=db.session())
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc)) from exc
        return _dump(result)

    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE,
        RBACPermission.WORKSPACE_ROLE_MANAGE,
        resource_required=False,
    )
    @console_ns.expect(console_ns.models[_ReplaceMemberRolesRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.MemberRolesResponse.__name__])
    def put(self, member_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberRolesRequest)
        try:
            result = svc.RBACService.MemberRoles.replace_user_roles(
                tenant_id,
                account_id,
                str(member_id),
                role_ids=list(request.role_ids),
            )
        except (CannotOperateSelfError, RoleAlreadyAssignedError) as exc:
            raise BadRequest(str(exc)) from exc
        except NoPermissionError as exc:
            raise Forbidden(str(exc)) from exc
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc)) from exc
        return _dump(result)


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/members")
class ListMembersByRole(_WorkspaceRoleManageResource):
    @console_ns.response(200, "Success", console_ns.models[_MembersInRoleList.__name__])
    def get(self, role_id):
        tenant_id, account_id = _current_ids()
        result = svc.RBACService.Roles.members(
            tenant_id,
            account_id,
            str(role_id),
            options=_pagination_options(),
        )
        _hydrate_role_members(tenant_id, result)
        return _dump(result)
