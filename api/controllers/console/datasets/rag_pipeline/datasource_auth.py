from flask import make_response, redirect, request
from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.impl.oauth import OAuthHandler
from libs.helper import StrLen
from libs.login import current_account_with_tenant, login_required
from models.provider_ids import DatasourceProviderID
from services.datasource_provider_service import DatasourceProviderService
from services.plugin.oauth_service import OAuthProxyService


@console_ns.route("/oauth/plugin/<path:provider_id>/datasource/get-authorization-url")
class DatasourcePluginOAuthAuthorizationUrl(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, provider_id: str):
        current_user, current_tenant_id = current_account_with_tenant()

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
        response = make_response(jsonable_encoder(authorization_url_response))
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
        credential_id = context.get("credential_id")
        if credential_id:
            datasource_provider_service.reauthorize_datasource_oauth_provider(
                tenant_id=tenant_id,
                provider_id=datasource_provider_id,
                avatar_url=oauth_response.metadata.get("avatar_url") or None,
                name=oauth_response.metadata.get("name") or None,
                expire_at=oauth_response.expires_at,
                credentials=dict(oauth_response.credentials),
                credential_id=context.get("credential_id"),
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
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "name", type=StrLen(max_length=100), required=False, nullable=True, location="json", default=None
            )
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()

        try:
            datasource_provider_service.add_datasource_api_key_provider(
                tenant_id=current_tenant_id,
                provider_id=datasource_provider_id,
                credentials=args["credentials"],
                name=args["name"],
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))
        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_id: str):
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        _, current_tenant_id = current_account_with_tenant()

        datasources = datasource_provider_service.list_datasource_credentials(
            tenant_id=current_tenant_id,
            provider=datasource_provider_id.provider_name,
            plugin_id=datasource_provider_id.plugin_id,
        )
        return {"result": datasources}, 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/delete")
class DatasourceAuthDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        datasource_provider_id = DatasourceProviderID(provider_id)
        plugin_id = datasource_provider_id.plugin_id
        provider_name = datasource_provider_id.provider_name

        parser = reqparse.RequestParser().add_argument(
            "credential_id", type=str, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.remove_datasource_credentials(
            tenant_id=current_tenant_id,
            auth_id=args["credential_id"],
            provider=provider_name,
            plugin_id=plugin_id,
        )
        return {"result": "success"}, 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/update")
class DatasourceAuthUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        datasource_provider_id = DatasourceProviderID(provider_id)
        parser = (
            reqparse.RequestParser()
            .add_argument("credentials", type=dict, required=False, nullable=True, location="json")
            .add_argument("name", type=StrLen(max_length=100), required=False, nullable=True, location="json")
            .add_argument("credential_id", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.update_datasource_credentials(
            tenant_id=current_tenant_id,
            auth_id=args["credential_id"],
            provider=datasource_provider_id.provider_name,
            plugin_id=datasource_provider_id.plugin_id,
            credentials=args.get("credentials", {}),
            name=args.get("name", None),
        )
        return {"result": "success"}, 201


@console_ns.route("/auth/plugin/datasource/list")
class DatasourceAuthListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()

        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_all_datasource_credentials(tenant_id=current_tenant_id)
        return {"result": jsonable_encoder(datasources)}, 200


@console_ns.route("/auth/plugin/datasource/default-list")
class DatasourceHardCodeAuthListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()

        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_hard_code_datasource_credentials(tenant_id=current_tenant_id)
        return {"result": jsonable_encoder(datasources)}, 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/custom-client")
class DatasourceAuthOauthCustomClient(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("client_params", type=dict, required=False, nullable=True, location="json")
            .add_argument("enable_oauth_custom_client", type=bool, required=False, nullable=True, location="json")
        )
        args = parser.parse_args()
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.setup_oauth_custom_client_params(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            client_params=args.get("client_params", {}),
            enabled=args.get("enable_oauth_custom_client", False),
        )
        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.remove_oauth_custom_client_params(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
        )
        return {"result": "success"}, 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/default")
class DatasourceAuthDefaultApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        parser = reqparse.RequestParser().add_argument("id", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.set_default_datasource_provider(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            credential_id=args["id"],
        )
        return {"result": "success"}, 200


@console_ns.route("/auth/plugin/datasource/<path:provider_id>/update-name")
class DatasourceUpdateProviderNameApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, provider_id: str):
        _, current_tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=StrLen(max_length=100), required=True, nullable=False, location="json")
            .add_argument("credential_id", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()
        datasource_provider_id = DatasourceProviderID(provider_id)
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.update_datasource_provider_name(
            tenant_id=current_tenant_id,
            datasource_provider_id=datasource_provider_id,
            name=args["name"],
            credential_id=args["credential_id"],
        )
        return {"result": "success"}, 200
