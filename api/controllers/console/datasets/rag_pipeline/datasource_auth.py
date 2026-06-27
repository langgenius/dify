from typing import Any

from flask import make_response, redirect, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import PluginOAuthAuthorizationUrlResponse
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.common_entities import I18nObject
from fields.base import ResponseModel
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from models.provider_ids import DatasourceProviderID
from services.datasource_provider_service import DatasourceProviderService
from services.plugin.oauth_service import OAuthProxyService


class DatasourceCredentialPayload(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    credentials: dict[str, Any] = Field(
        description="Plugin-defined credential parameters. The schema is declared by the datasource provider."
    )


class DatasourceCredentialDeletePayload(BaseModel):
    credential_id: str


class DatasourceCredentialUpdatePayload(BaseModel):
    credential_id: str
    name: str | None = Field(default=None, max_length=100)
    credentials: dict[str, Any] | None = Field(
        default=None,
        description="Plugin-defined credential parameters. The schema is declared by the datasource provider.",
    )


class DatasourceCustomClientPayload(BaseModel):
    client_params: dict[str, Any] | None = Field(
        default=None,
        description="Plugin-defined OAuth client parameters. The schema is declared by the datasource provider.",
    )
    enable_oauth_custom_client: bool | None = None


class DatasourceDefaultPayload(BaseModel):
    id: str


class DatasourceUpdateNamePayload(BaseModel):
    credential_id: str
    name: str = Field(max_length=100)


class DatasourceOAuthAuthorizationQuery(BaseModel):
    credential_id: str | None = Field(default=None, description="Credential ID to reauthorize")


class DatasourceOAuthCallbackQuery(BaseModel):
    code: str | None = Field(default=None, description="Authorization code from OAuth provider")
    state: str | None = Field(default=None, description="OAuth state parameter")
    error: str | None = Field(default=None, description="Error message from OAuth provider")
    context_id: str | None = Field(default=None, description="OAuth proxy context ID")


class DatasourceCredentialResponse(ResponseModel):
    credential: dict[str, Any] = Field(
        description="Obfuscated plugin-defined credential parameters from the datasource provider."
    )
    type: str
    name: str
    avatar_url: str | None
    id: str
    is_default: bool


class DatasourceCredentialListResponse(ResponseModel):
    result: list[DatasourceCredentialResponse]


class DatasourceOAuthSchemaResponse(ResponseModel):
    client_schema: list[ProviderConfig]
    credentials_schema: list[ProviderConfig]
    oauth_custom_client_params: dict[str, Any] | None = Field(
        description="Masked plugin-defined OAuth client parameters, when configured for the tenant."
    )
    is_oauth_custom_client_enabled: bool
    is_system_oauth_params_exists: bool
    redirect_uri: str


class DatasourceProviderAuthResponse(ResponseModel):
    author: str
    provider: str
    plugin_id: str
    plugin_unique_identifier: str
    icon: str
    name: str
    label: I18nObject
    description: I18nObject
    credential_schema: list[ProviderConfig]
    oauth_schema: DatasourceOAuthSchemaResponse | None
    credentials_list: list[DatasourceCredentialResponse]


class DatasourceProviderAuthListResponse(ResponseModel):
    result: list[DatasourceProviderAuthResponse]


register_schema_models(
    console_ns,
    DatasourceOAuthAuthorizationQuery,
    DatasourceOAuthCallbackQuery,
    DatasourceCredentialPayload,
    DatasourceCredentialDeletePayload,
    DatasourceCredentialUpdatePayload,
    DatasourceCustomClientPayload,
    DatasourceDefaultPayload,
    DatasourceUpdateNamePayload,
)
register_response_schema_models(
    console_ns,
    DatasourceCredentialListResponse,
    DatasourceProviderAuthListResponse,
    PluginOAuthAuthorizationUrlResponse,
    SimpleResultResponse,
)


@console_ns.route("/oauth/plugin/<path:provider_id>/datasource/get-authorization-url")
class DatasourcePluginOAuthAuthorizationUrl(Resource):
    @console_ns.doc(params=query_params_from_model(DatasourceOAuthAuthorizationQuery))
    @console_ns.response(
        200,
        "Datasource OAuth authorization URL generated successfully",
        console_ns.models[PluginOAuthAuthorizationUrlResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account, provider_id: str):
        tenant_id = current_tenant_id
        credential_id = request.args.get("credential_id")
        datasource_provider_id = DatasourceProviderID(provider_id)
        provider_name = datasource_provider_id.provider_name
        plugin_id = datasource_provider_id.plugin_id
        oauth_config = DatasourceProviderService().get_oauth_client(
            tenant_id=tenant_id,
            datasource_provider_id=datasource_provider_id,
        )
        if not oauth_config:
            raise ValueError(f"No OAuth Client Config for {provider_id}")

        context_id = OAuthProxyService.create_proxy_context(
            user_id=current_user.id,
            tenant_id=tenant_id,
            plugin_id=plugin_id,
            provider=provider_name,
            credential_id=credential_id,
        )
        oauth_handler = OAuthHandler()
        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/datasource/callback"
        authorization_url_response = oauth_handler.get_authorization_url(
            tenant_id=tenant_id,
            user_id=current_user.id,
            plugin_id=plugin_id,
            provider=provider_name,
            redirect_uri=redirect_uri,
            system_credentials=oauth_config,
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


@console_ns.route("/oauth/plugin/<path:provider_id>/datasource/callback")
class DatasourceOAuthCallback(Resource):
    @console_ns.doc(params=query_params_from_model(DatasourceOAuthCallbackQuery))
    # response-contract:ignore redirect response
    @console_ns.response(302, "Redirect to OAuth callback page")
    @setup_required
    def get(self, provider_id: str):
        context_id = request.cookies.get("context_id") or request.args.get("context_id")
        if not context_id:
            raise Forbidden("context_id not found")

        context = OAuthProxyService.use_proxy_context(context_id)
        if context is None:
            raise Forbidden("Invalid context_id")

        user_id: str = context["user_id"]
        tenant_id: str = context["tenant_id"]
        datasource_provider_id = DatasourceProviderID(provider_id)
        plugin_id = datasource_provider_id.plugin_id
        datasource_provider_service = DatasourceProviderService()
        oauth_client_params = datasource_provider_service.get_oauth_client(
            tenant_id=tenant_id,
            datasource_provider_id=datasource_provider_id,
        )
        if not oauth_client_params:
            raise NotFound()
        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/datasource/callback"
        oauth_handler = OAuthHandler()
        oauth_response = oauth_handler.get_credentials(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=datasource_provider_id.provider_name,
            redirect_uri=redirect_uri,
            system_credentials=oauth_client_params,
            request=request,
        )
        credential_id: str | None = context.get("credential_id")
        if credential_id:
            datasource_provider_service.reauthorize_datasource_oauth_provider(
                tenant_id=tenant_id,
                provider_id=datasource_provider_id,
                avatar_url=oauth_response.metadata.get("avatar_url") or None,
                name=oauth_response.metadata.get("name") or None,
                expire_at=oauth_response.expires_at,
                credentials=dict(oauth_response.credentials),
                credential_id=credential_id,
            )
        else:
            datasource_provider_service.add_datasource_oauth_provider(
                tenant_id=tenant_id,
                provider_id=datasource_provider_id,
                avatar_url=oauth_response.metadata.get("avatar_url") or None,
                name=oauth_response.metadata.get("name") or None,
                expire_at=oauth_response.expires_at,
                credentials=dict(oauth_response.credentials),
            )
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


@console_ns.route("/auth/plugin/datasource/<path:provider_id>")
class DatasourceAuth(Resource):
    @console_ns.expect(console_ns.models[DatasourceCredentialPayload.__name__])
    @console_ns.response(
        200, "Datasource credential created successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_CREATE, resource_required=False)
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider_id: str):
        payload = DatasourceCredentialPayload.model_validate(console_ns.payload or {})
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()

        try:
            datasource_provider_service.add_datasource_api_key_provider(
                tenant_id=current_tenant_id,
                provider_id=datasource_provider_id,
                credentials=payload.credentials,
                name=payload.name,
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200

    @console_ns.response(
        200,
        "Datasource credentials retrieved successfully",
        console_ns.models[DatasourceCredentialListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, user: Account, provider_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()

        datasources = datasource_provider_service.list_datasource_credentials(
            tenant_id=current_tenant_id,
            provider=datasource_provider_id.provider_name,
            plugin_id=datasource_provider_id.plugin_id,
            user=user,
        )
        return dump_response(DatasourceCredentialListResponse, {"result": datasources}), 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/delete")
class DatasourceAuthDeleteApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceCredentialDeletePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        plugin_id = datasource_provider_id.plugin_id
        provider_name = datasource_provider_id.provider_name

        payload = DatasourceCredentialDeletePayload.model_validate(console_ns.payload or {})
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.remove_datasource_credentials(
            tenant_id=current_tenant_id,
            auth_id=payload.credential_id,
            provider=provider_name,
            plugin_id=plugin_id,
        )
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/update")
class DatasourceAuthUpdateApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceCredentialUpdatePayload.__name__])
    @console_ns.response(
        201, "Datasource credential updated successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        payload = DatasourceCredentialUpdatePayload.model_validate(console_ns.payload or {})

        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.update_datasource_credentials(
            tenant_id=current_tenant_id,
            auth_id=payload.credential_id,
            provider=datasource_provider_id.provider_name,
            plugin_id=datasource_provider_id.plugin_id,
            credentials=payload.credentials or {},
            name=payload.name,
        )
        return SimpleResultResponse(result="success").model_dump(mode="json"), 201


@console_ns.route("/auth/plugin/datasource/list")
class DatasourceAuthListApi(Resource):
    @console_ns.response(
        200,
        "Datasource credentials retrieved successfully",
        console_ns.models[DatasourceProviderAuthListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_all_datasource_credentials(tenant_id=current_tenant_id)
        return dump_response(DatasourceProviderAuthListResponse, {"result": datasources}), 200


@console_ns.route("/auth/plugin/datasource/default-list")
class DatasourceHardCodeAuthListApi(Resource):
    @console_ns.response(
        200,
        "Default datasource credentials retrieved successfully",
        console_ns.models[DatasourceProviderAuthListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_hard_code_datasource_credentials(tenant_id=current_tenant_id)
        return dump_response(DatasourceProviderAuthListResponse, {"result": datasources}), 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/custom-client")
class DatasourceAuthOauthCustomClient(Resource):
    @console_ns.expect(console_ns.models[DatasourceCustomClientPayload.__name__])
    @console_ns.response(
        200, "Datasource OAuth custom client saved successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider_id: str):
        payload = DatasourceCustomClientPayload.model_validate(console_ns.payload or {})
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.setup_oauth_custom_client_params(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            client_params=payload.client_params or {},
            enabled=payload.enable_oauth_custom_client or False,
        )
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, provider_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.remove_oauth_custom_client_params(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
        )
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/default")
class DatasourceAuthDefaultApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceDefaultPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider_id: str):
        payload = DatasourceDefaultPayload.model_validate(console_ns.payload or {})
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.set_default_datasource_provider(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            credential_id=payload.id,
        )
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/update-name")
class DatasourceUpdateProviderNameApi(Resource):
    @console_ns.expect(console_ns.models[DatasourceUpdateNamePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider_id: str):
        payload = DatasourceUpdateNamePayload.model_validate(console_ns.payload or {})
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.update_datasource_provider_name(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            name=payload.name,
            credential_id=payload.credential_id,
        )
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200
