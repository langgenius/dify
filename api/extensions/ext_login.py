import json

import flask_login
from flask import Response, request
from flask_login import user_loaded_from_request, user_logged_in
from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from constants import HEADER_NAME_APP_CODE
from dify_app import DifyApp
from extensions.ext_database import db
from libs.passport import PassportService
from libs.token import extract_access_token, extract_webapp_passport
from models import Account, Tenant, TenantAccountJoin
from models.model import AppMCPServer, EndUser
from services.account_service import AccountService

login_manager = flask_login.LoginManager()


# Flask-Login configuration
@login_manager.request_loader
def load_user_from_request(request_from_flask_login):
    """Load user based on the request."""
    # Skip authentication for documentation endpoints
    if dify_config.SWAGGER_UI_ENABLED and request.path.endswith((dify_config.SWAGGER_UI_PATH, "/swagger.json")):
        return None

    auth_token = extract_access_token(request)

    # Check for admin API key authentication first
    if dify_config.ADMIN_API_KEY_ENABLE and auth_token:
        admin_api_key = dify_config.ADMIN_API_KEY
        if admin_api_key and admin_api_key == auth_token:
            workspace_id = request.headers.get("X-WORKSPACE-ID")
            if workspace_id:
                tenant_account_join = (
                    db.session.query(Tenant, TenantAccountJoin)
                    .where(Tenant.id == workspace_id)
                    .where(TenantAccountJoin.tenant_id == Tenant.id)
                    .where(TenantAccountJoin.role == "owner")
                    .one_or_none()
                )
                if tenant_account_join:
                    tenant, ta = tenant_account_join
                    account = db.session.query(Account).filter_by(id=ta.account_id).first()
                    if account:
                        account.current_tenant = tenant
                        return account

    if request.blueprint in {"console", "inner_api"}:
        if not auth_token:
            raise Unauthorized("Invalid Authorization token.")
        decoded = PassportService().verify(auth_token)
        user_id = decoded.get("user_id")
        source = decoded.get("token_source")
        if source:
            raise Unauthorized("Invalid Authorization token.")
        if not user_id:
            raise Unauthorized("Invalid Authorization token.")

        logged_in_account = AccountService.load_logged_in_account(account_id=user_id)
        return logged_in_account
    elif request.blueprint == "web":
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        webapp_token = extract_webapp_passport(app_code, request) if app_code else None

        if webapp_token:
            decoded = PassportService().verify(webapp_token)
            end_user_id = decoded.get("end_user_id")
            if not end_user_id:
                raise Unauthorized("Invalid Authorization token.")
            end_user = db.session.query(EndUser).where(EndUser.id == end_user_id).first()
            if not end_user:
                raise NotFound("End user not found.")
            return end_user
        else:
            if not auth_token:
                raise Unauthorized("Invalid Authorization token.")
            decoded = PassportService().verify(auth_token)
            end_user_id = decoded.get("end_user_id")
            if end_user_id:
                end_user = db.session.query(EndUser).where(EndUser.id == end_user_id).first()
                if not end_user:
                    raise NotFound("End user not found.")
                return end_user
            else:
                raise Unauthorized("Invalid Authorization token for web API.")
    elif request.blueprint == "mcp":
        server_code = request.view_args.get("server_code") if request.view_args else None
        if not server_code:
            raise Unauthorized("Invalid Authorization token.")
        app_mcp_server = db.session.query(AppMCPServer).where(AppMCPServer.server_code == server_code).first()
        if not app_mcp_server:
            raise NotFound("App MCP server not found.")
        end_user = (
            db.session.query(EndUser).where(EndUser.session_id == app_mcp_server.id, EndUser.type == "mcp").first()
        )
        if not end_user:
            raise NotFound("End user not found.")
        return end_user


@user_logged_in.connect
@user_loaded_from_request.connect
def on_user_logged_in(_sender, user):
    """Called when a user logged in.

    Note: AccountService.load_logged_in_account will populate user.current_tenant_id
    through the load_user method, which calls account.set_tenant_id().
    """
    # tenant_id context variable removed - using current_user.current_tenant_id directly
    pass


@login_manager.unauthorized_handler
def unauthorized_handler():
    """Handle unauthorized requests."""
    return Response(
        json.dumps({"code": "unauthorized", "message": "Unauthorized."}),
        status=401,
        content_type="application/json",
    )


def init_app(app: DifyApp):
    login_manager.init_app(app)
