import os
from typing import Literal

from flask import session
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from controllers.fastopenapi import console_router
from extensions.ext_database import db
from models.model import DifySetup
from services.account_service import TenantService

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
    init_status = get_init_validate_status()
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
    tenant_count = TenantService.get_tenant_count()
    if tenant_count > 0:
        raise AlreadySetupError()

    if payload.password != os.environ.get("INIT_PASSWORD"):
        session["is_init_validated"] = False
        raise InitValidateFailedError()

    session["is_init_validated"] = True
    return InitValidateResponse(result="success")


def get_init_validate_status() -> bool:
    if dify_config.EDITION == "SELF_HOSTED":
        if os.environ.get("INIT_PASSWORD"):
            if session.get("is_init_validated"):
                return True

            with Session(db.engine) as db_session:
                return db_session.execute(select(DifySetup)).scalar_one_or_none() is not None

    return True
