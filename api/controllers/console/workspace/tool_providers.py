import io
import logging
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any, Literal, cast
from urllib.parse import urlparse

from flask import make_response, redirect, request, send_file
from flask_restx import Resource
from pydantic import (
    BaseModel,
    Field,
    HttpUrl,
    RootModel,
    field_validator,
    model_validator,
)
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    enterprise_license_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.db.session_factory import session_factory
from core.entities.mcp_provider import IdentityMode, MCPAuthentication, MCPConfiguration
from core.entities.provider_entities import ProviderConfig
from core.mcp.auth.auth_flow import auth, handle_callback
from core.mcp.error import MCPAuthError, MCPError, MCPRefreshTokenError
from core.mcp.mcp_client import MCPClient
from core.plugin.entities.plugin_daemon import CredentialType, PluginOAuthAuthorizationUrlResponse
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.api_entities import (
    ToolApiEntity,
    ToolProviderCredentialApiEntity,
    ToolProviderCredentialInfoApiEntity,
    ToolProviderTypeApiLiteral,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ApiProviderSchemaType,
    ToolLabel,
    ToolProviderType,
    WorkflowToolParameterConfiguration,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import alphanumeric, dump_response, uuid_value
from libs.login import login_required
from models import Account
from models.provider_ids import ToolProviderID

# from models.provider_ids import ToolProviderID
from services.plugin.oauth_service import OAuthProxyService
from services.tools.api_tools_manage_service import ApiToolManageService, ApiToolPreviewResult
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
    visibility: str | None = None


class BuiltinToolUpdatePayload(BaseModel):
    credential_id: str
    credentials: dict[str, Any] | None = None
    name: str | None = Field(default=None, max_length=30)


class ToolEmojiIcon(BaseModel):
    background: str
    content: str


class ApiToolProviderBasePayload(BaseModel):
    credentials: dict[str, Any]
    schema_type: ApiProviderSchemaType
    schema_: str = Field(alias="schema")
    provider: str
    icon: ToolEmojiIcon
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


class BuiltinCredentialListQuery(BaseModel):
    include_credential_ids: list[str] = Field(
        default_factory=list,
        description="Credential IDs to include even if visibility would hide them",
    )


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
    icon: ToolEmojiIcon
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
    configuration: MCPConfiguration | None = None
    headers: dict[str, str] | None = None
    authentication: MCPAuthentication | None = None
    # None means "leave unchanged" on update; the controller resolves it to a
    # concrete IdentityMode before calling the service (see _resolve_identity_mode).
    identity_mode: IdentityMode | None = None

    @field_validator("authentication", "configuration", mode="before")
    @classmethod
    def empty_to_none(cls, value: object) -> object:
        if value == {}:
            return None
        return value


def _resolve_identity_mode(requested: IdentityMode | None, *, current: IdentityMode) -> IdentityMode:
    """Resolve the effective MCP identity_mode for a create/update request.

    Keeps two API-layer concerns out of the service so the service always
    receives a concrete value:

    * ``None`` means "leave unchanged" (update semantics) — fall back to
      ``current`` (``IdentityMode.OFF`` for a brand-new provider).
    * Identity forwarding is an enterprise-only capability. On non-enterprise
      deployments any non-OFF value is coerced back to OFF so a persisted row
      can never imply forwarding that the runtime won't perform. This gates the
      API surface to match the backend gate in
      ``MCPTool._forwarding_requested`` — both the API and the backend
      invocation must be gated on ``dify_config.ENTERPRISE_ENABLED``.
    """
    mode = current if requested is None else requested
    if mode != IdentityMode.OFF and not dify_config.ENTERPRISE_ENABLED:
        return IdentityMode.OFF
    return mode


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


class ApiProviderDetailResponse(ResponseModel):
    schema_type: ApiProviderSchemaType
    schema_: str = Field(alias="schema")
    tools: list[ApiToolBundle]
    icon: ToolEmojiIcon
    description: str | None = None
    credentials: Mapping[str, object] = Field(default_factory=dict)
    privacy_policy: str | None = None
    custom_disclaimer: str | None = None
    labels: list[str] = Field(default_factory=list)


class ApiSchemaParseResponse(ResponseModel):
    schema_type: ApiProviderSchemaType
    parameters_schema: list[ApiToolBundle]
    credentials_schema: list[ProviderConfig]
    warning: dict[str, str]


class ApiProviderRemoteSchemaResponse(ResponseModel):
    schema_: str = Field(alias="schema")


class ApiToolPreviewResponse(RootModel[ApiToolPreviewResult]):
    pass


class BuiltinProviderOAuthClientSchemaResponse(ResponseModel):
    schema_: list[ProviderConfig] = Field(alias="schema")
    is_oauth_custom_client_enabled: bool
    is_system_oauth_params_exists: bool
    client_params: Mapping[str, object] | None = None
    redirect_uri: str


class MCPAuthResponse(ResponseModel):
    result: Literal["success"] | None = None
    authorization_url: str | None = None


class ToolApiListResponse(RootModel[list[ToolApiEntity]]):
    pass


# TODO: This duplicates core.tools.entities.api_entities.ToolProviderApiEntity's
# public response projection. Consolidate the core entity and controller response
# shape when the tool-provider API serialization boundary is cleaned up.
class ToolProviderApiEntityResponse(ResponseModel):
    id: str
    author: str
    name: str
    description: I18nObject
    icon: str | Mapping[str, str]
    icon_dark: str | Mapping[str, str] = ""
    label: I18nObject
    type: ToolProviderType
    team_credentials: Mapping[str, object] = Field(default_factory=dict)
    is_team_authorization: bool = False
    allow_delete: bool = True
    plugin_id: str | None = Field(default="", description="The plugin id of the tool")
    plugin_unique_identifier: str | None = Field(default="", description="The unique identifier of the tool")
    tools: list[ToolApiEntity] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    server_url: str | None = Field(default="", description="The server url of the tool")
    updated_at: int = Field(default_factory=lambda: int(datetime.now().timestamp()))
    server_identifier: str | None = Field(default="", description="The server identifier of the MCP tool")
    masked_headers: dict[str, str] | None = Field(default=None, description="The masked headers of the MCP tool")
    original_headers: dict[str, str] | None = Field(default=None, description="The original headers of the MCP tool")
    authentication: MCPAuthentication | None = Field(default=None, description="The OAuth config of the MCP tool")
    is_dynamic_registration: bool = Field(default=True, description="Whether the MCP tool is dynamically registered")
    configuration: MCPConfiguration | None = Field(
        default=None, description="The timeout and sse_read_timeout of the MCP tool"
    )
    identity_mode: str = Field(default="off", description="Identity-forwarding mechanism: 'off' or 'idp_token'")
    workflow_app_id: str | None = Field(default=None, description="The app id of the workflow tool")

    @field_validator("tools", mode="before")
    @classmethod
    def convert_none_to_empty_list(cls, value: list[ToolApiEntity] | None) -> list[ToolApiEntity]:
        return value if value is not None else []


class ToolProviderListResponse(RootModel[list[ToolProviderApiEntityResponse]]):
    pass


def _dump_tool_provider_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return ToolProviderApiEntityResponse.model_validate(payload).model_dump(mode="json", exclude_unset=True)


def _dump_tool_provider_payload_list(payloads: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [_dump_tool_provider_payload(payload) for payload in payloads]


class ToolProviderCredentialListResponse(RootModel[list[ToolProviderCredentialApiEntity]]):
    pass


class ProviderConfigListResponse(RootModel[list[ProviderConfig]]):
    pass


class ToolLabelListResponse(RootModel[list[ToolLabel]]):
    pass


class WorkflowToolDetailResponse(ResponseModel):
    name: str
    label: str
    workflow_tool_id: str
    workflow_app_id: str
    icon: ToolEmojiIcon
    description: str
    parameters: list[WorkflowToolParameterConfiguration]
    output_schema: Mapping[str, object] = Field(default_factory=dict)
    tool: ToolApiEntity
    synced: bool
    privacy_policy: str | None = None


register_schema_models(
    console_ns,
    ToolProviderListQuery,
    UrlQuery,
    ProviderQuery,
    BuiltinCredentialListQuery,
    WorkflowToolGetQuery,
    WorkflowToolListQuery,
    MCPCallbackQuery,
    ToolEmojiIcon,
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
register_response_schema_models(
    console_ns,
    SimpleResultResponse,
    ApiProviderDetailResponse,
    ApiSchemaParseResponse,
    ApiProviderRemoteSchemaResponse,
    ApiToolPreviewResponse,
    BuiltinProviderOAuthClientSchemaResponse,
    ToolApiListResponse,
    ToolProviderApiEntityResponse,
    ToolProviderCredentialInfoApiEntity,
    ToolProviderCredentialListResponse,
    ToolProviderListResponse,
    ProviderConfigListResponse,
    PluginOAuthAuthorizationUrlResponse,
    ToolLabelListResponse,
    MCPAuthResponse,
    WorkflowToolDetailResponse,
)


@console_ns.route("/workspaces/current/tool-providers")
class ToolProviderListApi(Resource):
    @console_ns.doc(params=query_params_from_model(ToolProviderListQuery))
    @console_ns.response(
        200, "Tool providers retrieved successfully", console_ns.models[ToolProviderListResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        query = query_params_from_request(ToolProviderListQuery)

        return _dump_tool_provider_payload_list(
            ToolCommonService.list_tool_providers(
                user.id, tenant_id, cast(ToolProviderTypeApiLiteral | None, query.type)
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/tools")
class ToolBuiltinProviderListToolsApi(Resource):
    @console_ns.response(
        200,
        "Builtin provider tools retrieved successfully",
        console_ns.models[ToolApiListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):

        return dump_response(
            ToolApiListResponse,
            BuiltinToolManageService.list_builtin_tool_provider_tools(
                tenant_id,
                provider,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/info")
class ToolBuiltinProviderInfoApi(Resource):
    @console_ns.response(
        200,
        "Builtin provider info retrieved successfully",
        console_ns.models[ToolProviderApiEntityResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):

        return _dump_tool_provider_payload(
            BuiltinToolManageService.get_builtin_tool_provider_info(tenant_id, provider).to_dict()
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/delete")
class ToolBuiltinProviderDeleteApi(Resource):
    @console_ns.expect(console_ns.models[BuiltinToolCredentialDeletePayload.__name__])
    @console_ns.response(
        200,
        "Builtin provider credential deleted successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):

        payload = BuiltinToolCredentialDeletePayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            BuiltinToolManageService.delete_builtin_tool_provider(
                tenant_id,
                provider,
                payload.credential_id,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/add")
class ToolBuiltinProviderAddApi(Resource):
    @console_ns.expect(console_ns.models[BuiltinToolAddPayload.__name__])
    @console_ns.response(
        200,
        "Builtin provider added successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account, provider: str):
        payload = BuiltinToolAddPayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            BuiltinToolManageService.add_builtin_tool_provider(
                user_id=user.id,
                tenant_id=tenant_id,
                provider=provider,
                credentials=payload.credentials,
                name=payload.name,
                api_type=CredentialType.of(payload.type),
                visibility=payload.visibility,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/update")
class ToolBuiltinProviderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[BuiltinToolUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Builtin provider updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account, provider: str):
        payload = BuiltinToolUpdatePayload.model_validate(console_ns.payload or {})

        result = BuiltinToolManageService.update_builtin_tool_provider(
            user_id=user.id,
            tenant_id=tenant_id,
            provider=provider,
            credential_id=payload.credential_id,
            credentials=payload.credentials,
            name=payload.name or "",
        )
        return dump_response(SimpleResultResponse, result)


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/credentials")
class ToolBuiltinProviderGetCredentialsApi(Resource):
    @console_ns.doc(params=query_params_from_model(BuiltinCredentialListQuery))
    @console_ns.response(
        200,
        "Builtin provider credentials retrieved successfully",
        console_ns.models[ToolProviderCredentialListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str):
        # Optional list of credential IDs to include even if visibility would hide them
        # (used when a workflow/agent node still references another member's only_me credential).
        query = query_params_from_request(
            BuiltinCredentialListQuery,
            list_fields=("include_credential_ids",),
        )

        return dump_response(
            ToolProviderCredentialListResponse,
            BuiltinToolManageService.get_builtin_tool_provider_credentials(
                tenant_id=tenant_id,
                provider_name=provider,
                session=db.session(),
                user=user,
                include_credential_ids=query.include_credential_ids or None,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/icon")
class ToolBuiltinProviderIconApi(Resource):
    @console_ns.response(200, "Builtin provider icon")
    @setup_required
    def get(self, provider: str):
        icon_bytes, mimetype = BuiltinToolManageService.get_builtin_tool_provider_icon(provider)
        icon_cache_max_age = dify_config.TOOL_ICON_CACHE_MAX_AGE
        # response-contract:ignore binary send_file response
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)


@console_ns.route("/workspaces/current/tool-provider/api/add")
class ToolApiProviderAddApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolProviderAddPayload.__name__])
    @console_ns.response(200, "API provider added successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.TOOL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = ApiToolProviderAddPayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            ApiToolManageService.create_api_tool_provider(
                user.id,
                tenant_id,
                payload.provider,
                payload.icon.model_dump(mode="json"),
                payload.credentials,
                payload.schema_type,
                payload.schema_,
                payload.privacy_policy or "",
                payload.custom_disclaimer or "",
                payload.labels or [],
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/api/remote")
class ToolApiProviderGetRemoteSchemaApi(Resource):
    @console_ns.doc(params=query_params_from_model(UrlQuery))
    @console_ns.response(
        200,
        "Remote API provider schema retrieved successfully",
        console_ns.models[ApiProviderRemoteSchemaResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        query = query_params_from_request(UrlQuery)

        return dump_response(
            ApiProviderRemoteSchemaResponse,
            ApiToolManageService.get_api_tool_provider_remote_schema(
                user.id,
                tenant_id,
                str(query.url),
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/api/tools")
class ToolApiProviderListToolsApi(Resource):
    @console_ns.doc(params=query_params_from_model(ProviderQuery))
    @console_ns.response(
        200, "API provider tools retrieved successfully", console_ns.models[ToolApiListResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        query = query_params_from_request(ProviderQuery)

        return dump_response(
            ToolApiListResponse,
            ApiToolManageService.list_api_tool_provider_tools(
                user.id,
                tenant_id,
                query.provider,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/api/update")
class ToolApiProviderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolProviderUpdatePayload.__name__])
    @console_ns.response(200, "API provider updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.TOOL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = ApiToolProviderUpdatePayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            ApiToolManageService.update_api_tool_provider(
                user.id,
                tenant_id,
                payload.provider,
                payload.original_provider,
                payload.icon.model_dump(mode="json"),
                payload.credentials,
                payload.schema_type,
                payload.schema_,
                payload.privacy_policy,
                payload.custom_disclaimer,
                payload.labels or [],
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/api/delete")
class ToolApiProviderDeleteApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolProviderDeletePayload.__name__])
    @console_ns.response(200, "API provider deleted successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.TOOL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = ApiToolProviderDeletePayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            ApiToolManageService.delete_api_tool_provider(
                user.id,
                tenant_id,
                payload.provider,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/api/get")
class ToolApiProviderGetApi(Resource):
    @console_ns.doc(params=query_params_from_model(ProviderQuery))
    @console_ns.response(
        200, "API provider retrieved successfully", console_ns.models[ApiProviderDetailResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        query = query_params_from_request(ProviderQuery)

        return dump_response(
            ApiProviderDetailResponse,
            ApiToolManageService.get_api_tool_provider(
                user.id,
                tenant_id,
                query.provider,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/credential/schema/<path:credential_type>")
class ToolBuiltinProviderCredentialsSchemaApi(Resource):
    @console_ns.response(
        200,
        "Builtin provider credential schema retrieved successfully",
        console_ns.models[ProviderConfigListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider, credential_type):

        return dump_response(
            ProviderConfigListResponse,
            BuiltinToolManageService.list_builtin_provider_credentials_schema(
                provider, CredentialType.of(credential_type), tenant_id
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/api/schema")
class ToolApiProviderSchemaApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolSchemaPayload.__name__])
    @console_ns.response(200, "API schema parsed successfully", console_ns.models[ApiSchemaParseResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = ApiToolSchemaPayload.model_validate(console_ns.payload or {})

        return dump_response(ApiSchemaParseResponse, ApiToolManageService.parser_api_schema(schema=payload.schema_))


@console_ns.route("/workspaces/current/tool-provider/api/test/pre")
class ToolApiProviderPreviousTestApi(Resource):
    @console_ns.expect(console_ns.models[ApiToolTestPayload.__name__])
    @console_ns.response(
        200,
        "API tool test preview completed successfully",
        console_ns.models[ApiToolPreviewResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        payload = ApiToolTestPayload.model_validate(console_ns.payload or {})
        return dump_response(
            ApiToolPreviewResponse,
            ApiToolManageService.test_api_tool_preview(
                current_tenant_id,
                payload.provider_name or "",
                payload.tool_name,
                payload.credentials,
                payload.parameters,
                payload.schema_type,
                payload.schema_,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/create")
class ToolWorkflowProviderCreateApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowToolCreatePayload.__name__])
    @console_ns.response(200, "Workflow tool created successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.TOOL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = WorkflowToolCreatePayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            WorkflowToolManageService.create_workflow_tool(
                user_id=user.id,
                tenant_id=tenant_id,
                workflow_app_id=payload.workflow_app_id,
                name=payload.name,
                label=payload.label,
                icon=payload.icon.model_dump(mode="json"),
                description=payload.description,
                parameters=payload.parameters,
                privacy_policy=payload.privacy_policy or "",
                labels=payload.labels or [],
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/update")
class ToolWorkflowProviderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowToolUpdatePayload.__name__])
    @console_ns.response(200, "Workflow tool updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.TOOL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = WorkflowToolUpdatePayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            WorkflowToolManageService.update_workflow_tool(
                user.id,
                tenant_id,
                payload.workflow_tool_id,
                payload.name,
                payload.label,
                payload.icon.model_dump(mode="json"),
                payload.description,
                payload.parameters,
                payload.privacy_policy or "",
                payload.labels or [],
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/delete")
class ToolWorkflowProviderDeleteApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowToolDeletePayload.__name__])
    @console_ns.response(200, "Workflow tool deleted successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.TOOL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = WorkflowToolDeletePayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            WorkflowToolManageService.delete_workflow_tool(
                user.id,
                tenant_id,
                payload.workflow_tool_id,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/workflow/get")
class ToolWorkflowProviderGetApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkflowToolGetQuery))
    @console_ns.response(
        200, "Workflow tool retrieved successfully", console_ns.models[WorkflowToolDetailResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        query = query_params_from_request(WorkflowToolGetQuery)

        if query.workflow_tool_id:
            tool = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                user.id,
                tenant_id,
                query.workflow_tool_id,
            )
        elif query.workflow_app_id:
            tool = WorkflowToolManageService.get_workflow_tool_by_app_id(
                user.id,
                tenant_id,
                query.workflow_app_id,
            )
        else:
            raise ValueError("incorrect workflow_tool_id or workflow_app_id")

        return dump_response(WorkflowToolDetailResponse, tool)


@console_ns.route("/workspaces/current/tool-provider/workflow/tools")
class ToolWorkflowProviderListToolApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkflowToolListQuery))
    @console_ns.response(
        200, "Workflow provider tools retrieved successfully", console_ns.models[ToolApiListResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        query = query_params_from_request(WorkflowToolListQuery)

        return dump_response(
            ToolApiListResponse,
            WorkflowToolManageService.list_single_workflow_tools(
                user.id,
                tenant_id,
                query.workflow_tool_id,
            ),
        )


@console_ns.route("/workspaces/current/tools/builtin")
class ToolBuiltinListApi(Resource):
    @console_ns.response(
        200, "Builtin tools retrieved successfully", console_ns.models[ToolProviderListResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        return _dump_tool_provider_payload_list(
            [
                provider.to_dict()
                for provider in BuiltinToolManageService.list_builtin_tools(
                    user.id,
                    tenant_id,
                )
            ],
        )


@console_ns.route("/workspaces/current/tools/api")
class ToolApiListApi(Resource):
    @console_ns.response(200, "API tools retrieved successfully", console_ns.models[ToolProviderListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):

        return _dump_tool_provider_payload_list(
            [
                provider.to_dict()
                for provider in ApiToolManageService.list_api_tools(
                    tenant_id,
                )
            ],
        )


@console_ns.route("/workspaces/current/tools/workflow")
class ToolWorkflowListApi(Resource):
    @console_ns.response(
        200, "Workflow tools retrieved successfully", console_ns.models[ToolProviderListResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account):
        return _dump_tool_provider_payload_list(
            [
                provider.to_dict()
                for provider in WorkflowToolManageService.list_tenant_workflow_tools(
                    user.id,
                    tenant_id,
                )
            ],
        )


@console_ns.route("/workspaces/current/tool-labels")
class ToolLabelsApi(Resource):
    @console_ns.response(200, "Tool labels retrieved successfully", console_ns.models[ToolLabelListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        return dump_response(ToolLabelListResponse, ToolLabelsService.list_tool_labels())


@console_ns.route("/oauth/plugin/<path:provider>/tool/authorization-url")
class ToolPluginOAuthApi(Resource):
    @console_ns.response(
        200,
        "Tool OAuth authorization URL generated successfully",
        console_ns.models[PluginOAuthAuthorizationUrlResponse.__name__],
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str):
        tool_provider = ToolProviderID(provider)
        plugin_id = tool_provider.plugin_id
        provider_name = tool_provider.provider_name

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
        # response-contract:ignore cookie-bearing Flask response
        response = make_response(dump_response(PluginOAuthAuthorizationUrlResponse, authorization_url_response))
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
    @console_ns.response(302, "Redirect to OAuth callback page")
    @setup_required
    def get(self, provider: str):
        context_id = request.cookies.get("context_id")
        if not context_id:
            raise Forbidden("context_id not found")

        context = OAuthProxyService.use_proxy_context(context_id)
        if context is None:
            raise Forbidden("Invalid context_id")

        tool_provider = ToolProviderID(provider)
        plugin_id = tool_provider.plugin_id
        provider_name = tool_provider.provider_name
        user_id: str = context["user_id"]
        tenant_id: str = context["tenant_id"]

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

        # add credentials to database — OAuth tokens default to only_me since they're personal
        BuiltinToolManageService.add_builtin_tool_provider(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=provider,
            credentials=dict(credentials),
            expires_at=expires_at,
            api_type=CredentialType.OAUTH2,
            visibility="only_me",
        )
        # response-contract:ignore redirect response
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/default-credential")
class ToolBuiltinProviderSetDefaultApi(Resource):
    @console_ns.expect(console_ns.models[BuiltinProviderDefaultCredentialPayload.__name__])
    @console_ns.response(200, "Default credential set successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_USE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider: str):
        payload = BuiltinProviderDefaultCredentialPayload.model_validate(console_ns.payload or {})
        return dump_response(
            SimpleResultResponse,
            BuiltinToolManageService.set_default_provider(
                tenant_id=current_tenant_id, provider=provider, id=payload.id
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client")
class ToolOAuthCustomClient(Resource):
    @console_ns.expect(console_ns.models[ToolOAuthCustomClientPayload.__name__])
    @console_ns.response(
        200, "Custom OAuth client saved successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):
        payload = ToolOAuthCustomClientPayload.model_validate(console_ns.payload or {})

        return dump_response(
            SimpleResultResponse,
            BuiltinToolManageService.save_custom_oauth_client_params(
                tenant_id=tenant_id,
                provider=provider,
                client_params=payload.client_params or {},
                enable_oauth_custom_client=payload.enable_oauth_custom_client
                if payload.enable_oauth_custom_client is not None
                else True,
            ),
        )

    @console_ns.response(
        200,
        "Custom OAuth client retrieved successfully",
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, provider: str):
        return BuiltinToolManageService.get_custom_oauth_client_params(tenant_id=current_tenant_id, provider=provider)

    @console_ns.response(
        200, "Custom OAuth client deleted successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, provider: str):
        return dump_response(
            SimpleResultResponse,
            BuiltinToolManageService.delete_custom_oauth_client_params(tenant_id=current_tenant_id, provider=provider),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/oauth/client-schema")
class ToolBuiltinProviderGetOauthClientSchemaApi(Resource):
    @console_ns.response(
        200,
        "Builtin provider OAuth client schema retrieved successfully",
        console_ns.models[BuiltinProviderOAuthClientSchemaResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, provider: str):
        return dump_response(
            BuiltinProviderOAuthClientSchemaResponse,
            BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema(
                tenant_id=current_tenant_id, provider_name=provider
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/builtin/<path:provider>/credential/info")
class ToolBuiltinProviderGetCredentialInfoApi(Resource):
    @console_ns.doc(params=query_params_from_model(BuiltinCredentialListQuery))
    @console_ns.response(
        200,
        "Builtin provider credential info retrieved successfully",
        console_ns.models[ToolProviderCredentialInfoApiEntity.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str):
        query = query_params_from_request(
            BuiltinCredentialListQuery,
            list_fields=("include_credential_ids",),
        )

        return dump_response(
            ToolProviderCredentialInfoApiEntity,
            BuiltinToolManageService.get_builtin_tool_provider_credential_info(
                tenant_id=tenant_id,
                provider=provider,
                session=db.session(),
                user=user,
                include_credential_ids=query.include_credential_ids or None,
            ),
        )


@console_ns.route("/workspaces/current/tool-provider/mcp")
class ToolProviderMCPApi(Resource):
    @console_ns.expect(console_ns.models[MCPProviderCreatePayload.__name__])
    @console_ns.response(
        200, "MCP provider created successfully", console_ns.models[ToolProviderApiEntityResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.MCP_MANAGE, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account):
        payload = MCPProviderCreatePayload.model_validate(console_ns.payload or {})

        configuration = payload.configuration or MCPConfiguration()
        authentication = payload.authentication

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
                identity_mode=_resolve_identity_mode(payload.identity_mode, current=IdentityMode.OFF),
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

        return _dump_tool_provider_payload(result.to_dict())

    @console_ns.expect(console_ns.models[MCPProviderUpdatePayload.__name__])
    @console_ns.response(200, "MCP provider updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.MCP_MANAGE, resource_required=False)
    @with_current_tenant_id
    def put(self, current_tenant_id: str):
        payload = MCPProviderUpdatePayload.model_validate(console_ns.payload or {})
        configuration = payload.configuration or MCPConfiguration()
        authentication = payload.authentication

        # Step 1: Get provider data for URL validation (short-lived session, no network I/O)
        validation_data = None
        with sessionmaker(db.engine).begin() as session:
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
        with sessionmaker(db.engine).begin() as session:
            service = MCPToolManageService(session=session)
            # Resolve "leave unchanged" (None) against the stored value, and gate
            # the result on ENTERPRISE_ENABLED — both are API-layer concerns, so
            # the service receives a concrete IdentityMode.
            existing = service.get_provider(provider_id=payload.provider_id, tenant_id=current_tenant_id)
            identity_mode = _resolve_identity_mode(payload.identity_mode, current=IdentityMode(existing.identity_mode))
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
                identity_mode=identity_mode,
            )

        return SimpleResultResponse(result="success").model_dump(mode="json")

    @console_ns.expect(console_ns.models[MCPProviderDeletePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.MCP_MANAGE, resource_required=False)
    @with_current_tenant_id
    def delete(self, current_tenant_id: str):
        payload = MCPProviderDeletePayload.model_validate(console_ns.payload or {})

        with sessionmaker(db.engine).begin() as session:
            service = MCPToolManageService(session=session)
            service.delete_provider(tenant_id=current_tenant_id, provider_id=payload.provider_id)

        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/workspaces/current/tool-provider/mcp/auth")
class ToolMCPAuthApi(Resource):
    @console_ns.expect(console_ns.models[MCPAuthPayload.__name__])
    @console_ns.response(200, "MCP provider authorized successfully", console_ns.models[MCPAuthResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.MCP_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        payload = MCPAuthPayload.model_validate(console_ns.payload or {})
        provider_id = payload.provider_id

        with sessionmaker(db.engine).begin() as session:
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
                with sessionmaker(db.engine).begin() as session:
                    service = MCPToolManageService(session=session)
                    service.update_provider_credentials(
                        provider_id=provider_id,
                        tenant_id=tenant_id,
                        credentials=provider_entity.credentials,
                        authed=True,
                    )
                    return MCPAuthResponse(result="success").model_dump(mode="json")
        except MCPAuthError as e:
            try:
                # Pass the extracted OAuth metadata hints to auth()
                auth_result = auth(
                    provider_entity,
                    payload.authorization_code,
                    resource_metadata_url=e.resource_metadata_url,
                    scope_hint=e.scope_hint,
                )
                with sessionmaker(db.engine).begin() as session:
                    service = MCPToolManageService(session=session)
                    response = service.execute_auth_actions(auth_result)
                    return dump_response(MCPAuthResponse, response)
            except MCPRefreshTokenError as e:
                with sessionmaker(db.engine).begin() as session:
                    service = MCPToolManageService(session=session)
                    service.clear_provider_credentials(provider_id=provider_id, tenant_id=tenant_id)
                raise ValueError(f"Failed to refresh token, please try to authorize again: {e}") from e
        except (MCPError, ValueError) as e:
            with sessionmaker(db.engine).begin() as session:
                service = MCPToolManageService(session=session)
                service.clear_provider_credentials(provider_id=provider_id, tenant_id=tenant_id)
            parsed = urlparse(server_url)
            sanitized_url = f"{parsed.scheme}://{parsed.hostname}{parsed.path}"
            logger.warning(
                "MCP authorization failed for provider %s (url=%s)",
                provider_id,
                sanitized_url,
                exc_info=True,
            )
            raise ValueError(f"Failed to connect to MCP server: {e}") from e


@console_ns.route("/workspaces/current/tool-provider/mcp/tools/<path:provider_id>")
class ToolMCPDetailApi(Resource):
    @console_ns.response(
        200, "MCP provider retrieved successfully", console_ns.models[ToolProviderApiEntityResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider_id: str):
        with sessionmaker(db.engine).begin() as session:
            service = MCPToolManageService(session=session)
            provider = service.get_provider(provider_id=provider_id, tenant_id=tenant_id)
            return _dump_tool_provider_payload(
                ToolTransformService.mcp_provider_to_user_provider(provider, for_list=True).to_dict()
            )


@console_ns.route("/workspaces/current/tools/mcp")
class ToolMCPListAllApi(Resource):
    @console_ns.response(200, "MCP tools retrieved successfully", console_ns.models[ToolProviderListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):

        with sessionmaker(db.engine).begin() as session:
            service = MCPToolManageService(session=session)
            # Skip sensitive data decryption for list view to improve performance
            tools = service.list_providers(tenant_id=tenant_id, include_sensitive=False)

            return _dump_tool_provider_payload_list([tool.to_dict() for tool in tools])


@console_ns.route("/workspaces/current/tool-provider/mcp/update/<path:provider_id>")
class ToolMCPUpdateApi(Resource):
    @console_ns.response(
        200, "MCP provider tools refreshed successfully", console_ns.models[ToolProviderApiEntityResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.MCP_MANAGE, resource_required=False)
    @with_current_tenant_id
    def get(self, tenant_id: str, provider_id: str):
        with sessionmaker(db.engine).begin() as session:
            service = MCPToolManageService(session=session)
            tools = service.list_provider_tools(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )
            return _dump_tool_provider_payload(tools.to_dict())


@console_ns.route("/mcp/oauth/callback")
class ToolMCPCallbackApi(Resource):
    @console_ns.doc(params=query_params_from_model(MCPCallbackQuery))
    @console_ns.response(302, "Redirect to OAuth callback page")
    def get(self):
        query = query_params_from_request(MCPCallbackQuery)
        state_key = query.state
        authorization_code = query.code

        # Create service instance for handle_callback
        with sessionmaker(db.engine).begin() as session:
            mcp_service = MCPToolManageService(session=session)
            # handle_callback now returns state data and tokens
            state_data, tokens = handle_callback(state_key, authorization_code)
            # Save tokens using the service layer
            mcp_service.save_oauth_data(
                state_data.provider_id, state_data.tenant_id, tokens.model_dump(), OAuthDataType.TOKENS
            )

        # response-contract:ignore redirect response
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")
