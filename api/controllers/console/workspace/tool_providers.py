import json

from flask_login import login_required, current_user
from flask_restful import Resource, abort, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.tool.provider.errors import ToolValidateFailedError
from core.tool.provider.tool_provider_service import ToolProviderService
from extensions.ext_database import db
from models.tool import ToolProvider, ToolProviderName


class ToolProviderListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenant_id = current_user.current_tenant_id

        tool_credential_dict = {}
        for tool_name in ToolProviderName:
            tool_credential_dict[tool_name.value] = {
                'tool_name': tool_name.value,
                'is_enabled': False,
                'credentials': None
            }

        tool_providers = db.session.query(ToolProvider).filter(ToolProvider.tenant_id == tenant_id).all()

        for p in tool_providers:
            if p.is_enabled:
                tool_credential_dict[p.tool_name] = {
                    'tool_name': p.tool_name,
                    'is_enabled': p.is_enabled,
                    'credentials': ToolProviderService(tenant_id, p.tool_name).get_credentials(obfuscated=True)
                }

        return list(tool_credential_dict.values())


class ToolProviderCredentialsApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        if provider not in [p.value for p in ToolProviderName]:
            abort(404)

        # The role of the current user in the ta table must be admin or owner
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden(f'User {current_user.id} is not authorized to update provider token, '
                            f'current_role is {current_user.current_tenant.current_role}')

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        tool_provider_service = ToolProviderService(tenant_id, provider)

        try:
            tool_provider_service.credentials_validate(args['credentials'])
        except ToolValidateFailedError as ex:
            raise ValueError(str(ex))

        encrypted_credentials = json.dumps(tool_provider_service.encrypt_credentials(args['credentials']))

        tenant = current_user.current_tenant

        tool_provider_model = db.session.query(ToolProvider).filter(
                ToolProvider.tenant_id == tenant.id,
                ToolProvider.tool_name == provider,
            ).first()

        # Only allow updating token for CUSTOM provider type
        if tool_provider_model:
            tool_provider_model.encrypted_credentials = encrypted_credentials
            tool_provider_model.is_enabled = True
        else:
            tool_provider_model = ToolProvider(
                tenant_id=tenant.id,
                tool_name=provider,
                encrypted_credentials=encrypted_credentials,
                is_enabled=True
            )
            db.session.add(tool_provider_model)

        db.session.commit()

        return {'result': 'success'}, 201


class ToolProviderCredentialsValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        if provider not in [p.value for p in ToolProviderName]:
            abort(404)

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        result = True
        error = None

        tenant_id = current_user.current_tenant_id

        tool_provider_service = ToolProviderService(tenant_id, provider)

        try:
            tool_provider_service.credentials_validate(args['credentials'])
        except ToolValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


api.add_resource(ToolProviderListApi, '/workspaces/current/tool-providers')
api.add_resource(ToolProviderCredentialsApi, '/workspaces/current/tool-providers/<provider>/credentials')
api.add_resource(ToolProviderCredentialsValidateApi,
                 '/workspaces/current/tool-providers/<provider>/credentials-validate')
