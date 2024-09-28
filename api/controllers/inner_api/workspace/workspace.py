from flask_restful import Resource, fields, reqparse,marshal

from controllers.console.setup import setup_required
from controllers.inner_api import api
from controllers.inner_api.wraps import inner_api_only
from events.tenant_event import tenant_was_created
from models.account import Account
from services.account_service import TenantService
from libs.helper import TimestampField

tenants_fields = {
    "id": fields.String,
    "name": fields.String,
    "plan": fields.String,
    "status": fields.String,
    "created_at": TimestampField,
    "current": fields.Boolean,
}

class EnterpriseWorkspace(Resource):
    @setup_required
    @inner_api_only
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("owner_email", type=str, required=True, location="args")
        args = parser.parse_args()

        account = Account.query.filter_by(email=args["owner_email"]).first()
        if account is None:
            return {"message": "owner account not found."}, 404
        tenants = TenantService.get_join_tenants(account)
        return {"workspaces": marshal(tenants, tenants_fields)}, 200

    @setup_required
    @inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("owner_email", type=str, required=True, location="json")
        args = parser.parse_args()

        account = Account.query.filter_by(email=args["owner_email"]).first()
        if account is None:
            return {"message": "owner account not found."}, 404

        tenant = TenantService.create_tenant(args["name"])
        TenantService.create_tenant_member(tenant, account, role="owner")

        tenant_was_created.send(tenant)

        return {"message": "enterprise workspace created."}
    
    @setup_required
    @inner_api_only
    def put(self):
        parser = reqparse.RequestParser()
        parser.add_argument("tenant_id", type=str, required=True, location="json")
        parser.add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()
        TenantService.modify_tencent(args["tenant_id"],args["name"])

        return {"message": "tenant info update."},200
    
    @setup_required
    @inner_api_only
    def delete(self):
        parser = reqparse.RequestParser()
        parser.add_argument("tenant_id", type=str, required=True, location="args")
        args = parser.parse_args()
        TenantService.delete_tencent(args["tenant_id"])

        return {"message": "delete tenant success."},200


api.add_resource(EnterpriseWorkspace, "/enterprise/workspace")
