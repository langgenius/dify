from typing import Literal

from flask import request
from pydantic import BaseModel, Field, field_validator

from controllers.fastopenapi import console_router
from extensions.ext_application_services import application_services
from libs.helper import EmailStr, extract_remote_ip
from libs.password import valid_password
from services.setup_service import (
    InitializationValidationRequiredError,
    SetupAlreadyCompletedError,
    SetupInput,
)

from .error import AlreadySetupError, NotInitValidateError
from .init_validate import is_init_validated
from .wraps import mark_setup_completed, only_edition_self_hosted


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
    """Get system setup status.

    NOTE: This endpoint is unauthenticated by design.

    During first-time bootstrap there is no admin account yet, so frontend initialization must be
    able to query setup progress before any login flow exists.

    Only bootstrap-safe status information should be returned by this endpoint.
    """
    setup_status = application_services().setup.get_status()
    if not setup_status.completed:
        return SetupStatusResponse(step="not_started")

    setup_at = setup_status.setup_at.isoformat() if setup_status.setup_at is not None else None
    return SetupStatusResponse(step="finished", setup_at=setup_at)


@console_router.post(
    "/setup",
    response_model=SetupResponse,
    tags=["console"],
    status_code=201,
)
@only_edition_self_hosted
def setup_system(payload: SetupRequestPayload) -> SetupResponse:
    """Initialize system setup with admin account.

    NOTE: This endpoint is unauthenticated by design for first-time bootstrap.
    Access is restricted to self-hosted editions (`COMMUNITY` and `ENTERPRISE`), one-time setup guards,
    and init-password validation rather than user session authentication.
    """
    try:
        application_services().setup.initialize(
            SetupInput(
                email=payload.email,
                name=payload.name,
                password=payload.password,
                ip_address=extract_remote_ip(request),
                language=payload.language,
            ),
            initialization_validated=is_init_validated(),
        )
    except SetupAlreadyCompletedError:
        raise AlreadySetupError() from None
    except InitializationValidationRequiredError:
        raise NotInitValidateError() from None

    mark_setup_completed()

    return SetupResponse(result="success")
