import io
from urllib.parse import urlparse

from flask import make_response, redirect, request, send_file
from flask_restx import (
    Resource,
    reqparse,
)
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    setup_required,
)
from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
from core.mcp.auth.auth_flow import auth, handle_callback
from core.mcp.error import MCPAuthError, MCPError, MCPRefreshTokenError
from core.mcp.mcp_client import MCPClient
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.tool_entities import CredentialType
from extensions.ext_database import db
from libs.helper import StrLen, alphanumeric, uuid_value
from libs.login import current_account_with_tenant, login_required
from models.provider_ids import ToolProviderID
from services.plugin.oauth_service import OAuthProxyService
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService, OAuthDataType
from services.tools.tool_labels_service import ToolLabelsService
from services.tools.tools_manage_service import ToolCommonService
from services.tools.tools_transform_service import ToolTransformService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


def is_valid_url(url: str) -> bool:
    if not url:
        return False

    try:
        parsed = urlparse(url)
        return all([parsed.scheme, parsed.netloc]) and parsed.scheme in ["http", "https"]
    except (ValueError, TypeError):
        # ValueError: Invalid URL format
        # TypeError: url is not a string
        return False


@console_ns.route("/workspaces/current/tool-providers")
class ToolProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        req = reqparse.RequestParser().add_argument(
            "type",
            type=str,
            choices=["builtin", "model", "api", "workflow", "mcp"],
            required=False,
            nullable=True,
            location="args",
        )
        args = req.parse_args()

        return ToolCommonService.list_tool_providers(user_id, tenant_id, args.get("type", None))


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/tools")
class ToolBuiltinProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, tenant_id = current_account_with_tenant()

        return jsonable_encoder(
            BuiltinToolManageService.list_builtin_tool_provider_tools(
                tenant_id,
                provider,
            )
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/info")
class ToolBuiltinProviderInfoApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, tenant_id = current_account_with_tenant()

        return jsonable_encoder(BuiltinToolManageService.get_builtin_tool_provider_info(tenant_id, provider))


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/delete")
class ToolBuiltinProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user, tenant_id = current_account_with_tenant()
        if not user.is_admin_or_owner:
            raise Forbidden()

        req = reqparse.RequestParser().add_argument(
            "credential_id", type=str, required=True, nullable=False, location="json"
        )
        args = req.parse_args()

        return BuiltinToolManageService.delete_builtin_tool_provider(
            tenant_id,
            provider,
            args["credential_id"],
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/add")
class ToolBuiltinProviderAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        parser = (
            reqparse.RequestParser()
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("name", type=StrLen(30), required=False, nullable=False, location="json")
            .add_argument("type", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        if args["type"] not in CredentialType.values():
            raise ValueError(f"Invalid credential type: {args['type']}")

        return BuiltinToolManageService.add_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credentials=args["credentials"],
            name=args["name"],
            api_type=CredentialType.of(args["type"]),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/update")
class ToolBuiltinProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        parser = (
            reqparse.RequestParser()
            .add_argument("credential_id", type=str, required=True, nullable=False, location="json")
            .add_argument("credentials", type=dict, required=False, nullable=True, location="json")
            .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
        )

        args = parser.parse_args()

        result = BuiltinToolManageService.update_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credential_id=args["credential_id"],
            credentials=args.get("credentials", None),
            name=args.get("name", ""),
        )
        return result


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/credentials")
class ToolBuiltinProviderGetCredentialsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, tenant_id = current_account_with_tenant()

        return jsonable_encoder(
            BuiltinToolManageService.get_builtin_tool_provider_credentials(
                tenant_id=tenant_id,
                provider_name=provider,
            )
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/icon")
class ToolBuiltinProviderIconApi(Resource):
    @setup_required
    def get(self, provider):
        icon_bytes, mimetype = BuiltinToolManageService.get_builtin_tool_provider_icon(provider)
        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


@console_ns.route("/workspaces/current/tool-provider/api/add")
class ToolApiProviderAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        parser = (
            reqparse.RequestParser()
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("schema_type", type=str, required=True, nullable=False, location="json")
            .add_argument("schema", type=str, required=True, nullable=False, location="json")
            .add_argument("provider", type=str, required=True, nullable=False, location="json")
            .add_argument("icon", type=dict, required=True, nullable=False, location="json")
            .add_argument("privacy_policy", type=str, required=False, nullable=True, location="json")
            .add_argument("labels", type=list[str], required=False, nullable=True, location="json", default=[])
            .add_argument("custom_disclaimer", type=str, required=False, nullable=True, location="json")
        )

        args = parser.parse_args()

        return ApiToolManageService.create_api_tool_provider(
            user_id,
            tenant_id,
            args["provider"],
            args["icon"],
            args["credentials"],
            args["schema_type"],
            args["schema"],
            args.get("privacy_policy", ""),
            args.get("custom_disclaimer", ""),
            args.get("labels", []),
        )


@console_ns.route("/workspaces/current/tool-provider/api/remote")
class ToolApiProviderGetRemoteSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        parser = reqparse.RequestParser().add_argument("url", type=str, required=True, nullable=False, location="args")

        args = parser.parse_args()

        return ApiToolManageService.get_api_tool_provider_remote_schema(
            user_id,
            tenant_id,
            args["url"],
        )


@console_ns.route("/workspaces/current/tool-provider/api/tools")
class ToolApiProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        parser = reqparse.RequestParser().add_argument(
            "provider", type=str, required=True, nullable=False, location="args"
        )

        args = parser.parse_args()

        return jsonable_encoder(
            ApiToolManageService.list_api_tool_provider_tools(
                user_id,
                tenant_id,
                args["provider"],
            )
        )


@console_ns.route("/workspaces/current/tool-provider/api/update")
class ToolApiProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        parser = (
            reqparse.RequestParser()
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("schema_type", type=str, required=True, nullable=False, location="json")
            .add_argument("schema", type=str, required=True, nullable=False, location="json")
            .add_argument("provider", type=str, required=True, nullable=False, location="json")
            .add_argument("original_provider", type=str, required=True, nullable=False, location="json")
            .add_argument("icon", type=dict, required=True, nullable=False, location="json")
            .add_argument("privacy_policy", type=str, required=True, nullable=True, location="json")
            .add_argument("labels", type=list[str], required=False, nullable=True, location="json")
            .add_argument("custom_disclaimer", type=str, required=True, nullable=True, location="json")
        )

        args = parser.parse_args()

        return ApiToolManageService.update_api_tool_provider(
            user_id,
            tenant_id,
            args["provider"],
            args["original_provider"],
            args["icon"],
            args["credentials"],
            args["schema_type"],
            args["schema"],
            args["privacy_policy"],
            args["custom_disclaimer"],
            args.get("labels", []),
        )


@console_ns.route("/workspaces/current/tool-provider/api/delete")
class ToolApiProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        parser = reqparse.RequestParser().add_argument(
            "provider", type=str, required=True, nullable=False, location="json"
        )

        args = parser.parse_args()

        return ApiToolManageService.delete_api_tool_provider(
            user_id,
            tenant_id,
            args["provider"],
        )


@console_ns.route("/workspaces/current/tool-provider/api/get")
class ToolApiProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        parser = reqparse.RequestParser().add_argument(
            "provider", type=str, required=True, nullable=False, location="args"
        )

        args = parser.parse_args()

        return ApiToolManageService.get_api_tool_provider(
            user_id,
            tenant_id,
            args["provider"],
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/credential/schema/<path:credential_type>")
class ToolBuiltinProviderCredentialsSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider, credential_type):
        _, tenant_id = current_account_with_tenant()

        return jsonable_encoder(
            BuiltinToolManageService.list_builtin_provider_credentials_schema(
                provider, CredentialType.of(credential_type), tenant_id
            )
        )


@console_ns.route("/workspaces/current/tool-provider/api/schema")
class ToolApiProviderSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser().add_argument(
            "schema", type=str, required=True, nullable=False, location="json"
        )

        args = parser.parse_args()

        return ApiToolManageService.parser_api_schema(
            schema=args["schema"],
        )


@console_ns.route("/workspaces/current/tool-provider/api/test/pre")
class ToolApiProviderPreviousTestApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("tool_name", type=str, required=True, nullable=False, location="json")
            .add_argument("provider_name", type=str, required=False, nullable=False, location="json")
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("parameters", type=dict, required=True, nullable=False, location="json")
            .add_argument("schema_type", type=str, required=True, nullable=False, location="json")
            .add_argument("schema", type=str, required=True, nullable=False, location="json")
        )

        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()
        return ApiToolManageService.test_api_tool_preview(
            current_tenant_id,
            args["provider_name"] or "",
            args["tool_name"],
            args["credentials"],
            args["parameters"],
            args["schema_type"],
            args["schema"],
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/create")
class ToolWorkflowProviderCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        reqparser = (
            reqparse.RequestParser()
            .add_argument("workflow_app_id", type=uuid_value, required=True, nullable=False, location="json")
            .add_argument("name", type=alphanumeric, required=True, nullable=False, location="json")
            .add_argument("label", type=str, required=True, nullable=False, location="json")
            .add_argument("description", type=str, required=True, nullable=False, location="json")
            .add_argument("icon", type=dict, required=True, nullable=False, location="json")
            .add_argument("parameters", type=list[dict], required=True, nullable=False, location="json")
            .add_argument("privacy_policy", type=str, required=False, nullable=True, location="json", default="")
            .add_argument("labels", type=list[str], required=False, nullable=True, location="json")
        )

        args = reqparser.parse_args()

        return WorkflowToolManageService.create_workflow_tool(
            user_id=user_id,
            tenant_id=tenant_id,
            workflow_app_id=args["workflow_app_id"],
            name=args["name"],
            label=args["label"],
            icon=args["icon"],
            description=args["description"],
            parameters=args["parameters"],
            privacy_policy=args["privacy_policy"],
            labels=args["labels"],
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/update")
class ToolWorkflowProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        reqparser = (
            reqparse.RequestParser()
            .add_argument("workflow_tool_id", type=uuid_value, required=True, nullable=False, location="json")
            .add_argument("name", type=alphanumeric, required=True, nullable=False, location="json")
            .add_argument("label", type=str, required=True, nullable=False, location="json")
            .add_argument("description", type=str, required=True, nullable=False, location="json")
            .add_argument("icon", type=dict, required=True, nullable=False, location="json")
            .add_argument("parameters", type=list[dict], required=True, nullable=False, location="json")
            .add_argument("privacy_policy", type=str, required=False, nullable=True, location="json", default="")
            .add_argument("labels", type=list[str], required=False, nullable=True, location="json")
        )

        args = reqparser.parse_args()

        if not args["workflow_tool_id"]:
            raise ValueError("incorrect workflow_tool_id")

        return WorkflowToolManageService.update_workflow_tool(
            user_id,
            tenant_id,
            args["workflow_tool_id"],
            args["name"],
            args["label"],
            args["icon"],
            args["description"],
            args["parameters"],
            args["privacy_policy"],
            args.get("labels", []),
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/delete")
class ToolWorkflowProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id

        reqparser = reqparse.RequestParser().add_argument(
            "workflow_tool_id", type=uuid_value, required=True, nullable=False, location="json"
        )

        args = reqparser.parse_args()

        return WorkflowToolManageService.delete_workflow_tool(
            user_id,
            tenant_id,
            args["workflow_tool_id"],
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/get")
class ToolWorkflowProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        parser = (
            reqparse.RequestParser()
            .add_argument("workflow_tool_id", type=uuid_value, required=False, nullable=True, location="args")
            .add_argument("workflow_app_id", type=uuid_value, required=False, nullable=True, location="args")
        )

        args = parser.parse_args()

        if args.get("workflow_tool_id"):
            tool = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                user_id,
                tenant_id,
                args["workflow_tool_id"],
            )
        elif args.get("workflow_app_id"):
            tool = WorkflowToolManageService.get_workflow_tool_by_app_id(
                user_id,
                tenant_id,
                args["workflow_app_id"],
            )
        else:
            raise ValueError("incorrect workflow_tool_id or workflow_app_id")

        return jsonable_encoder(tool)


@console_ns.route("/workspaces/current/tool-provider/workflow/tools")
class ToolWorkflowProviderListToolApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        parser = reqparse.RequestParser().add_argument(
            "workflow_tool_id", type=uuid_value, required=True, nullable=False, location="args"
        )

        args = parser.parse_args()

        return jsonable_encoder(
            WorkflowToolManageService.list_single_workflow_tools(
                user_id,
                tenant_id,
                args["workflow_tool_id"],
            )
        )


@console_ns.route("/workspaces/current/tools/builtin")
class ToolBuiltinListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        return jsonable_encoder(
            [
                provider.to_dict()
                for provider in BuiltinToolManageService.list_builtin_tools(
                    user_id,
                    tenant_id,
                )
            ]
        )


@console_ns.route("/workspaces/current/tools/api")
class ToolApiListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()

        return jsonable_encoder(
            [
                provider.to_dict()
                for provider in ApiToolManageService.list_api_tools(
                    tenant_id,
                )
            ]
        )


@console_ns.route("/workspaces/current/tools/workflow")
class ToolWorkflowListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        return jsonable_encoder(
            [
                provider.to_dict()
                for provider in WorkflowToolManageService.list_tenant_workflow_tools(
                    user_id,
                    tenant_id,
                )
            ]
        )


@console_ns.route("/workspaces/current/tool-labels")
class ToolLabelsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        return jsonable_encoder(ToolLabelsService.list_tool_labels())


@console_ns.route("/oauth/plugin/<path:provider>/tool/authorization-url")
class ToolPluginOAuthApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        tool_provider = ToolProviderID(provider)
        plugin_id = tool_provider.plugin_id
        provider_name = tool_provider.provider_name

        # todo check permission
        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        oauth_client_params = BuiltinToolManageService.get_oauth_client(tenant_id=tenant_id, provider=provider)
        if oauth_client_params is None:
            raise Forbidden("no oauth available client config found for this tool provider")

        oauth_handler = OAuthHandler()
        context_id = OAuthProxyService.create_proxy_context(
            user_id=user.id, tenant_id=tenant_id, plugin_id=plugin_id, provider=provider_name
        )
        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/tool/callback"
        authorization_url_response = oauth_handler.get_authorization_url(
            tenant_id=tenant_id,
            user_id=user.id,
            plugin_id=plugin_id,
            provider=provider_name,
            redirect_uri=redirect_uri,
            system_credentials=oauth_client_params,
        )
        response = make_response(jsonable_encoder(authorization_url_response))
        response.set_cookie(
            "context_id",
            context_id,
            httponly=True,
            samesite="Lax",
            max_age=OAuthProxyService.__MAX_AGE__,
        )
        return response


@console_ns.route("/oauth/plugin/<path:provider>/tool/callback")
class ToolOAuthCallback(Resource):
    @setup_required
    def get(self, provider):
        context_id = request.cookies.get("context_id")
        if not context_id:
            raise Forbidden("context_id not found")

        context = OAuthProxyService.use_proxy_context(context_id)
        if context is None:
            raise Forbidden("Invalid context_id")

        tool_provider = ToolProviderID(provider)
        plugin_id = tool_provider.plugin_id
        provider_name = tool_provider.provider_name
        user_id, tenant_id = context.get("user_id"), context.get("tenant_id")

        oauth_handler = OAuthHandler()
        oauth_client_params = BuiltinToolManageService.get_oauth_client(tenant_id, provider)
        if oauth_client_params is None:
            raise Forbidden("no oauth available client config found for this tool provider")

        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/tool/callback"
        credentials_response = oauth_handler.get_credentials(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            redirect_uri=redirect_uri,
            system_credentials=oauth_client_params,
            request=request,
        )

        credentials = credentials_response.credentials
        expires_at = credentials_response.expires_at

        if not credentials:
            raise Exception("the plugin credentials failed")

        # add credentials to database
        BuiltinToolManageService.add_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credentials=dict(credentials),
            expires_at=expires_at,
            api_type=CredentialType.OAUTH2,
        )
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/default-credential")
class ToolBuiltinProviderSetDefaultApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        current_user, current_tenant_id = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("id", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        return BuiltinToolManageService.set_default_provider(
            tenant_id=current_tenant_id, user_id=current_user.id, provider=provider, id=args["id"]
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client")
class ToolOAuthCustomClient(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        parser = (
            reqparse.RequestParser()
            .add_argument("client_params", type=dict, required=False, nullable=True, location="json")
            .add_argument("enable_oauth_custom_client", type=bool, required=False, nullable=True, location="json")
        )
        args = parser.parse_args()

        user, tenant_id = current_account_with_tenant()

        if not user.is_admin_or_owner:
            raise Forbidden()

        return BuiltinToolManageService.save_custom_oauth_client_params(
            tenant_id=tenant_id,
            provider=provider,
            client_params=args.get("client_params", {}),
            enable_oauth_custom_client=args.get("enable_oauth_custom_client", True),
        )

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, current_tenant_id = current_account_with_tenant()
        return jsonable_encoder(
            BuiltinToolManageService.get_custom_oauth_client_params(tenant_id=current_tenant_id, provider=provider)
        )

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider):
        _, current_tenant_id = current_account_with_tenant()
        return jsonable_encoder(
            BuiltinToolManageService.delete_custom_oauth_client_params(tenant_id=current_tenant_id, provider=provider)
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/oauth/client-schema")
class ToolBuiltinProviderGetOauthClientSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, current_tenant_id = current_account_with_tenant()
        return jsonable_encoder(
            BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema(
                tenant_id=current_tenant_id, provider_name=provider
            )
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/credential/info")
class ToolBuiltinProviderGetCredentialInfoApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, tenant_id = current_account_with_tenant()

        return jsonable_encoder(
            BuiltinToolManageService.get_builtin_tool_provider_credential_info(
                tenant_id=tenant_id,
                provider=provider,
            )
        )


@console_ns.route("/workspaces/current/tool-provider/mcp")
class ToolProviderMCPApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("server_url", type=str, required=True, nullable=False, location="json")
            .add_argument("name", type=str, required=True, nullable=False, location="json")
            .add_argument("icon", type=str, required=True, nullable=False, location="json")
            .add_argument("icon_type", type=str, required=True, nullable=False, location="json")
            .add_argument("icon_background", type=str, required=False, nullable=True, location="json", default="")
            .add_argument("server_identifier", type=str, required=True, nullable=False, location="json")
            .add_argument("configuration", type=dict, required=False, nullable=True, location="json", default={})
            .add_argument("headers", type=dict, required=False, nullable=True, location="json", default={})
            .add_argument("authentication", type=dict, required=False, nullable=True, location="json", default={})
        )
        args = parser.parse_args()
        user, tenant_id = current_account_with_tenant()

        # Parse and validate models
        configuration = MCPConfiguration.model_validate(args["configuration"])
        authentication = MCPAuthentication.model_validate(args["authentication"]) if args["authentication"] else None

        # Create provider
        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            result = service.create_provider(
                tenant_id=tenant_id,
                user_id=user.id,
                server_url=args["server_url"],
                name=args["name"],
                icon=args["icon"],
                icon_type=args["icon_type"],
                icon_background=args["icon_background"],
                server_identifier=args["server_identifier"],
                headers=args["headers"],
                configuration=configuration,
                authentication=authentication,
            )
            return jsonable_encoder(result)

    @setup_required
    @login_required
    @account_initialization_required
    def put(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("server_url", type=str, required=True, nullable=False, location="json")
            .add_argument("name", type=str, required=True, nullable=False, location="json")
            .add_argument("icon", type=str, required=True, nullable=False, location="json")
            .add_argument("icon_type", type=str, required=True, nullable=False, location="json")
            .add_argument("icon_background", type=str, required=False, nullable=True, location="json")
            .add_argument("provider_id", type=str, required=True, nullable=False, location="json")
            .add_argument("server_identifier", type=str, required=True, nullable=False, location="json")
            .add_argument("configuration", type=dict, required=False, nullable=True, location="json", default={})
            .add_argument("headers", type=dict, required=False, nullable=True, location="json", default={})
            .add_argument("authentication", type=dict, required=False, nullable=True, location="json", default={})
        )
        args = parser.parse_args()
        configuration = MCPConfiguration.model_validate(args["configuration"])
        authentication = MCPAuthentication.model_validate(args["authentication"]) if args["authentication"] else None
        _, current_tenant_id = current_account_with_tenant()

        # Step 1: Validate server URL change if needed (includes URL format validation and network operation)
        validation_result = None
        with Session(db.engine) as session:
            service = MCPToolManageService(session=session)
            validation_result = service.validate_server_url_change(
                tenant_id=current_tenant_id, provider_id=args["provider_id"], new_server_url=args["server_url"]
            )

            # No need to check for errors here, exceptions will be raised directly

        # Step 2: Perform database update in a transaction
        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            service.update_provider(
                tenant_id=current_tenant_id,
                provider_id=args["provider_id"],
                server_url=args["server_url"],
                name=args["name"],
                icon=args["icon"],
                icon_type=args["icon_type"],
                icon_background=args["icon_background"],
                server_identifier=args["server_identifier"],
                headers=args["headers"],
                configuration=configuration,
                authentication=authentication,
                validation_result=validation_result,
            )
            return {"result": "success"}

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self):
        parser = reqparse.RequestParser().add_argument(
            "provider_id", type=str, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()
        _, current_tenant_id = current_account_with_tenant()

        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            service.delete_provider(tenant_id=current_tenant_id, provider_id=args["provider_id"])
            return {"result": "success"}


@console_ns.route("/workspaces/current/tool-provider/mcp/auth")
class ToolMCPAuthApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("provider_id", type=str, required=True, nullable=False, location="json")
            .add_argument("authorization_code", type=str, required=False, nullable=True, location="json")
        )
        args = parser.parse_args()
        provider_id = args["provider_id"]
        _, tenant_id = current_account_with_tenant()

        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            db_provider = service.get_provider(provider_id=provider_id, tenant_id=tenant_id)
            if not db_provider:
                raise ValueError("provider not found")

            # Convert to entity
            provider_entity = db_provider.to_entity()
            server_url = provider_entity.decrypt_server_url()
            headers = provider_entity.decrypt_authentication()

        # Try to connect without active transaction
        try:
            # Use MCPClientWithAuthRetry to handle authentication automatically
            with MCPClient(
                server_url=server_url,
                headers=headers,
                timeout=provider_entity.timeout,
                sse_read_timeout=provider_entity.sse_read_timeout,
            ):
                # Update credentials in new transaction
                with Session(db.engine) as session, session.begin():
                    service = MCPToolManageService(session=session)
                    service.update_provider_credentials(
                        provider_id=provider_id,
                        tenant_id=tenant_id,
                        credentials=provider_entity.credentials,
                        authed=True,
                    )
                return {"result": "success"}
        except MCPAuthError as e:
            try:
                auth_result = auth(provider_entity, args.get("authorization_code"))
                with Session(db.engine) as session, session.begin():
                    service = MCPToolManageService(session=session)
                    response = service.execute_auth_actions(auth_result)
                    return response
            except MCPRefreshTokenError as e:
                with Session(db.engine) as session, session.begin():
                    service = MCPToolManageService(session=session)
                    service.clear_provider_credentials(provider_id=provider_id, tenant_id=tenant_id)
                raise ValueError(f"Failed to refresh token, please try to authorize again: {e}") from e
        except MCPError as e:
            with Session(db.engine) as session, session.begin():
                service = MCPToolManageService(session=session)
                service.clear_provider_credentials(provider_id=provider_id, tenant_id=tenant_id)
            raise ValueError(f"Failed to connect to MCP server: {e}") from e


@console_ns.route("/workspaces/current/tool-provider/mcp/tools/<path:provider_id>")
class ToolMCPDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id):
        _, tenant_id = current_account_with_tenant()
        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            provider = service.get_provider(provider_id=provider_id, tenant_id=tenant_id)
            return jsonable_encoder(ToolTransformService.mcp_provider_to_user_provider(provider, for_list=True))


@console_ns.route("/workspaces/current/tools/mcp")
class ToolMCPListAllApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()

        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            # Skip sensitive data decryption for list view to improve performance
            tools = service.list_providers(tenant_id=tenant_id, include_sensitive=False)

            return [tool.to_dict() for tool in tools]


@console_ns.route("/workspaces/current/tool-provider/mcp/update/<path:provider_id>")
class ToolMCPUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id):
        _, tenant_id = current_account_with_tenant()
        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            tools = service.list_provider_tools(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )
            return jsonable_encoder(tools)


@console_ns.route("/mcp/oauth/callback")
class ToolMCPCallbackApi(Resource):
    def get(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("code", type=str, required=True, nullable=False, location="args")
            .add_argument("state", type=str, required=True, nullable=False, location="args")
        )
        args = parser.parse_args()
        state_key = args["state"]
        authorization_code = args["code"]

        # Create service instance for handle_callback
        with Session(db.engine) as session, session.begin():
            mcp_service = MCPToolManageService(session=session)
            # handle_callback now returns state data and tokens
            state_data, tokens = handle_callback(state_key, authorization_code)
            # Save tokens using the service layer
            mcp_service.save_oauth_data(
                state_data.provider_id, state_data.tenant_id, tokens.model_dump(), OAuthDataType.TOKENS
            )

        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")
