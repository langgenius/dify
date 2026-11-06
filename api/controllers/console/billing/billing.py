from typing import Literal, assert_never

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.billing.error import (
    BillingOperationFailedError,
    BillingOperationFailedErrorResponse,
    BillingUnavailableError,
    BillingUnavailableErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    to_billing_request_error,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums import CloudPlan, DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.billing_client import billing
from services.errors.billing import UnknownErrorReason

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


def _subscription_portal_error(error: billing.BillingSubscriptionUpstreamError) -> BaseHTTPException:
    match error.reason:
        case (
            ""
            | "CODEC"
            | "VALIDATOR"
            | "UNKNOWN"
            | "INVALID_SECRET_KEY"
            | "REQUEST_IN_PROGRESS"
            | "MISSING_TENANT_ID"
            | "INVALID_TENANT_ID"
            | "MISSING_ACCOUNT_ID"
            | "INVALID_ACCOUNT_ID"
            | "MISSING_PREFILLED_EMAIL"
            | "INVALID_PAYMENT_LINK_REQUEST"
            | "MISSING_PLAN"
            | "MISSING_INTERVAL"
            | "INVALID_PLAN_INTERVAL"
            | "CREATE_SUBSCRIPTION_PAYMENT_LINK_FAILED"
            | "INVALID_KNOWLEDGE_RATE_LIMIT_REQUEST"
            | "TENANT_IDS_COUNT_TOO_LARGE"
            | "DOCUMENT_USAGE_UNAVAILABLE"
        ):
            return to_billing_request_error(error)
        case UnknownErrorReason() | None:
            return to_billing_request_error(error)
        case unreachable:
            assert_never(unreachable)


def _invoice_portal_error(error: billing.BillingInvoiceUpstreamError) -> BaseHTTPException:
    match error.reason:
        case (
            ""
            | "CODEC"
            | "VALIDATOR"
            | "UNKNOWN"
            | "INVALID_SECRET_KEY"
            | "REQUEST_IN_PROGRESS"
            | "MISSING_TENANT_ID"
            | "INVALID_TENANT_ID"
            | "MISSING_ACCOUNT_ID"
            | "INVALID_ACCOUNT_ID"
            | "MISSING_PREFILLED_EMAIL"
            | "INVALID_INVOICE_REQUEST"
            | "CREATE_INVOICE_PORTAL_FAILED"
        ):
            return to_billing_request_error(error)
        case UnknownErrorReason() | None:
            return to_billing_request_error(error)
        case unreachable:
            assert_never(unreachable)


@console_ns.route("/billing/subscription")
class Subscription(Resource):
    @error_responses(BillingOperationFailedError, BillingUnavailableError)
    @console_ns.doc(params=query_params_from_model(SubscriptionQuery))
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
        except billing.BillingSubscriptionUpstreamError as error:
            raise _subscription_portal_error(error) from error
        return dump_response(BillingSubscriptionResponse, data)


@console_ns.route("/billing/invoices")
class Invoices(Resource):
    @error_responses(BillingOperationFailedError, BillingUnavailableError)
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
        except billing.BillingInvoiceUpstreamError as error:
            raise _invoice_portal_error(error) from error
        return dump_response(BillingInvoiceResponse, data)
