"""Console RBAC roles endpoints."""

from flask import request
from flask_restx import Resource

from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACCheck, Workspace, rbac_language
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.rbac.schemas import (
    CopyRoleParam,
    _MembersInRoleList,
    _RBACRoleList,
    _RolesListQuery,
    _RoleUpsertRequest,
    pagination_options,
)
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from machinery.context import RequestContext
from services.rbac import contracts as dto


@console_ns.route("/workspaces/current/rbac/role-permissions/catalog")
class RBACWorkspaceCatalogApi(Resource):
    @console_account_admission()
    @console_ns.response(200, "Success", console_ns.models[dto.PermissionCatalogResponse.__name__])
    def get(self, context: RequestContext):
        return dump_response(
            dto.PermissionCatalogResponse, application_services().rbac.roles.catalog(context, language=rbac_language())
        )


@console_ns.route("/workspaces/current/rbac/roles")
class RBACRolesApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[_RBACRoleList.__name__])
    def get(self, context: RequestContext):
        req_data = _RolesListQuery.model_validate(request.args.to_dict(flat=True))
        result = application_services().rbac.roles.list(
            context, options=req_data.to_inner_options(), include_owner=req_data.include_owner, language=rbac_language()
        )
        return dump_response(_RBACRoleList, result)

    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(201, "Role created", console_ns.models[dto.RBACRole.__name__])
    def post(self, context: RequestContext):
        request = _RoleUpsertRequest.model_validate(console_ns.payload or {})
        role = application_services().rbac.roles.create(context, request.to_mutation(), language=rbac_language())
        return (dump_response(dto.RBACRole, role), 201)


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>")
class RBACRoleItemApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[dto.RBACRole.__name__])
    def get(self, context: RequestContext, role_id):
        return dump_response(
            dto.RBACRole, application_services().rbac.roles.get(context, str(role_id), language=rbac_language())
        )

    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[dto.RBACRole.__name__])
    def put(self, context: RequestContext, role_id):
        request = _RoleUpsertRequest.model_validate(console_ns.payload or {})
        role = application_services().rbac.roles.update(
            context, str(role_id), request.to_mutation(), language=rbac_language()
        )
        return dump_response(dto.RBACRole, role)

    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    def delete(self, context: RequestContext, role_id):
        application_services().rbac.roles.delete(context, str(role_id), language=rbac_language())
        return dump_response(SimpleResultResponse, {"result": "success"})


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/copy")
class RBACRoleCopyApi(Resource):
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())])
    @console_ns.response(201, "Role copied", console_ns.models[dto.RBACRole.__name__])
    def post(self, context: RequestContext, role_id):
        request = CopyRoleParam.model_validate(console_ns.payload or {})
        role = application_services().rbac.roles.copy(
            context, str(role_id), copy_member=request.copy_member, language=rbac_language()
        )
        return (dump_response(dto.RBACRole, role), 201)


@console_ns.route("/workspaces/current/rbac/roles/<uuid:role_id>/members")
class ListMembersByRole(Resource):
    @console_account_admission()
    @console_ns.response(200, "Success", console_ns.models[_MembersInRoleList.__name__])
    def get(self, context: RequestContext, role_id):
        return dump_response(
            _MembersInRoleList,
            application_services().rbac.roles.list_members_by_role(
                context, role_id=str(role_id), options=pagination_options(), language=rbac_language()
            ),
        )
