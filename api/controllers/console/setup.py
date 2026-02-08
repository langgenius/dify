from typing import Literal

from flask import request
from pydantic import BaseModel, Field, field_validator

from configs import dify_config
from controllers.fastopenapi import console_router
from libs.helper import EmailStr, extract_remote_ip
from libs.password import valid_password
from models.model import DifySetup, db
from services.account_service import RegisterService, TenantService

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


class SetupStatusResponse(BaseModel):
    step: Literal["not_started", "finished"] = Field(description="Setup step status")
    setup_at: str | None = Field(default=None, description="Setup completion time (ISO format)")


class SetupResponse(BaseModel):
    result: str = Field(description="Setup result", examples=["success"])


@console_router.get(
    "/setup",
    response_model=SetupStatusResponse,
    tags=["console"],
)
def get_setup_status_api() -> SetupStatusResponse:
    """Get system setup status."""
    if dify_config.EDITION == "SELF_HOSTED":
        setup_status = get_setup_status()
        if setup_status and not isinstance(setup_status, bool):
            return SetupStatusResponse(step="finished", setup_at=setup_status.setup_at.isoformat())
        if setup_status:
            return SetupStatusResponse(step="finished")
        return SetupStatusResponse(step="not_started")
    return SetupStatusResponse(step="finished")


@console_router.post(
    "/setup",
    response_model=SetupResponse,
    tags=["console"],
    status_code=201,
)
@only_edition_self_hosted
def setup_system(payload: SetupRequestPayload) -> SetupResponse:
    """Initialize system setup with admin account."""
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
        return db.session.query(DifySetup).first()

    return True
