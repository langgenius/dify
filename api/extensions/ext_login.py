import json

import flask_login  # type: ignore
from flask import Response, request
from flask_login import user_loaded_from_request, user_logged_in
from werkzeug.exceptions import Unauthorized

import contexts
from dify_app import DifyApp
from extensions.ext_database import db
from libs.passport import PassportService
from models.account import Account
from models.model import EndUser
from services.account_service import AccountService

login_manager = flask_login.LoginManager()


# Flask-Login configuration
@login_manager.request_loader
def load_user_from_request(request_from_flask_login):
    """Load user based on the request."""
    auth_header = request.headers.get("Authorization", "")
    # Check if the user_id contains a dot, indicating the old format
    if not auth_header:
        auth_token = request.args.get("_token")
        if not auth_token:
            raise Unauthorized("Invalid Authorization token.")
    else:
        if " " not in auth_header:
            raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")
        auth_scheme, auth_token = auth_header.split(None, 1)
        auth_scheme = auth_scheme.lower()
        if auth_scheme != "bearer":
            raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

    decoded = PassportService().verify(auth_token)
    if request.blueprint in {"console", "inner_api"}:
        user_id = decoded.get("user_id")

        logged_in_account = AccountService.load_logged_in_account(account_id=user_id)
        return logged_in_account
    else:
        end_user = db.session.query(EndUser).filter(EndUser.id == decoded["end_user_id"]).first()
        return end_user


@user_logged_in.connect
@user_loaded_from_request.connect
def on_user_logged_in(_sender, user):
    """Called when a user logged in."""
    if user and isinstance(user, Account) and user.current_tenant_id:
        contexts.tenant_id.set(user.current_tenant_id)


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
