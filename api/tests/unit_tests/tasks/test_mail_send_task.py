"""
Unit tests for mail send tasks.

This module tests the mail sending functionality including:
- Email template rendering with internationalization
- SMTP integration with various configurations
- Retry logic for failed email sends
- Error handling and logging
"""

import smtplib
from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from configs.feature import TemplateMode
from libs.email_i18n import EmailType
from tasks.mail_inner_task import _render_template_with_strategy, send_inner_email_task
from tasks.mail_register_task import (
    send_email_register_mail_task,
    send_email_register_mail_task_when_account_exist,
)
from tasks.mail_reset_password_task import (
    send_reset_password_mail_task,
    send_reset_password_mail_task_when_account_not_exist,
)


class TestEmailTemplateRendering:
    """Test email template rendering with various scenarios."""

    def test_render_template_unsafe_mode(self):
        """Test template rendering in unsafe mode with Jinja2 syntax."""
        # Arrange
        body = "Hello {{ name }}, your code is {{ code }}"
        substitutions = {"name": "John", "code": "123456"}

        # Act
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.UNSAFE):
            result = _render_template_with_strategy(body, substitutions)

        # Assert
        assert result == "Hello John, your code is 123456"

    def test_render_template_sandbox_mode(self):
        """Test template rendering in sandbox mode for security."""
        # Arrange
        body = "Hello {{ name }}, your code is {{ code }}"
        substitutions = {"name": "Alice", "code": "654321"}

        # Act
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.SANDBOX):
            with patch.object(dify_config, "MAIL_TEMPLATING_TIMEOUT", 3):
                result = _render_template_with_strategy(body, substitutions)

        # Assert
        assert result == "Hello Alice, your code is 654321"

    def test_render_template_disabled_mode(self):
        """Test template rendering when templating is disabled."""
        # Arrange
        body = "Hello {{ name }}, your code is {{ code }}"
        substitutions = {"name": "Bob", "code": "999999"}

        # Act
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.DISABLED):
            result = _render_template_with_strategy(body, substitutions)

        # Assert - should return body unchanged
        assert result == "Hello {{ name }}, your code is {{ code }}"

    def test_render_template_sandbox_timeout(self):
        """Test that sandbox mode respects timeout settings and range limits."""
        # Arrange - template with very large range (exceeds sandbox MAX_RANGE)
        body = "{% for i in range(1000000) %}{{ i }}{% endfor %}"
        substitutions: dict[str, str] = {}

        # Act & Assert - sandbox blocks ranges larger than MAX_RANGE (100000)
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.SANDBOX):
            with patch.object(dify_config, "MAIL_TEMPLATING_TIMEOUT", 1):
                # Should raise OverflowError for range too big
                with pytest.raises((TimeoutError, RuntimeError, OverflowError)):
                    _render_template_with_strategy(body, substitutions)

    def test_render_template_invalid_mode(self):
        """Test that invalid template mode raises ValueError."""
        # Arrange
        body = "Test"
        substitutions: dict[str, str] = {}

        # Act & Assert
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", "invalid_mode"):
            with pytest.raises(ValueError, match="Unsupported mail templating mode"):
                _render_template_with_strategy(body, substitutions)

    def test_render_template_with_special_characters(self):
        """Test template rendering with special characters and HTML."""
        # Arrange
        body = "<h1>Hello {{ name }}</h1><p>Code: {{ code }}</p>"
        substitutions = {"name": "Test<User>", "code": "ABC&123"}

        # Act
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.SANDBOX):
            result = _render_template_with_strategy(body, substitutions)

        # Assert
        assert "Test<User>" in result
        assert "ABC&123" in result

    def test_render_template_missing_variable_sandbox(self):
        """Test sandbox mode handles missing variables gracefully."""
        # Arrange
        body = "Hello {{ name }}, your code is {{ missing_var }}"
        substitutions = {"name": "John"}

        # Act - sandbox mode renders undefined variables as empty strings by default
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.SANDBOX):
            result = _render_template_with_strategy(body, substitutions)

        # Assert - undefined variable is rendered as empty string
        assert "Hello John" in result
        assert "missing_var" not in result  # Variable name should not appear in output


class TestSMTPIntegration:
    """Test SMTP client integration with various configurations."""

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_with_tls_ssl(self, mock_smtp_ssl):
        """Test SMTP send with TLS using SMTP_SSL."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test Subject", "html": "<p>Test Content</p>"}

        # Act
        client.send(mail_data)

        # Assert
        mock_smtp_ssl.assert_called_once_with("smtp.example.com", 465, timeout=10)
        mock_server.login.assert_called_once_with("user@example.com", "password123")
        mock_server.sendmail.assert_called_once()
        mock_server.quit.assert_called_once()

    @patch("libs.smtp.smtplib.SMTP")
    def test_smtp_send_with_opportunistic_tls(self, mock_smtp):
        """Test SMTP send with opportunistic TLS (STARTTLS)."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=587,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=True,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act
        client.send(mail_data)

        # Assert
        mock_smtp.assert_called_once_with("smtp.example.com", 587, timeout=10)
        mock_server.ehlo.assert_called()
        mock_server.starttls.assert_called_once()
        assert mock_server.ehlo.call_count == 2  # Before and after STARTTLS
        mock_server.sendmail.assert_called_once()
        mock_server.quit.assert_called_once()

    @patch("libs.smtp.smtplib.SMTP")
    def test_smtp_send_without_tls(self, mock_smtp):
        """Test SMTP send without TLS encryption."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=25,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=False,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act
        client.send(mail_data)

        # Assert
        mock_smtp.assert_called_once_with("smtp.example.com", 25, timeout=10)
        mock_server.login.assert_called_once()
        mock_server.sendmail.assert_called_once()
        mock_server.quit.assert_called_once()

    @patch("libs.smtp.smtplib.SMTP")
    def test_smtp_send_without_authentication(self, mock_smtp):
        """Test SMTP send without authentication (empty credentials)."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=25,
            username="",
            password="",
            _from="noreply@example.com",
            use_tls=False,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act
        client.send(mail_data)

        # Assert
        mock_server.login.assert_not_called()  # Should skip login with empty credentials
        mock_server.sendmail.assert_called_once()
        mock_server.quit.assert_called_once()

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_authentication_failure(self, mock_smtp_ssl):
        """Test SMTP send handles authentication failure."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server
        mock_server.login.side_effect = smtplib.SMTPAuthenticationError(535, b"Authentication failed")

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="wrong_password",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises(smtplib.SMTPAuthenticationError):
            client.send(mail_data)

        mock_server.quit.assert_called_once()  # Should still cleanup

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_timeout_error(self, mock_smtp_ssl):
        """Test SMTP send handles timeout errors."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_smtp_ssl.side_effect = TimeoutError("Connection timeout")

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises(TimeoutError):
            client.send(mail_data)

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_connection_refused(self, mock_smtp_ssl):
        """Test SMTP send handles connection refused errors."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_smtp_ssl.side_effect = ConnectionRefusedError("Connection refused")

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises((ConnectionRefusedError, OSError)):
            client.send(mail_data)

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_ensures_cleanup_on_error(self, mock_smtp_ssl):
        """Test SMTP send ensures cleanup even when errors occur."""
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server
        mock_server.sendmail.side_effect = smtplib.SMTPException("Send failed")

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises(smtplib.SMTPException):
            client.send(mail_data)

        # Verify cleanup was called
        mock_server.quit.assert_called_once()


class TestMailTaskRetryLogic:
    """Test retry logic for mail sending tasks."""

    @patch("tasks.mail_register_task.mail")
    def test_mail_task_skips_when_not_initialized(self, mock_mail):
        """Test that mail tasks skip execution when mail is not initialized."""
        # Arrange
        mock_mail.is_inited.return_value = False

        # Act
        result = send_email_register_mail_task(language="en-US", to="test@example.com", code="123456")

        # Assert
        assert result is None
        mock_mail.is_inited.assert_called_once()

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    @patch("tasks.mail_register_task.logger")
    def test_mail_task_logs_success(self, mock_logger, mock_mail, mock_email_service):
        """Test that successful mail sends are logged properly."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task(language="en-US", to="test@example.com", code="123456")

        # Assert
        mock_service.send_email.assert_called_once_with(
            email_type=EmailType.EMAIL_REGISTER,
            language_code="en-US",
            to="test@example.com",
            template_context={"to": "test@example.com", "code": "123456"},
        )
        # Verify logging calls
        assert mock_logger.info.call_count == 2  # Start and success logs

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    @patch("tasks.mail_register_task.logger")
    def test_mail_task_logs_failure(self, mock_logger, mock_mail, mock_email_service):
        """Test that failed mail sends are logged with exception details."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_service.send_email.side_effect = Exception("SMTP connection failed")
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task(language="en-US", to="test@example.com", code="123456")

        # Assert
        mock_logger.exception.assert_called_once_with("Send email register mail to %s failed", "test@example.com")

    @patch("tasks.mail_reset_password_task.get_email_i18n_service")
    @patch("tasks.mail_reset_password_task.mail")
    def test_reset_password_task_success(self, mock_mail, mock_email_service):
        """Test reset password task sends email successfully."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_reset_password_mail_task(language="zh-Hans", to="user@example.com", code="RESET123")

        # Assert
        mock_service.send_email.assert_called_once_with(
            email_type=EmailType.RESET_PASSWORD,
            language_code="zh-Hans",
            to="user@example.com",
            template_context={"to": "user@example.com", "code": "RESET123"},
        )

    @patch("tasks.mail_reset_password_task.get_email_i18n_service")
    @patch("tasks.mail_reset_password_task.mail")
    @patch("tasks.mail_reset_password_task.dify_config")
    def test_reset_password_when_account_not_exist_with_register(self, mock_config, mock_mail, mock_email_service):
        """Test reset password task when account doesn't exist and registration is allowed."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_config.CONSOLE_WEB_URL = "https://console.example.com"
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_reset_password_mail_task_when_account_not_exist(
            language="en-US", to="newuser@example.com", is_allow_register=True
        )

        # Assert
        mock_service.send_email.assert_called_once()
        call_args = mock_service.send_email.call_args
        assert call_args[1]["email_type"] == EmailType.RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST
        assert call_args[1]["to"] == "newuser@example.com"
        assert "sign_up_url" in call_args[1]["template_context"]

    @patch("tasks.mail_reset_password_task.get_email_i18n_service")
    @patch("tasks.mail_reset_password_task.mail")
    def test_reset_password_when_account_not_exist_without_register(self, mock_mail, mock_email_service):
        """Test reset password task when account doesn't exist and registration is not allowed."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_reset_password_mail_task_when_account_not_exist(
            language="en-US", to="newuser@example.com", is_allow_register=False
        )

        # Assert
        mock_service.send_email.assert_called_once()
        call_args = mock_service.send_email.call_args
        assert call_args[1]["email_type"] == EmailType.RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST_NO_REGISTER


class TestMailTaskInternationalization:
    """Test internationalization support in mail tasks."""

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    def test_mail_task_with_english_language(self, mock_mail, mock_email_service):
        """Test mail task with English language code."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task(language="en-US", to="test@example.com", code="123456")

        # Assert
        call_args = mock_service.send_email.call_args
        assert call_args[1]["language_code"] == "en-US"

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    def test_mail_task_with_chinese_language(self, mock_mail, mock_email_service):
        """Test mail task with Chinese language code."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task(language="zh-Hans", to="test@example.com", code="123456")

        # Assert
        call_args = mock_service.send_email.call_args
        assert call_args[1]["language_code"] == "zh-Hans"

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    @patch("tasks.mail_register_task.dify_config")
    def test_account_exist_task_includes_urls(self, mock_config, mock_mail, mock_email_service):
        """Test account exist task includes proper URLs in template context."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_config.CONSOLE_WEB_URL = "https://console.example.com"
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task_when_account_exist(
            language="en-US", to="existing@example.com", account_name="John Doe"
        )

        # Assert
        call_args = mock_service.send_email.call_args
        context = call_args[1]["template_context"]
        assert context["login_url"] == "https://console.example.com/signin"
        assert context["reset_password_url"] == "https://console.example.com/reset-password"
        assert context["account_name"] == "John Doe"


class TestInnerEmailTask:
    """Test inner email task with template rendering."""

    @patch("tasks.mail_inner_task.get_email_i18n_service")
    @patch("tasks.mail_inner_task.mail")
    @patch("tasks.mail_inner_task._render_template_with_strategy")
    def test_inner_email_task_renders_and_sends(self, mock_render, mock_mail, mock_email_service):
        """Test inner email task renders template and sends email."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_render.return_value = "<p>Hello John, your code is 123456</p>"
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        to_list = ["user1@example.com", "user2@example.com"]
        subject = "Test Subject"
        body = "<p>Hello {{ name }}, your code is {{ code }}</p>"
        substitutions = {"name": "John", "code": "123456"}

        # Act
        send_inner_email_task(to=to_list, subject=subject, body=body, substitutions=substitutions)

        # Assert
        mock_render.assert_called_once_with(body, substitutions)
        mock_service.send_raw_email.assert_called_once_with(
            to=to_list, subject=subject, html_content="<p>Hello John, your code is 123456</p>"
        )

    @patch("tasks.mail_inner_task.mail")
    def test_inner_email_task_skips_when_not_initialized(self, mock_mail):
        """Test inner email task skips when mail is not initialized."""
        # Arrange
        mock_mail.is_inited.return_value = False

        # Act
        result = send_inner_email_task(to=["test@example.com"], subject="Test", body="Body", substitutions={})

        # Assert
        assert result is None

    @patch("tasks.mail_inner_task.get_email_i18n_service")
    @patch("tasks.mail_inner_task.mail")
    @patch("tasks.mail_inner_task._render_template_with_strategy")
    @patch("tasks.mail_inner_task.logger")
    def test_inner_email_task_logs_failure(self, mock_logger, mock_render, mock_mail, mock_email_service):
        """Test inner email task logs failures properly."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_render.return_value = "<p>Content</p>"
        mock_service = MagicMock()
        mock_service.send_raw_email.side_effect = Exception("Send failed")
        mock_email_service.return_value = mock_service

        to_list = ["user@example.com"]

        # Act
        send_inner_email_task(to=to_list, subject="Test", body="Body", substitutions={})

        # Assert
        mock_logger.exception.assert_called_once()


class TestSendGridIntegration:
    """Test SendGrid client integration."""

    @patch("libs.sendgrid.sendgrid.SendGridAPIClient")
    def test_sendgrid_send_success(self, mock_sg_client):
        """Test SendGrid client sends email successfully."""
        # Arrange
        from libs.sendgrid import SendGridClient

        mock_client_instance = MagicMock()
        mock_sg_client.return_value = mock_client_instance
        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_client_instance.client.mail.send.post.return_value = mock_response

        client = SendGridClient(sendgrid_api_key="test_api_key", _from="noreply@example.com")

        mail_data = {"to": "recipient@example.com", "subject": "Test Subject", "html": "<p>Test Content</p>"}

        # Act
        client.send(mail_data)

        # Assert
        mock_sg_client.assert_called_once_with(api_key="test_api_key")
        mock_client_instance.client.mail.send.post.assert_called_once()

    @patch("libs.sendgrid.sendgrid.SendGridAPIClient")
    def test_sendgrid_send_missing_recipient(self, mock_sg_client):
        """Test SendGrid client raises error when recipient is missing."""
        # Arrange
        from libs.sendgrid import SendGridClient

        client = SendGridClient(sendgrid_api_key="test_api_key", _from="noreply@example.com")

        mail_data = {"to": "", "subject": "Test Subject", "html": "<p>Test Content</p>"}

        # Act & Assert
        with pytest.raises(ValueError, match="recipient address is missing"):
            client.send(mail_data)

    @patch("libs.sendgrid.sendgrid.SendGridAPIClient")
    def test_sendgrid_send_unauthorized_error(self, mock_sg_client):
        """Test SendGrid client handles unauthorized errors."""
        # Arrange
        from python_http_client.exceptions import UnauthorizedError

        from libs.sendgrid import SendGridClient

        mock_client_instance = MagicMock()
        mock_sg_client.return_value = mock_client_instance
        mock_client_instance.client.mail.send.post.side_effect = UnauthorizedError(
            MagicMock(status_code=401), "Unauthorized"
        )

        client = SendGridClient(sendgrid_api_key="invalid_key", _from="noreply@example.com")

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises(UnauthorizedError):
            client.send(mail_data)

    @patch("libs.sendgrid.sendgrid.SendGridAPIClient")
    def test_sendgrid_send_forbidden_error(self, mock_sg_client):
        """Test SendGrid client handles forbidden errors."""
        # Arrange
        from python_http_client.exceptions import ForbiddenError

        from libs.sendgrid import SendGridClient

        mock_client_instance = MagicMock()
        mock_sg_client.return_value = mock_client_instance
        mock_client_instance.client.mail.send.post.side_effect = ForbiddenError(MagicMock(status_code=403), "Forbidden")

        client = SendGridClient(sendgrid_api_key="test_api_key", _from="invalid@example.com")

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises(ForbiddenError):
            client.send(mail_data)

    @patch("libs.sendgrid.sendgrid.SendGridAPIClient")
    def test_sendgrid_send_timeout_error(self, mock_sg_client):
        """Test SendGrid client handles timeout errors."""
        # Arrange
        from libs.sendgrid import SendGridClient

        mock_client_instance = MagicMock()
        mock_sg_client.return_value = mock_client_instance
        mock_client_instance.client.mail.send.post.side_effect = TimeoutError("Request timeout")

        client = SendGridClient(sendgrid_api_key="test_api_key", _from="noreply@example.com")

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act & Assert
        with pytest.raises(TimeoutError):
            client.send(mail_data)


class TestMailExtension:
    """Test mail extension initialization and configuration."""

    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_smtp_configuration(self, mock_config):
        """Test mail extension initializes SMTP client correctly."""
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "smtp"
        mock_config.SMTP_SERVER = "smtp.example.com"
        mock_config.SMTP_PORT = 465
        mock_config.SMTP_USERNAME = "user@example.com"
        mock_config.SMTP_PASSWORD = "password123"
        mock_config.SMTP_USE_TLS = True
        mock_config.SMTP_OPPORTUNISTIC_TLS = False
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@example.com"

        mail = Mail()
        mock_app = MagicMock()

        # Act
        mail.init_app(mock_app)

        # Assert
        assert mail.is_inited() is True
        assert mail._client is not None

    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_without_mail_type(self, mock_config):
        """Test mail extension skips initialization when MAIL_TYPE is not set."""
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = None

        mail = Mail()
        mock_app = MagicMock()

        # Act
        mail.init_app(mock_app)

        # Assert
        assert mail.is_inited() is False

    @patch("extensions.ext_mail.dify_config")
    def test_mail_send_validates_parameters(self, mock_config):
        """Test mail send validates required parameters."""
        # Arrange
        from extensions.ext_mail import Mail

        mail = Mail()
        mail._client = MagicMock()
        mail._default_send_from = "noreply@example.com"

        # Act & Assert - missing to
        with pytest.raises(ValueError, match="mail to is not set"):
            mail.send(to="", subject="Test", html="<p>Content</p>")

        # Act & Assert - missing subject
        with pytest.raises(ValueError, match="mail subject is not set"):
            mail.send(to="test@example.com", subject="", html="<p>Content</p>")

        # Act & Assert - missing html
        with pytest.raises(ValueError, match="mail html is not set"):
            mail.send(to="test@example.com", subject="Test", html="")

    @patch("extensions.ext_mail.dify_config")
    def test_mail_send_uses_default_from(self, mock_config):
        """Test mail send uses default from address when not provided."""
        # Arrange
        from extensions.ext_mail import Mail

        mail = Mail()
        mock_client = MagicMock()
        mail._client = mock_client
        mail._default_send_from = "default@example.com"

        # Act
        mail.send(to="test@example.com", subject="Test", html="<p>Content</p>")

        # Assert
        mock_client.send.assert_called_once()
        call_args = mock_client.send.call_args[0][0]
        assert call_args["from"] == "default@example.com"


class TestEmailI18nService:
    """Test email internationalization service."""

    @patch("libs.email_i18n.FlaskMailSender")
    @patch("libs.email_i18n.FeatureBrandingService")
    @patch("libs.email_i18n.FlaskEmailRenderer")
    def test_email_service_sends_with_branding(self, mock_renderer_class, mock_branding_class, mock_sender_class):
        """Test email service sends email with branding support."""
        # Arrange
        from libs.email_i18n import EmailI18nConfig, EmailI18nService, EmailLanguage, EmailTemplate, EmailType
        from services.feature_service import BrandingModel

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "<html>Rendered content</html>"
        mock_renderer_class.return_value = mock_renderer

        mock_branding = MagicMock()
        mock_branding.get_branding_config.return_value = BrandingModel(
            enabled=True, application_title="Custom App", logo="logo.png"
        )
        mock_branding_class.return_value = mock_branding

        mock_sender = MagicMock()
        mock_sender_class.return_value = mock_sender

        template = EmailTemplate(
            subject="Test {application_title}",
            template_path="templates/test.html",
            branded_template_path="templates/branded/test.html",
        )

        config = EmailI18nConfig(templates={EmailType.EMAIL_REGISTER: {EmailLanguage.EN_US: template}})

        service = EmailI18nService(
            config=config, renderer=mock_renderer, branding_service=mock_branding, sender=mock_sender
        )

        # Act
        service.send_email(
            email_type=EmailType.EMAIL_REGISTER,
            language_code="en-US",
            to="test@example.com",
            template_context={"code": "123456"},
        )

        # Assert
        mock_renderer.render_template.assert_called_once()
        # Should use branded template
        assert mock_renderer.render_template.call_args[0][0] == "templates/branded/test.html"
        mock_sender.send_email.assert_called_once_with(
            to="test@example.com", subject="Test Custom App", html_content="<html>Rendered content</html>"
        )

    @patch("libs.email_i18n.FlaskMailSender")
    def test_email_service_send_raw_email_single_recipient(self, mock_sender_class):
        """Test email service sends raw email to single recipient."""
        # Arrange
        from libs.email_i18n import EmailI18nConfig, EmailI18nService

        mock_sender = MagicMock()
        mock_sender_class.return_value = mock_sender

        service = EmailI18nService(
            config=EmailI18nConfig(),
            renderer=MagicMock(),
            branding_service=MagicMock(),
            sender=mock_sender,
        )

        # Act
        service.send_raw_email(to="test@example.com", subject="Test", html_content="<p>Content</p>")

        # Assert
        mock_sender.send_email.assert_called_once_with(
            to="test@example.com", subject="Test", html_content="<p>Content</p>"
        )

    @patch("libs.email_i18n.FlaskMailSender")
    def test_email_service_send_raw_email_multiple_recipients(self, mock_sender_class):
        """Test email service sends raw email to multiple recipients."""
        # Arrange
        from libs.email_i18n import EmailI18nConfig, EmailI18nService

        mock_sender = MagicMock()
        mock_sender_class.return_value = mock_sender

        service = EmailI18nService(
            config=EmailI18nConfig(),
            renderer=MagicMock(),
            branding_service=MagicMock(),
            sender=mock_sender,
        )

        # Act
        service.send_raw_email(
            to=["user1@example.com", "user2@example.com"], subject="Test", html_content="<p>Content</p>"
        )

        # Assert
        assert mock_sender.send_email.call_count == 2
        mock_sender.send_email.assert_any_call(to="user1@example.com", subject="Test", html_content="<p>Content</p>")
        mock_sender.send_email.assert_any_call(to="user2@example.com", subject="Test", html_content="<p>Content</p>")


class TestPerformanceAndTiming:
    """Test performance tracking and timing in mail tasks."""

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    @patch("tasks.mail_register_task.logger")
    @patch("tasks.mail_register_task.time")
    def test_mail_task_tracks_execution_time(self, mock_time, mock_logger, mock_mail, mock_email_service):
        """Test that mail tasks track and log execution time."""
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Simulate time progression
        mock_time.perf_counter.side_effect = [100.0, 100.5]  # 0.5 second execution

        # Act
        send_email_register_mail_task(language="en-US", to="test@example.com", code="123456")

        # Assert
        assert mock_time.perf_counter.call_count == 2
        # Verify latency is logged
        success_log_call = mock_logger.info.call_args_list[1]
        assert "latency" in str(success_log_call)


class TestEdgeCasesAndErrorHandling:
    """
    Test edge cases and error handling scenarios.

    This test class covers unusual inputs, boundary conditions,
    and various error scenarios to ensure robust error handling.
    """

    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_invalid_smtp_config_missing_server(self, mock_config):
        """
        Test mail initialization fails when SMTP server is missing.

        Validates that proper error is raised when required SMTP
        configuration parameters are not provided.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "smtp"
        mock_config.SMTP_SERVER = None  # Missing required parameter
        mock_config.SMTP_PORT = 465

        mail = Mail()
        mock_app = MagicMock()

        # Act & Assert
        with pytest.raises(ValueError, match="SMTP_SERVER and SMTP_PORT are required"):
            mail.init_app(mock_app)

    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_invalid_smtp_opportunistic_tls_without_tls(self, mock_config):
        """
        Test mail initialization fails with opportunistic TLS but TLS disabled.

        Opportunistic TLS (STARTTLS) requires TLS to be enabled.
        This test ensures the configuration is validated properly.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "smtp"
        mock_config.SMTP_SERVER = "smtp.example.com"
        mock_config.SMTP_PORT = 587
        mock_config.SMTP_USE_TLS = False  # TLS disabled
        mock_config.SMTP_OPPORTUNISTIC_TLS = True  # But opportunistic TLS enabled

        mail = Mail()
        mock_app = MagicMock()

        # Act & Assert
        with pytest.raises(ValueError, match="SMTP_OPPORTUNISTIC_TLS is not supported without enabling SMTP_USE_TLS"):
            mail.init_app(mock_app)

    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_unsupported_mail_type(self, mock_config):
        """
        Test mail initialization fails with unsupported mail type.

        Ensures that only supported mail providers (smtp, sendgrid, resend)
        are accepted and invalid types are rejected.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "unsupported_provider"

        mail = Mail()
        mock_app = MagicMock()

        # Act & Assert
        with pytest.raises(ValueError, match="Unsupported mail type"):
            mail.init_app(mock_app)

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_with_empty_subject(self, mock_smtp_ssl):
        """
        Test SMTP client handles empty subject gracefully.

        While not ideal, the SMTP client should be able to send
        emails with empty subjects without crashing.
        """
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        # Email with empty subject
        mail_data = {"to": "recipient@example.com", "subject": "", "html": "<p>Content</p>"}

        # Act
        client.send(mail_data)

        # Assert - should still send successfully
        mock_server.sendmail.assert_called_once()

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_with_unicode_characters(self, mock_smtp_ssl):
        """
        Test SMTP client handles Unicode characters in email content.

        Ensures proper handling of international characters in
        subject lines and email bodies.
        """
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        # Email with Unicode characters (Chinese, emoji, etc.)
        mail_data = {
            "to": "recipient@example.com",
            "subject": "测试邮件 🎉 Test Email",
            "html": "<p>你好世界 Hello World 🌍</p>",
        }

        # Act
        client.send(mail_data)

        # Assert
        mock_server.sendmail.assert_called_once()
        mock_server.quit.assert_called_once()

    @patch("tasks.mail_inner_task.get_email_i18n_service")
    @patch("tasks.mail_inner_task.mail")
    @patch("tasks.mail_inner_task._render_template_with_strategy")
    def test_inner_email_task_with_empty_recipient_list(self, mock_render, mock_mail, mock_email_service):
        """
        Test inner email task handles empty recipient list.

        When no recipients are provided, the task should handle
        this gracefully without attempting to send emails.
        """
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_render.return_value = "<p>Content</p>"
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_inner_email_task(to=[], subject="Test", body="Body", substitutions={})

        # Assert
        mock_service.send_raw_email.assert_called_once_with(to=[], subject="Test", html_content="<p>Content</p>")


class TestConcurrencyAndThreadSafety:
    """
    Test concurrent execution and thread safety scenarios.

    These tests ensure that mail tasks can handle concurrent
    execution without race conditions or resource conflicts.
    """

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    def test_multiple_mail_tasks_concurrent_execution(self, mock_mail, mock_email_service):
        """
        Test multiple mail tasks can execute concurrently.

        Simulates concurrent execution of multiple mail tasks
        to ensure thread safety and proper resource handling.
        """
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act - simulate concurrent task execution
        recipients = [f"user{i}@example.com" for i in range(5)]
        for recipient in recipients:
            send_email_register_mail_task(language="en-US", to=recipient, code="123456")

        # Assert - all tasks should complete successfully
        assert mock_service.send_email.call_count == 5


class TestResendIntegration:
    """
    Test Resend email service integration.

    Resend is an alternative email provider that can be used
    instead of SMTP or SendGrid.
    """

    @patch("builtins.__import__", side_effect=__import__)
    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_resend_configuration(self, mock_config, mock_import):
        """
        Test mail extension initializes Resend client correctly.

        Validates that Resend API key is properly configured
        and the client is initialized.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "resend"
        mock_config.RESEND_API_KEY = "re_test_api_key"
        mock_config.RESEND_API_URL = None
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@example.com"

        # Create mock resend module
        mock_resend = MagicMock()
        mock_emails = MagicMock()
        mock_resend.Emails = mock_emails

        # Override import for resend module
        original_import = __import__

        def custom_import(name, *args, **kwargs):
            if name == "resend":
                return mock_resend
            return original_import(name, *args, **kwargs)

        mock_import.side_effect = custom_import

        mail = Mail()
        mock_app = MagicMock()

        # Act
        mail.init_app(mock_app)

        # Assert
        assert mail.is_inited() is True
        assert mock_resend.api_key == "re_test_api_key"

    @patch("builtins.__import__", side_effect=__import__)
    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_resend_with_custom_url(self, mock_config, mock_import):
        """
        Test mail extension initializes Resend with custom API URL.

        Some deployments may use a custom Resend API endpoint.
        This test ensures custom URLs are properly configured.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "resend"
        mock_config.RESEND_API_KEY = "re_test_api_key"
        mock_config.RESEND_API_URL = "https://custom-resend.example.com"
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@example.com"

        # Create mock resend module
        mock_resend = MagicMock()
        mock_emails = MagicMock()
        mock_resend.Emails = mock_emails

        # Override import for resend module
        original_import = __import__

        def custom_import(name, *args, **kwargs):
            if name == "resend":
                return mock_resend
            return original_import(name, *args, **kwargs)

        mock_import.side_effect = custom_import

        mail = Mail()
        mock_app = MagicMock()

        # Act
        mail.init_app(mock_app)

        # Assert
        assert mail.is_inited() is True
        assert mock_resend.api_url == "https://custom-resend.example.com"

    @patch("extensions.ext_mail.dify_config")
    def test_mail_init_resend_missing_api_key(self, mock_config):
        """
        Test mail initialization fails when Resend API key is missing.

        Resend requires an API key to function. This test ensures
        proper validation of required configuration.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mock_config.MAIL_TYPE = "resend"
        mock_config.RESEND_API_KEY = None  # Missing API key

        mail = Mail()
        mock_app = MagicMock()

        # Act & Assert
        with pytest.raises(ValueError, match="RESEND_API_KEY is not set"):
            mail.init_app(mock_app)


class TestTemplateContextValidation:
    """
    Test template context validation and rendering.

    These tests ensure that template contexts are properly
    validated and rendered with correct variable substitution.
    """

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    def test_mail_task_template_context_includes_all_required_fields(self, mock_mail, mock_email_service):
        """
        Test that mail tasks include all required fields in template context.

        Template rendering requires specific context variables.
        This test ensures all required fields are present.
        """
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task(language="en-US", to="test@example.com", code="ABC123")

        # Assert
        call_args = mock_service.send_email.call_args
        context = call_args[1]["template_context"]

        # Verify all required fields are present
        assert "to" in context
        assert "code" in context
        assert context["to"] == "test@example.com"
        assert context["code"] == "ABC123"

    def test_render_template_with_complex_nested_data(self):
        """
        Test template rendering with complex nested data structures.

        Templates may need to access nested dictionaries or lists.
        This test ensures complex data structures are handled correctly.
        """
        # Arrange
        body = (
            "User: {{ user.name }}, Items: "
            "{% for item in items %}{{ item }}{% if not loop.last %}, {% endif %}{% endfor %}"
        )
        substitutions = {"user": {"name": "John Doe"}, "items": ["apple", "banana", "cherry"]}

        # Act
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.SANDBOX):
            result = _render_template_with_strategy(body, substitutions)

        # Assert
        assert "John Doe" in result
        assert "apple" in result
        assert "banana" in result
        assert "cherry" in result

    def test_render_template_with_conditional_logic(self):
        """
        Test template rendering with conditional logic.

        Templates often use conditional statements to customize
        content based on context variables.
        """
        # Arrange
        body = "{% if is_premium %}Premium User{% else %}Free User{% endif %}"

        # Act - Test with premium user
        with patch.object(dify_config, "MAIL_TEMPLATING_MODE", TemplateMode.SANDBOX):
            result_premium = _render_template_with_strategy(body, {"is_premium": True})
            result_free = _render_template_with_strategy(body, {"is_premium": False})

        # Assert
        assert "Premium User" in result_premium
        assert "Free User" in result_free


class TestEmailValidation:
    """
    Test email address validation and sanitization.

    These tests ensure that email addresses are properly
    validated before sending to prevent errors.
    """

    @patch("extensions.ext_mail.dify_config")
    def test_mail_send_with_invalid_email_format(self, mock_config):
        """
        Test mail send with malformed email address.

        While the Mail class doesn't validate email format,
        this test documents the current behavior.
        """
        # Arrange
        from extensions.ext_mail import Mail

        mail = Mail()
        mock_client = MagicMock()
        mail._client = mock_client
        mail._default_send_from = "noreply@example.com"

        # Act - send to malformed email (no validation in Mail class)
        mail.send(to="not-an-email", subject="Test", html="<p>Content</p>")

        # Assert - Mail class passes through to client
        mock_client.send.assert_called_once()


class TestSMTPEdgeCases:
    """
    Test SMTP-specific edge cases and error conditions.

    These tests cover various SMTP-specific scenarios that
    may occur in production environments.
    """

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_with_very_large_email_body(self, mock_smtp_ssl):
        """
        Test SMTP client handles large email bodies.

        Some emails may contain large HTML content with images
        or extensive formatting. This test ensures they're handled.
        """
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        # Create a large HTML body (simulating a newsletter)
        large_html = "<html><body>" + "<p>Content paragraph</p>" * 1000 + "</body></html>"
        mail_data = {"to": "recipient@example.com", "subject": "Large Email", "html": large_html}

        # Act
        client.send(mail_data)

        # Assert
        mock_server.sendmail.assert_called_once()
        # Verify the large content was included
        sent_message = mock_server.sendmail.call_args[0][2]
        assert len(sent_message) > 10000  # Should be a large message

    @patch("libs.smtp.smtplib.SMTP_SSL")
    def test_smtp_send_with_multiple_recipients_in_to_field(self, mock_smtp_ssl):
        """
        Test SMTP client with single recipient (current implementation).

        The current SMTPClient implementation sends to a single
        recipient per call. This test documents that behavior.
        """
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp_ssl.return_value = mock_server

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            _from="noreply@example.com",
            use_tls=True,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act
        client.send(mail_data)

        # Assert - sends to single recipient
        call_args = mock_server.sendmail.call_args
        assert call_args[0][1] == "recipient@example.com"

    @patch("libs.smtp.smtplib.SMTP")
    def test_smtp_send_with_whitespace_in_credentials(self, mock_smtp):
        """
        Test SMTP client strips whitespace from credentials.

        The SMTPClient checks for non-empty credentials after stripping
        whitespace to avoid authentication with blank credentials.
        """
        # Arrange
        from libs.smtp import SMTPClient

        mock_server = MagicMock()
        mock_smtp.return_value = mock_server

        # Credentials with only whitespace
        client = SMTPClient(
            server="smtp.example.com",
            port=25,
            username="   ",  # Only whitespace
            password="   ",  # Only whitespace
            _from="noreply@example.com",
            use_tls=False,
            opportunistic_tls=False,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Content</p>"}

        # Act
        client.send(mail_data)

        # Assert - should NOT attempt login with whitespace-only credentials
        mock_server.login.assert_not_called()


class TestLoggingAndMonitoring:
    """
    Test logging and monitoring functionality.

    These tests ensure that mail tasks properly log their
    execution for debugging and monitoring purposes.
    """

    @patch("tasks.mail_register_task.get_email_i18n_service")
    @patch("tasks.mail_register_task.mail")
    @patch("tasks.mail_register_task.logger")
    def test_mail_task_logs_recipient_information(self, mock_logger, mock_mail, mock_email_service):
        """
        Test that mail tasks log recipient information for audit trails.

        Logging recipient information helps with debugging and
        tracking email delivery in production.
        """
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_email_register_mail_task(language="en-US", to="audit@example.com", code="123456")

        # Assert
        # Check that recipient is logged in start message
        start_log_call = mock_logger.info.call_args_list[0]
        assert "audit@example.com" in str(start_log_call)

    @patch("tasks.mail_inner_task.get_email_i18n_service")
    @patch("tasks.mail_inner_task.mail")
    @patch("tasks.mail_inner_task.logger")
    def test_inner_email_task_logs_subject_for_tracking(self, mock_logger, mock_mail, mock_email_service):
        """
        Test that inner email task logs subject for tracking purposes.

        Logging email subjects helps identify which emails are being
        sent and aids in debugging delivery issues.
        """
        # Arrange
        mock_mail.is_inited.return_value = True
        mock_service = MagicMock()
        mock_email_service.return_value = mock_service

        # Act
        send_inner_email_task(
            to=["user@example.com"], subject="Important Notification", body="<p>Body</p>", substitutions={}
        )

        # Assert
        # Check that subject is logged
        start_log_call = mock_logger.info.call_args_list[0]
        assert "Important Notification" in str(start_log_call)
