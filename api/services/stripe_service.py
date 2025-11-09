import stripe

from configs import dify_config
from extensions.ext_database import db
from models.account import Account


class StripeService:
    def __init__(self):
        stripe.api_key = dify_config.STRIPE_SECRET_KEY

    @staticmethod
    def construct_event(payload, sig_header):
        return stripe.Webhook.construct_event(payload, sig_header, dify_config.STRIPE_WEBHOOK_SECRET)

    @staticmethod
    def handle_checkout_session_completed(session):
        customer_id = session.get("customer")
        subscription_id = session.get("subscription")

        if not customer_id or not subscription_id:
            return

        # Update user's subscription status in the database
        account = db.session.query(Account).where(Account.stripe_customer_id == customer_id).first()
        if account:
            account.subscription_status = "active"
            db.session.commit()

    @staticmethod
    def handle_customer_subscription_deleted(subscription):
        customer_id = subscription.get("customer")

        if not customer_id:
            return

        # Update user's subscription status in the database
        account = db.session.query(Account).where(Account.stripe_customer_id == customer_id).first()
        if account:
            account.subscription_status = "canceled"
            db.session.commit()
