import json
import threading

import flask_login  # type: ignore
from flask import Response, request
from flask_login import user_loaded_from_request, user_logged_in
from werkzeug.exceptions import Unauthorized

import contexts
import requests
from dify_app import DifyApp
from libs.passport import PassportService
from services.account_service import AccountService, TenantService

login_manager = flask_login.LoginManager()


create_user_lock =threading.Lock()

# Flask-Login configuration
@login_manager.request_loader
def load_user_from_request(request_from_flask_login):
    """Load user based on the request."""
    if request.blueprint not in {"console", "inner_api"}:
        return None
    # Check if the user_id contains a dot, indicating the old format
    auth_header = request.headers.get("Authorization", "")
    data = {
        "hwsso_token": auth_header,
        "csrf_token": ""
    }

    resp = requests.post("http://localhost:5010/login", json=data)
    if resp.status_code == 200:
        user_info = resp.json()["data"]
        email = user_info["email"][0]   
        with create_user_lock:
            logged_in_account = AccountService.load_logged_in_account(account_id=None, email= email)
            if not logged_in_account:
                if TenantService.get_tenant_count() == 0:
                    logged_in_account = AccountService.create_account_and_tenant(email=user_info["email"][0],
                                                name=user_info["cn"],
                                                interface_language="en-US",)
                else:
                    logged_in_account = AccountService.create_account(email=user_info["email"][0],
                                                name=user_info["cn"],
                                                interface_language="en-US", is_setup=True)  
                    tenant = TenantService.get_first_tenant()
                    TenantService.create_tenant_member(tenant=tenant, account=logged_in_account)
                    logged_in_account = AccountService.load_logged_in_account(account_id=None, email= email)
                  
        return logged_in_account
    else:
        raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")
    # if not auth_header:
    #     auth_token = request.args.get("_token")
    #     if not auth_token:
    #         raise Unauthorized("Invalid Authorization token.")
    # else:
    #     if " " not in auth_header:
    #         raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")
    #     auth_scheme, auth_token = auth_header.split(None, 1)
    #     auth_scheme = auth_scheme.lower()
    #     if auth_scheme != "bearer":
    #         raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

    # decoded = PassportService().verify(auth_token)
    # user_id = decoded.get("user_id")



@user_logged_in.connect
@user_loaded_from_request.connect
def on_user_logged_in(_sender, user):
    """Called when a user logged in."""
    if user:
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
