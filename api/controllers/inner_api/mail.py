from flask_restful import (
    Resource,  # type: ignore
    reqparse,
)

from controllers.console.wraps import setup_required
from controllers.inner_api import api
from controllers.inner_api.wraps import billing_inner_api_only, enterprise_inner_api_only
from tasks.mail_inner_task import send_inner_email_task


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

        send_inner_email_task.delay(
            to=args["to"], subject=args["subject"], body=args["body"], substitutions=args["substitutions"]
        )
        return {"message": "success"}, 200


class BillingMail(Resource):
    @setup_required
    @billing_inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("to", type=str, action="append", required=True)
        parser.add_argument("subject", type=str, required=True)
        parser.add_argument("body", type=str, required=True)
        parser.add_argument("substitutions", type=dict, required=False)
        args = parser.parse_args()

        send_inner_email_task.delay(
            to=args["to"], subject=args["subject"], body=args["body"], substitutions=args["substitutions"]
        )
        return {"message": "success"}, 200


api.add_resource(EnterpriseMail, "/enterprise/mail")
api.add_resource(BillingMail, "/billing/mail")
