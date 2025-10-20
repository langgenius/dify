import os

from flask import session
from flask_restx import Resource, fields, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_database import db
from libs.helper import StrLen
from models.model import DifySetup
from services.account_service import TenantService

from . import api, console_ns
from .error import AlreadySetupError, InitValidateFailedError
from .wraps import only_edition_self_hosted


@console_ns.route("/init")
class InitValidateAPI(Resource):
    @api.doc("get_init_status")
    @api.doc(description="Get initialization validation status")
    @api.response(
        200,
        "Success",
        model=api.model(
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

    @api.doc("validate_init_password")
    @api.doc(description="Validate initialization password for self-hosted edition")
    @api.expect(
        api.model(
            "InitValidateRequest",
            {"password": fields.String(required=True, description="Initialization password", max_length=30)},
        )
    )
    @api.response(
        201,
        "Success",
        model=api.model("InitValidateResponse", {"result": fields.String(description="Operation result")}),
    )
    @api.response(400, "Already setup or validation failed")
    @only_edition_self_hosted
    def post(self):
        """Validate initialization password"""
        # is tenant created
        tenant_count = TenantService.get_tenant_count()
        if tenant_count > 0:
            raise AlreadySetupError()

        parser = reqparse.RequestParser().add_argument("password", type=StrLen(30), required=True, location="json")
        input_password = parser.parse_args()["password"]

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
