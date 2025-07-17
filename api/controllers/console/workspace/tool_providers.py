import io
from urllib.parse import urlparse

from flask import make_response, redirect, request, send_file
from flask_login import current_user
from flask_restful import (
    Resource,
    reqparse,
)
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    setup_required,
)
from core.mcp.auth.auth_flow import auth, handle_callback
from core.mcp.auth.auth_provider import OAuthClientProvider
from core.mcp.error import MCPAuthError, MCPError
from core.mcp.mcp_client import MCPClient
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import ToolProviderID
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.tool_entities import CredentialType
from libs.helper import StrLen, alphanumeric, uuid_value
from libs.login import login_required
from services.plugin.oauth_service import OAuthProxyService
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_mange_service import MCPToolManageService
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
    except Exception:
        return False


class ToolProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        req = reqparse.RequestParser()
        req.add_argument(
            "type",
            type=str,
            choices=["builtin", "model", "api", "workflow", "mcp"],
            required=False,
            nullable=True,
            location="args",
        )
        args = req.parse_args()

        return ToolCommonService.list_tool_providers(user_id, tenant_id, args.get("type", None))


class ToolBuiltinProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        user = current_user

        tenant_id = user.current_tenant_id

        return jsonable_encoder(
            BuiltinToolManageService.list_builtin_tool_provider_tools(
                tenant_id,
                provider,
            )
        )


class ToolBuiltinProviderInfoApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        return jsonable_encoder(BuiltinToolManageService.get_builtin_tool_provider_info(tenant_id, provider))


class ToolBuiltinProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user = current_user
        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id
        req = reqparse.RequestParser()
        req.add_argument("credential_id", type=str, required=True, nullable=False, location="json")
        args = req.parse_args()

        return BuiltinToolManageService.delete_builtin_tool_provider(
            tenant_id,
            provider,
            args["credential_id"],
        )


class ToolBuiltinProviderAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("name", type=StrLen(30), required=False, nullable=False, location="json")
        parser.add_argument("type", type=str, required=True, nullable=False, location="json")
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


class ToolBuiltinProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("credential_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("credentials", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")

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


class ToolBuiltinProviderGetCredentialsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        tenant_id = current_user.current_tenant_id

        return jsonable_encoder(
            BuiltinToolManageService.get_builtin_tool_provider_credentials(
                tenant_id=tenant_id,
                provider_name=provider,
            )
        )


class ToolBuiltinProviderIconApi(Resource):
    @setup_required
    def get(self, provider):
        icon_bytes, mimetype = BuiltinToolManageService.get_builtin_tool_provider_icon(provider)
        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


class ToolApiProviderAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("schema_type", type=str, required=True, nullable=False, location="json")
        parser.add_argument("schema", type=str, required=True, nullable=False, location="json")
        parser.add_argument("provider", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("privacy_policy", type=str, required=False, nullable=True, location="json")
        parser.add_argument("labels", type=list[str], required=False, nullable=True, location="json", default=[])
        parser.add_argument("custom_disclaimer", type=str, required=False, nullable=True, location="json")

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


class ToolApiProviderGetRemoteSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument("url", type=str, required=True, nullable=False, location="args")

        args = parser.parse_args()

        return ApiToolManageService.get_api_tool_provider_remote_schema(
            user_id,
            tenant_id,
            args["url"],
        )


class ToolApiProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")

        args = parser.parse_args()

        return jsonable_encoder(
            ApiToolManageService.list_api_tool_provider_tools(
                user_id,
                tenant_id,
                args["provider"],
            )
        )


class ToolApiProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("schema_type", type=str, required=True, nullable=False, location="json")
        parser.add_argument("schema", type=str, required=True, nullable=False, location="json")
        parser.add_argument("provider", type=str, required=True, nullable=False, location="json")
        parser.add_argument("original_provider", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("privacy_policy", type=str, required=True, nullable=True, location="json")
        parser.add_argument("labels", type=list[str], required=False, nullable=True, location="json")
        parser.add_argument("custom_disclaimer", type=str, required=True, nullable=True, location="json")

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


class ToolApiProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument("provider", type=str, required=True, nullable=False, location="json")

        args = parser.parse_args()

        return ApiToolManageService.delete_api_tool_provider(
            user_id,
            tenant_id,
            args["provider"],
        )


class ToolApiProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")

        args = parser.parse_args()

        return ApiToolManageService.get_api_tool_provider(
            user_id,
            tenant_id,
            args["provider"],
        )


class ToolBuiltinProviderCredentialsSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider, credential_type):
        user = current_user
        tenant_id = user.current_tenant_id

        return jsonable_encoder(
            BuiltinToolManageService.list_builtin_provider_credentials_schema(
                provider, CredentialType.of(credential_type), tenant_id
            )
        )


class ToolApiProviderSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()

        parser.add_argument("schema", type=str, required=True, nullable=False, location="json")

        args = parser.parse_args()

        return ApiToolManageService.parser_api_schema(
            schema=args["schema"],
        )


class ToolApiProviderPreviousTestApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()

        parser.add_argument("tool_name", type=str, required=True, nullable=False, location="json")
        parser.add_argument("provider_name", type=str, required=False, nullable=False, location="json")
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("parameters", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("schema_type", type=str, required=True, nullable=False, location="json")
        parser.add_argument("schema", type=str, required=True, nullable=False, location="json")

        args = parser.parse_args()

        return ApiToolManageService.test_api_tool_preview(
            current_user.current_tenant_id,
            args["provider_name"] or "",
            args["tool_name"],
            args["credentials"],
            args["parameters"],
            args["schema_type"],
            args["schema"],
        )


class ToolWorkflowProviderCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        reqparser = reqparse.RequestParser()
        reqparser.add_argument("workflow_app_id", type=uuid_value, required=True, nullable=False, location="json")
        reqparser.add_argument("name", type=alphanumeric, required=True, nullable=False, location="json")
        reqparser.add_argument("label", type=str, required=True, nullable=False, location="json")
        reqparser.add_argument("description", type=str, required=True, nullable=False, location="json")
        reqparser.add_argument("icon", type=dict, required=True, nullable=False, location="json")
        reqparser.add_argument("parameters", type=list[dict], required=True, nullable=False, location="json")
        reqparser.add_argument("privacy_policy", type=str, required=False, nullable=True, location="json", default="")
        reqparser.add_argument("labels", type=list[str], required=False, nullable=True, location="json")

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


class ToolWorkflowProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        reqparser = reqparse.RequestParser()
        reqparser.add_argument("workflow_tool_id", type=uuid_value, required=True, nullable=False, location="json")
        reqparser.add_argument("name", type=alphanumeric, required=True, nullable=False, location="json")
        reqparser.add_argument("label", type=str, required=True, nullable=False, location="json")
        reqparser.add_argument("description", type=str, required=True, nullable=False, location="json")
        reqparser.add_argument("icon", type=dict, required=True, nullable=False, location="json")
        reqparser.add_argument("parameters", type=list[dict], required=True, nullable=False, location="json")
        reqparser.add_argument("privacy_policy", type=str, required=False, nullable=True, location="json", default="")
        reqparser.add_argument("labels", type=list[str], required=False, nullable=True, location="json")

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


class ToolWorkflowProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        user_id = user.id
        tenant_id = user.current_tenant_id

        reqparser = reqparse.RequestParser()
        reqparser.add_argument("workflow_tool_id", type=uuid_value, required=True, nullable=False, location="json")

        args = reqparser.parse_args()

        return WorkflowToolManageService.delete_workflow_tool(
            user_id,
            tenant_id,
            args["workflow_tool_id"],
        )


class ToolWorkflowProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("workflow_tool_id", type=uuid_value, required=False, nullable=True, location="args")
        parser.add_argument("workflow_app_id", type=uuid_value, required=False, nullable=True, location="args")

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


class ToolWorkflowProviderListToolApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("workflow_tool_id", type=uuid_value, required=True, nullable=False, location="args")

        args = parser.parse_args()

        return jsonable_encoder(
            WorkflowToolManageService.list_single_workflow_tools(
                user_id,
                tenant_id,
                args["workflow_tool_id"],
            )
        )


class ToolBuiltinListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        return jsonable_encoder(
            [
                provider.to_dict()
                for provider in BuiltinToolManageService.list_builtin_tools(
                    user_id,
                    tenant_id,
                )
            ]
        )


class ToolApiListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user
        tenant_id = user.current_tenant_id

        return jsonable_encoder(
            [
                provider.to_dict()
                for provider in ApiToolManageService.list_api_tools(
                    tenant_id,
                )
            ]
        )


class ToolWorkflowListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        return jsonable_encoder(
            [
                provider.to_dict()
                for provider in WorkflowToolManageService.list_tenant_workflow_tools(
                    user_id,
                    tenant_id,
                )
            ]
        )


class ToolLabelsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        return jsonable_encoder(ToolLabelsService.list_tool_labels())


class ToolPluginOAuthApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        tool_provider = ToolProviderID(provider)
        plugin_id = tool_provider.plugin_id
        provider_name = tool_provider.provider_name

        # todo check permission
        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = user.current_tenant_id
        oauth_client_params = BuiltinToolManageService.get_oauth_client(tenant_id=tenant_id, provider=provider)
        if oauth_client_params is None:
            raise Forbidden("no oauth available client config found for this tool provider")

        oauth_handler = OAuthHandler()
        context_id = OAuthProxyService.create_proxy_context(
            user_id=current_user.id, tenant_id=tenant_id, plugin_id=plugin_id, provider=provider_name
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
        credentials = oauth_handler.get_credentials(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            redirect_uri=redirect_uri,
            system_credentials=oauth_client_params,
            request=request,
        ).credentials

        if not credentials:
            raise Exception("the plugin credentials failed")

        # add credentials to database
        BuiltinToolManageService.add_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credentials=dict(credentials),
            api_type=CredentialType.OAUTH2,
        )
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


class ToolBuiltinProviderSetDefaultApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        parser = reqparse.RequestParser()
        parser.add_argument("id", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        return BuiltinToolManageService.set_default_provider(
            tenant_id=current_user.current_tenant_id, user_id=current_user.id, provider=provider, id=args["id"]
        )


class ToolOAuthCustomClient(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        parser = reqparse.RequestParser()
        parser.add_argument("client_params", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("enable_oauth_custom_client", type=bool, required=False, nullable=True, location="json")
        args = parser.parse_args()

        user = current_user

        if not user.is_admin_or_owner:
            raise Forbidden()

        return BuiltinToolManageService.save_custom_oauth_client_params(
            tenant_id=user.current_tenant_id,
            provider=provider,
            client_params=args.get("client_params", {}),
            enable_oauth_custom_client=args.get("enable_oauth_custom_client", True),
        )

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        return jsonable_encoder(
            BuiltinToolManageService.get_custom_oauth_client_params(
                tenant_id=current_user.current_tenant_id, provider=provider
            )
        )

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider):
        return jsonable_encoder(
            BuiltinToolManageService.delete_custom_oauth_client_params(
                tenant_id=current_user.current_tenant_id, provider=provider
            )
        )


class ToolBuiltinProviderGetOauthClientSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        return jsonable_encoder(
            BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema(
                tenant_id=current_user.current_tenant_id, provider_name=provider
            )
        )


class ToolBuiltinProviderGetCredentialInfoApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        tenant_id = current_user.current_tenant_id

        return jsonable_encoder(
            BuiltinToolManageService.get_builtin_tool_provider_credential_info(
                tenant_id=tenant_id,
                provider=provider,
            )
        )


class ToolProviderMCPApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("server_url", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon_type", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon_background", type=str, required=False, nullable=True, location="json", default="")
        parser.add_argument("server_identifier", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        user = current_user
        if not is_valid_url(args["server_url"]):
            raise ValueError("Server URL is not valid.")
        return jsonable_encoder(
            MCPToolManageService.create_mcp_provider(
                tenant_id=user.current_tenant_id,
                server_url=args["server_url"],
                name=args["name"],
                icon=args["icon"],
                icon_type=args["icon_type"],
                icon_background=args["icon_background"],
                user_id=user.id,
                server_identifier=args["server_identifier"],
            )
        )

    @setup_required
    @login_required
    @account_initialization_required
    def put(self):
        parser = reqparse.RequestParser()
        parser.add_argument("server_url", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon_type", type=str, required=True, nullable=False, location="json")
        parser.add_argument("icon_background", type=str, required=False, nullable=True, location="json")
        parser.add_argument("provider_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("server_identifier", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        if not is_valid_url(args["server_url"]):
            if "[__HIDDEN__]" in args["server_url"]:
                pass
            else:
                raise ValueError("Server URL is not valid.")
        MCPToolManageService.update_mcp_provider(
            tenant_id=current_user.current_tenant_id,
            provider_id=args["provider_id"],
            server_url=args["server_url"],
            name=args["name"],
            icon=args["icon"],
            icon_type=args["icon_type"],
            icon_background=args["icon_background"],
            server_identifier=args["server_identifier"],
        )
        return {"result": "success"}

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self):
        parser = reqparse.RequestParser()
        parser.add_argument("provider_id", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        MCPToolManageService.delete_mcp_tool(tenant_id=current_user.current_tenant_id, provider_id=args["provider_id"])
        return {"result": "success"}


class ToolMCPAuthApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("provider_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("authorization_code", type=str, required=False, nullable=True, location="json")
        args = parser.parse_args()
        provider_id = args["provider_id"]
        tenant_id = current_user.current_tenant_id
        provider = MCPToolManageService.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if not provider:
            raise ValueError("provider not found")
        try:
            with MCPClient(
                provider.decrypted_server_url,
                provider_id,
                tenant_id,
                authed=False,
                authorization_code=args["authorization_code"],
                for_list=True,
            ):
                MCPToolManageService.update_mcp_provider_credentials(
                    mcp_provider=provider,
                    credentials=provider.decrypted_credentials,
                    authed=True,
                )
                return {"result": "success"}

        except MCPAuthError:
            auth_provider = OAuthClientProvider(provider_id, tenant_id, for_list=True)
            return auth(auth_provider, provider.decrypted_server_url, args["authorization_code"])
        except MCPError as e:
            MCPToolManageService.update_mcp_provider_credentials(
                mcp_provider=provider,
                credentials={},
                authed=False,
            )
            raise ValueError(f"Failed to connect to MCP server: {e}") from e


class ToolMCPDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id):
        user = current_user
        provider = MCPToolManageService.get_mcp_provider_by_provider_id(provider_id, user.current_tenant_id)
        return jsonable_encoder(ToolTransformService.mcp_provider_to_user_provider(provider, for_list=True))


class ToolMCPListAllApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user
        tenant_id = user.current_tenant_id

        tools = MCPToolManageService.retrieve_mcp_tools(tenant_id=tenant_id)

        return [tool.to_dict() for tool in tools]


class ToolMCPUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id):
        tenant_id = current_user.current_tenant_id
        tools = MCPToolManageService.list_mcp_tool_from_remote_server(
            tenant_id=tenant_id,
            provider_id=provider_id,
        )
        return jsonable_encoder(tools)


class ToolMCPCallbackApi(Resource):
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("code", type=str, required=True, nullable=False, location="args")
        parser.add_argument("state", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()
        state_key = args["state"]
        authorization_code = args["code"]
        handle_callback(state_key, authorization_code)
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


# tool provider
api.add_resource(ToolProviderListApi, "/workspaces/current/tool-providers")

# tool oauth
api.add_resource(ToolPluginOAuthApi, "/oauth/plugin/<path:provider>/tool/authorization-url")
api.add_resource(ToolOAuthCallback, "/oauth/plugin/<path:provider>/tool/callback")
api.add_resource(ToolOAuthCustomClient, "/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client")

# builtin tool provider
api.add_resource(ToolBuiltinProviderListToolsApi, "/workspaces/current/tool-provider/builtin/<path:provider>/tools")
api.add_resource(ToolBuiltinProviderInfoApi, "/workspaces/current/tool-provider/builtin/<path:provider>/info")
api.add_resource(ToolBuiltinProviderAddApi, "/workspaces/current/tool-provider/builtin/<path:provider>/add")
api.add_resource(ToolBuiltinProviderDeleteApi, "/workspaces/current/tool-provider/builtin/<path:provider>/delete")
api.add_resource(ToolBuiltinProviderUpdateApi, "/workspaces/current/tool-provider/builtin/<path:provider>/update")
api.add_resource(
    ToolBuiltinProviderSetDefaultApi, "/workspaces/current/tool-provider/builtin/<path:provider>/default-credential"
)
api.add_resource(
    ToolBuiltinProviderGetCredentialInfoApi, "/workspaces/current/tool-provider/builtin/<path:provider>/credential/info"
)
api.add_resource(
    ToolBuiltinProviderGetCredentialsApi, "/workspaces/current/tool-provider/builtin/<path:provider>/credentials"
)
api.add_resource(
    ToolBuiltinProviderCredentialsSchemaApi,
    "/workspaces/current/tool-provider/builtin/<path:provider>/credential/schema/<path:credential_type>",
)
api.add_resource(
    ToolBuiltinProviderGetOauthClientSchemaApi,
    "/workspaces/current/tool-provider/builtin/<path:provider>/oauth/client-schema",
)
api.add_resource(ToolBuiltinProviderIconApi, "/workspaces/current/tool-provider/builtin/<path:provider>/icon")

# api tool provider
api.add_resource(ToolApiProviderAddApi, "/workspaces/current/tool-provider/api/add")
api.add_resource(ToolApiProviderGetRemoteSchemaApi, "/workspaces/current/tool-provider/api/remote")
api.add_resource(ToolApiProviderListToolsApi, "/workspaces/current/tool-provider/api/tools")
api.add_resource(ToolApiProviderUpdateApi, "/workspaces/current/tool-provider/api/update")
api.add_resource(ToolApiProviderDeleteApi, "/workspaces/current/tool-provider/api/delete")
api.add_resource(ToolApiProviderGetApi, "/workspaces/current/tool-provider/api/get")
api.add_resource(ToolApiProviderSchemaApi, "/workspaces/current/tool-provider/api/schema")
api.add_resource(ToolApiProviderPreviousTestApi, "/workspaces/current/tool-provider/api/test/pre")

# workflow tool provider
api.add_resource(ToolWorkflowProviderCreateApi, "/workspaces/current/tool-provider/workflow/create")
api.add_resource(ToolWorkflowProviderUpdateApi, "/workspaces/current/tool-provider/workflow/update")
api.add_resource(ToolWorkflowProviderDeleteApi, "/workspaces/current/tool-provider/workflow/delete")
api.add_resource(ToolWorkflowProviderGetApi, "/workspaces/current/tool-provider/workflow/get")
api.add_resource(ToolWorkflowProviderListToolApi, "/workspaces/current/tool-provider/workflow/tools")

# mcp tool provider
api.add_resource(ToolMCPDetailApi, "/workspaces/current/tool-provider/mcp/tools/<path:provider_id>")
api.add_resource(ToolProviderMCPApi, "/workspaces/current/tool-provider/mcp")
api.add_resource(ToolMCPUpdateApi, "/workspaces/current/tool-provider/mcp/update/<path:provider_id>")
api.add_resource(ToolMCPAuthApi, "/workspaces/current/tool-provider/mcp/auth")
api.add_resource(ToolMCPCallbackApi, "/mcp/oauth/callback")

api.add_resource(ToolBuiltinListApi, "/workspaces/current/tools/builtin")
api.add_resource(ToolApiListApi, "/workspaces/current/tools/api")
api.add_resource(ToolMCPListAllApi, "/workspaces/current/tools/mcp")
api.add_resource(ToolWorkflowListApi, "/workspaces/current/tools/workflow")
api.add_resource(ToolLabelsApi, "/workspaces/current/tool-labels")
