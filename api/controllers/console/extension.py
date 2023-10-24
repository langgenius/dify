from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.login import login_required
from services.extension_service import ExtensionService


class CodeBasedExtension(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('module', type=str, required=True, location='args')
        args = parser.parse_args()

        return ExtensionService.get_code_based_extensions(args['module'])


api.add_resource(CodeBasedExtension, '/code-based-extensions')