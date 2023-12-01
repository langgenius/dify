from flask_restful import Resource, reqparse
from flask_login import current_user

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from controllers.console.wraps import only_edition_cloud
from libs.login import login_required
from services.billing_service import BillingService


class BillingInfo(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        return {
            "enabled": True,
            "subscription": {
                "plan": "professional"
            },
            "members": {
                "size": 2,
                "limit": 3
            },
            "apps": {
                "size": 20,
                "limit": 50
            },
            "vector_space": {
                "size": 100,
                "limit": 200
            },
            "docs_processing": "top_priority",
            "can_replace_logo": True
        }

        # return BillingService.get_info(current_user.current_tenant_id)


class Subscription(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        prefilled_email = current_user.email
        return {
            "url": f'https://buy.stripe.com/test_fZeaGB7Te2NPgBGeUX?prefilled_email={prefilled_email}'
        }

        # parser = reqparse.RequestParser()
        # parser.add_argument('plan', type=str, required=True, location='args', choices=['professional', 'team'])
        # parser.add_argument('interval', type=str, required=True, location='args', choices=['month', 'year'])
        # args = parser.parse_args()
        #
        # return BillingService.get_subscription(args['plan'], args['interval'], current_user.email, current_user.name, current_user.current_tenant_id)


class Invoices(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        return {
            "url": f'https://billing.stripe.com/p/login/test_eVa7vw9EvgJf78Q7ss?prefilled_email={current_user.email}'
        }

        # return BillingService.get_invoices(current_user.email)


api.add_resource(BillingInfo, '/billing/info')
api.add_resource(Subscription, '/billing/subscription')
api.add_resource(Invoices, '/billing/invoices')
