from flask_restful import Resource, reqparse

from controllers.console import api
from events.tenant_event import tenant_was_created
from models.account import Account
from services.account_service import TenantService

class EnterpriseWorkspaceNew(Resource):
    
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        parser.add_argument('owner_email', type=str, required=True, location='json')
        args = parser.parse_args()
        account = Account.query.filter_by(email=args['owner_email']).first()
        if account is None:
            return {
                'message': 'owner account not found.'
            }, 404

        tenant = TenantService.create_tenant(args['name'])
        TenantService.create_tenant_member(tenant, account, role='owner')

        tenant_was_created.send(tenant)

        return {
            'message': 'enterprise workspace created.'
        }


api.add_resource(EnterpriseWorkspaceNew, '/enterprise/workspace')

