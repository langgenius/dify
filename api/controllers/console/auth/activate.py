import base64
import secrets
from datetime import datetime

from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.error import AlreadyActivateError
from extensions.ext_database import db
from libs.helper import email, str_len, supported_language, timezone
from libs.password import valid_password, hash_password
from models.account import AccountStatus, Tenant
from services.account_service import RegisterService


class ActivateCheckApi(Resource):
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('workspace_id', type=str, required=True, nullable=False, location='args')
        parser.add_argument('email', type=email, required=True, nullable=False, location='args')
        parser.add_argument('token', type=str, required=True, nullable=False, location='args')
        args = parser.parse_args()

        account = RegisterService.get_account_if_token_valid(args['workspace_id'], args['email'], args['token'])

        tenant = db.session.query(Tenant).filter(
            Tenant.id == args['workspace_id'],
            Tenant.status == 'normal'
        ).first()

        return {'is_valid': account is not None, 'workspace_name': tenant.name}


class ActivateApi(Resource):
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('workspace_id', type=str, required=True, nullable=False, location='json')
        parser.add_argument('email', type=email, required=True, nullable=False, location='json')
        parser.add_argument('token', type=str, required=True, nullable=False, location='json')
        parser.add_argument('name', type=str_len(30), required=True, nullable=False, location='json')
        parser.add_argument('password', type=valid_password, required=True, nullable=False, location='json')
        parser.add_argument('interface_language', type=supported_language, required=True, nullable=False,
                            location='json')
        parser.add_argument('timezone', type=timezone, required=True, nullable=False, location='json')
        args = parser.parse_args()

        account = RegisterService.get_account_if_token_valid(args['workspace_id'], args['email'], args['token'])
        if account is None:
            raise AlreadyActivateError()

        RegisterService.revoke_token(args['workspace_id'], args['email'], args['token'])

        account.name = args['name']

        # generate password salt
        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()

        # encrypt password with salt
        password_hashed = hash_password(args['password'], salt)
        base64_password_hashed = base64.b64encode(password_hashed).decode()
        account.password = base64_password_hashed
        account.password_salt = base64_salt
        account.interface_language = args['interface_language']
        account.timezone = args['timezone']
        account.interface_theme = 'light'
        account.status = AccountStatus.ACTIVE.value
        account.initialized_at = datetime.utcnow()
        db.session.commit()

        return {'result': 'success'}


api.add_resource(ActivateCheckApi, '/activate/check')
api.add_resource(ActivateApi, '/activate')
