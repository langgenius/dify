import os
from typing import Literal

from flask import session
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from models.model import DifySetup
from services.account_service import TenantService

from . import console_ns
from .error import AlreadySetupError, InitValidateFailedError
from .wraps import only_edition_self_hosted


class InitValidatePayload(BaseModel):
    password: str = Field(..., max_length=30, description="Initialization password")


class InitStatusResponse(ResponseModel):
    status: Literal["finished", "not_started"] = Field(..., description="Initialization status")


class InitValidateResponse(ResponseModel):
    result: str = Field(description="Operation result", examples=["success"])


register_schema_models(console_ns, InitValidatePayload)
register_response_schema_models(console_ns, InitStatusResponse, InitValidateResponse)


def get_init_status() -> InitStatusResponse:
    """Get initialization validation status."""
    init_status = get_init_validate_status()
    if init_status:
        return InitStatusResponse(status="finished")
    return InitStatusResponse(status="not_started")


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


@console_ns.route("/init")
class InitValidateApi(Resource):
    @console_ns.doc("get_init_status")
    @console_ns.doc(description="Get initialization validation status")
    @console_ns.response(200, "Success", console_ns.models[InitStatusResponse.__name__])
    def get(self):
        """Get initialization validation status."""
        return dump_response(InitStatusResponse, get_init_status())

    @console_ns.doc("validate_init_password")
    @console_ns.doc(description="Validate initialization password")
    @console_ns.expect(console_ns.models[InitValidatePayload.__name__])
    @console_ns.response(201, "Success", console_ns.models[InitValidateResponse.__name__])
    @console_ns.response(400, "Already setup or validation failed")
    @only_edition_self_hosted
    def post(self):
        """Validate initialization password."""
        payload = InitValidatePayload.model_validate(console_ns.payload or {})
        return dump_response(InitValidateResponse, validate_init_password(payload)), 201
