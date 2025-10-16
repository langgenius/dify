from flask.views import MethodView
from flask_restx import reqparse

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService


@console_ns.route("/billing/subscription")
class Subscription(MethodView):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        parser = reqparse.RequestParser()
        parser.add_argument("plan", type=str, required=True, location="args", choices=["professional", "team"])
        parser.add_argument("interval", type=str, required=True, location="args", choices=["month", "year"])
        args = parser.parse_args()
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_subscription(args["plan"], args["interval"], current_user.email, current_tenant_id)


@console_ns.route("/billing/invoices")
class Invoices(MethodView):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_invoices(current_user.email, current_tenant_id)
