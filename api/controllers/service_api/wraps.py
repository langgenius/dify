# -*- coding:utf-8 -*-
from datetime import datetime
from functools import wraps

from flask import request, current_app
from flask_login import user_logged_in
from flask_restful import Resource
from werkzeug.exceptions import NotFound, Unauthorized

from libs.login import _get_user
from extensions.ext_database import db
from models.account import Tenant, TenantAccountJoin, Account
from models.model import ApiToken, App


def validate_app_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token('app')

            app_model = db.session.query(App).filter(App.id == api_token.app_id).first()
            if not app_model:
                raise NotFound()

            if app_model.status != 'normal':
                raise NotFound()

            if not app_model.enable_api:
                raise NotFound()

            return view(app_model, None, *args, **kwargs)
        return decorated

    if view:
        return decorator(view)

    # if view is None, it means that the decorator is used without parentheses
    # use the decorator as a function for method_decorators
    return decorator


def validate_dataset_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token('dataset')
            tenant_account_join = db.session.query(Tenant, TenantAccountJoin) \
                .filter(Tenant.id == api_token.tenant_id) \
                .filter(TenantAccountJoin.tenant_id == Tenant.id) \
                .filter(TenantAccountJoin.role == 'owner') \
                .one_or_none()
            if tenant_account_join:
                tenant, ta = tenant_account_join
                account = Account.query.filter_by(id=ta.account_id).first()
                # Login admin
                if account:
                    account.current_tenant = tenant
                    current_app.login_manager._update_request_context_with_user(account)
                    user_logged_in.send(current_app._get_current_object(), user=_get_user())
                else:
                    raise Unauthorized("Tenant owner account is not exist.")
            else:
                raise Unauthorized("Tenant is not exist.")
            return view(api_token.tenant_id, *args, **kwargs)
        return decorated

    if view:
        return decorator(view)

    # if view is None, it means that the decorator is used without parentheses
    # use the decorator as a function for method_decorators
    return decorator


def validate_and_get_api_token(scope=None):
    """
    Validate and get API token.
    """
    auth_header = request.headers.get('Authorization')
    if auth_header is None or ' ' not in auth_header:
        raise Unauthorized("Authorization header must be provided and start with 'Bearer'")

    auth_scheme, auth_token = auth_header.split(None, 1)
    auth_scheme = auth_scheme.lower()

    if auth_scheme != 'bearer':
        raise Unauthorized("Authorization scheme must be 'Bearer'")

    api_token = db.session.query(ApiToken).filter(
        ApiToken.token == auth_token,
        ApiToken.type == scope,
    ).first()

    if not api_token:
        raise Unauthorized("Access token is invalid")

    api_token.last_used_at = datetime.utcnow()
    db.session.commit()

    return api_token


class AppApiResource(Resource):
    method_decorators = [validate_app_token]


class DatasetApiResource(Resource):
    method_decorators = [validate_dataset_token]
