"""
Unit tests for AccountService phone verification methods.

This module tests the phone verification functionality including:
- Sending phone verification codes
- Verifying phone codes
- Rate limiting
- Token management
- Error handling
"""

from unittest.mock import MagicMock, patch

import pytest


class TestAccountServiceSendPhoneVerificationCode:
    """Test AccountService.send_phone_verification_code method."""

    @patch("services.account_service.dify_config")
    def test_raises_error_when_verify_disabled(self, mock_config):
        """Test raises ValueError when Plivo Verify is not enabled."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = False

        with pytest.raises(ValueError, match="Plivo Verify is not enabled"):
            AccountService.send_phone_verification_code("+14155551234")

    @patch("services.account_service.dify_config")
    def test_raises_rate_limit_error_when_exceeded(self, mock_config):
        """Test raises PhoneCodeLoginRateLimitExceededError when rate limited."""
        from controllers.console.auth.error import PhoneCodeLoginRateLimitExceededError
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        # Mock rate limiter to return True (rate limited)
        with patch.object(
            AccountService.phone_code_login_rate_limiter,
            "is_rate_limited",
            return_value=True,
        ):
            with patch.object(
                AccountService.phone_code_login_rate_limiter,
                "time_window",
                300,
            ):
                with pytest.raises(PhoneCodeLoginRateLimitExceededError):
                    AccountService.send_phone_verification_code("+14155551234")

    @patch("services.account_service.dify_config")
    @patch("services.account_service.TokenManager")
    def test_raises_error_when_sms_not_initialized(self, mock_token_manager, mock_config):
        """Test raises ValueError when SMS client is not initialized."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService.phone_code_login_rate_limiter,
            "is_rate_limited",
            return_value=False,
        ):
            with patch("services.account_service.sms") as mock_sms:
                mock_sms.is_inited.return_value = False
                mock_sms.is_verify_enabled.return_value = False

                with pytest.raises(ValueError, match="SMS client is not initialized"):
                    AccountService.send_phone_verification_code("+14155551234")

    @patch("services.account_service.dify_config")
    @patch("services.account_service.TokenManager")
    def test_success_returns_token(self, mock_token_manager, mock_config):
        """Test successful verification code sending returns token."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True
        mock_token_manager.generate_token.return_value = "test-token-123"

        with patch.object(
            AccountService.phone_code_login_rate_limiter,
            "is_rate_limited",
            return_value=False,
        ):
            with patch.object(
                AccountService.phone_code_login_rate_limiter,
                "increment_rate_limit",
            ) as mock_increment:
                with patch("services.account_service.sms") as mock_sms:
                    mock_sms.is_inited.return_value = True
                    mock_sms.is_verify_enabled.return_value = True
                    mock_sms.send_verification_code.return_value = {
                        "session_uuid": "session-uuid-123",
                        "status": "sent",
                    }

                    result = AccountService.send_phone_verification_code("+14155551234")

                    assert result == "test-token-123"
                    mock_sms.send_verification_code.assert_called_once_with("+14155551234")
                    mock_token_manager.generate_token.assert_called_once()
                    mock_increment.assert_called_once_with("+14155551234")

    @patch("services.account_service.dify_config")
    @patch("services.account_service.TokenManager")
    def test_returns_none_when_no_session_uuid(self, mock_token_manager, mock_config):
        """Test returns None when no session_uuid in response."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService.phone_code_login_rate_limiter,
            "is_rate_limited",
            return_value=False,
        ):
            with patch("services.account_service.sms") as mock_sms:
                mock_sms.is_inited.return_value = True
                mock_sms.is_verify_enabled.return_value = True
                mock_sms.send_verification_code.return_value = {
                    "session_uuid": None,
                    "status": "failed",
                }

                result = AccountService.send_phone_verification_code("+14155551234")

                assert result is None
                mock_token_manager.generate_token.assert_not_called()


class TestAccountServiceVerifyPhoneCode:
    """Test AccountService.verify_phone_code method."""

    @patch("services.account_service.dify_config")
    def test_raises_error_when_verify_disabled(self, mock_config):
        """Test raises ValueError when Plivo Verify is not enabled."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = False

        with pytest.raises(ValueError, match="Plivo Verify is not enabled"):
            AccountService.verify_phone_code("token-123", "123456")

    @patch("services.account_service.dify_config")
    def test_returns_false_when_token_invalid(self, mock_config):
        """Test returns False when token is invalid."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService, "get_phone_code_login_data", return_value=None
        ):
            result = AccountService.verify_phone_code("invalid-token", "123456")
            assert result is False

    @patch("services.account_service.dify_config")
    def test_returns_false_when_token_missing_session_uuid(self, mock_config):
        """Test returns False when token data is missing session_uuid."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService,
            "get_phone_code_login_data",
            return_value={"phone_number": "+14155551234"},
        ):
            result = AccountService.verify_phone_code("token-123", "123456")
            assert result is False

    @patch("services.account_service.dify_config")
    def test_returns_false_when_sms_not_initialized(self, mock_config):
        """Test raises ValueError when SMS client is not initialized."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService,
            "get_phone_code_login_data",
            return_value={
                "session_uuid": "session-uuid-123",
                "phone_number": "+14155551234",
            },
        ):
            with patch("services.account_service.sms") as mock_sms:
                mock_sms.is_inited.return_value = False
                mock_sms.is_verify_enabled.return_value = False

                with pytest.raises(ValueError, match="SMS client is not initialized"):
                    AccountService.verify_phone_code("token-123", "123456")

    @patch("services.account_service.dify_config")
    def test_success_verification_revokes_token(self, mock_config):
        """Test successful verification revokes the token."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService,
            "get_phone_code_login_data",
            return_value={
                "session_uuid": "session-uuid-123",
                "phone_number": "+14155551234",
            },
        ):
            with patch.object(
                AccountService, "revoke_phone_code_login_token"
            ) as mock_revoke:
                with patch("services.account_service.sms") as mock_sms:
                    mock_sms.is_inited.return_value = True
                    mock_sms.is_verify_enabled.return_value = True
                    mock_sms.verify_code.return_value = True

                    result = AccountService.verify_phone_code("token-123", "123456")

                    assert result is True
                    mock_sms.verify_code.assert_called_once_with(
                        "session-uuid-123", "123456"
                    )
                    mock_revoke.assert_called_once_with("token-123")

    @patch("services.account_service.dify_config")
    def test_failed_verification_does_not_revoke_token(self, mock_config):
        """Test failed verification does not revoke the token."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService,
            "get_phone_code_login_data",
            return_value={
                "session_uuid": "session-uuid-123",
                "phone_number": "+14155551234",
            },
        ):
            with patch.object(
                AccountService, "revoke_phone_code_login_token"
            ) as mock_revoke:
                with patch("services.account_service.sms") as mock_sms:
                    mock_sms.is_inited.return_value = True
                    mock_sms.is_verify_enabled.return_value = True
                    mock_sms.verify_code.return_value = False

                    result = AccountService.verify_phone_code("token-123", "000000")

                    assert result is False
                    mock_revoke.assert_not_called()

    @patch("services.account_service.dify_config")
    @patch("services.account_service.logger")
    def test_returns_false_on_exception(self, mock_logger, mock_config):
        """Test returns False and logs exception on error."""
        from services.account_service import AccountService

        mock_config.PLIVO_VERIFY_ENABLED = True

        with patch.object(
            AccountService,
            "get_phone_code_login_data",
            return_value={
                "session_uuid": "session-uuid-123",
                "phone_number": "+14155551234",
            },
        ):
            with patch("services.account_service.sms") as mock_sms:
                mock_sms.is_inited.return_value = True
                mock_sms.is_verify_enabled.return_value = True
                mock_sms.verify_code.side_effect = Exception("API Error")

                result = AccountService.verify_phone_code("token-123", "123456")

                assert result is False
                mock_logger.exception.assert_called_once()


class TestAccountServiceTokenManagement:
    """Test AccountService token management methods."""

    @patch("services.account_service.TokenManager")
    def test_get_phone_code_login_data(self, mock_token_manager):
        """Test get_phone_code_login_data calls TokenManager correctly."""
        from services.account_service import AccountService

        mock_token_manager.get_token_data.return_value = {
            "session_uuid": "session-uuid-123",
            "phone_number": "+14155551234",
        }

        result = AccountService.get_phone_code_login_data("test-token")

        mock_token_manager.get_token_data.assert_called_once_with(
            "test-token", "phone_code_login"
        )
        assert result["session_uuid"] == "session-uuid-123"

    @patch("services.account_service.TokenManager")
    def test_revoke_phone_code_login_token(self, mock_token_manager):
        """Test revoke_phone_code_login_token calls TokenManager correctly."""
        from services.account_service import AccountService

        AccountService.revoke_phone_code_login_token("test-token")

        mock_token_manager.revoke_token.assert_called_once_with(
            "test-token", "phone_code_login"
        )


class TestAccountServicePhoneVerifyRateLimiting:
    """Test AccountService phone verification rate limiting."""

    @patch("services.account_service.redis_client")
    @patch("services.account_service.dify_config")
    def test_add_phone_verify_error_rate_limit_new(self, mock_config, mock_redis):
        """Test adding first rate limit error."""
        from services.account_service import AccountService

        mock_config.PHONE_VERIFY_LOCKOUT_DURATION = 86400
        mock_redis.get.return_value = None

        AccountService.add_phone_verify_error_rate_limit("+14155551234")

        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args[0]
        assert "phone_verify_error_rate_limit:+14155551234" in call_args[0]
        assert call_args[2] == 1  # First error

    @patch("services.account_service.redis_client")
    @patch("services.account_service.dify_config")
    def test_add_phone_verify_error_rate_limit_increment(self, mock_config, mock_redis):
        """Test incrementing existing rate limit error count."""
        from services.account_service import AccountService

        mock_config.PHONE_VERIFY_LOCKOUT_DURATION = 86400
        mock_redis.get.return_value = b"3"  # Already has 3 errors

        AccountService.add_phone_verify_error_rate_limit("+14155551234")

        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args[0]
        assert call_args[2] == 4  # Incremented to 4

    @patch("services.account_service.redis_client")
    def test_is_phone_verify_error_rate_limit_not_limited(self, mock_redis):
        """Test returns False when under rate limit."""
        from services.account_service import AccountService

        mock_redis.get.return_value = b"3"  # 3 errors, under limit of 5

        result = AccountService.is_phone_verify_error_rate_limit("+14155551234")

        assert result is False

    @patch("services.account_service.redis_client")
    def test_is_phone_verify_error_rate_limit_at_limit(self, mock_redis):
        """Test returns True when at rate limit."""
        from services.account_service import AccountService

        mock_redis.get.return_value = b"5"  # 5 errors, at limit

        result = AccountService.is_phone_verify_error_rate_limit("+14155551234")

        assert result is True

    @patch("services.account_service.redis_client")
    def test_is_phone_verify_error_rate_limit_over_limit(self, mock_redis):
        """Test returns True when over rate limit."""
        from services.account_service import AccountService

        mock_redis.get.return_value = b"10"  # 10 errors, over limit

        result = AccountService.is_phone_verify_error_rate_limit("+14155551234")

        assert result is True

    @patch("services.account_service.redis_client")
    def test_is_phone_verify_error_rate_limit_no_errors(self, mock_redis):
        """Test returns False when no errors recorded."""
        from services.account_service import AccountService

        mock_redis.get.return_value = None  # No errors

        result = AccountService.is_phone_verify_error_rate_limit("+14155551234")

        assert result is False

    @patch("services.account_service.redis_client")
    def test_reset_phone_verify_error_rate_limit(self, mock_redis):
        """Test resetting phone verify error rate limit."""
        from services.account_service import AccountService

        AccountService.reset_phone_verify_error_rate_limit("+14155551234")

        mock_redis.delete.assert_called_once_with(
            "phone_verify_error_rate_limit:+14155551234"
        )
