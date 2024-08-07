from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.api_based_extension_fields import api_based_extension_fields
from libs.login import login_required
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from services.code_based_extension_service import CodeBasedExtensionService


class CodeBasedExtensionAPI(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('module', type=str, required=True, location='args')
        args = parser.parse_args()

        return {
            'module': args['module'],
            'data': CodeBasedExtensionService.get_code_based_extension(args['module'])
        }


class APIBasedExtensionAPI(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def get(self):
        tenant_id = current_user.current_tenant_id
        return APIBasedExtensionService.get_all_by_tenant_id(tenant_id)

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        parser.add_argument('api_endpoint', type=str, required=True, location='json')
        parser.add_argument('api_key', type=str, required=True, location='json')
        args = parser.parse_args()

        extension_data = APIBasedExtension(
            tenant_id=current_user.current_tenant_id,
            name=args['name'],
            api_endpoint=args['api_endpoint'],
            api_key=args['api_key']
        )

        return APIBasedExtensionService.save(extension_data)


class APIBasedExtensionDetailAPI(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def get(self, id):
        api_based_extension_id = str(id)
        tenant_id = current_user.current_tenant_id

        return APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def post(self, id):
        api_based_extension_id = str(id)
        tenant_id = current_user.current_tenant_id

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)

        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        parser.add_argument('api_endpoint', type=str, required=True, location='json')
        parser.add_argument('api_key', type=str, required=True, location='json')
        args = parser.parse_args()

        extension_data_from_db.name = args['name']
        extension_data_from_db.api_endpoint = args['api_endpoint']

        if args['api_key'] != '[__HIDDEN__]':
            extension_data_from_db.api_key = args['api_key']

        return APIBasedExtensionService.save(extension_data_from_db)

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, id):
        api_based_extension_id = str(id)
        tenant_id = current_user.current_tenant_id

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)

        APIBasedExtensionService.delete(extension_data_from_db)

        return {'result': 'success'}


api.add_resource(CodeBasedExtensionAPI, '/code-based-extension')

api.add_resource(APIBasedExtensionAPI, '/api-based-extension')
api.add_resource(APIBasedExtensionDetailAPI, '/api-based-extension/<uuid:id>')
