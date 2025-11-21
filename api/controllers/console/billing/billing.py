import base64

from flask_restx import Resource, fields, reqparse
from werkzeug.exceptions import BadRequest

from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from enums.cloud_plan import CloudPlan
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService


@console_ns.route("/billing/subscription")
class Subscription(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument(
                "plan",
                type=str,
                required=True,
                location="args",
                choices=[CloudPlan.PROFESSIONAL, CloudPlan.TEAM],
            )
            .add_argument("interval", type=str, required=True, location="args", choices=["month", "year"])
        )
        args = parser.parse_args()
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_subscription(args["plan"], args["interval"], current_user.email, current_tenant_id)


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
    @api.doc("sync_partner_tenants_bindings")
    @api.doc(description="Sync partner tenants bindings")
    @api.doc(params={"partner_key": "Partner key"})
    @api.expect(
        api.model(
            "SyncPartnerTenantsBindingsRequest",
            {"click_id": fields.String(required=True, description="Click Id from partner referral link")},
        )
    )
    @api.response(200, "Tenants synced to partner successfully")
    @api.response(400, "Invalid partner information")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def put(self, partner_key: str):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("click_id", required=True, type=str, location="json")
        args = parser.parse_args()

        try:
            click_id = args["click_id"]
            decoded_partner_key = base64.b64decode(partner_key).decode("utf-8")
        except Exception:
            raise BadRequest("Invalid partner_key")

        if not click_id or not decoded_partner_key or not current_user.id:
            raise BadRequest("Invalid partner information")

        return BillingService.sync_partner_tenants_bindings(current_user.id, decoded_partner_key, click_id)
