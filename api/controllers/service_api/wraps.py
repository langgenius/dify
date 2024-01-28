# -*- coding:utf-8 -*-
from datetime import datetime
from functools import wraps

from extensions.ext_database import db
from flask import current_app, request
from flask_login import user_logged_in
from flask_restful import Resource
from libs.login import _get_user
from models.account import Account, Tenant, TenantAccountJoin
from models.model import ApiToken, App
from services.feature_service import FeatureService
from werkzeug.exceptions import NotFound, Unauthorized


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


def cloud_edition_billing_resource_check(resource: str,
                                         api_token_type: str,
                                         error_msg: str = "You have reached the limit of your subscription."):
    def interceptor(view):
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token(api_token_type)
            features = FeatureService.get_features(api_token.tenant_id)

            if features.billing.enabled:
                members = features.members
                apps = features.apps
                vector_space = features.vector_space

                if resource == 'members' and 0 < members.limit <= members.size:
                    raise Unauthorized(error_msg)
                elif resource == 'apps' and 0 < apps.limit <= apps.size:
                    raise Unauthorized(error_msg)
                elif resource == 'vector_space' and 0 < vector_space.limit <= vector_space.size:
                    raise Unauthorized(error_msg)
                else:
                    return view(*args, **kwargs)

            return view(*args, **kwargs)
        return decorated
    return interceptor


def validate_dataset_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token('dataset')
            tenant_account_join = db.session.query(Tenant, TenantAccountJoin) \
                .filter(Tenant.id == api_token.tenant_id) \
                .filter(TenantAccountJoin.tenant_id == Tenant.id) \
                .filter(TenantAccountJoin.role.in_(['owner'])) \
                .one_or_none() # TODO: only owner information is required, so only one is returned.
            if tenant_account_join:
                tenant, ta = tenant_account_join
                account = Account.query.filter_by(id=ta.account_id).first()
                # Login admin
                if account:
                    account.current_tenant = tenant
                    current_app.login_manager._update_request_context_with_user(account)
                    user_logged_in.send(current_app._get_current_object(), user=_get_user())
                else:
                    raise Unauthorized("Tenant owner account does not exist.")
            else:
                raise Unauthorized("Tenant does not exist.")
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
