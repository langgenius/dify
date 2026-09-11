from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import register_schema_model
from controllers.console.wraps import model_validate, setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import inner_api_only
from extensions.ext_application_services import application_services
from services.entities.mail_entities import InnerMailMessage


class InnerMailPayload(BaseModel):
    to: list[str] = Field(description="Recipient email addresses", min_length=1)
    subject: str
    body: str
    substitutions: dict[str, Any] | None = None


register_schema_model(inner_api_ns, InnerMailPayload)


class BaseMail(Resource):
    """Shared logic for sending an inner email."""

    @inner_api_ns.doc("send_inner_mail")
    @inner_api_ns.doc(description="Send internal email")
    @inner_api_ns.expect(inner_api_ns.models[InnerMailPayload.__name__])
    @model_validate(InnerMailPayload)
    def post(self, args: InnerMailPayload):
        application_services().inner_mail.send(
            InnerMailMessage(
                recipients=tuple(args.to),
                subject=args.subject,
                body=args.body,
                substitutions=args.substitutions,
            )
        )
        return {"message": "success"}, 200


@inner_api_ns.route("/enterprise/mail")
class EnterpriseMail(BaseMail):
    @inner_api_ns.doc("send_enterprise_mail")
    @inner_api_ns.doc(description="Send internal email for enterprise features")
    @inner_api_ns.expect(inner_api_ns.models[InnerMailPayload.__name__])
    @inner_api_ns.doc(
        responses={200: "Email sent successfully", 401: "Unauthorized - invalid API key", 404: "Service not available"}
    )
    @inner_api_only
    @setup_required
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
    @inner_api_ns.doc("send_billing_mail")
    @inner_api_ns.doc(description="Send internal email for billing notifications")
    @inner_api_ns.expect(inner_api_ns.models[InnerMailPayload.__name__])
    @inner_api_ns.doc(
        responses={200: "Email sent successfully", 401: "Unauthorized - invalid API key", 404: "Service not available"}
    )
    @inner_api_only
    @setup_required
    def post(self):
        """Send internal email for billing notifications.

        This endpoint allows sending internal emails for billing-related
        notifications and alerts.

        Returns:
            dict: Success message with status code 200
        """
        return super().post()
