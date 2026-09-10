import base64
from typing import Any, Literal

from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel
from werkzeug.exceptions import BadRequest

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
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


class PartnerTenantsPayload(BaseModel):
    click_id: str = Field(..., description="Click Id from partner referral link")


class BillingResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


class BillingInvoiceResponse(ResponseModel):
    url: str


class BillingSubscriptionResponse(ResponseModel):
    url: str


register_schema_models(console_ns, SubscriptionQuery, PartnerTenantsPayload)
register_response_schema_models(
    console_ns,
    BillingOperationFailedErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    BillingUnavailableErrorResponse,
    BillingResponse,
    BillingInvoiceResponse,
    BillingSubscriptionResponse,
)


@console_ns.route("/billing/subscription")
class Subscription(Resource):
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


@console_ns.route("/billing/partners/<string:partner_key>/tenants")
class PartnerTenants(Resource):
    @console_ns.doc("sync_partner_tenants_bindings")
    @console_ns.doc(description="Sync partner tenants bindings")
    @console_ns.doc(params={"partner_key": "Partner key"})
    @console_ns.expect(console_ns.models[PartnerTenantsPayload.__name__])
    @console_ns.response(200, "Tenants synced to partner successfully", console_ns.models[BillingResponse.__name__])
    @console_ns.response(400, "Invalid partner information")
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @model_validate(PartnerTenantsPayload)
    def put(self, req_data: PartnerTenantsPayload, request_context: RequestContext, partner_key: str):
        try:
            click_id = req_data.click_id
            decoded_partner_key = base64.b64decode(partner_key).decode("utf-8")
        except Exception as e:
            raise BadRequest("Invalid partner_key") from e

        if not click_id or not decoded_partner_key:
            raise BadRequest("Invalid partner information")

        return application_services().partner_tenant_bindings.sync(
            account_id=request_context.account_id,
            partner_key=decoded_partner_key,
            click_id=click_id,
        )
