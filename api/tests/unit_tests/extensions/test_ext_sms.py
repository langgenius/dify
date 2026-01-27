"""
Unit tests for Plivo SMS extension.

This module tests the SMS extension functionality including:
- Plivo client initialization
- Verification code sending via Plivo Verify API
- OTP verification via Plivo Verify API
- SMS sending via Plivo Message API
- Error handling and logging
"""

from unittest.mock import MagicMock, patch

import pytest


class TestSMSExtensionInitialization:
    """Test SMS extension initialization with various configurations."""

    @patch("extensions.ext_sms.dify_config")
    def test_sms_init_when_verify_disabled(self, mock_config):
        """Test SMS extension skips initialization when PLIVO_VERIFY_ENABLED is False."""
        from extensions.ext_sms import SMS

        mock_config.PLIVO_VERIFY_ENABLED = False

        sms = SMS()
        mock_app = MagicMock()

        sms.init_app(mock_app)

        assert sms.is_inited() is False
        assert sms.is_verify_enabled() is False

    @patch("extensions.ext_sms.dify_config")
    def test_sms_init_when_credentials_missing(self, mock_config):
        """Test SMS extension logs warning when credentials are missing."""
        from extensions.ext_sms import SMS

        mock_config.PLIVO_VERIFY_ENABLED = True
        mock_config.PLIVO_AUTH_ID = None
        mock_config.PLIVO_AUTH_TOKEN = None

        sms = SMS()
        mock_app = MagicMock()

        sms.init_app(mock_app)

        assert sms.is_inited() is False
        assert sms.is_verify_enabled() is False

    @patch("extensions.ext_sms.dify_config")
    def test_sms_init_success(self, mock_config):
        """Test SMS extension initializes successfully with valid credentials."""
        from extensions.ext_sms import SMS

        mock_config.PLIVO_VERIFY_ENABLED = True
        mock_config.PLIVO_AUTH_ID = "test_auth_id"
        mock_config.PLIVO_AUTH_TOKEN = "test_auth_token"

        mock_client = MagicMock()

        with patch.dict("sys.modules", {"plivo": MagicMock()}):
            import sys
            sys.modules["plivo"].RestClient.return_value = mock_client

            sms = SMS()
            mock_app = MagicMock()

            sms.init_app(mock_app)

            assert sms.is_inited() is True
            assert sms.is_verify_enabled() is True
            sys.modules["plivo"].RestClient.assert_called_once_with(
                auth_id="test_auth_id", auth_token="test_auth_token"
            )

    @patch("extensions.ext_sms.dify_config")
    def test_sms_init_raises_on_client_error(self, mock_config):
        """Test SMS extension raises error when Plivo client initialization fails."""
        from extensions.ext_sms import SMS

        mock_config.PLIVO_VERIFY_ENABLED = True
        mock_config.PLIVO_AUTH_ID = "test_auth_id"
        mock_config.PLIVO_AUTH_TOKEN = "test_auth_token"

        mock_plivo = MagicMock()
        mock_plivo.RestClient.side_effect = Exception("Connection failed")

        with patch.dict("sys.modules", {"plivo": mock_plivo}):
            sms = SMS()
            mock_app = MagicMock()

            with pytest.raises(ValueError, match="Failed to initialize Plivo client"):
                sms.init_app(mock_app)


class TestSMSSendVerificationCode:
    """Test sending verification codes via Plivo Verify API."""

    def _create_initialized_sms(self):
        """Helper to create an initialized SMS instance."""
        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = MagicMock()
        sms._verify_enabled = True
        return sms

    def test_send_verification_code_raises_when_not_initialized(self):
        """Test sending verification raises error when client not initialized."""
        from extensions.ext_sms import SMS

        sms = SMS()

        with pytest.raises(ValueError, match="SMS client is not initialized"):
            sms.send_verification_code("+14155551234")

    def test_send_verification_code_raises_when_verify_disabled(self):
        """Test sending verification raises error when verify is disabled."""
        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = MagicMock()
        sms._verify_enabled = False

        with pytest.raises(ValueError, match="Plivo Verify is not enabled"):
            sms.send_verification_code("+14155551234")

    def test_send_verification_code_success(self):
        """Test successful verification code sending."""
        sms = self._create_initialized_sms()

        mock_response = MagicMock()
        mock_response.session_uuid = "test-session-uuid-123"
        sms._client.verify_session.create.return_value = mock_response

        result = sms.send_verification_code("+14155551234")

        assert result["session_uuid"] == "test-session-uuid-123"
        assert result["status"] == "sent"
        assert result["channel"] == "sms"
        sms._client.verify_session.create.assert_called_once_with(
            recipient="+14155551234",
            channel="sms",
            app_uuid=None,
        )

    def test_send_verification_code_voice_channel(self):
        """Test successful verification code sending via voice channel."""
        sms = self._create_initialized_sms()

        mock_response = MagicMock()
        mock_response.session_uuid = "test-session-uuid-voice"
        sms._client.verify_session.create.return_value = mock_response

        result = sms.send_verification_code("+14155551234", channel="voice")

        assert result["session_uuid"] == "test-session-uuid-voice"
        assert result["status"] == "sent"
        assert result["channel"] == "voice"
        sms._client.verify_session.create.assert_called_once_with(
            recipient="+14155551234",
            channel="voice",
            app_uuid=None,
        )

    def test_send_verification_code_invalid_channel(self):
        """Test sending verification raises error for invalid channel."""
        sms = self._create_initialized_sms()

        with pytest.raises(ValueError, match="Invalid channel"):
            sms.send_verification_code("+14155551234", channel="email")

    def test_send_verification_code_raises_plivo_error(self):
        """Test sending verification raises PlivoVerifyError on API failure."""
        from extensions.ext_sms import PlivoVerifyError

        sms = self._create_initialized_sms()
        sms._client.verify_session.create.side_effect = Exception("API Error")

        with pytest.raises(PlivoVerifyError, match="Failed to send verification code"):
            sms.send_verification_code("+14155551234")


class TestSMSVerifyCode:
    """Test OTP verification via Plivo Verify API."""

    def _create_initialized_sms(self):
        """Helper to create an initialized SMS instance."""
        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = MagicMock()
        sms._verify_enabled = True
        return sms

    def test_verify_code_raises_when_not_initialized(self):
        """Test verification raises error when client not initialized."""
        from extensions.ext_sms import SMS

        sms = SMS()

        with pytest.raises(ValueError, match="SMS client is not initialized"):
            sms.verify_code("session-uuid", "123456")

    def test_verify_code_raises_when_verify_disabled(self):
        """Test verification raises error when verify is disabled."""
        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = MagicMock()
        sms._verify_enabled = False

        with pytest.raises(ValueError, match="Plivo Verify is not enabled"):
            sms.verify_code("session-uuid", "123456")

    def test_verify_code_success(self):
        """Test successful OTP verification."""
        sms = self._create_initialized_sms()

        mock_response = MagicMock()
        mock_response.status = "verified"
        sms._client.verify_session.validate.return_value = mock_response

        result = sms.verify_code("session-uuid-123", "123456")

        assert result is True
        sms._client.verify_session.validate.assert_called_once_with(
            session_uuid="session-uuid-123",
            otp="123456",
        )

    def test_verify_code_failure_invalid_otp(self):
        """Test verification returns False for invalid OTP."""
        sms = self._create_initialized_sms()

        mock_response = MagicMock()
        mock_response.status = "failed"
        sms._client.verify_session.validate.return_value = mock_response

        result = sms.verify_code("session-uuid-123", "000000")

        assert result is False

    def test_verify_code_returns_false_for_invalid_error(self):
        """Test verification returns False when API returns invalid OTP error."""
        sms = self._create_initialized_sms()
        sms._client.verify_session.validate.side_effect = Exception("Invalid OTP")

        result = sms.verify_code("session-uuid-123", "000000")

        assert result is False

    def test_verify_code_returns_false_for_expired_error(self):
        """Test verification returns False when API returns expired OTP error."""
        sms = self._create_initialized_sms()
        sms._client.verify_session.validate.side_effect = Exception("OTP expired")

        result = sms.verify_code("session-uuid-123", "000000")

        assert result is False

    def test_verify_code_raises_for_other_errors(self):
        """Test verification raises PlivoVerifyError for non-OTP related errors."""
        from extensions.ext_sms import PlivoVerifyError

        sms = self._create_initialized_sms()
        sms._client.verify_session.validate.side_effect = Exception("Network error")

        with pytest.raises(PlivoVerifyError, match="Verification check failed"):
            sms.verify_code("session-uuid-123", "123456")


class TestSMSSendMessage:
    """Test SMS sending via Plivo Message API."""

    def _create_initialized_sms(self):
        """Helper to create an initialized SMS instance."""
        from extensions.ext_sms import SMS

        sms = SMS()
        sms._client = MagicMock()
        sms._verify_enabled = True
        return sms

    def test_send_sms_raises_when_not_initialized(self):
        """Test sending SMS raises error when client not initialized."""
        from extensions.ext_sms import SMS

        sms = SMS()

        with pytest.raises(ValueError, match="SMS client is not initialized"):
            sms.send_sms("+14155551234", "Hello")

    @patch("extensions.ext_sms.dify_config")
    def test_send_sms_raises_when_no_from_number(self, mock_config):
        """Test sending SMS raises error when from number is not set."""
        mock_config.PLIVO_DEFAULT_FROM_NUMBER = None

        sms = self._create_initialized_sms()

        with pytest.raises(ValueError, match="From number is not set"):
            sms.send_sms("+14155551234", "Hello")

    @patch("extensions.ext_sms.dify_config")
    def test_send_sms_success_with_explicit_from(self, mock_config):
        """Test successful SMS sending with explicit from number."""
        mock_config.PLIVO_DEFAULT_FROM_NUMBER = "+10000000000"

        sms = self._create_initialized_sms()

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-123"]
        sms._client.messages.create.return_value = mock_response

        result = sms.send_sms("+14155551234", "Hello World", from_number="+15555555555")

        assert result["message_uuid"] == "msg-uuid-123"
        assert result["status"] == "sent"
        sms._client.messages.create.assert_called_once_with(
            src="+15555555555",
            dst="+14155551234",
            text="Hello World",
        )

    @patch("extensions.ext_sms.dify_config")
    def test_send_sms_success_with_default_from(self, mock_config):
        """Test successful SMS sending with default from number."""
        mock_config.PLIVO_DEFAULT_FROM_NUMBER = "+15555550000"

        sms = self._create_initialized_sms()

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-456"]
        sms._client.messages.create.return_value = mock_response

        result = sms.send_sms("+14155551234", "Hello World")

        assert result["message_uuid"] == "msg-uuid-456"
        sms._client.messages.create.assert_called_once_with(
            src="+15555550000",
            dst="+14155551234",
            text="Hello World",
        )

    @patch("extensions.ext_sms.dify_config")
    def test_send_sms_raises_plivo_error(self, mock_config):
        """Test sending SMS raises PlivoVerifyError on API failure."""
        from extensions.ext_sms import PlivoVerifyError

        mock_config.PLIVO_DEFAULT_FROM_NUMBER = "+15555550000"

        sms = self._create_initialized_sms()
        sms._client.messages.create.side_effect = Exception("API Error")

        with pytest.raises(PlivoVerifyError, match="Failed to send SMS"):
            sms.send_sms("+14155551234", "Hello World")


class TestSMSModuleFunctions:
    """Test module-level functions."""

    @patch("extensions.ext_sms.dify_config")
    def test_is_enabled_returns_config_value(self, mock_config):
        """Test is_enabled returns the config value."""
        from extensions.ext_sms import is_enabled

        mock_config.PLIVO_VERIFY_ENABLED = True
        assert is_enabled() is True

        mock_config.PLIVO_VERIFY_ENABLED = False
        assert is_enabled() is False


class TestPlivoVerifyError:
    """Test PlivoVerifyError exception class."""

    def test_error_with_message_only(self):
        """Test PlivoVerifyError with message only."""
        from extensions.ext_sms import PlivoVerifyError

        error = PlivoVerifyError("Test error message")

        assert str(error) == "Test error message"
        assert error.message == "Test error message"
        assert error.error_code is None

    def test_error_with_message_and_code(self):
        """Test PlivoVerifyError with message and error code."""
        from extensions.ext_sms import PlivoVerifyError

        error = PlivoVerifyError("Test error message", error_code="INVALID_OTP")

        assert str(error) == "Test error message"
        assert error.message == "Test error message"
        assert error.error_code == "INVALID_OTP"
