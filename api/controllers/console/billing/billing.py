import base64
from typing import Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel
from werkzeug.exceptions import BadRequest

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    only_edition_cloud,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.login import login_required
from models import Account
from services.billing_service import BillingService


class SubscriptionQuery(BaseModel):
    plan: Literal[CloudPlan.PROFESSIONAL, CloudPlan.TEAM] = Field(..., description="Subscription plan")
    interval: Literal["month", "year"] = Field(..., description="Billing interval")


class PartnerTenantsPayload(BaseModel):
    click_id: str = Field(..., description="Click Id from partner referral link")


class BillingResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


class BillingInvoiceResponse(ResponseModel):
    url: str


register_schema_models(console_ns, SubscriptionQuery, PartnerTenantsPayload)
register_response_schema_models(console_ns, BillingResponse, BillingInvoiceResponse)


@console_ns.route("/billing/subscription")
class Subscription(Resource):
    @console_ns.doc(params=query_params_from_model(SubscriptionQuery))
    @console_ns.response(200, "Success", console_ns.models[BillingResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        args = SubscriptionQuery.model_validate(request.args.to_dict(flat=True))
        BillingService.is_tenant_owner_or_admin(current_user, session=db.session())
        return BillingService.get_subscription(args.plan, args.interval, current_user.email, current_tenant_id)


@console_ns.route("/billing/invoices")
class Invoices(Resource):
    @console_ns.response(200, "Success", console_ns.models[BillingInvoiceResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        BillingService.is_tenant_owner_or_admin(current_user, session=db.session())
        return BillingService.get_invoices(current_user.email, current_tenant_id)


@console_ns.route("/billing/partners/<string:partner_key>/tenants")
class PartnerTenants(Resource):
    @console_ns.doc("sync_partner_tenants_bindings")
    @console_ns.doc(description="Sync partner tenants bindings")
    @console_ns.doc(params={"partner_key": "Partner key"})
    @console_ns.expect(console_ns.models[PartnerTenantsPayload.__name__])
    @console_ns.response(200, "Tenants synced to partner successfully", console_ns.models[BillingResponse.__name__])
    @console_ns.response(400, "Invalid partner information")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    def put(self, current_user: Account, partner_key: str):
        try:
            args = PartnerTenantsPayload.model_validate(console_ns.payload or {})
            click_id = args.click_id
            decoded_partner_key = base64.b64decode(partner_key).decode("utf-8")
        except Exception:
            raise BadRequest("Invalid partner_key")

        if not click_id or not decoded_partner_key or not current_user.id:
            raise BadRequest("Invalid partner information")

        return BillingService.sync_partner_tenants_bindings(current_user.id, decoded_partner_key, click_id)
