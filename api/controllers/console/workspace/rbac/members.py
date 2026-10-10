"""Console RBAC members endpoints."""

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import Forbidden

from controllers.common.errors import InvalidArgumentError
from controllers.common.rbac import rbac_language
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.rbac.schemas import (
    _ReplaceMemberRolesRequest,
)
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    CannotOperateSelfError,
    InvalidWorkspaceMemberRoleError,
    MemberNotInTenantError,
    RoleAlreadyAssignedError,
)
from services.rbac import contracts as dto


@console_ns.route("/workspaces/current/rbac/my-permissions")
class RBACMyPermissionsApi(Resource):
    @console_account_admission()
    @console_ns.response(200, "Success", console_ns.models[dto.MyPermissionsResponse.__name__])
    def get(self, context: RequestContext):
        return dump_response(
            dto.MyPermissionsResponse,
            application_services().rbac.members.permissions(
                context.active_workspace_id,
                context.account_id,
                app_id=request.args.get("app_id") or None,
                dataset_id=request.args.get("dataset_id") or None,
                agent_id=request.args.get("agent_id") or None,
                language=rbac_language(),
            ),
        )


@console_ns.route("/workspaces/current/rbac/members/<uuid:member_id>/rbac-roles")
class RBACMemberRolesApi(Resource):
    @console_account_admission()
    @console_ns.response(200, "Success", console_ns.models[dto.MemberRolesResponse.__name__])
    def get(self, context: RequestContext, member_id):
        return dump_response(
            dto.MemberRolesResponse,
            application_services().rbac.members.get(context, str(member_id), language=rbac_language()),
        )

    @console_account_admission()
    @console_ns.expect_model(_ReplaceMemberRolesRequest)
    @console_ns.response(200, "Success", console_ns.models[dto.MemberRolesResponse.__name__])
    def put(self, context: RequestContext, member_id):
        request = _ReplaceMemberRolesRequest.model_validate(console_ns.payload or {})
        try:
            result = application_services().rbac.members.replace(
                context, str(member_id), role_ids=list(request.role_ids), language=rbac_language()
            )
        except NoPermissionError as error:
            raise Forbidden(str(error)) from error
        except AccountNotFoundError as error:
            raise InvalidArgumentError(description="Member not in tenant.") from error
        except (
            CannotOperateSelfError,
            InvalidWorkspaceMemberRoleError,
            MemberNotInTenantError,
            RoleAlreadyAssignedError,
        ) as error:
            raise InvalidArgumentError(description=str(error)) from error
        return dump_response(dto.MemberRolesResponse, result)
