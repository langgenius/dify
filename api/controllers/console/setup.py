from flask import request
from flask_restful import Resource, reqparse  # type: ignore

from configs import dify_config
from libs.helper import StrLen, email, extract_remote_ip
from libs.password import valid_password
from models.model import DifySetup
from services.account_service import RegisterService, TenantService

from . import api
from .error import AlreadySetupError, NotInitValidateError
from .init_validate import get_init_validate_status
from .wraps import only_edition_self_hosted


class SetupApi(Resource):
    def get(self):
        if dify_config.EDITION == "SELF_HOSTED":
            setup_status = get_setup_status()
            if setup_status:
                return {"step": "finished", "setup_at": setup_status.setup_at.isoformat()}
            return {"step": "not_started"}
        return {"step": "finished"}

    @only_edition_self_hosted
    def post(self):
        # is set up
        if get_setup_status():
            raise AlreadySetupError()

        # is tenant created
        tenant_count = TenantService.get_tenant_count()
        if tenant_count > 0:
            raise AlreadySetupError()

        if not get_init_validate_status():
            raise NotInitValidateError()

        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("name", type=StrLen(30), required=True, location="json")
        parser.add_argument("password", type=valid_password, required=True, location="json")
        args = parser.parse_args()

        # setup
        RegisterService.setup(
            email=args["email"], name=args["name"], password=args["password"], ip_address=extract_remote_ip(request)
        )

        return {"result": "success"}, 201


def get_setup_status():
    if dify_config.EDITION == "SELF_HOSTED":
        return DifySetup.query.first()
    return True


api.add_resource(SetupApi, "/setup")
