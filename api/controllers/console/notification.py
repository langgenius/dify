from flask_restx import Resource

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService


@console_ns.route("/notification")
class NotificationApi(Resource):
    @console_ns.doc("get_notification")
    @console_ns.doc(description="Get notification for the current user")
    @console_ns.doc(
        responses={
            200: "Success",
            401: "Unauthorized",
        }
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, _ = current_account_with_tenant()
        notification = BillingService.read_notification(current_user.email)
        return notification
