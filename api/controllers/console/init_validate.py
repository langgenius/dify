import os

from flask import session
from flask_restful import Resource, reqparse  # type: ignore
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_database import db
from libs.helper import StrLen
from models.model import DifySetup
from services.account_service import TenantService

from . import api
from .error import AlreadySetupError, InitValidateFailedError
from .wraps import only_edition_self_hosted


class InitValidateAPI(Resource):
    def get(self):
        init_status = get_init_validate_status()
        if init_status:
            return {"status": "finished"}
        return {"status": "not_started"}

    @only_edition_self_hosted
    def post(self):
        # is tenant created
        tenant_count = TenantService.get_tenant_count()
        if tenant_count > 0:
            raise AlreadySetupError()

        parser = reqparse.RequestParser()
        parser.add_argument("password", type=StrLen(30), required=True, location="json")
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


api.add_resource(InitValidateAPI, "/init")
