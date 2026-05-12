from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, field_validator
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console import console_ns
from libs.login import current_account_with_tenant, login_required
from services.enterprise import rbac_service as svc


_LEGACY_WORKSPACE_PERMISSION_KEYS: list[str] = [
    # These keys are copied from the enterprise RBAC catalog examples in
    # `dify-rbac.md` so the legacy workspace roles stay in the same key format
    # as the enterprise RBAC surface.
    "workspace.member.manage",
    "workspace.role.manage",
]

_LEGACY_APP_PERMISSION_KEYS: list[str] = [
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.access_config",
]

_LEGACY_DATASET_PERMISSION_KEYS: list[str] = [
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.use",
]

_LEGACY_ROLE_PERMISSION_KEYS: dict[str, list[str]] = {
    # These legacy role groups predate the RBAC refactor. The mapping keeps the
    # old workspace roles readable through the new RBAC endpoint by translating
    # each role into the closest enterprise permission keys that already exist
    # in the catalog and tests.
    "owner": [
        *_LEGACY_WORKSPACE_PERMISSION_KEYS,
        *_LEGACY_APP_PERMISSION_KEYS,
        *_LEGACY_DATASET_PERMISSION_KEYS,
    ],
    "admin": [
        *_LEGACY_WORKSPACE_PERMISSION_KEYS,
        *_LEGACY_APP_PERMISSION_KEYS,
        *_LEGACY_DATASET_PERMISSION_KEYS,
    ],
    "editor": [
        *_LEGACY_APP_PERMISSION_KEYS,
        *_LEGACY_DATASET_PERMISSION_KEYS,
    ],
    "normal": [
        "app.acl.view_layout",
        "app.acl.test_and_run",
    ],
    "dataset_operator": [
        *_LEGACY_DATASET_PERMISSION_KEYS,
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


class _PaginationQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page_number: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("page", "page_number"))
    results_per_page: int | None = Field(
        default=None, ge=1, le=100, validation_alias=AliasChoices("limit", "results_per_page")
    )
    reverse: bool | None = None

    def to_inner_options(self) -> svc.ListOption:
        return svc.ListOption.model_validate(self.model_dump())


class _RolesListQuery(_PaginationQuery):
    include_owner: int = Field(default=0, ge=0, le=1)


def _pagination_options() -> svc.ListOption:
    return _PaginationQuery.model_validate(request.args.to_dict(flat=True)).to_inner_options()


def _filter_out_owner(paginated: svc.Paginated[svc.RBACRole]) -> svc.Paginated[svc.RBACRole]:
    filtered = [r for r in paginated.data if r.name != "owner"]
    return svc.Paginated[svc.RBACRole](
        data=filtered,
        pagination=paginated.pagination,
    )


def _legacy_workspace_roles(options: svc.ListOption | None = None) -> svc.Paginated[svc.RBACRole]:
    """Return the built-in legacy workspace roles in the RBAC list shape.

    This keeps the new `/rbac/roles` endpoint compatible with the original
    Dify role model when enterprise RBAC is disabled.
    """

    legacy_roles = [
        svc.RBACRole(
            id=role_name,
            tenant_id="",
            type=svc.RBACRoleType.WORKSPACE.value,
            category="global_system_default",
            name=role_name,
            description="",
            is_builtin=True,
            permission_keys=list(_LEGACY_ROLE_PERMISSION_KEYS[role_name]),
            role_tag="owner" if role_name == "owner" else "",
        )
        for role_name in ("owner", "admin", "editor", "normal", "dataset_operator")
    ]

    page_number = options.page_number if options and options.page_number is not None else 1
    results_per_page = options.results_per_page if options and options.results_per_page is not None else len(legacy_roles)
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


# ---------------------------------------------------------------------------
# Permission catalogs.
# ---------------------------------------------------------------------------


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog")
class RBACWorkspaceCatalogApi(Resource):
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.workspace(tenant_id, account_id))


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog/app")
class RBACAppCatalogApi(Resource):
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.app(tenant_id, account_id))


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog/dataset")
class RBACDatasetCatalogApi(Resource):
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.dataset(tenant_id, account_id))


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
    def get(self):
        tenant_id, account_id = _current_ids()
        query = _RolesListQuery.model_validate(request.args.to_dict(flat=True))
        options = query.to_inner_options()
        if not dify_config.RBAC_ENABLED:
            result = _legacy_workspace_roles(options)
        else:
            result = svc.RBACService.Roles.list(tenant_id, account_id, options=options)
        if query.include_owner == 0:
            result = _filter_out_owner(result)
        return _dump(result)

    @login_required
    def post(self):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.create(tenant_id, account_id, request.to_mutation())
        return _dump(role), 201


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>")
class RBACRoleItemApi(Resource):
    @login_required
    def get(self, role_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Roles.get(tenant_id, account_id, str(role_id)))

    @login_required
    def put(self, role_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.update(tenant_id, account_id, str(role_id), request.to_mutation())
        return _dump(role)

    @login_required
    def delete(self, role_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.Roles.delete(tenant_id, account_id, str(role_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/copy")
class RBACRoleCopyApi(Resource):
    @login_required
    def post(self, role_id):
        tenant_id, account_id = _current_ids()
        role = svc.RBACService.Roles.copy(tenant_id, account_id, str(role_id))
        return _dump(role), 201


# ---------------------------------------------------------------------------
# Access policies (tenant-level permission sets).
# ---------------------------------------------------------------------------


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
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicies.get(tenant_id, account_id, str(policy_id)))

    @login_required
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
    def delete(self, policy_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.AccessPolicies.delete(tenant_id, account_id, str(policy_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>/copy")
class RBACAccessPolicyCopyApi(Resource):
    @login_required
    def post(self, policy_id):
        tenant_id, account_id = _current_ids()
        policy = svc.RBACService.AccessPolicies.copy(tenant_id, account_id, str(policy_id))
        return _dump(policy), 201


# ---------------------------------------------------------------------------
# Per-app access (App Access Config).
# ---------------------------------------------------------------------------


class _ReplaceBindingsRequest(BaseModel):
    role_ids: list[str] = []
    account_ids: list[str] = []

    @field_validator("role_ids", "account_ids", mode="before")
    @classmethod
    def _coerce_bindings(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


@console_ns.route("/workspaces/current/rbac/my-permissions")
class RBACMyPermissionsApi(Resource):
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.MyPermissions.get(
                tenant_id,
                account_id,
                app_id=request.args.get("app_id") or None,
                dataset_id=request.args.get("dataset_id") or None,
            )
        )


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policy")
class RBACAppMatrixApi(Resource):
    @login_required
    def get(self, app_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AppAccess.matrix(tenant_id, account_id, str(app_id)))


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<uuid:policy_id>/role-bindings")
class RBACAppRoleBindingsApi(Resource):
    @login_required
    def get(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.AppAccess.list_role_bindings(tenant_id, account_id, str(app_id), str(policy_id))
        )


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<uuid:policy_id>/member-bindings")
class RBACAppMemberBindingsApi(Resource):
    @login_required
    def get(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.AppAccess.list_member_bindings(tenant_id, account_id, str(app_id), str(policy_id))
        )


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<uuid:policy_id>/bindings")
class RBACAppBindingsApi(Resource):
    @login_required
    def put(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceBindingsRequest)
        return _dump(
            svc.RBACService.AppAccess.replace_bindings(
                tenant_id,
                account_id,
                str(app_id),
                str(policy_id),
                svc.ReplaceBindings(role_ids=list(request.role_ids), account_ids=list(request.account_ids)),
            )
        )


# ---------------------------------------------------------------------------
# Per-dataset access (Knowledge Base Access Config).
# ---------------------------------------------------------------------------


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policy")
class RBACDatasetMatrixApi(Resource):
    @login_required
    def get(self, dataset_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.DatasetAccess.matrix(tenant_id, account_id, str(dataset_id)))


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<uuid:policy_id>/role-bindings")
class RBACDatasetRoleBindingsApi(Resource):
    @login_required
    def get(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.DatasetAccess.list_role_bindings(
                tenant_id, account_id, str(dataset_id), str(policy_id)
            )
        )


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<uuid:policy_id>/bindings")
class RBACDatasetBindingsApi(Resource):
    @login_required
    def put(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceBindingsRequest)
        return _dump(
            svc.RBACService.DatasetAccess.replace_bindings(
                tenant_id,
                account_id,
                str(dataset_id),
                str(policy_id),
                svc.ReplaceBindings(role_ids=list(request.role_ids), account_ids=list(request.account_ids)),
            )
        )


@console_ns.route(
    "/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<uuid:policy_id>/member-bindings"
)
class RBACDatasetMemberBindingsApi(Resource):
    @login_required
    def get(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.DatasetAccess.list_member_bindings(
                tenant_id, account_id, str(dataset_id), str(policy_id)
            )
        )


# ---------------------------------------------------------------------------
# Workspace-level access (Settings > Access Rules).
# ---------------------------------------------------------------------------


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policy")
class RBACWorkspaceAppMatrixApi(Resource):
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        return _dump(svc.RBACService.WorkspaceAccess.app_matrix(tenant_id, account_id, options=options))


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/role-bindings")
class RBACWorkspaceAppRoleBindingsApi(Resource):
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_app_role_bindings(tenant_id, account_id, str(policy_id))
        )


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/bindings")
class RBACWorkspaceAppBindingsApi(Resource):
    @login_required
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceBindingsRequest)
        return _dump(
            svc.RBACService.WorkspaceAccess.replace_app_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceBindings(role_ids=list(request.role_ids), account_ids=list(request.account_ids)),
            )
        )


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/member-bindings")
class RBACWorkspaceAppMemberBindingsApi(Resource):
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_app_member_bindings(tenant_id, account_id, str(policy_id))
        )


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policy")
class RBACWorkspaceDatasetMatrixApi(Resource):
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        return _dump(svc.RBACService.WorkspaceAccess.dataset_matrix(tenant_id, account_id, options=options))


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/role-bindings")
class RBACWorkspaceDatasetRoleBindingsApi(Resource):
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_dataset_role_bindings(tenant_id, account_id, str(policy_id))
        )


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/bindings")
class RBACWorkspaceDatasetBindingsApi(Resource):
    @login_required
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceBindingsRequest)
        return _dump(
            svc.RBACService.WorkspaceAccess.replace_dataset_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceBindings(role_ids=list(request.role_ids), account_ids=list(request.account_ids)),
            )
        )


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/member-bindings")
class RBACWorkspaceDatasetMemberBindingsApi(Resource):
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_dataset_member_bindings(tenant_id, account_id, str(policy_id))
        )


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


@console_ns.route("/workspaces/current/rbac/members/<uuid:member_id>/rbac-roles")
class RBACMemberRolesApi(Resource):
    @login_required
    def get(self, member_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.MemberRoles.get(tenant_id, account_id, str(member_id)))

    @login_required
    def put(self, member_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberRolesRequest)
        return _dump(
            svc.RBACService.MemberRoles.replace(
                tenant_id,
                account_id,
                str(member_id),
                role_ids=list(request.role_ids),
            )
        )
