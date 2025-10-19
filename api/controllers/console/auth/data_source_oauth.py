import logging

import httpx
from flask import current_app, redirect, request
from flask_restx import Resource, fields
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import api, console_ns
from libs.login import current_account_with_tenant, login_required
from libs.oauth_data_source import NotionOAuth

from ..wraps import account_initialization_required, setup_required

logger = logging.getLogger(__name__)


def get_oauth_providers():
    with current_app.app_context():
        notion_oauth = NotionOAuth(
            client_id=dify_config.NOTION_CLIENT_ID or "",
            client_secret=dify_config.NOTION_CLIENT_SECRET or "",
            redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/data-source/callback/notion",
        )

        OAUTH_PROVIDERS = {"notion": notion_oauth}
        return OAUTH_PROVIDERS


@console_ns.route("/oauth/data-source/<string:provider>")
class OAuthDataSource(Resource):
    @api.doc("oauth_data_source")
    @api.doc(description="Get OAuth authorization URL for data source provider")
    @api.doc(params={"provider": "Data source provider name (notion)"})
    @api.response(
        200,
        "Authorization URL or internal setup success",
        api.model(
            "OAuthDataSourceResponse",
            {"data": fields.Raw(description="Authorization URL or 'internal' for internal setup")},
        ),
    )
    @api.response(400, "Invalid provider")
    @api.response(403, "Admin privileges required")
    def get(self, provider: str):
        # The role of the current user in the table must be admin or owner
        current_user, _ = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400
        if dify_config.NOTION_INTEGRATION_TYPE == "internal":
            internal_secret = dify_config.NOTION_INTERNAL_SECRET
            if not internal_secret:
                return ({"error": "Internal secret is not set"},)
            oauth_provider.save_internal_access_token(internal_secret)
            return {"data": "internal"}
        else:
            auth_url = oauth_provider.get_authorization_url()
            return {"data": auth_url}, 200


@console_ns.route("/oauth/data-source/callback/<string:provider>")
class OAuthDataSourceCallback(Resource):
    @api.doc("oauth_data_source_callback")
    @api.doc(description="Handle OAuth callback from data source provider")
    @api.doc(
        params={
            "provider": "Data source provider name (notion)",
            "code": "Authorization code from OAuth provider",
            "error": "Error message from OAuth provider",
        }
    )
    @api.response(302, "Redirect to console with result")
    @api.response(400, "Invalid provider")
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400
        if "code" in request.args:
            code = request.args.get("code")

            return redirect(f"{dify_config.CONSOLE_WEB_URL}?type=notion&code={code}")
        elif "error" in request.args:
            error = request.args.get("error")

            return redirect(f"{dify_config.CONSOLE_WEB_URL}?type=notion&error={error}")
        else:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}?type=notion&error=Access denied")


@console_ns.route("/oauth/data-source/binding/<string:provider>")
class OAuthDataSourceBinding(Resource):
    @api.doc("oauth_data_source_binding")
    @api.doc(description="Bind OAuth data source with authorization code")
    @api.doc(
        params={"provider": "Data source provider name (notion)", "code": "Authorization code from OAuth provider"}
    )
    @api.response(
        200,
        "Data source binding success",
        api.model("OAuthDataSourceBindingResponse", {"result": fields.String(description="Operation result")}),
    )
    @api.response(400, "Invalid provider or code")
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400
        if "code" in request.args:
            code = request.args.get("code", "")
            if not code:
                return {"error": "Invalid code"}, 400
            try:
                oauth_provider.get_access_token(code)
            except httpx.HTTPStatusError as e:
                logger.exception(
                    "An error occurred during the OAuthCallback process with %s: %s", provider, e.response.text
                )
                return {"error": "OAuth data source process failed"}, 400

            return {"result": "success"}, 200


@console_ns.route("/oauth/data-source/<string:provider>/<uuid:binding_id>/sync")
class OAuthDataSourceSync(Resource):
    @api.doc("oauth_data_source_sync")
    @api.doc(description="Sync data from OAuth data source")
    @api.doc(params={"provider": "Data source provider name (notion)", "binding_id": "Data source binding ID"})
    @api.response(
        200,
        "Data source sync success",
        api.model("OAuthDataSourceSyncResponse", {"result": fields.String(description="Operation result")}),
    )
    @api.response(400, "Invalid provider or sync failed")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider, binding_id):
        provider = str(provider)
        binding_id = str(binding_id)
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400
        try:
            oauth_provider.sync_data_source(binding_id)
        except httpx.HTTPStatusError as e:
            logger.exception(
                "An error occurred during the OAuthCallback process with %s: %s", provider, e.response.text
            )
            return {"error": "OAuth data source process failed"}, 400

        return {"result": "success"}, 200
