import io
import logging
from typing import Any, Literal
from urllib.parse import urlparse

from flask import make_response, redirect, request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    is_admin_or_owner_required,
    setup_required,
)
from core.db.session_factory import session_factory
from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
from core.mcp.auth.auth_flow import auth, handle_callback
from core.mcp.error import MCPAuthError, MCPError, MCPRefreshTokenError
from core.mcp.mcp_client import MCPClient
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.tool_entities import ApiProviderSchemaType, WorkflowToolParameterConfiguration
from extensions.ext_database import db
from libs.helper import alphanumeric, uuid_value
from libs.login import current_account_with_tenant, login_required
from models.provider_ids import ToolProviderID

# from models.provider_ids import ToolProviderID
from services.plugin.oauth_service import OAuthProxyService
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService, OAuthDataType
from services.tools.tool_labels_service import ToolLabelsService
from services.tools.tools_manage_service import ToolCommonService
from services.tools.tools_transform_service import ToolTransformService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

logger = logging.getLogger(__name__)


def is_valid_url(url: str) -> bool:
    if not url:
        return False

    try:
        parsed = urlparse(url)
        return all([parsed.scheme, parsed.netloc]) and parsed.scheme in ["http", "https"]
    except (ValueError, TypeError):
        return False


class ToolProviderListQuery(BaseModel):
    type: Literal["builtin", "model", "api", "workflow", "mcp"] | None = None


class BuiltinToolCredentialDeletePayload(BaseModel):
    credential_id: str


class BuiltinToolAddPayload(BaseModel):
    credentials: dict[str, Any]
    name: str | None = Field(default=None, max_length=30)
    type: CredentialType


class BuiltinToolUpdatePayload(BaseModel):
    credential_id: str
    credentials: dict[str, Any] | None = None
    name: str | None = Field(default=None, max_length=30)


class ApiToolProviderBasePayload(BaseModel):
    credentials: dict[str, Any]
    schema_type: ApiProviderSchemaType
    schema_: str = Field(alias="schema")
    provider: str
    icon: dict[str, Any]
    privacy_policy: str | None = None
    labels: list[str] | None = None
    custom_disclaimer: str = ""


class ApiToolProviderAddPayload(ApiToolProviderBasePayload):
    pass


class ApiToolProviderUpdatePayload(ApiToolProviderBasePayload):
    original_provider: str


class UrlQuery(BaseModel):
    url: HttpUrl


class ProviderQuery(BaseModel):
    provider: str


class ApiToolProviderDeletePayload(BaseModel):
    provider: str


class ApiToolSchemaPayload(BaseModel):
    schema_: str = Field(alias="schema")


class ApiToolTestPayload(BaseModel):
    tool_name: str
    provider_name: str | None = None
    credentials: dict[str, Any]
    parameters: dict[str, Any]
    schema_type: ApiProviderSchemaType
    schema_: str = Field(alias="schema")


class WorkflowToolBasePayload(BaseModel):
    name: str
    label: str
    description: str
    icon: dict[str, Any]
    parameters: list[WorkflowToolParameterConfiguration] = Field(default_factory=list)
    privacy_policy: str | None = ""
    labels: list[str] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return alphanumeric(value)


class WorkflowToolCreatePayload(WorkflowToolBasePayload):
    workflow_app_id: str

    @field_validator("workflow_app_id")
    @classmethod
    def validate_workflow_app_id(cls, value: str) -> str:
        return uuid_value(value)


class WorkflowToolUpdatePayload(WorkflowToolBasePayload):
    workflow_tool_id: str

    @field_validator("workflow_tool_id")
    @classmethod
    def validate_workflow_tool_id(cls, value: str) -> str:
        return uuid_value(value)


class WorkflowToolDeletePayload(BaseModel):
    workflow_tool_id: str

    @field_validator("workflow_tool_id")
    @classmethod
    def validate_workflow_tool_id(cls, value: str) -> str:
        return uuid_value(value)


class WorkflowToolGetQuery(BaseModel):
    workflow_tool_id: str | None = None
    workflow_app_id: str | None = None

    @field_validator("workflow_tool_id", "workflow_app_id")
    @classmethod
    def validate_ids(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)

    @model_validator(mode="after")
    def ensure_one(self) -> "WorkflowToolGetQuery":
        if not self.workflow_tool_id and not self.workflow_app_id:
            raise ValueError("workflow_tool_id or workflow_app_id is required")
        return self


class WorkflowToolListQuery(BaseModel):
    workflow_tool_id: str

    @field_validator("workflow_tool_id")
    @classmethod
    def validate_workflow_tool_id(cls, value: str) -> str:
        return uuid_value(value)


class BuiltinProviderDefaultCredentialPayload(BaseModel):
    id: str


class ToolOAuthCustomClientPayload(BaseModel):
    client_params: dict[str, Any] | None = None
    enable_oauth_custom_client: bool | None = True


class MCPProviderBasePayload(BaseModel):
    server_url: str
    name: str
    icon: str
    icon_type: str
    icon_background: str = ""
    server_identifier: str
    configuration: dict[str, Any] | None = Field(default_factory=dict)
    headers: dict[str, Any] | None = Field(default_factory=dict)
    authentication: dict[str, Any] | None = Field(default_factory=dict)


class MCPProviderCreatePayload(MCPProviderBasePayload):
    pass


class MCPProviderUpdatePayload(MCPProviderBasePayload):
    provider_id: str


class MCPProviderDeletePayload(BaseModel):
    provider_id: str


class MCPAuthPayload(BaseModel):
    provider_id: str
    authorization_code: str | None = None


class MCPCallbackQuery(BaseModel):
    code: str
    state: str


register_schema_models(
    console_ns,
    BuiltinToolCredentialDeletePayload,
    BuiltinToolAddPayload,
    BuiltinToolUpdatePayload,
    ApiToolProviderAddPayload,
    ApiToolProviderUpdatePayload,
    ApiToolProviderDeletePayload,
    ApiToolSchemaPayload,
    ApiToolTestPayload,
    WorkflowToolCreatePayload,
    WorkflowToolUpdatePayload,
    WorkflowToolDeletePayload,
    BuiltinProviderDefaultCredentialPayload,
    ToolOAuthCustomClientPayload,
    MCPProviderCreatePayload,
    MCPProviderUpdatePayload,
    MCPProviderDeletePayload,
    MCPAuthPayload,
)


@console_ns.route("/workspaces/current/tool-providers")
class ToolProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        raw_args = request.args.to_dict()
        query = ToolProviderListQuery.model_validate(raw_args)

        return ToolCommonService.list_tool_providers(user_id, tenant_id, query.type)  # type: ignore


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
    @console_ns.expect(console_ns.models[BuiltinToolCredentialDeletePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider):
        _, tenant_id = current_account_with_tenant()

        payload = BuiltinToolCredentialDeletePayload.model_validate(console_ns.payload or {})

        return BuiltinToolManageService.delete_builtin_tool_provider(
            tenant_id,
            provider,
            payload.credential_id,
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/add")
class ToolBuiltinProviderAddApi(Resource):
    @console_ns.expect(console_ns.models[BuiltinToolAddPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        payload = BuiltinToolAddPayload.model_validate(console_ns.payload or {})

        return BuiltinToolManageService.add_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credentials=payload.credentials,
            name=payload.name,
            api_type=CredentialType.of(payload.type),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/update")
class ToolBuiltinProviderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[BuiltinToolUpdatePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider):
        user, tenant_id = current_account_with_tenant()
        user_id = user.id

        payload = BuiltinToolUpdatePayload.model_validate(console_ns.payload or {})

        result = BuiltinToolManageService.update_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credential_id=payload.credential_id,
            credentials=payload.credentials,
            name=payload.name or "",
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
    @console_ns.expect(console_ns.models[ApiToolProviderAddPayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        payload = ApiToolProviderAddPayload.model_validate(console_ns.payload or {})

        return ApiToolManageService.create_api_tool_provider(
            user_id,
            tenant_id,
            payload.provider,
            payload.icon,
            payload.credentials,
            payload.schema_type,
            payload.schema_,
            payload.privacy_policy or "",
            payload.custom_disclaimer or "",
            payload.labels or [],
        )


@console_ns.route("/workspaces/current/tool-provider/api/remote")
class ToolApiProviderGetRemoteSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        raw_args = request.args.to_dict()
        query = UrlQuery.model_validate(raw_args)

        return ApiToolManageService.get_api_tool_provider_remote_schema(
            user_id,
            tenant_id,
            str(query.url),
        )


@console_ns.route("/workspaces/current/tool-provider/api/tools")
class ToolApiProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        raw_args = request.args.to_dict()
        query = ProviderQuery.model_validate(raw_args)

        return jsonable_encoder(
            ApiToolManageService.list_api_tool_provider_tools(
                user_id,
                tenant_id,
                query.provider,
            )
        )


@console_ns.route("/workspaces/current/tool-provider/api/update")
class ToolApiProviderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolProviderUpdatePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        payload = ApiToolProviderUpdatePayload.model_validate(console_ns.payload or {})

        return ApiToolManageService.update_api_tool_provider(
            user_id,
            tenant_id,
            payload.provider,
            payload.original_provider,
            payload.icon,
            payload.credentials,
            payload.schema_type,
            payload.schema_,
            payload.privacy_policy,
            payload.custom_disclaimer,
            payload.labels or [],
        )


@console_ns.route("/workspaces/current/tool-provider/api/delete")
class ToolApiProviderDeleteApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolProviderDeletePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        payload = ApiToolProviderDeletePayload.model_validate(console_ns.payload or {})

        return ApiToolManageService.delete_api_tool_provider(
            user_id,
            tenant_id,
            payload.provider,
        )


@console_ns.route("/workspaces/current/tool-provider/api/get")
class ToolApiProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        raw_args = request.args.to_dict()
        query = ProviderQuery.model_validate(raw_args)

        return ApiToolManageService.get_api_tool_provider(
            user_id,
            tenant_id,
            query.provider,
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
    @console_ns.expect(console_ns.models[ApiToolSchemaPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = ApiToolSchemaPayload.model_validate(console_ns.payload or {})

        return ApiToolManageService.parser_api_schema(
            schema=payload.schema_,
        )


@console_ns.route("/workspaces/current/tool-provider/api/test/pre")
class ToolApiProviderPreviousTestApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolTestPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = ApiToolTestPayload.model_validate(console_ns.payload or {})
        _, current_tenant_id = current_account_with_tenant()
        return ApiToolManageService.test_api_tool_preview(
            current_tenant_id,
            payload.provider_name or "",
            payload.tool_name,
            payload.credentials,
            payload.parameters,
            payload.schema_type,
            payload.schema_,
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/create")
class ToolWorkflowProviderCreateApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowToolCreatePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        payload = WorkflowToolCreatePayload.model_validate(console_ns.payload or {})

        return WorkflowToolManageService.create_workflow_tool(
            user_id=user_id,
            tenant_id=tenant_id,
            workflow_app_id=payload.workflow_app_id,
            name=payload.name,
            label=payload.label,
            icon=payload.icon,
            description=payload.description,
            parameters=payload.parameters,
            privacy_policy=payload.privacy_policy or "",
            labels=payload.labels or [],
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/update")
class ToolWorkflowProviderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowToolUpdatePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()
        user_id = user.id

        payload = WorkflowToolUpdatePayload.model_validate(console_ns.payload or {})

        return WorkflowToolManageService.update_workflow_tool(
            user_id,
            tenant_id,
            payload.workflow_tool_id,
            payload.name,
            payload.label,
            payload.icon,
            payload.description,
            payload.parameters,
            payload.privacy_policy or "",
            payload.labels or [],
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/delete")
class ToolWorkflowProviderDeleteApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowToolDeletePayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        payload = WorkflowToolDeletePayload.model_validate(console_ns.payload or {})

        return WorkflowToolManageService.delete_workflow_tool(
            user_id,
            tenant_id,
            payload.workflow_tool_id,
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/get")
class ToolWorkflowProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user, tenant_id = current_account_with_tenant()

        user_id = user.id

        raw_args = request.args.to_dict()
        query = WorkflowToolGetQuery.model_validate(raw_args)

        if query.workflow_tool_id:
            tool = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                user_id,
                tenant_id,
                query.workflow_tool_id,
            )
        elif query.workflow_app_id:
            tool = WorkflowToolManageService.get_workflow_tool_by_app_id(
                user_id,
                tenant_id,
                query.workflow_app_id,
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

        raw_args = request.args.to_dict()
        query = WorkflowToolListQuery.model_validate(raw_args)

        return jsonable_encoder(
            WorkflowToolManageService.list_single_workflow_tools(
                user_id,
                tenant_id,
                query.workflow_tool_id,
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
    @is_admin_or_owner_required
    @account_initialization_required
    def get(self, provider):
        tool_provider = ToolProviderID(provider)
        plugin_id = tool_provider.plugin_id
        provider_name = tool_provider.provider_name

        user, tenant_id = current_account_with_tenant()

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
    @console_ns.expect(console_ns.models[BuiltinProviderDefaultCredentialPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        current_user, current_tenant_id = current_account_with_tenant()
        payload = BuiltinProviderDefaultCredentialPayload.model_validate(console_ns.payload or {})
        return BuiltinToolManageService.set_default_provider(
            tenant_id=current_tenant_id, user_id=current_user.id, provider=provider, id=payload.id
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client")
class ToolOAuthCustomClient(Resource):
    @console_ns.expect(console_ns.models[ToolOAuthCustomClientPayload.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        payload = ToolOAuthCustomClientPayload.model_validate(console_ns.payload or {})

        _, tenant_id = current_account_with_tenant()

        return BuiltinToolManageService.save_custom_oauth_client_params(
            tenant_id=tenant_id,
            provider=provider,
            client_params=payload.client_params or {},
            enable_oauth_custom_client=payload.enable_oauth_custom_client
            if payload.enable_oauth_custom_client is not None
            else True,
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
    @console_ns.expect(console_ns.models[MCPProviderCreatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = MCPProviderCreatePayload.model_validate(console_ns.payload or {})
        user, tenant_id = current_account_with_tenant()

        # Parse and validate models
        configuration = MCPConfiguration.model_validate(payload.configuration or {})
        authentication = MCPAuthentication.model_validate(payload.authentication) if payload.authentication else None

        # 1) Create provider in a short transaction (no network I/O inside)
        with session_factory.create_session() as session, session.begin():
            service = MCPToolManageService(session=session)
            result = service.create_provider(
                tenant_id=tenant_id,
                user_id=user.id,
                server_url=payload.server_url,
                name=payload.name,
                icon=payload.icon,
                icon_type=payload.icon_type,
                icon_background=payload.icon_background,
                server_identifier=payload.server_identifier,
                headers=payload.headers or {},
                configuration=configuration,
                authentication=authentication,
            )

        # 2) Try to fetch tools immediately after creation so they appear without a second save.
        #    Perform network I/O outside any DB session to avoid holding locks.
        try:
            reconnect = MCPToolManageService.reconnect_with_url(
                server_url=payload.server_url,
                headers=payload.headers or {},
                timeout=configuration.timeout,
                sse_read_timeout=configuration.sse_read_timeout,
            )
            # Update just-created provider with authed/tools in a new short transaction
            with session_factory.create_session() as session, session.begin():
                service = MCPToolManageService(session=session)
                db_provider = service.get_provider(provider_id=result.id, tenant_id=tenant_id)
                db_provider.authed = reconnect.authed
                db_provider.tools = reconnect.tools

                result = ToolTransformService.mcp_provider_to_user_provider(db_provider, for_list=True)
        except Exception:
            # Best-effort: if initial fetch fails (e.g., auth required), return created provider as-is
            logger.warning("Failed to fetch MCP tools after creation", exc_info=True)

        return jsonable_encoder(result)

    @console_ns.expect(console_ns.models[MCPProviderUpdatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def put(self):
        payload = MCPProviderUpdatePayload.model_validate(console_ns.payload or {})
        configuration = MCPConfiguration.model_validate(payload.configuration or {})
        authentication = MCPAuthentication.model_validate(payload.authentication) if payload.authentication else None
        _, current_tenant_id = current_account_with_tenant()

        # Step 1: Get provider data for URL validation (short-lived session, no network I/O)
        validation_data = None
        with Session(db.engine) as session:
            service = MCPToolManageService(session=session)
            validation_data = service.get_provider_for_url_validation(
                tenant_id=current_tenant_id, provider_id=payload.provider_id
            )

        # Step 2: Perform URL validation with network I/O OUTSIDE of any database session
        # This prevents holding database locks during potentially slow network operations
        validation_result = MCPToolManageService.validate_server_url_standalone(
            tenant_id=current_tenant_id,
            new_server_url=payload.server_url,
            validation_data=validation_data,
        )

        # Step 3: Perform database update in a transaction
        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            service.update_provider(
                tenant_id=current_tenant_id,
                provider_id=payload.provider_id,
                server_url=payload.server_url,
                name=payload.name,
                icon=payload.icon,
                icon_type=payload.icon_type,
                icon_background=payload.icon_background,
                server_identifier=payload.server_identifier,
                headers=payload.headers or {},
                configuration=configuration,
                authentication=authentication,
                validation_result=validation_result,
            )

        return {"result": "success"}

    @console_ns.expect(console_ns.models[MCPProviderDeletePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self):
        payload = MCPProviderDeletePayload.model_validate(console_ns.payload or {})
        _, current_tenant_id = current_account_with_tenant()

        with Session(db.engine) as session, session.begin():
            service = MCPToolManageService(session=session)
            service.delete_provider(tenant_id=current_tenant_id, provider_id=payload.provider_id)

        return {"result": "success"}


@console_ns.route("/workspaces/current/tool-provider/mcp/auth")
class ToolMCPAuthApi(Resource):
    @console_ns.expect(console_ns.models[MCPAuthPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = MCPAuthPayload.model_validate(console_ns.payload or {})
        provider_id = payload.provider_id
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
                # Pass the extracted OAuth metadata hints to auth()
                auth_result = auth(
                    provider_entity,
                    payload.authorization_code,
                    resource_metadata_url=e.resource_metadata_url,
                    scope_hint=e.scope_hint,
                )
                with Session(db.engine) as session, session.begin():
                    service = MCPToolManageService(session=session)
                    response = service.execute_auth_actions(auth_result)
                    return response
            except MCPRefreshTokenError as e:
                with Session(db.engine) as session, session.begin():
                    service = MCPToolManageService(session=session)
                    service.clear_provider_credentials(provider_id=provider_id, tenant_id=tenant_id)
                raise ValueError(f"Failed to refresh token, please try to authorize again: {e}") from e
        except (MCPError, ValueError) as e:
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
        raw_args = request.args.to_dict()
        query = MCPCallbackQuery.model_validate(raw_args)
        state_key = query.state
        authorization_code = query.code

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
