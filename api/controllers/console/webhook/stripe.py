import logging

import stripe
from flask import request, current_app
from flask_restful import Resource

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import only_edition_cloud
from services.provider_checkout_service import ProviderCheckoutService


class StripeWebhookApi(Resource):
    @setup_required
    @only_edition_cloud
    def post(self):
        payload = request.data
        sig_header = request.headers.get('STRIPE_SIGNATURE')
        webhook_secret = current_app.config.get('STRIPE_WEBHOOK_SECRET')

        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, webhook_secret
            )
        except ValueError as e:
            # Invalid payload
            return 'Invalid payload', 400
        except stripe.error.SignatureVerificationError as e:
            # Invalid signature
            return 'Invalid signature', 400

        # Handle the checkout.session.completed event
        if event['type'] == 'checkout.session.completed':
            logging.debug(event['data']['object']['id'])
            logging.debug(event['data']['object']['amount_subtotal'])
            logging.debug(event['data']['object']['currency'])
            logging.debug(event['data']['object']['payment_intent'])
            logging.debug(event['data']['object']['payment_status'])
            logging.debug(event['data']['object']['metadata'])

            # Fulfill the purchase...
            provider_checkout_service = ProviderCheckoutService()

            try:
                provider_checkout_service.fulfill_provider_order(event)
            except Exception as e:
                logging.debug(str(e))
                return 'success', 200

        return 'success', 200


api.add_resource(StripeWebhookApi, '/webhook/stripe')
