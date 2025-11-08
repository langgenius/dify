import stripe
from flask import request, jsonify
from flask_restx import Resource, Namespace

from services.stripe_service import StripeService

ns = Namespace('webhooks', description='Webhook operations')

@ns.route('/stripe')
class StripeWebhook(Resource):
    def post(self):
        payload = request.get_data(as_text=True)
        sig_header = request.headers.get('Stripe-Signature')

        try:
            event = StripeService.construct_event(payload, sig_header)
        except ValueError as e:
            # Invalid payload
            return 'Invalid payload', 400
        except stripe.error.SignatureVerificationError as e:
            # Invalid signature
            return 'Invalid signature', 400

        # Handle the event
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            StripeService.handle_checkout_session_completed(session)
        elif event['type'] == 'customer.subscription.deleted':
            subscription = event['data']['object']
            StripeService.handle_customer_subscription_deleted(subscription)
        else:
            print('Unhandled event type {}'.format(event['type']))

        return jsonify({'status': 'success'})
