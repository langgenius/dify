
from flask_restful import Resource, reqparse  # type: ignore
import flask_login
from unstructured.utils import first

from controllers.console import api
from controllers.console.wraps import setup_required
from services.ext.account_ext_service import AccountExtService, TenantExtService
from models.account import (
    Account,
    Tenant,
)
from extensions.ext_database import db

class AccountsApi(Resource):

    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("accounts",
                            type=lambda x: x if isinstance(x, list) else [] ,
                            required=True,
                            location="json")
        parser.add_argument("target_tenant_id", type=str,
                            required=True,
                            location="json")
        args = parser.parse_args()
        target_tenant_id = args["target_tenant_id"]
        accounts = args["accounts"]
        AccountExtService.update_account_list(accounts=accounts,
                                              target_tenant_id=target_tenant_id)

        return {}

class LoginAccountInfo:

    def __init__(self, id, name, tenant_id):
        self.id  = id
        self.name = name
        self.tenant_id = tenant_id

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "tenant_id": self.tenant_id,
        }

class LoginAccountsApi(Resource):

    @setup_required
    def get(self):
        current_user = flask_login.current_user
        # current_user_info = db.session.query(Account).filter(Account.id==current_user.id).first()
        tenant = current_user.current_tenant
        login_account = LoginAccountInfo(id=current_user.id, name=current_user.name, tenant_id=tenant.id)
        return login_account.to_dict()

class TenantEnableApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("target_tenant_id", type=str, required=True, location="json")
        parser.add_argument("target_tenant_name", type=str, required=True, location="json")
        args = parser.parse_args()
        target_tenant_id = args["target_tenant_id"]
        target_tenant_name = args["target_tenant_name"]
        tenant_account_info = TenantExtService.enable_tenant(target_tenant_id=target_tenant_id,target_tenant_name=target_tenant_name)
        return tenant_account_info.to_dict(),200

class TenantInitApi(Resource):

    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("target_tenant_id", type=str, required=True, location="json")
        parser.add_argument("target_tenant_name", type=str, required=True, location="json")
        args = parser.parse_args()
        target_tenant_id = args["target_tenant_id"]
        target_tenant_name = args["target_tenant_name"]
        tenant_data = TenantExtService.init_tenant(target_tenant_id=target_tenant_id,target_tenant_name=target_tenant_name)
        return tenant_data.to_dict(),200

api.add_resource(AccountsApi, "/accounts/update")
api.add_resource(TenantEnableApi, "/tenant/enable")
api.add_resource(TenantInitApi, "/tenant/init")
api.add_resource(LoginAccountsApi, "/login/account/info")
