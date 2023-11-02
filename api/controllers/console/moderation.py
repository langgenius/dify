from flask_restful import Resource, reqparse
from flask_login import current_user

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.login import login_required
from services.moderation_service import ModerationService

class ModerationAPI(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('app_id', type=str, required=True, location='json')
        parser.add_argument('text', type=str, required=True, location='json')
        args = parser.parse_args()

        service = ModerationService()
        return service.moderation_for_outputs(args['app_id'], current_user.current_tenant_id, args['text'])

api.add_resource(ModerationAPI, '/moderation')