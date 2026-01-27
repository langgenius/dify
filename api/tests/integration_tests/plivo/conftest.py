"""
Pytest configuration and fixtures for Plivo integration tests.
"""

import os

import pytest


def pytest_configure(config):
    """Configure custom markers for Plivo tests."""
    config.addinivalue_line(
        "markers",
        "plivo_e2e: mark test as requiring Plivo credentials for end-to-end testing",
    )
    config.addinivalue_line(
        "markers",
        "plivo_manual: mark test as requiring manual intervention (OTP entry)",
    )


@pytest.fixture(scope="session")
def plivo_credentials():
    """
    Fixture providing Plivo credentials from environment variables.

    Returns None if credentials are not available.
    """
    auth_id = os.environ.get("PLIVO_AUTH_ID")
    auth_token = os.environ.get("PLIVO_AUTH_TOKEN")

    if not auth_id or not auth_token:
        return None

    return {
        "auth_id": auth_id,
        "auth_token": auth_token,
    }


@pytest.fixture(scope="session")
def plivo_test_numbers():
    """
    Fixture providing Plivo test phone numbers from environment variables.

    Returns None if numbers are not available.
    """
    from_number = os.environ.get("PLIVO_TEST_FROM_NUMBER")
    to_number = os.environ.get("PLIVO_TEST_TO_NUMBER")
    verify_number = os.environ.get("PLIVO_TEST_PHONE_NUMBER")

    return {
        "from_number": from_number,
        "to_number": to_number,
        "verify_number": verify_number,
    }


@pytest.fixture(scope="session")
def plivo_client(plivo_credentials):
    """
    Fixture providing an initialized Plivo client.

    Skips tests if credentials are not available.
    """
    if not plivo_credentials:
        pytest.skip("Plivo credentials not available")

    import plivo

    return plivo.RestClient(
        auth_id=plivo_credentials["auth_id"],
        auth_token=plivo_credentials["auth_token"],
    )


@pytest.fixture
def mock_plivo_client():
    """
    Fixture providing a mock Plivo client for unit tests.
    """
    from unittest.mock import MagicMock

    client = MagicMock()

    # Mock account.get for credential validation
    client.account.get.return_value = {"account_id": "test_account"}

    # Mock messages.create for SMS sending
    mock_message_response = MagicMock()
    mock_message_response.message_uuid = ["test-message-uuid"]
    client.messages.create.return_value = mock_message_response

    # Mock verify_session.create for OTP sending
    mock_verify_response = MagicMock()
    mock_verify_response.session_uuid = "test-session-uuid"
    client.verify_session.create.return_value = mock_verify_response

    # Mock verify_session.validate for OTP verification
    mock_validate_response = MagicMock()
    mock_validate_response.status = "verified"
    client.verify_session.validate.return_value = mock_validate_response

    return client


@pytest.fixture
def initialized_sms_extension(mock_plivo_client):
    """
    Fixture providing an initialized SMS extension with mock client.
    """
    from extensions.ext_sms import SMS

    sms = SMS()
    sms._client = mock_plivo_client
    sms._verify_enabled = True

    return sms
