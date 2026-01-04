import os

from flask import session
from flask_restx import Resource, fields
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_database import db
from models.model import DifySetup
from services.account_service import TenantService

from . import console_ns
from .error import AlreadySetupError, InitValidateFailedError
from .wraps import only_edition_self_hosted

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class InitValidatePayload(BaseModel):
    password: str = Field(..., max_length=30)


console_ns.schema_model(
    InitValidatePayload.__name__,
    InitValidatePayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/init")
class InitValidateAPI(Resource):
    @console_ns.doc("get_init_status")
    @console_ns.doc(description="Get initialization validation status")
    @console_ns.response(
        200,
        "Success",
        model=console_ns.model(
            "InitStatusResponse",
            {"status": fields.String(description="Initialization status", enum=["finished", "not_started"])},
        ),
    )
    def get(self):
        """Get initialization validation status"""
        init_status = get_init_validate_status()
        if init_status:
            return {"status": "finished"}
        return {"status": "not_started"}

    @console_ns.doc("validate_init_password")
    @console_ns.doc(description="Validate initialization password for self-hosted edition")
    @console_ns.expect(console_ns.models[InitValidatePayload.__name__])
    @console_ns.response(
        201,
        "Success",
        model=console_ns.model("InitValidateResponse", {"result": fields.String(description="Operation result")}),
    )
    @console_ns.response(400, "Already setup or validation failed")
    @only_edition_self_hosted
    def post(self):
        """Validate initialization password"""
        # is tenant created
        tenant_count = TenantService.get_tenant_count()
        if tenant_count > 0:
            raise AlreadySetupError()

        payload = InitValidatePayload.model_validate(console_ns.payload)
        input_password = payload.password

        if input_password != os.environ.get("INIT_PASSWORD"):
            session["is_init_validated"] = False
            raise InitValidateFailedError()

        session["is_init_validated"] = True
        return {"result": "success"}, 201


def get_init_validate_status():
    if dify_config.EDITION == "SELF_HOSTED":
        if os.environ.get("INIT_PASSWORD"):
            if session.get("is_init_validated"):
                return True

            with Session(db.engine) as db_session:
                return db_session.execute(select(DifySetup)).scalar_one_or_none()

    return True
