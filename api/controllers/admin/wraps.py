from collections.abc import Callable
from functools import wraps
from typing import Optional

from flask import request
from werkzeug.exceptions import Forbidden, Unauthorized

from configs import dify_config
from extensions.ext_database import db
from libs.passport import PassportService
from models.account import AccountStatus, Tenant, TenantStatus
from models.model import App
from models.organization import OrganizationMember, OrganizationRole
from services.account_service import AccountService


def validate_admin_token_and_extract_info(view: Optional[Callable] = None):
    def decorator(view_func):
        @wraps(view_func)
        def decorated_view(*args, **kwargs):
            # Extract user info from Bearer token
            auth_header = request.headers.get("Authorization")
            if auth_header is None or " " not in auth_header:
                raise Unauthorized("Authorization header must be provided and start with 'Bearer'")

            auth_scheme, auth_token = auth_header.split(None, 1)
            auth_scheme = auth_scheme.lower()

            if auth_scheme != "bearer":
                raise Unauthorized("Authorization scheme must be 'Bearer'")

            # Decode the JWT token to extract user info
            try:
                decoded = PassportService().verify(auth_token)
                user_id = decoded.get("user_id")
            except Exception as e:
                raise Unauthorized(f"Failed to extract user_id from token: {str(e)}")

            if not user_id:
                raise Unauthorized("Invalid token: missing user_id")

            account = AccountService.load_user(user_id)
            if account is None:
                raise Unauthorized("Invalid token: user not found")
            if account.status != AccountStatus.ACTIVE:
                raise Unauthorized("Invalid token: account is not active")
            
            # Check if user has admin role in their current organization
            org_member = db.session.query(OrganizationMember).filter(
                OrganizationMember.account_id == user_id,
                OrganizationMember.organization_id == account.current_organization_id
            ).first()
            
            if not org_member:
                raise Unauthorized("Invalid token: user is not a member of any organization")
            
            # Check if the user has admin role
            if org_member.role != OrganizationRole.ADMIN:
                raise Unauthorized("Invalid token: account does not have admin privileges")

            app_id = request.headers.get("X-App-Id")
            if not app_id:
                app_id = dify_config.DEFAULT_APP_ID

            app_model = db.session.query(App).filter(App.id == app_id).first()

            if not app_model:
                raise Forbidden("The app no longer exists.")

            if app_model.status != "normal":
                raise Forbidden("The app's status is abnormal.")

            if not app_model.enable_api:
                raise Forbidden("The app's API service has been disabled.")

            tenant = db.session.query(Tenant).filter(Tenant.id == app_model.tenant_id).first()
            if tenant is None:
                raise ValueError("Tenant does not exist.")
            if tenant.status == TenantStatus.ARCHIVE:
                raise Forbidden("The workspace's status is archived.")

            # Pass account and app_model to the view
            kwargs["app_model"] = app_model
            kwargs["account"] = account

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)
