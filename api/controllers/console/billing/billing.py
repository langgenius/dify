import base64

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from enums.cloud_plan import CloudPlan
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class SubscriptionQuery(BaseModel):
    plan: str = Field(..., description="Subscription plan")
    interval: str = Field(..., description="Billing interval")

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, value: str) -> str:
        if value not in [CloudPlan.PROFESSIONAL, CloudPlan.TEAM]:
            raise ValueError("Invalid plan")
        return value

    @field_validator("interval")
    @classmethod
    def validate_interval(cls, value: str) -> str:
        if value not in {"month", "year"}:
            raise ValueError("Invalid interval")
        return value


class PartnerTenantsPayload(BaseModel):
    click_id: str = Field(..., description="Click Id from partner referral link")


for model in (SubscriptionQuery, PartnerTenantsPayload):
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/billing/subscription")
class Subscription(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        args = SubscriptionQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_subscription(args.plan, args.interval, current_user.email, current_tenant_id)


@console_ns.route("/billing/invoices")
class Invoices(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_invoices(current_user.email, current_tenant_id)


@console_ns.route("/billing/partners/<string:partner_key>/tenants")
class PartnerTenants(Resource):
    @console_ns.doc("sync_partner_tenants_bindings")
    @console_ns.doc(description="Sync partner tenants bindings")
    @console_ns.doc(params={"partner_key": "Partner key"})
    @console_ns.expect(
        console_ns.model(
            "SyncPartnerTenantsBindingsRequest",
            {"click_id": fields.String(required=True, description="Click Id from partner referral link")},
        )
    )
    @console_ns.response(200, "Tenants synced to partner successfully")
    @console_ns.response(400, "Invalid partner information")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def put(self, partner_key: str):
        current_user, _ = current_account_with_tenant()

        try:
            args = PartnerTenantsPayload.model_validate(console_ns.payload or {})
            click_id = args.click_id
            decoded_partner_key = base64.b64decode(partner_key).decode("utf-8")
        except Exception:
            raise BadRequest("Invalid partner_key")

        if not click_id or not decoded_partner_key or not current_user.id:
            raise BadRequest("Invalid partner information")

        return BillingService.sync_partner_tenants_bindings(current_user.id, decoded_partner_key, click_id)
