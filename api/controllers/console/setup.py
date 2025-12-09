from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator

from configs import dify_config
from libs.helper import EmailStr, extract_remote_ip
from libs.password import valid_password
from models.model import DifySetup, db
from services.account_service import RegisterService, TenantService

from . import console_ns
from .error import AlreadySetupError, NotInitValidateError
from .init_validate import get_init_validate_status
from .wraps import only_edition_self_hosted

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class SetupRequestPayload(BaseModel):
    email: EmailStr = Field(..., description="Admin email address")
    name: str = Field(..., max_length=30, description="Admin name (max 30 characters)")
    password: str = Field(..., description="Admin password")
    language: str | None = Field(default=None, description="Admin language")

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


console_ns.schema_model(
    SetupRequestPayload.__name__,
    SetupRequestPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/setup")
class SetupApi(Resource):
    @console_ns.doc("get_setup_status")
    @console_ns.doc(description="Get system setup status")
    @console_ns.response(
        200,
        "Success",
        console_ns.model(
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

    @console_ns.doc("setup_system")
    @console_ns.doc(description="Initialize system setup with admin account")
    @console_ns.expect(console_ns.models[SetupRequestPayload.__name__])
    @console_ns.response(
        201, "Success", console_ns.model("SetupResponse", {"result": fields.String(description="Setup result")})
    )
    @console_ns.response(400, "Already setup or validation failed")
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

        args = SetupRequestPayload.model_validate(console_ns.payload)

        # setup
        RegisterService.setup(
            email=args.email,
            name=args.name,
            password=args.password,
            ip_address=extract_remote_ip(request),
            language=args.language,
        )

        return {"result": "success"}, 201


def get_setup_status():
    if dify_config.EDITION == "SELF_HOSTED":
        return db.session.query(DifySetup).first()
    else:
        return True
