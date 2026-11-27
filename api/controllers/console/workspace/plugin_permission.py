"""Console transport for workspace plugin permission settings.

The handlers admit the caller, map the request into the settings record, call one
use case from the composition root, and serialize the result. They never reach
persistence directly; the import-boundary contract for this module enforces that.
"""

from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.common.fields import SuccessResponse
from controllers.common.schema import register_enum_models, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums.plugin_permission import TenantPluginDebugPermission, TenantPluginInstallPermission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from services.plugin.plugin_permission_settings_service import PluginPermissionSettings


class ParserPermissionChange(BaseModel):
    install_permission: TenantPluginInstallPermission = TenantPluginInstallPermission.EVERYONE
    debug_permission: TenantPluginDebugPermission = TenantPluginDebugPermission.EVERYONE


class PluginPermissionSettingsPayload(BaseModel):
    install_permission: TenantPluginInstallPermission = TenantPluginInstallPermission.EVERYONE
    debug_permission: TenantPluginDebugPermission = TenantPluginDebugPermission.EVERYONE


class PluginPermissionResponse(ResponseModel):
    install_permission: TenantPluginInstallPermission
    debug_permission: TenantPluginDebugPermission


register_schema_models(console_ns, PluginPermissionSettingsPayload, ParserPermissionChange)
register_response_schema_models(console_ns, PluginPermissionResponse, SuccessResponse)
register_enum_models(console_ns, TenantPluginDebugPermission, TenantPluginInstallPermission)


@console_ns.route("/workspaces/current/plugin/permission/change")
class PluginChangePermissionApi(Resource):
    @console_ns.expect(console_ns.models[ParserPermissionChange.__name__])
    @console_ns.response(200, "Success", console_ns.models[SuccessResponse.__name__])
    @console_account_admission()
    @model_validate(ParserPermissionChange)
    def post(self, req_data: ParserPermissionChange, context: RequestContext) -> dict[str, bool]:
        """Replace the active workspace's plugin permission settings.

        Preconditions: admission yielded an initialized account with an active
        workspace, and the payload validated.
        Postconditions: returns ``{"success": True}`` after the settings commit.
        Raises ``Forbidden`` before any write when ``Account.is_admin_or_owner``
        rejects the admitted account. As before, that property admits every role
        when RBAC is enabled.
        """
        # Preserve the legacy account property, including its RBAC-enabled bypass.
        account, _ = current_account_with_tenant()
        if not account.is_admin_or_owner:
            raise Forbidden()

        application_services().workspaces.plugin_permissions.change_settings(
            context,
            PluginPermissionSettings(
                install_permission=req_data.install_permission,
                debug_permission=req_data.debug_permission,
            ),
        )
        return {"success": True}


@console_ns.route("/workspaces/current/plugin/permission/fetch")
class PluginFetchPermissionApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[PluginPermissionResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext) -> dict[str, str]:
        """Return the active workspace's effective plugin permission settings.

        Postconditions: returns the stored settings, or install by admins and debug
        by everyone when the workspace has none. No state changes.
        """
        settings = application_services().workspaces.plugin_permissions.get_settings(context)
        return dump_response(PluginPermissionResponse, settings)
