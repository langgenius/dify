from flask_login import current_user
from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, only_edition_cloud
from libs.login import login_required
from services.operation_service import OperationService


class TenantUtm(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def post(self):

        parser = reqparse.RequestParser()
        parser.add_argument('utm_source', type=str, required=True)
        parser.add_argument('utm_medium', type=str, required=True)
        parser.add_argument('utm_campaign', type=str, required=False, default='')
        parser.add_argument('utm_content', type=str, required=False, default='')
        parser.add_argument('utm_term', type=str, required=False, default='')
        args = parser.parse_args()

        return OperationService.record_utm(current_user.current_tenant_id, args)


api.add_resource(TenantUtm, '/operation/utm')
