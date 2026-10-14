from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.billing.error import (
    BillingOperationFailedErrorResponse,
    BillingUnavailableErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    to_billing_request_error,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums import CloudPlan, DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.errors.billing import BillingError

_BILLING_PORTAL_ALLOWED_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})


class SubscriptionQuery(BaseModel):
    plan: Literal[CloudPlan.PROFESSIONAL, CloudPlan.TEAM] = Field(..., description="Subscription plan")
    interval: Literal["month", "year"] = Field(..., description="Billing interval")


class BillingInvoiceResponse(ResponseModel):
    url: str


class BillingSubscriptionResponse(ResponseModel):
    url: str


register_schema_models(console_ns, SubscriptionQuery)
register_response_schema_models(
    console_ns,
    BillingOperationFailedErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    BillingUnavailableErrorResponse,
    BillingInvoiceResponse,
    BillingSubscriptionResponse,
)


@console_ns.route("/billing/subscription")
class Subscription(Resource):
    @console_ns.doc_query(SubscriptionQuery)
    @console_ns.response(200, "Success", console_ns.models[BillingSubscriptionResponse.__name__])
    @console_ns.response(403, "Forbidden")
    @console_ns.response(
        422,
        "Invalid subscription query",
        console_ns.models[BillingUnprocessableEntityErrorResponse.__name__],
    )
    @console_ns.response(
        502,
        "Billing operation failed",
        console_ns.models[BillingOperationFailedErrorResponse.__name__],
    )
    @console_ns.response(
        503,
        "Billing unavailable",
        console_ns.models[BillingUnavailableErrorResponse.__name__],
    )
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_BILLING_PORTAL_ALLOWED_ROLES,
    )
    @model_validate(SubscriptionQuery)
    def get(self, req_data: SubscriptionQuery, request_context: RequestContext):
        try:
            data = application_services().billing_portal.get_subscription(
                request_context,
                plan=req_data.plan,
                interval=req_data.interval,
            )
        except BillingError as error:
            raise to_billing_request_error(error) from error
        return dump_response(BillingSubscriptionResponse, data)


@console_ns.route("/billing/invoices")
class Invoices(Resource):
    @console_ns.response(200, "Success", console_ns.models[BillingInvoiceResponse.__name__])
    @console_ns.response(403, "Forbidden")
    @console_ns.response(
        502,
        "Billing operation failed",
        console_ns.models[BillingOperationFailedErrorResponse.__name__],
    )
    @console_ns.response(
        503,
        "Billing unavailable",
        console_ns.models[BillingUnavailableErrorResponse.__name__],
    )
    @console_account_admission(
        editions=frozenset({DeploymentEdition.CLOUD}),
        allowed_roles=_BILLING_PORTAL_ALLOWED_ROLES,
    )
    def get(self, request_context: RequestContext):
        try:
            data = application_services().billing_portal.get_invoices(request_context)
        except BillingError as error:
            raise to_billing_request_error(error) from error
        return dump_response(BillingInvoiceResponse, data)
