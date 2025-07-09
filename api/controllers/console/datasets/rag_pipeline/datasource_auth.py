import random

from flask import redirect, request
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
from core.plugin.impl.oauth import OAuthHandler
from extensions.ext_database import db
from libs.login import login_required
from models.oauth import DatasourceOauthParamConfig, DatasourceProvider
from services.datasource_provider_service import DatasourceProviderService


class DatasourcePluginOauthApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")
        parser.add_argument("plugin_id", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()
        provider = args["provider"]
        plugin_id = args["plugin_id"]
        # Check user role first
        if not current_user.is_editor:
            raise Forbidden()
        # get all plugin oauth configs
        plugin_oauth_config = (
            db.session.query(DatasourceOauthParamConfig).filter_by(provider=provider, plugin_id=plugin_id).first()
        )
        if not plugin_oauth_config:
            raise NotFound()
        oauth_handler = OAuthHandler()
        redirect_url = (
            f"{dify_config.CONSOLE_WEB_URL}/oauth/datasource/callback?provider={provider}&plugin_id={plugin_id}"
        )
        system_credentials = plugin_oauth_config.system_credentials
        if system_credentials:
            system_credentials["redirect_url"] = redirect_url
        response = oauth_handler.get_authorization_url(
            current_user.current_tenant.id, current_user.id, plugin_id, provider, system_credentials=system_credentials
        )
        return response.model_dump()


class DatasourceOauthCallback(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")
        parser.add_argument("plugin_id", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()
        provider = args["provider"]
        plugin_id = args["plugin_id"]
        oauth_handler = OAuthHandler()
        plugin_oauth_config = (
            db.session.query(DatasourceOauthParamConfig).filter_by(provider=provider, plugin_id=plugin_id).first()
        )
        if not plugin_oauth_config:
            raise NotFound()
        credentials = oauth_handler.get_credentials(
            current_user.current_tenant.id,
            current_user.id,
            plugin_id,
            provider,
            system_credentials=plugin_oauth_config.system_credentials,
            request=request,
        )
        datasource_provider = DatasourceProvider(
            plugin_id=plugin_id, provider=provider, auth_type="oauth", encrypted_credentials=credentials
        )
        db.session.add(datasource_provider)
        db.session.commit()
        return redirect(f"{dify_config.CONSOLE_WEB_URL}")


class DatasourceAuth(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str, required=False, nullable=False, location="json", default="test")
        parser.add_argument("plugin_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()

        datasource_provider_service = DatasourceProviderService()

        try:
            datasource_provider_service.datasource_provider_credentials_validate(
                tenant_id=current_user.current_tenant_id,
                provider=args["provider"],
                plugin_id=args["plugin_id"],
                credentials=args["credentials"],
                name="test" + str(random.randint(1, 1000000)),  # noqa: S311
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}, 201

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")
        parser.add_argument("plugin_id", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()
        datasource_provider_service = DatasourceProviderService()
        datasources = datasource_provider_service.get_datasource_credentials(
            tenant_id=current_user.current_tenant_id, provider=args["provider"], plugin_id=args["plugin_id"]
        )
        return {"result": datasources}, 200


class DatasourceAuthUpdateDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, auth_id: str):
        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")
        parser.add_argument("plugin_id", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()
        if not current_user.is_editor:
            raise Forbidden()
        datasource_provider_service = DatasourceProviderService()
        datasource_provider_service.remove_datasource_credentials(
            tenant_id=current_user.current_tenant_id,
            auth_id=auth_id,
            provider=args["provider"],
            plugin_id=args["plugin_id"],
        )
        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, auth_id: str):
        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, required=True, nullable=False, location="args")
        parser.add_argument("plugin_id", type=str, required=True, nullable=False, location="args")
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()
        if not current_user.is_editor:
            raise Forbidden()
        try:
            datasource_provider_service = DatasourceProviderService()
            datasource_provider_service.update_datasource_credentials(
                tenant_id=current_user.current_tenant_id,
                auth_id=auth_id,
                provider=args["provider"],
                plugin_id=args["plugin_id"],
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


# Import Rag Pipeline
api.add_resource(
    DatasourcePluginOauthApi,
    "/oauth/plugin/datasource",
)
api.add_resource(
    DatasourceOauthCallback,
    "/oauth/plugin/datasource/callback",
)
api.add_resource(
    DatasourceAuth,
    "/auth/plugin/datasource",
)

api.add_resource(
    DatasourceAuthUpdateDeleteApi,
    "/auth/plugin/datasource/<string:auth_id>",
)

api.add_resource(
    DatasourceAuthListApi,
    "/auth/plugin/datasource/list",
)
