# tests/unit/test_webhook_controller.py

import json
import os
from unittest.mock import MagicMock, patch

import pytest

# Import the Blueprint from the controller file
from api.controllers.webhook_controller import controllers, handle_successful_payment
from flask import Flask

# --- Fixtures ---


@pytest.fixture
def client():
    """Fixture to set up a test Flask client."""
    app = Flask(__name__)
    # Register the Blueprint
    app.register_blueprint(controllers)
    app.config["TESTING"] = True
    with app.test_client() as client:
        # Set the webhook secret as an environment variable for the test run
        os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_testsecret"
        yield client
        # Clean up the environment variable after the test
        del os.environ["STRIPE_WEBHOOK_SECRET"]


def make_event_payload(event_type, data_object):
    """Helper to create a basic Stripe event structure."""
    return {"type": event_type, "data": {"object": data_object}}


# --- Tests for Webhook Endpoint (/webhook/stripe) ---


@patch("stripe.Webhook.construct_event")
@patch("api.controllers.webhook_controller.handle_successful_payment")
def test_stripe_webhook_checkout_session_completed(mock_handle_payment, mock_construct_event, client):
    """Test handling of a successful checkout session completion."""
    # 1. Prepare mock event data
    session_obj = {"client_reference_id": "123", "subscription": "sub_456"}
    event = make_event_payload("checkout.session.completed", session_obj)
    mock_construct_event.return_value = event

    # 2. Make POST request
    response = client.post(
        "/webhook/stripe",
        data=json.dumps(event),
        content_type="application/json",
        headers={"Stripe-Signature": "valid_signature"},
    )

    # 3. Assertions
    assert response.status_code == 200
    assert response.json == {"received": True}
    # Check that the specific handler was called
    mock_handle_payment.assert_called_once_with(session_obj)


@patch("stripe.Webhook.construct_event")
def test_stripe_webhook_invalid_payload(mock_construct_event, client):
    """Test handling of a ValueError (invalid payload format)."""
    # 1. Simulate ValueError on payload construction
    mock_construct_event.side_effect = ValueError("Invalid payload")

    # 2. Make POST request (using client from fixture)
    response = client.post("/webhook/stripe", data="invalid payload", headers={"Stripe-Signature": "test"})

    # 3. Assertions
    assert response.status_code == 400
    assert response.json == {"error": "Invalid payload"}
    mock_construct_event.assert_called_once()


@patch("stripe.Webhook.construct_event")
def test_stripe_webhook_invalid_signature(mock_construct_event, client):
    """Test handling of a SignatureVerificationError (invalid signature)."""
    # 1. Simulate SignatureVerificationError on signature check
    from stripe.error import SignatureVerificationError

    mock_construct_event.side_effect = SignatureVerificationError("Invalid signature", None)

    # 2. Make POST request
    response = client.post("/webhook/stripe", data="{}", headers={"Stripe-Signature": "bad_signature"})

    # 3. Assertions
    assert response.status_code == 400
    assert response.json == {"error": "Invalid signature"}
    mock_construct_event.assert_called_once()


# --- Tests for Handler Functions ---


@patch("api.controllers.webhook_controller.Account")
def test_handle_successful_payment_updates_account(mock_account):
    """Test the handler logic for updating the user's account status."""
    # 1. Prepare mock objects
    session_data = {
        "client_reference_id": "999",
        "subscription": "sub_XYZ",
    }

    # Mock the Account model query result
    account_instance = MagicMock()
    # Mock the query chain: Account.query.filter_by(id='999').first()
    mock_account.query.filter_by.return_value.first.return_value = account_instance

    # 2. Execute the handler function
    handle_successful_payment(session_data)

    # 3. Assertions
    # Check that the database lookup happened correctly
    mock_account.query.filter_by.assert_called_once_with(id="999")
    # Check that the account instance attributes were updated
    assert account_instance.subscription_status == "active"
    assert account_instance.subscription_id == "sub_XYZ"
    # Check that the save method was called to persist changes
    account_instance.save.assert_called_once()


@patch("api.controllers.webhook_controller.Account")
def test_handle_successful_payment_no_user_id(mock_account):
    """Test the handler when client_reference_id is missing."""
    session_data = {"subscription": "sub_XYZ"}

    handle_successful_payment(session_data)

    # Assert that no database interaction occurred
    mock_account.query.filter_by.assert_not_called()
