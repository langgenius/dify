from flask_login import current_user  # type: ignore
from flask_restful import Resource, reqparse  # type: ignore

from controllers.console import api
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from libs.login import login_required
from services.billing_service import BillingService


class Subscription(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("plan", type=str, required=True, location="args", choices=["professional", "team"])
        parser.add_argument("interval", type=str, required=True, location="args", choices=["month", "year"])
        args = parser.parse_args()

        BillingService.is_tenant_owner_or_admin(current_user)

        return BillingService.get_subscription(
            args["plan"], args["interval"], current_user.email, current_user.current_tenant_id
        )


class Invoices(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_invoices(current_user.email, current_user.current_tenant_id)


api.add_resource(Subscription, "/billing/subscription")
api.add_resource(Invoices, "/billing/invoices")
