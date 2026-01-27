"""
Unit tests for Plivo SMS verification Celery tasks.

This module tests the SMS verification task functionality including:
- Sending phone verification codes via Plivo Verify API
- Verifying OTP codes
- Error handling and logging
- Task execution timing
"""

from unittest.mock import MagicMock, patch

import pytest


class TestSendPhoneVerificationCodeTask:
    """Test the send_phone_verification_code_task Celery task."""

    @patch("tasks.sms_verify_task.sms")
    def test_task_returns_none_when_sms_not_initialized(self, mock_sms):
        """Test task returns None when SMS client is not initialized."""
        from tasks.sms_verify_task import send_phone_verification_code_task

        mock_sms.is_inited.return_value = False
        mock_sms.is_verify_enabled.return_value = False

        result = send_phone_verification_code_task("+14155551234")

        assert result is None
        mock_sms.is_inited.assert_called_once()

    @patch("tasks.sms_verify_task.sms")
    def test_task_returns_none_when_verify_not_enabled(self, mock_sms):
        """Test task returns None when verify is not enabled."""
        from tasks.sms_verify_task import send_phone_verification_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = False

        result = send_phone_verification_code_task("+14155551234")

        assert result is None

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    def test_task_success(self, mock_logger, mock_sms):
        """Test successful phone verification code sending."""
        from tasks.sms_verify_task import send_phone_verification_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.send_verification_code.return_value = {
            "session_uuid": "test-session-uuid",
            "status": "sent",
        }

        result = send_phone_verification_code_task("+14155551234")

        assert result is not None
        assert result["session_uuid"] == "test-session-uuid"
        assert result["status"] == "sent"
        mock_sms.send_verification_code.assert_called_once_with("+14155551234")
        # Verify logging was called
        assert mock_logger.info.call_count >= 2  # Start and success logs

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    def test_task_returns_none_on_exception(self, mock_logger, mock_sms):
        """Test task returns None and logs exception on error."""
        from tasks.sms_verify_task import send_phone_verification_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.send_verification_code.side_effect = Exception("API Error")

        result = send_phone_verification_code_task("+14155551234")

        assert result is None
        mock_logger.exception.assert_called_once()

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    @patch("tasks.sms_verify_task.time")
    def test_task_logs_execution_time(self, mock_time, mock_logger, mock_sms):
        """Test task logs execution time."""
        from tasks.sms_verify_task import send_phone_verification_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.send_verification_code.return_value = {
            "session_uuid": "test-uuid",
            "status": "sent",
        }
        mock_time.perf_counter.side_effect = [100.0, 100.5]  # 0.5 second execution

        send_phone_verification_code_task("+14155551234")

        assert mock_time.perf_counter.call_count == 2
        # Verify latency is logged in success message
        success_log_calls = [call for call in mock_logger.info.call_args_list]
        assert any("latency" in str(call) for call in success_log_calls)


class TestVerifyPhoneCodeTask:
    """Test the verify_phone_code_task Celery task."""

    @patch("tasks.sms_verify_task.sms")
    def test_task_returns_false_when_sms_not_initialized(self, mock_sms):
        """Test task returns False when SMS client is not initialized."""
        from tasks.sms_verify_task import verify_phone_code_task

        mock_sms.is_inited.return_value = False
        mock_sms.is_verify_enabled.return_value = False

        result = verify_phone_code_task("session-uuid", "123456")

        assert result is False

    @patch("tasks.sms_verify_task.sms")
    def test_task_returns_false_when_verify_not_enabled(self, mock_sms):
        """Test task returns False when verify is not enabled."""
        from tasks.sms_verify_task import verify_phone_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = False

        result = verify_phone_code_task("session-uuid", "123456")

        assert result is False

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    def test_task_success_verification_passed(self, mock_logger, mock_sms):
        """Test successful OTP verification."""
        from tasks.sms_verify_task import verify_phone_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.verify_code.return_value = True

        result = verify_phone_code_task("session-uuid-123", "123456")

        assert result is True
        mock_sms.verify_code.assert_called_once_with("session-uuid-123", "123456")

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    def test_task_success_verification_failed(self, mock_logger, mock_sms):
        """Test OTP verification failure (invalid OTP)."""
        from tasks.sms_verify_task import verify_phone_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.verify_code.return_value = False

        result = verify_phone_code_task("session-uuid-123", "000000")

        assert result is False
        mock_sms.verify_code.assert_called_once_with("session-uuid-123", "000000")

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    def test_task_returns_false_on_exception(self, mock_logger, mock_sms):
        """Test task returns False and logs exception on error."""
        from tasks.sms_verify_task import verify_phone_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.verify_code.side_effect = Exception("API Error")

        result = verify_phone_code_task("session-uuid-123", "123456")

        assert result is False
        mock_logger.exception.assert_called_once()

    @patch("tasks.sms_verify_task.sms")
    @patch("tasks.sms_verify_task.logger")
    @patch("tasks.sms_verify_task.time")
    def test_task_logs_execution_time(self, mock_time, mock_logger, mock_sms):
        """Test task logs execution time."""
        from tasks.sms_verify_task import verify_phone_code_task

        mock_sms.is_inited.return_value = True
        mock_sms.is_verify_enabled.return_value = True
        mock_sms.verify_code.return_value = True
        mock_time.perf_counter.side_effect = [100.0, 100.3]  # 0.3 second execution

        verify_phone_code_task("session-uuid-123", "123456")

        assert mock_time.perf_counter.call_count == 2


class TestTaskQueueConfiguration:
    """Test task queue configuration."""

    def test_send_verification_task_uses_mail_queue(self):
        """Test send verification task is configured to use mail queue."""
        from tasks.sms_verify_task import send_phone_verification_code_task

        # Check the task's queue setting
        assert send_phone_verification_code_task.queue == "mail"

    def test_verify_code_task_uses_mail_queue(self):
        """Test verify code task is configured to use mail queue."""
        from tasks.sms_verify_task import verify_phone_code_task

        # Check the task's queue setting
        assert verify_phone_code_task.queue == "mail"
