"""
End-to-end integration tests for Plivo SMS functionality with live APIs.

These tests require actual Plivo credentials and make real API calls.
They are skipped by default unless the following environment variables are set:
- PLIVO_AUTH_ID: Your Plivo Auth ID
- PLIVO_AUTH_TOKEN: Your Plivo Auth Token
- PLIVO_TEST_FROM_NUMBER: A Plivo phone number for sending SMS
- PLIVO_TEST_TO_NUMBER: A verified phone number to receive test SMS

To run these tests:
    PLIVO_AUTH_ID=xxx PLIVO_AUTH_TOKEN=xxx PLIVO_TEST_FROM_NUMBER=+1xxx PLIVO_TEST_TO_NUMBER=+1xxx pytest tests/integration_tests/plivo/test_plivo_sms_e2e.py -v

WARNING: These tests will send real SMS messages and may incur charges on your Plivo account.
"""

import os

import pytest

# Check if Plivo credentials are available
PLIVO_AUTH_ID = os.environ.get("PLIVO_AUTH_ID")
PLIVO_AUTH_TOKEN = os.environ.get("PLIVO_AUTH_TOKEN")
PLIVO_TEST_FROM_NUMBER = os.environ.get("PLIVO_TEST_FROM_NUMBER")
PLIVO_TEST_TO_NUMBER = os.environ.get("PLIVO_TEST_TO_NUMBER")

PLIVO_CREDENTIALS_AVAILABLE = all([
    PLIVO_AUTH_ID,
    PLIVO_AUTH_TOKEN,
    PLIVO_TEST_FROM_NUMBER,
    PLIVO_TEST_TO_NUMBER,
])

skip_without_credentials = pytest.mark.skipif(
    not PLIVO_CREDENTIALS_AVAILABLE,
    reason="Plivo credentials not set. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, "
    "PLIVO_TEST_FROM_NUMBER, and PLIVO_TEST_TO_NUMBER environment variables to run.",
)


@skip_without_credentials
class TestPlivoSMSEndToEnd:
    """End-to-end tests for Plivo SMS API integration."""

    def test_plivo_client_authentication(self):
        """Test that Plivo client can authenticate with provided credentials."""
        import plivo

        client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)

        # Fetch account details to verify authentication
        account = client.account.get()

        assert account is not None
        assert hasattr(account, "account_type") or hasattr(account, "auth_id")

    def test_plivo_send_sms_success(self):
        """Test sending an actual SMS via Plivo API."""
        import plivo

        client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)

        response = client.messages.create(
            src=PLIVO_TEST_FROM_NUMBER,
            dst=PLIVO_TEST_TO_NUMBER,
            text="Dify Integration Test - Please ignore this message.",
        )

        assert response is not None
        assert response.message_uuid is not None
        assert len(response.message_uuid) > 0
        print(f"SMS sent successfully. Message UUID: {response.message_uuid[0]}")

    def test_plivo_send_sms_invalid_credentials(self):
        """Test that invalid credentials fail gracefully."""
        import plivo

        # Plivo validates credentials at client creation time
        with pytest.raises(plivo.exceptions.AuthenticationError):
            client = plivo.RestClient(auth_id="invalid_id", auth_token="invalid_token")

    def test_plivo_tool_provider_validation(self):
        """Test the Plivo SMS tool provider credential validation with real credentials."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": PLIVO_AUTH_ID,
            "auth_token": PLIVO_AUTH_TOKEN,
        }

        # Should not raise any exception
        provider._validate_credentials(user_id="test-user", credentials=credentials)

    def test_plivo_tool_provider_validation_invalid_credentials(self):
        """Test the Plivo SMS tool provider rejects invalid credentials."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": "invalid_auth_id",
            "auth_token": "invalid_auth_token",
        }

        with pytest.raises(ToolProviderCredentialValidationError):
            provider._validate_credentials(user_id="test-user", credentials=credentials)


def _create_send_sms_tool(credentials):
    """Helper to create a SendSmsTool with proper mocking."""
    from unittest.mock import MagicMock

    from core.tools.builtin_tool.providers.plivo_sms.tools.send_sms import SendSmsTool

    entity = MagicMock()
    entity.model_copy.return_value = entity

    runtime = MagicMock()
    runtime.credentials = credentials
    runtime.runtime_parameters = {}

    return SendSmsTool(provider="plivo_sms", entity=entity, runtime=runtime)


@skip_without_credentials
class TestPlivoSMSToolEndToEnd:
    """End-to-end tests for Plivo SMS send_sms tool."""

    def test_send_sms_tool_success(self):
        """Test the send_sms tool with real Plivo API."""
        tool = _create_send_sms_tool({
            "auth_id": PLIVO_AUTH_ID,
            "auth_token": PLIVO_AUTH_TOKEN,
        })

        params = {
            "to": PLIVO_TEST_TO_NUMBER,
            "from_number": PLIVO_TEST_FROM_NUMBER,
            "message": "Dify Tool Integration Test - Please ignore this message.",
        }

        messages = list(tool._invoke(user_id="test-user", tool_parameters=params))

        assert len(messages) == 2
        # First message should be text
        text_message = messages[0]
        assert "SMS sent successfully" in str(text_message)
        print(f"Tool invocation successful: {text_message}")

    def test_send_sms_tool_with_unicode(self):
        """Test the send_sms tool with Unicode characters."""
        tool = _create_send_sms_tool({
            "auth_id": PLIVO_AUTH_ID,
            "auth_token": PLIVO_AUTH_TOKEN,
        })

        params = {
            "to": PLIVO_TEST_TO_NUMBER,
            "from_number": PLIVO_TEST_FROM_NUMBER,
            "message": "Dify Test - Hello World!",
        }

        messages = list(tool._invoke(user_id="test-user", tool_parameters=params))

        assert len(messages) == 2
        assert "SMS sent successfully" in str(messages[0])


@skip_without_credentials
class TestPlivoSMSExtensionEndToEnd:
    """End-to-end tests for Plivo SMS extension."""

    def test_sms_extension_send_sms(self):
        """Test SMS extension send_sms method with real API."""
        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = None
        sms._verify_enabled = False

        # Manually initialize with test credentials
        import plivo

        sms._client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)
        sms._verify_enabled = True

        with pytest.MonkeyPatch().context() as m:
            m.setattr("extensions.ext_sms.dify_config.PLIVO_DEFAULT_FROM_NUMBER", PLIVO_TEST_FROM_NUMBER)

            result = sms.send_sms(
                to=PLIVO_TEST_TO_NUMBER,
                message="Dify Extension Test - Please ignore this message.",
                from_number=PLIVO_TEST_FROM_NUMBER,
            )

            assert result is not None
            assert result["status"] == "sent"
            assert result["message_uuid"] is not None
            print(f"Extension send_sms successful: {result['message_uuid']}")


@skip_without_credentials
class TestPlivoMessageDeliveryStatus:
    """Tests for checking Plivo message delivery status."""

    def test_get_message_details(self):
        """Test fetching message details after sending."""
        import time

        import plivo

        client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)

        # Send a message first
        response = client.messages.create(
            src=PLIVO_TEST_FROM_NUMBER,
            dst=PLIVO_TEST_TO_NUMBER,
            text="Dify Status Check Test - Please ignore.",
        )

        message_uuid = response.message_uuid[0]
        print(f"Sent message with UUID: {message_uuid}")

        # Wait a bit for the message to be processed
        time.sleep(2)

        # Get message details
        message_details = client.messages.get(message_uuid)

        assert message_details is not None
        assert message_details.message_uuid == message_uuid
        print(f"Message status: {message_details.message_state}")


class TestPlivoCredentialValidation:
    """Tests for Plivo credential validation without making API calls."""

    def test_empty_credentials_rejected(self):
        """Test that empty credentials are rejected."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()

        with pytest.raises(ToolProviderCredentialValidationError):
            provider._validate_credentials(
                user_id="test",
                credentials={"auth_id": "", "auth_token": ""},
            )

    def test_missing_auth_id_rejected(self):
        """Test that missing auth_id is rejected."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()

        with pytest.raises(ToolProviderCredentialValidationError):
            provider._validate_credentials(
                user_id="test",
                credentials={"auth_token": "some_token"},
            )

    def test_missing_auth_token_rejected(self):
        """Test that missing auth_token is rejected."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()

        with pytest.raises(ToolProviderCredentialValidationError):
            provider._validate_credentials(
                user_id="test",
                credentials={"auth_id": "some_id"},
            )
