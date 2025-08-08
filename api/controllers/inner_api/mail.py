from flask_restful import (
    Resource,  # type: ignore
    reqparse,
)

from controllers.console.wraps import setup_required
from controllers.inner_api import api
from controllers.inner_api.wraps import enterprise_inner_api_only
from services.enterprise.mail_service import DifyMail, EnterpriseMailService


class EnterpriseMail(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("to", type=str, action="append", required=True)
        parser.add_argument("subject", type=str, required=True)
        parser.add_argument("body", type=str, required=True)
        parser.add_argument("substitutions", type=dict, required=False)
        args = parser.parse_args()

        EnterpriseMailService.send_mail(DifyMail(**args))
        return {"message": "success"}, 200


api.add_resource(EnterpriseMail, "/enterprise/mail")
