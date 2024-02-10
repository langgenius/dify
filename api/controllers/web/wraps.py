from functools import wraps

from flask import request
from flask_restful import Resource
from werkzeug.exceptions import NotFound, Unauthorized

from extensions.ext_database import db
from libs.passport import PassportService
from models.model import App, EndUser, Site


def validate_jwt_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            app_model, end_user = decode_jwt_token()

            return view(app_model, end_user, *args, **kwargs)
        return decorated
    if view:
        return decorator(view)
    return decorator

def decode_jwt_token():
    auth_header = request.headers.get('Authorization')
    if auth_header is None:
        raise Unauthorized('Authorization header is missing.')

    if ' ' not in auth_header:
        raise Unauthorized('Invalid Authorization header format. Expected \'Bearer <api-key>\' format.')
    
    auth_scheme, tk = auth_header.split(None, 1)
    auth_scheme = auth_scheme.lower()

    if auth_scheme != 'bearer':
        raise Unauthorized('Invalid Authorization header format. Expected \'Bearer <api-key>\' format.')
    decoded = PassportService().verify(tk)
    app_code = decoded.get('app_code')
    app_model = db.session.query(App).filter(App.id == decoded['app_id']).first()
    site = db.session.query(Site).filter(Site.code == app_code).first()
    if not app_model:
        raise NotFound()
    if not app_code or not site:
        raise Unauthorized('Site URL is no longer valid.')
    if app_model.enable_site is False:
        raise Unauthorized('Site is disabled.')
    end_user = db.session.query(EndUser).filter(EndUser.id == decoded['end_user_id']).first()
    if not end_user:
        raise NotFound()

    return app_model, end_user

class WebApiResource(Resource):
    method_decorators = [validate_jwt_token]
