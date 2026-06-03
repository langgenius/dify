from typing import Literal

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from fields.base import ResponseModel
from libs.helper import EmailStr, dump_response, extract_remote_ip
from libs.password import valid_password
from models.model import DifySetup, db
from services.account_service import RegisterService, TenantService

from . import console_ns
from .error import AlreadySetupError, NotInitValidateError
from .init_validate import get_init_validate_status
from .wraps import only_edition_self_hosted


class SetupRequestPayload(BaseModel):
    email: EmailStr = Field(..., description="Admin email address")
    name: str = Field(..., max_length=30, description="Admin name (max 30 characters)")
    password: str = Field(..., description="Admin password")
    language: str | None = Field(default=None, description="Admin language")

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


class SetupStatusResponse(ResponseModel):
    step: Literal["not_started", "finished"] = Field(description="Setup step status")
    setup_at: str | None = Field(default=None, description="Setup completion time (ISO format)")


class SetupResponse(ResponseModel):
    result: str = Field(description="Setup result", examples=["success"])


register_schema_models(console_ns, SetupRequestPayload)
register_response_schema_models(console_ns, SetupStatusResponse, SetupResponse)


def get_setup_status_api() -> SetupStatusResponse:
    """Get system setup status.

    NOTE: This endpoint is unauthenticated by design.

    During first-time bootstrap there is no admin account yet, so frontend initialization must be
    able to query setup progress before any login flow exists.

    Only bootstrap-safe status information should be returned by this endpoint.
    """
    if dify_config.EDITION == "SELF_HOSTED":
        setup_status = get_setup_status()
        if setup_status and not isinstance(setup_status, bool):
            return SetupStatusResponse(step="finished", setup_at=setup_status.setup_at.isoformat())
        if setup_status:
            return SetupStatusResponse(step="finished")
        return SetupStatusResponse(step="not_started")
    return SetupStatusResponse(step="finished")


@only_edition_self_hosted
def setup_system(payload: SetupRequestPayload) -> SetupResponse:
    """Initialize system setup with admin account.

    NOTE: This endpoint is unauthenticated by design for first-time bootstrap.
    Access is restricted by deployment mode (`SELF_HOSTED`), one-time setup guards,
    and init-password validation rather than user session authentication.
    """
    if get_setup_status():
        raise AlreadySetupError()

    tenant_count = TenantService.get_tenant_count()
    if tenant_count > 0:
        raise AlreadySetupError()

    if not get_init_validate_status():
        raise NotInitValidateError()

    normalized_email = payload.email.lower()

    RegisterService.setup(
        email=normalized_email,
        name=payload.name,
        password=payload.password,
        ip_address=extract_remote_ip(request),
        language=payload.language,
    )

    return SetupResponse(result="success")


def get_setup_status() -> DifySetup | bool | None:
    if dify_config.EDITION == "SELF_HOSTED":
        return db.session.scalar(select(DifySetup).limit(1))

    return True


@console_ns.route("/setup")
class SetupApi(Resource):
    @console_ns.doc("get_setup_status")
    @console_ns.doc(description="Get system setup status")
    @console_ns.response(200, "Success", console_ns.models[SetupStatusResponse.__name__])
    def get(self):
        """Get system setup status."""
        return dump_response(SetupStatusResponse, get_setup_status_api())

    @console_ns.doc("setup_system")
    @console_ns.doc(description="Initialize system setup with admin account")
    @console_ns.expect(console_ns.models[SetupRequestPayload.__name__])
    @console_ns.response(201, "Success", console_ns.models[SetupResponse.__name__])
    @console_ns.response(400, "Already setup or validation failed")
    @only_edition_self_hosted
    def post(self):
        """Initialize system setup with admin account."""
        payload = SetupRequestPayload.model_validate(console_ns.payload or {})
        return dump_response(SetupResponse, setup_system(payload)), 201
