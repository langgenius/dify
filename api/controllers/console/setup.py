from flask import request
from flask_restx import Resource, fields, reqparse

from configs import dify_config
from libs.helper import StrLen, email, extract_remote_ip
from libs.password import valid_password
from models.model import DifySetup, db
from services.account_service import RegisterService, TenantService

from . import api, console_ns
from .error import AlreadySetupError, NotInitValidateError
from .init_validate import get_init_validate_status
from .wraps import only_edition_self_hosted


@console_ns.route("/setup")
class SetupApi(Resource):
    @api.doc("get_setup_status")
    @api.doc(description="Get system setup status")
    @api.response(
        200,
        "Success",
        api.model(
            "SetupStatusResponse",
            {
                "step": fields.String(description="Setup step status", enum=["not_started", "finished"]),
                "setup_at": fields.String(description="Setup completion time (ISO format)", required=False),
            },
        ),
    )
    def get(self):
        """Get system setup status"""
        if dify_config.EDITION == "SELF_HOSTED":
            setup_status = get_setup_status()
            # Check if setup_status is a DifySetup object rather than a bool
            if setup_status and not isinstance(setup_status, bool):
                return {"step": "finished", "setup_at": setup_status.setup_at.isoformat()}
            elif setup_status:
                return {"step": "finished"}
            return {"step": "not_started"}
        return {"step": "finished"}

    @api.doc("setup_system")
    @api.doc(description="Initialize system setup with admin account")
    @api.expect(
        api.model(
            "SetupRequest",
            {
                "email": fields.String(required=True, description="Admin email address"),
                "name": fields.String(required=True, description="Admin name (max 30 characters)"),
                "password": fields.String(required=True, description="Admin password"),
            },
        )
    )
    @api.response(201, "Success", api.model("SetupResponse", {"result": fields.String(description="Setup result")}))
    @api.response(400, "Already setup or validation failed")
    @only_edition_self_hosted
    def post(self):
        """Initialize system setup with admin account"""
        # is set up
        if get_setup_status():
            raise AlreadySetupError()

        # is tenant created
        tenant_count = TenantService.get_tenant_count()
        if tenant_count > 0:
            raise AlreadySetupError()

        if not get_init_validate_status():
            raise NotInitValidateError()

        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("name", type=StrLen(30), required=True, location="json")
            .add_argument("password", type=valid_password, required=True, location="json")
            .add_argument("language", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        # setup
        RegisterService.setup(
            email=args["email"],
            name=args["name"],
            password=args["password"],
            ip_address=extract_remote_ip(request),
            language=args["language"],
        )

        return {"result": "success"}, 201


def get_setup_status():
    if dify_config.EDITION == "SELF_HOSTED":
        return db.session.query(DifySetup).first()
    else:
        return True
