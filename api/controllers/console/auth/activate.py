import datetime

from flask import request
from flask_restful import Resource, reqparse

from constants.languages import supported_language
from controllers.console import api
from controllers.console.error import AlreadyActivateError
from extensions.ext_database import db
from libs.helper import StrLen, email, extract_remote_ip, timezone
from models.account import AccountStatus, Tenant
from services.account_service import AccountService, RegisterService


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
            tenant: Tenant = invitation.get("tenant", None)
            workspace_name = tenant.name if tenant else None
            workspace_id = tenant.id if tenant else None
            invitee_email = data.get("email") if data else None
            return {
                "is_valid": invitation is not None,
                "data": {"workspace_name": workspace_name, "workspace_id": workspace_id, "email": invitee_email},
            }
        else:
            return {"is_valid": False}


class ActivateApi(Resource):
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("workspace_id", type=str, required=False, nullable=True, location="json")
        parser.add_argument("email", type=email, required=False, nullable=True, location="json")
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        parser.add_argument("name", type=StrLen(30), required=True, nullable=False, location="json")
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
        account.initialized_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        db.session.commit()

        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))

        return {"result": "success", "data": token_pair.model_dump()}


api.add_resource(ActivateCheckApi, "/activate/check")
api.add_resource(ActivateApi, "/activate")
