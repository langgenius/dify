import base64
import datetime
import secrets

from flask_restful import Resource, reqparse

from constants.languages import supported_language
from controllers.console import api
from controllers.console.error import AlreadyActivateError
from extensions.ext_database import db
from libs.helper import email, str_len, timezone
from libs.password import hash_password, valid_password
from models.account import AccountStatus, Tenant
from services.account_service import RegisterService


class ActivateCheckApi(Resource):
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("workspace_id", type=str, required=False, nullable=True, location="args")
        parser.add_argument("email", type=email, required=False, nullable=True, location="args")
        parser.add_argument("token", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()

        workspaceId = args["workspace_id"]
        reg_email = args["email"]
        token = args["token"]

        invitation = RegisterService.get_invitation_if_token_valid(workspaceId, reg_email, token)
        if invitation:
            data = invitation.get("data", {})
            tenant: Tenant = invitation.get("tenant")
            workspace_name = tenant.name if tenant else "Unknown Workspace"
            workspace_id = tenant.id if tenant else "Unknown Workspace ID"
            invitee_email = data.get("email", "Unknown Email")
            return {
                "is_valid": invitation is not None,
                "data": {"workspace_name": workspace_name, "workspace_id": workspace_id, "email": invitee_email}
            }
        else:
            return {"is_valid": False}


class ActivateApi(Resource):
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("workspace_id", type=str, required=False, nullable=True, location="json")
        parser.add_argument("email", type=email, required=False, nullable=True, location="json")
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str_len(30), required=True, nullable=False, location="json")
        parser.add_argument(
            "interface_language", type=supported_language, required=True, nullable=False, location="json"
        )
        parser.add_argument("timezone", type=timezone, required=True, nullable=False, location="json")
        args = parser.parse_args()

        invitation = RegisterService.get_invitation_if_token_valid(args["workspace_id"], args["email"], args["token"])
        if invitation is None:
            raise AlreadyActivateError()

        RegisterService.revoke_token(args["workspace_id"], args["email"], args["token"])

        account = invitation["account"]
        account.name = args["name"]

        account.interface_language = args["interface_language"]
        account.timezone = args["timezone"]
        account.interface_theme = "light"
        account.status = AccountStatus.ACTIVE.value
        account.initialized_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        db.session.commit()

        return {"result": "success"}


api.add_resource(ActivateCheckApi, "/activate/check")
api.add_resource(ActivateApi, "/activate")
