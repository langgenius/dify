import logging

import httpx
from flask import current_app, redirect, request
from flask_restx import Resource, fields

from configs import dify_config
from libs.login import login_required
from libs.oauth_data_source import NotionOAuth

from .. import console_ns
from ..wraps import account_initialization_required, is_admin_or_owner_required, setup_required

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
    @console_ns.doc("oauth_data_source")
    @console_ns.doc(description="Get OAuth authorization URL for data source provider")
    @console_ns.doc(params={"provider": "Data source provider name (notion)"})
    @console_ns.response(
        200,
        "Authorization URL or internal setup success",
        console_ns.model(
            "OAuthDataSourceResponse",
            {"data": fields.Raw(description="Authorization URL or 'internal' for internal setup")},
        ),
    )
    @console_ns.response(400, "Invalid provider")
    @console_ns.response(403, "Admin privileges required")
    @is_admin_or_owner_required
    def get(self, provider: str):
        # The role of the current user in the table must be admin or owner
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
    @console_ns.doc("oauth_data_source_callback")
    @console_ns.doc(description="Handle OAuth callback from data source provider")
    @console_ns.doc(
        params={
            "provider": "Data source provider name (notion)",
            "code": "Authorization code from OAuth provider",
            "error": "Error message from OAuth provider",
        }
    )
    @console_ns.response(302, "Redirect to console with result")
    @console_ns.response(400, "Invalid provider")
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
    @console_ns.doc("oauth_data_source_binding")
    @console_ns.doc(description="Bind OAuth data source with authorization code")
    @console_ns.doc(
        params={"provider": "Data source provider name (notion)", "code": "Authorization code from OAuth provider"}
    )
    @console_ns.response(
        200,
        "Data source binding success",
        console_ns.model("OAuthDataSourceBindingResponse", {"result": fields.String(description="Operation result")}),
    )
    @console_ns.response(400, "Invalid provider or code")
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
    @console_ns.doc("oauth_data_source_sync")
    @console_ns.doc(description="Sync data from OAuth data source")
    @console_ns.doc(params={"provider": "Data source provider name (notion)", "binding_id": "Data source binding ID"})
    @console_ns.response(
        200,
        "Data source sync success",
        console_ns.model("OAuthDataSourceSyncResponse", {"result": fields.String(description="Operation result")}),
    )
    @console_ns.response(400, "Invalid provider or sync failed")
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
