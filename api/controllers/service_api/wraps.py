# -*- coding:utf-8 -*-
from datetime import datetime
from functools import wraps

from flask import request
from flask_restful import Resource
from werkzeug.exceptions import NotFound, Unauthorized

from extensions.ext_database import db
from models.dataset import Dataset
from models.model import ApiToken, App


def validate_app_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            api_token = validate_and_get_api_token('app')

            app_model = db.session.query(App).get(api_token.app_id)
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

            dataset = db.session.query(Dataset).get(api_token.dataset_id)
            if not dataset:
                raise NotFound()

            return view(dataset, *args, **kwargs)
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
    if auth_header is None:
        raise Unauthorized()

    auth_scheme, auth_token = auth_header.split(None, 1)
    auth_scheme = auth_scheme.lower()

    if auth_scheme != 'bearer':
        raise Unauthorized()

    api_token = db.session.query(ApiToken).filter(
        ApiToken.token == auth_token,
        ApiToken.type == scope,
    ).first()

    if not api_token:
        raise Unauthorized()

    api_token.last_used_at = datetime.utcnow()
    db.session.commit()

    return api_token


class AppApiResource(Resource):
    method_decorators = [validate_app_token]


class DatasetApiResource(Resource):
    method_decorators = [validate_dataset_token]
