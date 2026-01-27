"""
End-to-end integration tests for Plivo Verify API functionality with live APIs.

These tests require actual Plivo credentials and make real API calls.
They are skipped by default unless the following environment variables are set:
- PLIVO_AUTH_ID: Your Plivo Auth ID
- PLIVO_AUTH_TOKEN: Your Plivo Auth Token
- PLIVO_TEST_PHONE_NUMBER: A verified phone number to receive OTP

To run these tests:
    PLIVO_AUTH_ID=xxx PLIVO_AUTH_TOKEN=xxx PLIVO_TEST_PHONE_NUMBER=+1xxx pytest tests/integration_tests/plivo/test_plivo_verify_e2e.py -v

WARNING: These tests will send real OTP messages and may incur charges on your Plivo account.

NOTE: The verify_code tests require manual intervention as you need to enter the actual OTP
received on your phone. These tests are marked with `manual_test` and are skipped by default.
"""

import os

import pytest

# Check if Plivo credentials are available
PLIVO_AUTH_ID = os.environ.get("PLIVO_AUTH_ID")
PLIVO_AUTH_TOKEN = os.environ.get("PLIVO_AUTH_TOKEN")
PLIVO_TEST_PHONE_NUMBER = os.environ.get("PLIVO_TEST_PHONE_NUMBER")

PLIVO_VERIFY_CREDENTIALS_AVAILABLE = all([
    PLIVO_AUTH_ID,
    PLIVO_AUTH_TOKEN,
    PLIVO_TEST_PHONE_NUMBER,
])

skip_without_credentials = pytest.mark.skipif(
    not PLIVO_VERIFY_CREDENTIALS_AVAILABLE,
    reason="Plivo Verify credentials not set. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, "
    "and PLIVO_TEST_PHONE_NUMBER environment variables to run.",
)

skip_manual_test = pytest.mark.skipif(
    os.environ.get("PLIVO_RUN_MANUAL_TESTS") != "true",
    reason="Manual test skipped. Set PLIVO_RUN_MANUAL_TESTS=true to run.",
)

skip_requires_infrastructure = pytest.mark.skipif(
    os.environ.get("PLIVO_RUN_INFRASTRUCTURE_TESTS") != "true",
    reason="Test requires infrastructure (Redis). Set PLIVO_RUN_INFRASTRUCTURE_TESTS=true to run.",
)


@skip_without_credentials
class TestPlivoVerifyEndToEnd:
    """End-to-end tests for Plivo Verify API integration."""

    def test_plivo_verify_session_create(self):
        """Test creating a Plivo Verify session (sends OTP)."""
        import plivo

        client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)

        response = client.verify_session.create(
            recipient=PLIVO_TEST_PHONE_NUMBER,
            channel="sms",
            app_uuid=None,
        )

        assert response is not None
        assert hasattr(response, "session_uuid")
        assert response.session_uuid is not None
        print(f"Verify session created. Session UUID: {response.session_uuid}")

        # Store session UUID for potential follow-up tests
        return response.session_uuid

    def test_plivo_verify_invalid_phone_number(self):
        """Test that invalid phone number fails gracefully."""
        import plivo

        client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)

        # Try with an invalid phone number
        with pytest.raises(Exception):  # Plivo raises various exceptions for invalid numbers
            client.verify_session.create(
                recipient="invalid-number",
                channel="sms",
                app_uuid=None,
            )

    @skip_manual_test
    def test_plivo_verify_full_flow(self):
        """
        Test complete Plivo Verify flow: send OTP and verify it.

        This test requires manual intervention to enter the OTP received on the phone.
        Only runs when PLIVO_RUN_MANUAL_TESTS=true is set.
        """
        import plivo

        client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)

        # Step 1: Send OTP
        print(f"\nSending OTP to {PLIVO_TEST_PHONE_NUMBER}...")
        response = client.verify_session.create(
            recipient=PLIVO_TEST_PHONE_NUMBER,
            channel="sms",
            app_uuid=None,
        )

        session_uuid = response.session_uuid
        print(f"OTP sent. Session UUID: {session_uuid}")

        # Step 2: Get OTP from user input
        otp = input("Enter the OTP received on your phone: ").strip()

        # Step 3: Verify OTP
        print(f"Verifying OTP: {otp}...")
        verify_response = client.verify_session.validate(
            session_uuid=session_uuid,
            otp=otp,
        )

        assert verify_response is not None
        assert verify_response.status == "verified"
        print("OTP verification successful!")


@skip_without_credentials
class TestPlivoVerifyExtensionEndToEnd:
    """End-to-end tests for Plivo SMS extension with Verify API."""

    def test_sms_extension_send_verification_code(self):
        """Test SMS extension send_verification_code method with real API."""
        from extensions.ext_sms import SMS

        sms = SMS()

        # Manually initialize with test credentials
        import plivo

        sms._client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)
        sms._verify_enabled = True

        result = sms.send_verification_code(PLIVO_TEST_PHONE_NUMBER)

        assert result is not None
        assert result["status"] == "sent"
        assert result["session_uuid"] is not None
        print(f"Verification code sent. Session UUID: {result['session_uuid']}")

    def test_sms_extension_verify_code_invalid(self):
        """Test SMS extension verify_code method with invalid OTP."""
        from extensions.ext_sms import SMS

        sms = SMS()

        # Manually initialize with test credentials
        import plivo

        sms._client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)
        sms._verify_enabled = True

        # First send verification code
        send_result = sms.send_verification_code(PLIVO_TEST_PHONE_NUMBER)
        session_uuid = send_result["session_uuid"]

        # Try to verify with invalid OTP
        result = sms.verify_code(session_uuid, "000000")

        # Should return False for invalid OTP
        assert result is False
        print("Invalid OTP correctly rejected.")

    @skip_manual_test
    def test_sms_extension_full_verification_flow(self):
        """
        Test complete verification flow through SMS extension.

        This test requires manual intervention to enter the OTP received on the phone.
        Only runs when PLIVO_RUN_MANUAL_TESTS=true is set.
        """
        from extensions.ext_sms import SMS

        sms = SMS()

        # Manually initialize with test credentials
        import plivo

        sms._client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)
        sms._verify_enabled = True

        # Step 1: Send verification code
        print(f"\nSending verification code to {PLIVO_TEST_PHONE_NUMBER}...")
        send_result = sms.send_verification_code(PLIVO_TEST_PHONE_NUMBER)
        session_uuid = send_result["session_uuid"]
        print(f"Verification code sent. Session UUID: {session_uuid}")

        # Step 2: Get OTP from user input
        otp = input("Enter the OTP received on your phone: ").strip()

        # Step 3: Verify OTP
        print(f"Verifying OTP: {otp}...")
        result = sms.verify_code(session_uuid, otp)

        assert result is True
        print("OTP verification successful through SMS extension!")


@skip_without_credentials
class TestPlivoVerifyAccountServiceEndToEnd:
    """End-to-end tests for AccountService phone verification with real API."""

    def _setup_sms_extension(self):
        """Helper to set up the SMS extension with test credentials."""
        from unittest.mock import patch

        import plivo

        from extensions.ext_sms import sms

        sms._client = plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)
        sms._verify_enabled = True

    @skip_requires_infrastructure
    def test_account_service_send_phone_verification_code(self):
        """Test AccountService.send_phone_verification_code with real API.

        Note: This test requires Redis to be running for token management.
        """
        from unittest.mock import patch

        from services.account_service import AccountService

        self._setup_sms_extension()

        with patch("services.account_service.dify_config") as mock_config:
            mock_config.PLIVO_VERIFY_ENABLED = True

            with patch.object(
                AccountService.phone_code_login_rate_limiter,
                "is_rate_limited",
                return_value=False,
            ):
                with patch.object(
                    AccountService.phone_code_login_rate_limiter,
                    "increment_rate_limit",
                ):
                    token = AccountService.send_phone_verification_code(
                        PLIVO_TEST_PHONE_NUMBER
                    )

                    assert token is not None
                    print(f"Phone verification code sent. Token: {token[:20]}...")

    @skip_manual_test
    def test_account_service_full_verification_flow(self):
        """
        Test complete AccountService phone verification flow.

        This test requires manual intervention to enter the OTP received on the phone.
        Only runs when PLIVO_RUN_MANUAL_TESTS=true is set.
        """
        from unittest.mock import patch

        from services.account_service import AccountService

        self._setup_sms_extension()

        with patch("services.account_service.dify_config") as mock_config:
            mock_config.PLIVO_VERIFY_ENABLED = True

            with patch.object(
                AccountService.phone_code_login_rate_limiter,
                "is_rate_limited",
                return_value=False,
            ):
                with patch.object(
                    AccountService.phone_code_login_rate_limiter,
                    "increment_rate_limit",
                ):
                    # Step 1: Send verification code
                    print(f"\nSending verification code to {PLIVO_TEST_PHONE_NUMBER}...")
                    token = AccountService.send_phone_verification_code(
                        PLIVO_TEST_PHONE_NUMBER
                    )
                    print(f"Verification code sent. Token: {token[:20]}...")

                    # Step 2: Get OTP from user input
                    otp = input("Enter the OTP received on your phone: ").strip()

                    # Step 3: Verify OTP
                    print(f"Verifying OTP: {otp}...")
                    result = AccountService.verify_phone_code(token, otp)

                    assert result is True
                    print("OTP verification successful through AccountService!")


class TestPlivoVerifyErrorHandling:
    """Tests for Plivo Verify error handling without making API calls."""

    def test_sms_extension_not_initialized_error(self):
        """Test that uninitialized SMS extension raises appropriate error."""
        from extensions.ext_sms import SMS

        sms = SMS()
        # Don't initialize - _client should be None

        with pytest.raises(ValueError, match="SMS client is not initialized"):
            sms.send_verification_code("+14155551234")

    def test_sms_extension_verify_disabled_error(self):
        """Test that disabled verify raises appropriate error."""
        from unittest.mock import MagicMock

        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = MagicMock()
        sms._verify_enabled = False

        with pytest.raises(ValueError, match="Plivo Verify is not enabled"):
            sms.send_verification_code("+14155551234")

    def test_plivo_verify_error_exception(self):
        """Test PlivoVerifyError exception class."""
        from extensions.ext_sms import PlivoVerifyError

        error = PlivoVerifyError("Test error", error_code="TEST_CODE")

        assert str(error) == "Test error"
        assert error.message == "Test error"
        assert error.error_code == "TEST_CODE"
