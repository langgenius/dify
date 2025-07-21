from fastapi.encoders import jsonable_encoder
from flask import make_response, redirect, request
from flask_login import current_user  # type: ignore
from flask_restful import (  # type: ignore
    Resource,  # type: ignore
    reqparse,
)
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.entities.plugin import DatasourceProviderID
from core.plugin.impl.oauth import OAuthHandler
from extensions.ext_database import db
from libs.login import login_required
from models.oauth import DatasourceOauthParamConfig
from services.datasource_provider_service import DatasourceProviderService
from services.plugin.oauth_service import OAuthProxyService


class DatasourcePluginOAuthAuthorizationUrl(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id: str):
        user = current_user
        tenant_id = user.current_tenant_id
        if not current_user.is_editor:
            raise Forbidden()

        datasource_provider_id = DatasourceProviderID(provider_id)
        provider_name = datasource_provider_id.provider_name
        plugin_id = datasource_provider_id.plugin_id
        oauth_config = (
            db.session.query(DatasourceOauthParamConfig).filter_by(provider=provider_name, plugin_id=plugin_id).first()
        )
        if not oauth_config:
            raise ValueError(f"No OAuth Client Config for {provider_id}")

        context_id = OAuthProxyService.create_proxy_context(
            user_id=current_user.id, tenant_id=tenant_id, plugin_id=plugin_id, provider=provider_name
        )
        oauth_handler = OAuthHandler()
        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/datasource/callback"
        oauth_client_params = oauth_config.system_credentials

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


class DatasourceOAuthCallback(Resource):
    @setup_required
    def get(self, provider_id: str):
        context_id = request.cookies.get("context_id") or request.args.get("context_id")
        if not context_id:
            raise Forbidden("context_id not found")

        context = OAuthProxyService.use_proxy_context(context_id)
        if context is None:
            raise Forbidden("Invalid context_id")

        user_id, tenant_id = context.get("user_id"), context.get("tenant_id")
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
        datasource_provider_service.add_datasource_oauth_provider(
            tenant_id=tenant_id,
            provider_id=datasource_provider_id,
            avatar_url=oauth_response.metadata.get("avatar_url") or None,
            name=oauth_response.metadata.get("name") or None,
            credentials=dict(oauth_response.credentials),
        )
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


class DatasourceAuth(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_id: str):
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=False, nullable=True, location="json", default=None)
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()

        try:
            datasource_provider_service.add_datasource_api_key_provider(
                tenant_id=current_user.current_tenant_id,
                provider_id=datasource_provider_id,
                credentials=args["credentials"],
                name=args["name"],
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_datasource_credentials(
            tenant_id=current_user.current_tenant_id,
            provider=datasource_provider_id.provider_name,
            plugin_id=datasource_provider_id.plugin_id,
        )
        return {"result": datasources}, 200


class DatasourceAuthUpdateDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider_id: str, auth_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        plugin_id = datasource_provider_id.plugin_id
        provider_name = datasource_provider_id.provider_name
        if not current_user.is_editor:
            raise Forbidden()
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.remove_datasource_credentials(
            tenant_id=current_user.current_tenant_id,
            auth_id=auth_id,
            provider=provider_name,
            plugin_id=plugin_id,
        )
        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider_id: str, auth_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        parser = reqparse.RequestParser()
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()
        if not current_user.is_editor:
            raise Forbidden()
        try:
            datasource_provider_service = DatasourceProviderService()
            datasource_provider_service.update_datasource_credentials(
                tenant_id=current_user.current_tenant_id,
                auth_id=auth_id,
                provider=datasource_provider_id.provider_name,
                plugin_id=datasource_provider_id.plugin_id,
                credentials=args["credentials"],
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}, 201


class DatasourceAuthListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_all_datasource_credentials(
            tenant_id=current_user.current_tenant_id
        )
        return {"result": datasources}, 200

class DatasourceAuthOauthCustomClient(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_id: str):
        if not current_user.is_editor:
            raise Forbidden()
        parser = reqparse.RequestParser()
        parser.add_argument("client_params", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("enabled", type=bool, required=False, nullable=True, location="json")
        args = parser.parse_args()
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()

        datasource_provider_service.setup_oauth_custom_client_params(
            tenant_id=current_user.current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            client_params=args.get("client_params", {}),
            enabled=args.get("enabled", False),
        )
        return {"result": "success"}, 200

api.add_resource(
    DatasourcePluginOAuthAuthorizationUrl,
    "/oauth/plugin/<path:provider_id>/datasource/get-authorization-url",
)
api.add_resource(
    DatasourceOAuthCallback,
    "/oauth/plugin/<path:provider_id>/datasource/callback",
)
api.add_resource(
    DatasourceAuth,
    "/auth/plugin/datasource/<path:provider_id>",
)

api.add_resource(
    DatasourceAuthUpdateDeleteApi,
    "/auth/plugin/datasource/<path:provider_id>/<string:auth_id>",
)

api.add_resource(
    DatasourceAuthListApi,
    "/auth/plugin/datasource/list",
)

api.add_resource(
    DatasourceAuthOauthCustomClient,
    "/auth/plugin/datasource/<path:provider_id>/custom-client",
)
