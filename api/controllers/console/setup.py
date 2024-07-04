from functools import wraps

from flask import current_app, request
from flask_restful import Resource, reqparse

from libs.helper import email, get_remote_ip, str_len
from libs.password import valid_password
from models.model import DifySetup
from services.account_service import RegisterService, TenantService

from . import api
from .error import AlreadySetupError, NotInitValidateError, NotSetupError
from .init_validate import get_init_validate_status
from .wraps import only_edition_self_hosted


class SetupApi(Resource):

    def get(self):
        if current_app.config['EDITION'] == 'SELF_HOSTED':
            setup_status = get_setup_status()
            if setup_status:
                return {
                    'step': 'finished',
                    'setup_at': setup_status.setup_at.isoformat()
                }
            return {'step': 'not_started'}
        return {'step': 'finished'}

    @only_edition_self_hosted
    def post(self):
        # is set up
        if get_setup_status():
            raise AlreadySetupError()

        # is tenant created
        tenant_count = TenantService.get_tenant_count()
        if tenant_count > 0:
            raise AlreadySetupError()
    
        if not get_init_validate_status():
            raise NotInitValidateError()

        parser = reqparse.RequestParser()
        parser.add_argument('email', type=email,
                            required=True, location='json')
        parser.add_argument('name', type=str_len(
            30), required=True, location='json')
        parser.add_argument('password', type=valid_password,
                            required=True, location='json')
        args = parser.parse_args()

        # setup
        RegisterService.setup(
            email=args['email'],
            name=args['name'],
            password=args['password'],
            ip_address=get_remote_ip(request)
        )

        return {'result': 'success'}, 201


def setup_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        # check setup
        if not get_init_validate_status():
            raise NotInitValidateError()
        
        elif not get_setup_status():
            raise NotSetupError()

        return view(*args, **kwargs)

    return decorated


def get_setup_status():
    if current_app.config['EDITION'] == 'SELF_HOSTED':
        return DifySetup.query.first()
    else:
        return True

api.add_resource(SetupApi, '/setup')
