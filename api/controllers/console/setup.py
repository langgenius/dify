from flask import request
from flask_accepts import accepts, responds  # pyright: ignore[reportMissingTypeStubs]
from flask_restx import Resource
from marshmallow import Schema, fields, validate

from configs import dify_config
from libs.helper import StrLen, email, extract_remote_ip
from libs.password import valid_password
from models.model import DifySetup, db
from services.account_service import RegisterService, TenantService

from . import console_ns
from .error import AlreadySetupError, NotInitValidateError
from .init_validate import get_init_validate_status
from .wraps import only_edition_self_hosted


class SetupStatusResponse(Schema):
    step = fields.String(required=True, validate=validate.OneOf(["not_started", "finished"]))
    setup_at = fields.String(required=False, metadata={"description": "ISO datetime"})


class SetupRequest(Schema):
    email = fields.String(required=True, validate=email, metadata={"description": "Admin email address"})
    name = fields.String(required=True, validate=StrLen(30), metadata={"description": "Admin name (max 30 characters)"})
    password = fields.String(required=True, validate=valid_password, metadata={"description": "Admin password"})


class SetupResponse(Schema):
    result = fields.String(required=True)


@console_ns.route("/setup")
class SetupApi(Resource):
    @responds(schema=SetupStatusResponse, api=console_ns, status_code=200)
    def get(self):
        """Get system setup status"""
        if dify_config.EDITION == "SELF_HOSTED":
            setup_status = get_setup_status()
            if setup_status and not isinstance(setup_status, bool):
                return {"step": "finished", "setup_at": setup_status.setup_at.isoformat()}
            elif setup_status:
                return {"step": "finished"}
            return {"step": "not_started"}
        return {"step": "finished"}

    @only_edition_self_hosted
    @accepts(schema=SetupRequest, api=console_ns)
    @responds(schema=SetupResponse, api=console_ns, status_code=201)
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

        payload = request.parsed_obj

        RegisterService.setup(
            email=payload["email"],
            name=payload["name"],
            password=payload["password"],
            ip_address=extract_remote_ip(request),
        )
        return {"result": "success"}, 201


def get_setup_status():
    if dify_config.EDITION == "SELF_HOSTED":
        return db.session.query(DifySetup).first()
    else:
        return True
