from typing import Literal

from flask import session
from pydantic import BaseModel, Field

from controllers.fastopenapi import console_router
from extensions.ext_application_services import application_services
from services.init_validation_service import AlreadyInitializedError, InvalidInitializationPasswordError

from .error import AlreadySetupError, InitValidateFailedError
from .wraps import only_edition_self_hosted


class InitValidatePayload(BaseModel):
    password: str = Field(..., max_length=30, description="Initialization password")


class InitStatusResponse(BaseModel):
    status: Literal["finished", "not_started"] = Field(..., description="Initialization status")


class InitValidateResponse(BaseModel):
    result: str = Field(description="Operation result", examples=["success"])


@console_router.get(
    "/init",
    response_model=InitStatusResponse,
    tags=["console"],
)
def get_init_status() -> InitStatusResponse:
    """Get initialization validation status."""
    init_status = is_init_validated()
    if init_status:
        return InitStatusResponse(status="finished")
    return InitStatusResponse(status="not_started")


@console_router.post(
    "/init",
    response_model=InitValidateResponse,
    tags=["console"],
    status_code=201,
)
@only_edition_self_hosted
def validate_init_password(payload: InitValidatePayload) -> InitValidateResponse:
    """Validate initialization password."""
    try:
        application_services().init_validation.validate_password(payload.password)
    except AlreadyInitializedError:
        raise AlreadySetupError() from None
    except InvalidInitializationPasswordError:
        session["is_init_validated"] = False
        raise InitValidateFailedError() from None

    session["is_init_validated"] = True
    return InitValidateResponse(result="success")


def is_init_validated() -> bool:
    return application_services().init_validation.is_validated(
        session_validated=bool(session.get("is_init_validated")),
    )
