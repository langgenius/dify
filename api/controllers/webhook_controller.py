# api/controllers/webhook_controller.py
# Added missing stripe imports to prevent NameError and ensured Blueprint registration

import os

import stripe  # Added missing import
from flask import Blueprint, jsonify, request  # Ensure Blueprint is imported

# Import your services and models
from models.account import Account

# Initialize the Flask Blueprint for controllers
controllers = Blueprint('controllers', __name__)


@controllers.route('/webhook/stripe', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events for subscription management"""

    payload = request.get_data(as_text=True)
    sig_header = request.headers.get('Stripe-Signature')
    endpoint_secret = os.environ.get('STRIPE_WEBHOOK_SECRET')

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, endpoint_secret
        )
    except ValueError as e:
        # Invalid payload
        return jsonify({'error': 'Invalid payload'}), 400
    except stripe.error.SignatureVerificationError as e:
        # Invalid signature
        return jsonify({'error': 'Invalid signature'}), 400

    # Dispatch the event type
    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        handle_successful_payment(session)
    elif event['type'] == 'customer.subscription.updated':
        subscription = event['data']['object']
        handle_subscription_update(subscription)
    elif event['type'] == 'customer.subscription.deleted':
        subscription = event['data']['object']
        handle_subscription_cancellation(subscription)

    # In a real application, you might use a logger here instead of print.
    # print(f"Received event type: {event['type']}")

    return jsonify({'received': True}), 200


def handle_successful_payment(session):
    """Process successful payment and activate subscription"""
    # Assuming client_reference_id stores the user_id
    user_id = session.get('client_reference_id')
    if user_id:
        account = Account.query.filter_by(id=user_id).first()
        if account:
            # Update the account status and store the subscription ID
            account.subscription_status = 'active'
            account.subscription_id = session.get('subscription')
            # Assuming 'account.save()' persists the changes to the database
            account.save()
            # print(f"User {user_id} subscription activated.")
        # else:
            # print(f"Account not found for user_id: {user_id}")


def handle_subscription_update(subscription):
    """Handle subscription updates (e.g., plan changes, renewal)"""
    # To be implemented as needed (e.g., updating credits, status)
    pass


def handle_subscription_cancellation(subscription):
    """Handle subscription cancellation (e.g., update status to 'canceled')"""
    # To be implemented as needed
    pass
