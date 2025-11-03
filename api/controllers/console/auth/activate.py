from flask import request
from flask_restx import Resource, fields, reqparse

from constants.languages import supported_language
from controllers.console import api, console_ns
from controllers.console.error import AlreadyActivateError
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import StrLen, email, extract_remote_ip, timezone
from models import AccountStatus
from services.account_service import AccountService, RegisterService

active_check_parser = (
    reqparse.RequestParser()
    .add_argument("workspace_id", type=str, required=False, nullable=True, location="args", help="Workspace ID")
    .add_argument("email", type=email, required=False, nullable=True, location="args", help="Email address")
    .add_argument("token", type=str, required=True, nullable=False, location="args", help="Activation token")
)


@console_ns.route("/activate/check")
class ActivateCheckApi(Resource):
    @api.doc("check_activation_token")
    @api.doc(description="Check if activation token is valid")
    @api.expect(active_check_parser)
    @api.response(
        200,
        "Success",
        api.model(
            "ActivationCheckResponse",
            {
                "is_valid": fields.Boolean(description="Whether token is valid"),
                "data": fields.Raw(description="Activation data if valid"),
            },
        ),
    )
    def get(self):
        args = active_check_parser.parse_args()

        workspaceId = args["workspace_id"]
        reg_email = args["email"]
        token = args["token"]

        invitation = RegisterService.get_invitation_if_token_valid(workspaceId, reg_email, token)
        if invitation:
            data = invitation.get("data", {})
            tenant = invitation.get("tenant", None)
            workspace_name = tenant.name if tenant else None
            workspace_id = tenant.id if tenant else None
            invitee_email = data.get("email") if data else None
            return {
                "is_valid": invitation is not None,
                "data": {"workspace_name": workspace_name, "workspace_id": workspace_id, "email": invitee_email},
            }
        else:
            return {"is_valid": False}


active_parser = (
    reqparse.RequestParser()
    .add_argument("workspace_id", type=str, required=False, nullable=True, location="json")
    .add_argument("email", type=email, required=False, nullable=True, location="json")
    .add_argument("token", type=str, required=True, nullable=False, location="json")
    .add_argument("name", type=StrLen(30), required=True, nullable=False, location="json")
    .add_argument("interface_language", type=supported_language, required=True, nullable=False, location="json")
    .add_argument("timezone", type=timezone, required=True, nullable=False, location="json")
)


@console_ns.route("/activate")
class ActivateApi(Resource):
    @api.doc("activate_account")
    @api.doc(description="Activate account with invitation token")
    @api.expect(active_parser)
    @api.response(
        200,
        "Account activated successfully",
        api.model(
            "ActivationResponse",
            {
                "result": fields.String(description="Operation result"),
                "data": fields.Raw(description="Login token data"),
            },
        ),
    )
    @api.response(400, "Already activated or invalid token")
    def post(self):
        args = active_parser.parse_args()

        invitation = RegisterService.get_invitation_if_token_valid(args["workspace_id"], args["email"], args["token"])
        if invitation is None:
            raise AlreadyActivateError()

        RegisterService.revoke_token(args["workspace_id"], args["email"], args["token"])

        account = invitation["account"]
        account.name = args["name"]

        account.interface_language = args["interface_language"]
        account.timezone = args["timezone"]
        account.interface_theme = "light"
        account.status = AccountStatus.ACTIVE
        account.initialized_at = naive_utc_now()
        db.session.commit()

        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))

        return {"result": "success", "data": token_pair.model_dump()}
