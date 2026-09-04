from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.rbac import RBACCheck, Workspace
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import RBACPermission, model_validate, rbac_permission_required
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import Account
from services.enterprise import rbac_service as svc
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


class _RBACRoleList(svc.Paginated[svc.RBACRole]):
    pass


class _RBACRoleAccountList(svc.Paginated[svc.RBACRoleAccount]):
    pass


class _AccessPolicyList(svc.Paginated[svc.AccessPolicy]):
    pass


class _MembersInRoleList(svc.Paginated[svc.MembersInRole]):
    pass


register_response_schema_models(
    console_ns,
    svc.PermissionCatalogResponse,
    svc.RBACRole,
    _RBACRoleList,
    _RBACRoleAccountList,
    _MembersInRoleList,
    svc.AccessPolicy,
    _AccessPolicyList,
    svc.AccessPolicyBindingState,
    svc.MyPermissionsResponse,
    svc.AppAccessMatrix,
    svc.DatasetAccessMatrix,
    svc.AgentAccessMatrix,
    svc.WorkspaceAccessMatrix,
    svc.ResourceWhitelist,
    svc.ResourceWhitelistConfig,
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


def _account_names_by_ids(account_ids: list[str]) -> dict[str, dict[str, str]]:
    ids = sorted({account_id.strip() for account_id in account_ids if account_id and account_id.strip()})
    if not ids:
        return {}

    with session_factory.create_session() as session:
        rows = session.execute(
            select(Account.id, Account.name, Account.avatar, Account.email).where(Account.id.in_(ids))
        ).all()

    return {
        account_id: {
            "name": name or "",
            "avatar": avatar or "",
            "email": email or "",
        }
        for account_id, name, avatar, email in rows
    }


def _hydrate_access_matrix_account_names(items: list[svc.AccessMatrixItem]) -> None:
    account_ids: list[str] = []
    for item in items:
        for account in item.accounts:
            account_id = account.account_id
            if account_id and not account.account_name:
                account_ids.append(account_id)

    account_names = _account_names_by_ids(account_ids)
    if not account_names:
        return

    for item in items:
        for account in item.accounts:
            account_id = str(account.account_id or "").strip()
            if account_id and not account.account_name:
                account.account_name = account_names.get(account_id, {}).get("name", "")
            account.avatar = account_names.get(account_id, {}).get("avatar", "")
            account.email = account_names.get(account_id, {}).get("email", "")


def _hydrate_resource_user_account_names(items: list[svc.ResourceUserAccessPolicies]) -> None:
    account_names = _account_names_by_ids([item.account.account_id for item in items])
    for item in items:
        account_id = item.account.account_id
        if account_id and not item.account.account_name:
            item.account.account_name = account_names.get(account_id, {}).get("name", "")
            item.account.avatar = account_names.get(account_id, {}).get("avatar", "")
            item.account.email = account_names.get(account_id, {}).get("email", "")


def _move_resource_maintainer_first(items: list[svc.ResourceUserAccessPolicies], maintainer_id: str | None) -> None:
    if not maintainer_id:
        return

    normalized_maintainer_id = str(maintainer_id).strip()
    if not normalized_maintainer_id:
        return

    for index, item in enumerate(items):
        account_id = str(item.account.account_id or "").strip()
        if account_id == normalized_maintainer_id:
            if index:
                items.insert(0, items.pop(index))
            return


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


# ---------------------------------------------------------------------------
# Roles.
# ---------------------------------------------------------------------------


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
class RBACRolesApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
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

    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(201, "Role created", console_ns.models[svc.RBACRole.__name__])
    def post(self):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.create(tenant_id, account_id, request.to_mutation())
        return _dump(role), 201


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>")
class RBACRoleItemApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
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

    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(200, "Success", console_ns.models[svc.RBACRole.__name__])
    def put(self, role_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.update(tenant_id, account_id, str(role_id), request.to_mutation())
        return _dump(role)

    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(200, "Success", console_ns.models[svc.RBACRole.__name__])
    def delete(self, role_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.Roles.delete(tenant_id, account_id, str(role_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/copy")
class RBACRoleCopyApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
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
class RBACAccessPoliciesApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
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

    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
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
class RBACAccessPolicyItemApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicy.__name__])
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicies.get(tenant_id, account_id, str(policy_id)))

    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
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

    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicy.__name__])
    def delete(self, policy_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.AccessPolicies.delete(tenant_id, account_id, str(policy_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>/copy")
class RBACAccessPolicyCopyApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(201, "Policy copied", console_ns.models[svc.AccessPolicy.__name__])
    def post(self, policy_id):
        tenant_id, account_id = _current_ids()
        policy = svc.RBACService.AccessPolicies.copy(tenant_id, account_id, str(policy_id))
        return _dump(policy), 201


@console_ns.route("/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/lock")
class RBACAccessPolicyBindingLockApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicyBindingState.__name__])
    def put(self, binding_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicyBindings.lock(tenant_id, account_id, str(binding_id)))


@console_ns.route("/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/unlock")
class RBACAccessPolicyBindingUnlockApi(Resource):
    @login_required
    @rbac_permission_required(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace()))
    @console_ns.response(200, "Success", console_ns.models[svc.AccessPolicyBindingState.__name__])
    def put(self, binding_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicyBindings.unlock(tenant_id, account_id, str(binding_id)))


# ---------------------------------------------------------------------------
# Shared request/response models for the per-resource access config.
# ---------------------------------------------------------------------------


class _ResourceAccessScopeRequest(BaseModel):
    automatic_include_workspace_members: bool


class _ReplaceBindingsRequest(BaseModel):
    role_ids: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("role_ids", "account_ids", mode="before")
    @classmethod
    def _coerce_bindings(cls, value: Any) -> list[str]:
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


class _ResourceUserAccessPoliciesQuery(_PaginationQuery):
    language: Literal["en", "ja", "zh"] | None = Field(default=None, description="Localized policy label language")


register_schema_models(
    console_ns,
    _ResourceAccessScopeRequest,
    _ReplaceBindingsRequest,
    _DeleteMemberBindingsRequest,
    _AccessControlLanguageQuery,
    _ResourceUserAccessPoliciesQuery,
    svc.ReplaceUserAccessPolicies,
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


# ---------------------------------------------------------------------------
# Access-permission routes for every resource kind (app, dataset, agent).
#
# The three resource kinds expose the same twelve endpoints and differ only in
# the URL segment, the path parameter and which inner-API client they call, so
# they are declared once as a table and registered in a loop.
# ---------------------------------------------------------------------------


type _ResourceAccessClient = (
    type[svc.RBACService.AppAccess] | type[svc.RBACService.DatasetAccess] | type[svc.RBACService.AgentAccess]
)


@dataclass(frozen=True)
class _ResourceAccessRoutes:
    """Everything that differs between the app, dataset and agent access routes."""

    resource_type: svc.RBACResourceType
    class_prefix: str
    matrix_model: type[BaseModel]
    access: _ResourceAccessClient
    catalog: Callable[[str, str], svc.PermissionCatalogResponse]
    workspace_matrix: Callable[[str, str, svc.ListOption], svc.WorkspaceAccessMatrix]
    workspace_role_bindings: Callable[[str, str, str], svc.RoleBindingsResponse]
    workspace_member_bindings: Callable[[str, str, str], svc.MemberBindingsResponse]
    replace_workspace_bindings: Callable[[str, str, str, svc.ReplaceBindings], svc.AccessMatrixItem]
    # Only resources that carry a maintainer column pin that account to the top of the member list.
    maintainer_id: Callable[[str, str], str | None] | None = None

    @property
    def url_segment(self) -> str:
        return self.resource_type.route.segment

    @property
    def id_param(self) -> str:
        return self.resource_type.route.id_param


@dataclass(frozen=True)
class _ResourceAccessApis:
    """The Flask-RESTX resources generated for one resource kind."""

    catalog: type[Resource]
    matrix: type[Resource]
    whitelist: type[Resource]
    whitelist_config: type[Resource]
    user_access_policies: type[Resource]
    user_access_policy_assignment: type[Resource]
    role_bindings: type[Resource]
    member_bindings: type[Resource]
    workspace_matrix: type[Resource]
    workspace_role_bindings: type[Resource]
    workspace_bindings: type[Resource]
    workspace_member_bindings: type[Resource]


_RESOURCE_ACCESS_ROUTES = (
    _ResourceAccessRoutes(
        resource_type=svc.RBACResourceType.APP,
        class_prefix="App",
        matrix_model=svc.AppAccessMatrix,
        access=svc.RBACService.AppAccess,
        catalog=lambda tenant_id, account_id: svc.RBACService.Catalog.app(tenant_id, account_id),
        workspace_matrix=lambda tenant_id, account_id, options: svc.RBACService.WorkspaceAccess.app_matrix(
            tenant_id, account_id, options=options
        ),
        workspace_role_bindings=lambda tenant_id, account_id, policy_id: (
            svc.RBACService.WorkspaceAccess.list_app_role_bindings(tenant_id, account_id, policy_id)
        ),
        workspace_member_bindings=lambda tenant_id, account_id, policy_id: (
            svc.RBACService.WorkspaceAccess.list_app_member_bindings(tenant_id, account_id, policy_id)
        ),
        replace_workspace_bindings=lambda tenant_id, account_id, policy_id, payload: (
            svc.RBACService.WorkspaceAccess.replace_app_bindings(tenant_id, account_id, policy_id, payload)
        ),
        maintainer_id=lambda tenant_id, resource_id: svc.app_maintainer_id(tenant_id, resource_id),
    ),
    _ResourceAccessRoutes(
        resource_type=svc.RBACResourceType.DATASET,
        class_prefix="Dataset",
        matrix_model=svc.DatasetAccessMatrix,
        access=svc.RBACService.DatasetAccess,
        catalog=lambda tenant_id, account_id: svc.RBACService.Catalog.dataset(tenant_id, account_id),
        workspace_matrix=lambda tenant_id, account_id, options: svc.RBACService.WorkspaceAccess.dataset_matrix(
            tenant_id, account_id, options=options
        ),
        workspace_role_bindings=lambda tenant_id, account_id, policy_id: (
            svc.RBACService.WorkspaceAccess.list_dataset_role_bindings(tenant_id, account_id, policy_id)
        ),
        workspace_member_bindings=lambda tenant_id, account_id, policy_id: (
            svc.RBACService.WorkspaceAccess.list_dataset_member_bindings(tenant_id, account_id, policy_id)
        ),
        replace_workspace_bindings=lambda tenant_id, account_id, policy_id, payload: (
            svc.RBACService.WorkspaceAccess.replace_dataset_bindings(tenant_id, account_id, policy_id, payload)
        ),
        maintainer_id=lambda tenant_id, resource_id: svc.dataset_maintainer_id(tenant_id, resource_id),
    ),
    _ResourceAccessRoutes(
        resource_type=svc.RBACResourceType.AGENT,
        class_prefix="Agent",
        matrix_model=svc.AgentAccessMatrix,
        access=svc.RBACService.AgentAccess,
        catalog=lambda tenant_id, account_id: svc.RBACService.Catalog.agent(tenant_id, account_id),
        workspace_matrix=lambda tenant_id, account_id, options: svc.RBACService.WorkspaceAccess.agent_matrix(
            tenant_id, account_id, options=options
        ),
        workspace_role_bindings=lambda tenant_id, account_id, policy_id: (
            svc.RBACService.WorkspaceAccess.list_agent_role_bindings(tenant_id, account_id, policy_id)
        ),
        workspace_member_bindings=lambda tenant_id, account_id, policy_id: (
            svc.RBACService.WorkspaceAccess.list_agent_member_bindings(tenant_id, account_id, policy_id)
        ),
        replace_workspace_bindings=lambda tenant_id, account_id, policy_id, payload: (
            svc.RBACService.WorkspaceAccess.replace_agent_bindings(tenant_id, account_id, policy_id, payload)
        ),
    ),
)


def _build_resource_access_apis(spec: _ResourceAccessRoutes) -> _ResourceAccessApis:
    id_param = spec.id_param
    resource_prefix = f"/workspaces/current/rbac/{spec.url_segment}/<uuid:{id_param}>"
    workspace_prefix = f"/workspaces/current/rbac/workspace/{spec.url_segment}"

    def resource_id(path_params) -> str:
        return str(path_params[id_param])

    def register(resource: type[Resource], name: str, url: str) -> type[Resource]:
        # Flask-RESTX derives the endpoint and the OpenAPI operation id from the class name,
        # so every generated resource keeps the distinct name its hand-written twin had.
        resource.__name__ = name
        resource.__qualname__ = name
        console_ns.route(url)(resource)
        return resource

    class CatalogApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.PermissionCatalogResponse.__name__])
        def get(self):
            tenant_id, account_id = _current_ids()
            return _dump(spec.catalog(tenant_id, account_id))

    class MatrixApi(Resource):
        @login_required
        @console_ns.doc(params=query_params_from_model(_AccessControlLanguageQuery))
        @console_ns.response(200, "Success", console_ns.models[spec.matrix_model.__name__])
        def get(self, **path_params):
            tenant_id, account_id = _current_ids()
            result = spec.access.matrix(tenant_id, account_id, resource_id(path_params))
            _hydrate_access_matrix_account_names(result.items)
            return _dump(result)

    class WhitelistApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelist.__name__])
        def get(self, **path_params):
            tenant_id, account_id = _current_ids()
            return _dump(spec.access.whitelist(tenant_id, account_id, resource_id(path_params)))

        @login_required
        @console_ns.expect(console_ns.models[_ResourceAccessScopeRequest.__name__])
        @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelist.__name__])
        def put(self, **path_params):
            tenant_id, account_id = _current_ids()
            target_id = resource_id(path_params)
            scope = _payload(_ResourceAccessScopeRequest)
            result = spec.access.replace_whitelist(
                tenant_id,
                account_id,
                target_id,
                svc.ReplaceMemberBindings(
                    automatic_include_workspace_members=scope.automatic_include_workspace_members
                ),
            )
            # Widening the scope only records it: the members still need the default access
            # policy before they can reach the resource.
            if scope.automatic_include_workspace_members:
                initialize_created_app_rbac_access_task.delay(tenant_id, account_id, **{id_param: target_id})
            return _dump(result)

    class WhitelistConfigApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.ResourceWhitelistConfig.__name__])
        def get(self, **path_params):
            tenant_id, account_id = _current_ids()
            return _dump(spec.access.whitelist_config(tenant_id, account_id, resource_id(path_params)))

    class UserAccessPoliciesApi(Resource):
        @login_required
        @console_ns.doc(params=query_params_from_model(_ResourceUserAccessPoliciesQuery))
        @console_ns.response(200, "Success", console_ns.models[svc.ResourceUserAccessPoliciesResponse.__name__])
        def get(self, **path_params):
            tenant_id, account_id = _current_ids()
            target_id = resource_id(path_params)
            options = _pagination_options()
            result = spec.access.user_access_policies(tenant_id, account_id, target_id, options=options)
            maintainer_id = spec.maintainer_id(tenant_id, target_id) if spec.maintainer_id else None
            _move_resource_maintainer_first(result.data, maintainer_id)
            _hydrate_resource_user_account_names(result.data)
            return _dump(result)

    class UserAccessPolicyAssignmentApi(Resource):
        @login_required
        @console_ns.expect(console_ns.models[svc.ReplaceUserAccessPolicies.__name__])
        @console_ns.response(200, "Success", console_ns.models[svc.ReplaceUserAccessPoliciesResponse.__name__])
        def put(self, target_account_id, **path_params):
            tenant_id, account_id = _current_ids()
            payload = _payload(svc.ReplaceUserAccessPolicies)
            return _dump(
                spec.access.replace_user_access_policies(
                    tenant_id,
                    account_id,
                    resource_id(path_params),
                    str(target_account_id),
                    payload,
                )
            )

    class RoleBindingsApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.RoleBindingsResponse.__name__])
        def get(self, policy_id, **path_params):
            tenant_id, account_id = _current_ids()
            return _dump(
                spec.access.list_role_bindings(tenant_id, account_id, resource_id(path_params), str(policy_id))
            )

    class MemberBindingsApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
        def get(self, policy_id, **path_params):
            tenant_id, account_id = _current_ids()
            return _dump(
                spec.access.list_member_bindings(tenant_id, account_id, resource_id(path_params), str(policy_id))
            )

        @login_required
        @console_ns.expect(console_ns.models[_DeleteMemberBindingsRequest.__name__])
        @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
        def delete(self, policy_id, **path_params):
            tenant_id, account_id = _current_ids()
            body = _payload(_DeleteMemberBindingsRequest)
            spec.access.delete_member_bindings(
                tenant_id,
                account_id,
                resource_id(path_params),
                str(policy_id),
                svc.DeleteMemberBindings(account_ids=body.account_ids),
            )
            return {"result": "success"}

    class WorkspaceMatrixApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.WorkspaceAccessMatrix.__name__])
        def get(self):
            tenant_id, account_id = _current_ids()
            result = spec.workspace_matrix(tenant_id, account_id, _pagination_options())
            _hydrate_access_matrix_account_names(result.items)
            return _dump(result)

    class WorkspaceRoleBindingsApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.RoleBindingsResponse.__name__])
        def get(self, policy_id):
            tenant_id, account_id = _current_ids()
            return _dump(spec.workspace_role_bindings(tenant_id, account_id, str(policy_id)))

    class WorkspaceBindingsApi(Resource):
        @login_required
        @console_ns.expect(console_ns.models[_ReplaceBindingsRequest.__name__])
        @console_ns.response(200, "Success", console_ns.models[svc.AccessMatrixItem.__name__])
        def put(self, policy_id):
            tenant_id, account_id = _current_ids()
            body = _payload(_ReplaceBindingsRequest)
            return _dump(
                spec.replace_workspace_bindings(
                    tenant_id,
                    account_id,
                    str(policy_id),
                    svc.ReplaceBindings(role_ids=list(body.role_ids), account_ids=list(body.account_ids)),
                )
            )

    class WorkspaceMemberBindingsApi(Resource):
        @login_required
        @console_ns.response(200, "Success", console_ns.models[svc.MemberBindingsResponse.__name__])
        def get(self, policy_id):
            tenant_id, account_id = _current_ids()
            return _dump(spec.workspace_member_bindings(tenant_id, account_id, str(policy_id)))

    prefix = spec.class_prefix
    return _ResourceAccessApis(
        catalog=register(
            CatalogApi,
            f"RBAC{prefix}CatalogApi",
            f"/workspaces/current/rbac/role-permissions/catalog/{spec.resource_type.value}",
        ),
        matrix=register(MatrixApi, f"RBAC{prefix}MatrixApi", f"{resource_prefix}/access-policy"),
        whitelist=register(WhitelistApi, f"RBAC{prefix}WhitelistApi", f"{resource_prefix}/whitelist"),
        whitelist_config=register(
            WhitelistConfigApi, f"RBAC{prefix}WhitelistConfigApi", f"{resource_prefix}/whitelist_config"
        ),
        user_access_policies=register(
            UserAccessPoliciesApi, f"RBAC{prefix}UserAccessPoliciesApi", f"{resource_prefix}/user-access-policies"
        ),
        user_access_policy_assignment=register(
            UserAccessPolicyAssignmentApi,
            f"RBAC{prefix}UserAccessPolicyAssignmentApi",
            f"{resource_prefix}/users/<uuid:target_account_id>/access-policies",
        ),
        role_bindings=register(
            RoleBindingsApi,
            f"RBAC{prefix}RoleBindingsApi",
            f"{resource_prefix}/access-policies/<uuid:policy_id>/role-bindings",
        ),
        member_bindings=register(
            MemberBindingsApi,
            f"RBAC{prefix}MemberBindingsApi",
            f"{resource_prefix}/access-policies/<string:policy_id>/member-bindings",
        ),
        workspace_matrix=register(
            WorkspaceMatrixApi, f"RBACWorkspace{prefix}MatrixApi", f"{workspace_prefix}/access-policy"
        ),
        workspace_role_bindings=register(
            WorkspaceRoleBindingsApi,
            f"RBACWorkspace{prefix}RoleBindingsApi",
            f"{workspace_prefix}/access-policies/<uuid:policy_id>/role-bindings",
        ),
        workspace_bindings=register(
            WorkspaceBindingsApi,
            f"RBACWorkspace{prefix}BindingsApi",
            f"{workspace_prefix}/access-policies/<uuid:policy_id>/bindings",
        ),
        workspace_member_bindings=register(
            WorkspaceMemberBindingsApi,
            f"RBACWorkspace{prefix}MemberBindingsApi",
            f"{workspace_prefix}/access-policies/<uuid:policy_id>/member-bindings",
        ),
    )


_RESOURCE_ACCESS_APIS = {spec.resource_type: _build_resource_access_apis(spec) for spec in _RESOURCE_ACCESS_ROUTES}


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
        return _dump(svc.RBACService.MemberRoles.get(tenant_id, account_id, str(member_id), session=db.session()))

    @login_required
    @console_ns.expect(console_ns.models[_ReplaceMemberRolesRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[svc.MemberRolesResponse.__name__])
    def put(self, member_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberRolesRequest)
        return _dump(
            svc.RBACService.MemberRoles.replace(
                tenant_id,
                account_id,
                str(member_id),
                role_ids=list(request.role_ids),
                session=db.session(),
            )
        )


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/members")
class ListMembersByRole(Resource):
    @login_required
    @console_ns.response(200, "Success", console_ns.models[_MembersInRoleList.__name__])
    def get(self, role_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.Roles.list_members_by_role(tenant_id, role_id=role_id, options=_pagination_options())
        )
