from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console import console_ns
from libs.login import current_account_with_tenant, login_required
from services.enterprise import rbac_service as svc


# ---------------------------------------------------------------------------
# Shared helpers.
# ---------------------------------------------------------------------------


def enterprise_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Reject every call when the Dify install is not running in enterprise
    mode. The dashboard UI shown in the screenshots is an enterprise-only
    feature, so every route here should fail fast (and clearly) in community.
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not dify_config.ENTERPRISE_ENABLED:
            raise Forbidden("Enterprise edition is not enabled")
        return view(*args, **kwargs)

    return decorated


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


def _pagination_options() -> svc.ListOption:
    return _PaginationQuery.model_validate(request.args.to_dict(flat=True)).to_inner_options()


# ---------------------------------------------------------------------------
# Permission catalogs.
# ---------------------------------------------------------------------------


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog")
class RBACWorkspaceCatalogApi(Resource):
    @enterprise_only
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.workspace(tenant_id, account_id))


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog/app")
class RBACAppCatalogApi(Resource):
    @enterprise_only
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Catalog.app(tenant_id, account_id))


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog/dataset")
class RBACDatasetCatalogApi(Resource):
    @enterprise_only
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
    @enterprise_only
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        return _dump(svc.RBACService.Roles.list(tenant_id, account_id, options=options))

    @enterprise_only
    @login_required
    def post(self):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.create(tenant_id, account_id, request.to_mutation())
        return _dump(role), 201


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>")
class RBACRoleItemApi(Resource):
    @enterprise_only
    @login_required
    def get(self, role_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.Roles.get(tenant_id, account_id, str(role_id)))

    @enterprise_only
    @login_required
    def put(self, role_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_RoleUpsertRequest)
        role = svc.RBACService.Roles.update(tenant_id, account_id, str(role_id), request.to_mutation())
        return _dump(role)

    @enterprise_only
    @login_required
    def delete(self, role_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.Roles.delete(tenant_id, account_id, str(role_id))
        return {"result": "success"}


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
    @enterprise_only
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

    @enterprise_only
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
    @enterprise_only
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AccessPolicies.get(tenant_id, account_id, str(policy_id)))

    @enterprise_only
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

    @enterprise_only
    @login_required
    def delete(self, policy_id):
        tenant_id, account_id = _current_ids()
        svc.RBACService.AccessPolicies.delete(tenant_id, account_id, str(policy_id))
        return {"result": "success"}


@console_ns.route("/workspaces/current/rbac/access-policies/<uuid:policy_id>/copy")
class RBACAccessPolicyCopyApi(Resource):
    @enterprise_only
    @login_required
    def post(self, policy_id):
        tenant_id, account_id = _current_ids()
        policy = svc.RBACService.AccessPolicies.copy(tenant_id, account_id, str(policy_id))
        return _dump(policy), 201


# ---------------------------------------------------------------------------
# Per-app access (App Access Config).
# ---------------------------------------------------------------------------


class _ReplaceRoleBindingsRequest(BaseModel):
    role_ids: list[str] = []


class _ReplaceMemberBindingsRequest(BaseModel):
    account_ids: list[str] = []


@console_ns.route("/workspaces/current/rbac/my-permissions")
class RBACMyPermissionsApi(Resource):
    @enterprise_only
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
    @enterprise_only
    @login_required
    def get(self, app_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.AppAccess.matrix(tenant_id, account_id, str(app_id)))


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<uuid:policy_id>/role-bindings")
class RBACAppRoleBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.AppAccess.list_role_bindings(tenant_id, account_id, str(app_id), str(policy_id))
        )

    @enterprise_only
    @login_required
    def put(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceRoleBindingsRequest)
        return _dump(
            svc.RBACService.AppAccess.replace_role_bindings(
                tenant_id,
                account_id,
                str(app_id),
                str(policy_id),
                svc.ReplaceRoleBindings(role_ids=list(request.role_ids)),
            )
        )


@console_ns.route("/workspaces/current/rbac/apps/<uuid:app_id>/access-policies/<uuid:policy_id>/member-bindings")
class RBACAppMemberBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.AppAccess.list_member_bindings(tenant_id, account_id, str(app_id), str(policy_id))
        )

    @enterprise_only
    @login_required
    def put(self, app_id, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberBindingsRequest)
        return _dump(
            svc.RBACService.AppAccess.replace_member_bindings(
                tenant_id,
                account_id,
                str(app_id),
                str(policy_id),
                svc.ReplaceMemberBindings(account_ids=list(request.account_ids)),
            )
        )


# ---------------------------------------------------------------------------
# Per-dataset access (Knowledge Base Access Config).
# ---------------------------------------------------------------------------


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policy")
class RBACDatasetMatrixApi(Resource):
    @enterprise_only
    @login_required
    def get(self, dataset_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.DatasetAccess.matrix(tenant_id, account_id, str(dataset_id)))


@console_ns.route("/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<uuid:policy_id>/role-bindings")
class RBACDatasetRoleBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.DatasetAccess.list_role_bindings(
                tenant_id, account_id, str(dataset_id), str(policy_id)
            )
        )

    @enterprise_only
    @login_required
    def put(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceRoleBindingsRequest)
        return _dump(
            svc.RBACService.DatasetAccess.replace_role_bindings(
                tenant_id,
                account_id,
                str(dataset_id),
                str(policy_id),
                svc.ReplaceRoleBindings(role_ids=list(request.role_ids)),
            )
        )


@console_ns.route(
    "/workspaces/current/rbac/datasets/<uuid:dataset_id>/access-policies/<uuid:policy_id>/member-bindings"
)
class RBACDatasetMemberBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.DatasetAccess.list_member_bindings(
                tenant_id, account_id, str(dataset_id), str(policy_id)
            )
        )

    @enterprise_only
    @login_required
    def put(self, dataset_id, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberBindingsRequest)
        return _dump(
            svc.RBACService.DatasetAccess.replace_member_bindings(
                tenant_id,
                account_id,
                str(dataset_id),
                str(policy_id),
                svc.ReplaceMemberBindings(account_ids=list(request.account_ids)),
            )
        )


# ---------------------------------------------------------------------------
# Workspace-level access (Settings > Access Rules).
# ---------------------------------------------------------------------------


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policy")
class RBACWorkspaceAppMatrixApi(Resource):
    @enterprise_only
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        return _dump(svc.RBACService.WorkspaceAccess.app_matrix(tenant_id, account_id, options=options))


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/role-bindings")
class RBACWorkspaceAppRoleBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_app_role_bindings(tenant_id, account_id, str(policy_id))
        )

    @enterprise_only
    @login_required
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceRoleBindingsRequest)
        return _dump(
            svc.RBACService.WorkspaceAccess.replace_app_role_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceRoleBindings(role_ids=list(request.role_ids)),
            )
        )


@console_ns.route("/workspaces/current/rbac/workspace/apps/access-policies/<uuid:policy_id>/member-bindings")
class RBACWorkspaceAppMemberBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_app_member_bindings(tenant_id, account_id, str(policy_id))
        )

    @enterprise_only
    @login_required
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberBindingsRequest)
        return _dump(
            svc.RBACService.WorkspaceAccess.replace_app_member_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceMemberBindings(account_ids=list(request.account_ids)),
            )
        )


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policy")
class RBACWorkspaceDatasetMatrixApi(Resource):
    @enterprise_only
    @login_required
    def get(self):
        tenant_id, account_id = _current_ids()
        options = _pagination_options()
        return _dump(svc.RBACService.WorkspaceAccess.dataset_matrix(tenant_id, account_id, options=options))


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/role-bindings")
class RBACWorkspaceDatasetRoleBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_dataset_role_bindings(tenant_id, account_id, str(policy_id))
        )

    @enterprise_only
    @login_required
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceRoleBindingsRequest)
        return _dump(
            svc.RBACService.WorkspaceAccess.replace_dataset_role_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceRoleBindings(role_ids=list(request.role_ids)),
            )
        )


@console_ns.route("/workspaces/current/rbac/workspace/datasets/access-policies/<uuid:policy_id>/member-bindings")
class RBACWorkspaceDatasetMemberBindingsApi(Resource):
    @enterprise_only
    @login_required
    def get(self, policy_id):
        tenant_id, account_id = _current_ids()
        return _dump(
            svc.RBACService.WorkspaceAccess.list_dataset_member_bindings(tenant_id, account_id, str(policy_id))
        )

    @enterprise_only
    @login_required
    def put(self, policy_id):
        tenant_id, account_id = _current_ids()
        request = _payload(_ReplaceMemberBindingsRequest)
        return _dump(
            svc.RBACService.WorkspaceAccess.replace_dataset_member_bindings(
                tenant_id,
                account_id,
                str(policy_id),
                svc.ReplaceMemberBindings(account_ids=list(request.account_ids)),
            )
        )


# ---------------------------------------------------------------------------
# Member ↔ role bindings (Settings > Members > Assign roles).
# ---------------------------------------------------------------------------


class _ReplaceMemberRolesRequest(BaseModel):
    role_ids: list[str] = []


@console_ns.route("/workspaces/current/rbac/members/<uuid:member_id>/rbac-roles")
class RBACMemberRolesApi(Resource):
    @enterprise_only
    @login_required
    def get(self, member_id):
        tenant_id, account_id = _current_ids()
        return _dump(svc.RBACService.MemberRoles.get(tenant_id, account_id, str(member_id)))

    @enterprise_only
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
