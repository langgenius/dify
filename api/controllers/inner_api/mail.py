from flask_restx import Resource, reqparse

from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import billing_inner_api_only, enterprise_inner_api_only
from tasks.mail_inner_task import send_inner_email_task

_mail_parser = (
    reqparse.RequestParser()
    .add_argument("to", type=str, action="append", required=True)
    .add_argument("subject", type=str, required=True)
    .add_argument("body", type=str, required=True)
    .add_argument("substitutions", type=dict, required=False)
)


class BaseMail(Resource):
    """Shared logic for sending an inner email."""

    def post(self):
        args = _mail_parser.parse_args()
        send_inner_email_task.delay(  # type: ignore
            to=args["to"],
            subject=args["subject"],
            body=args["body"],
            substitutions=args["substitutions"],
        )
        return {"message": "success"}, 200


@inner_api_ns.route("/enterprise/mail")
class EnterpriseMail(BaseMail):
    method_decorators = [setup_required, enterprise_inner_api_only]

    @inner_api_ns.doc("send_enterprise_mail")
    @inner_api_ns.doc(description="Send internal email for enterprise features")
    @inner_api_ns.expect(_mail_parser)
    @inner_api_ns.doc(
        responses={200: "Email sent successfully", 401: "Unauthorized - invalid API key", 404: "Service not available"}
    )
    def post(self):
        """Send internal email for enterprise features.

        This endpoint allows sending internal emails for enterprise-specific
        notifications and communications.

        Returns:
            dict: Success message with status code 200
        """
        return super().post()


@inner_api_ns.route("/billing/mail")
class BillingMail(BaseMail):
    method_decorators = [setup_required, billing_inner_api_only]

    @inner_api_ns.doc("send_billing_mail")
    @inner_api_ns.doc(description="Send internal email for billing notifications")
    @inner_api_ns.expect(_mail_parser)
    @inner_api_ns.doc(
        responses={200: "Email sent successfully", 401: "Unauthorized - invalid API key", 404: "Service not available"}
    )
    def post(self):
        """Send internal email for billing notifications.

        This endpoint allows sending internal emails for billing-related
        notifications and alerts.

        Returns:
            dict: Success message with status code 200
        """
        return super().post()
