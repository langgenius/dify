from flask_restful import Resource
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
            "subscription": {
                "plan": "professional",
                "duration": "yearly"
            },
            "members": {
                "size": 2,
                "limit": 3
            },
            "app": {
                "size": 20,
                "limit": 50
            },
            "vector_space": {
                "size": 100,
                "limit": 200
            },
            "docs_processing": "top_priority",
            "can_replace_logo": True,
            "logs_history_days": 0
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
            "monthly": [
                {
                    "plan": "professional",
                    "url": f'https://buy.stripe.com/test_7sI1615L60FH4SYbII?prefilled_email={prefilled_email}'
                },
                {
                    "plan": "team",
                    "url": f'https://buy.stripe.com/test_7sI7upflGdst99eeUW?prefilled_email={prefilled_email}'
                }
            ],
            "yearly": [
                {
                    "plan": "professional",
                    "url": f'https://buy.stripe.com/test_bIY01X2yUfABety8wx?prefilled_email={prefilled_email}'
                },
                {
                    "plan": "team",
                    "url": f'https://buy.stripe.com/test_fZeaGB7Te2NPgBGeUX?prefilled_email={prefilled_email}'
                }
            ]
        }

        # return BillingService.get_subscription(current_user.email, current_user.name)


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
