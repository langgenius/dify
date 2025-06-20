"""
Integration tests for the mail sending system.

These tests verify that the mail system works end-to-end with real configuration.
"""

from unittest.mock import Mock, patch

import pytest

from extensions.ext_mail import Mail
from libs.mail import MailConfigError, MailMessage, MailSenderFactory


class TestMailExtensionIntegration:
    """Test the Mail extension integration."""

    @patch("extensions.ext_mail.MailSenderFactory.create_from_dify_config")
    def test_mail_extension_initialization(self, mock_create_sender):
        """Test Mail extension initialization with new architecture."""
        # Setup mock
        mock_sender = Mock()
        mock_create_sender.return_value = mock_sender

        # Initialize Mail extension
        mail = Mail()
        assert not mail.is_inited()

        # Initialize with app
        mock_app = Mock()
        mail.init_app(mock_app)

        # Verify initialization
        assert mail.is_inited()
        mock_create_sender.assert_called_once()

    @patch("extensions.ext_mail.MailSenderFactory.create_from_dify_config")
    def test_mail_extension_send(self, mock_create_sender):
        """Test sending email through Mail extension."""
        # Setup mock sender
        mock_sender = Mock()
        mock_create_sender.return_value = mock_sender

        # Initialize Mail extension
        mail = Mail()
        mock_app = Mock()
        mail.init_app(mock_app)

        # Send email
        mail.send(
            to="recipient@example.com", subject="Test Subject", html="<p>Test content</p>", from_="sender@example.com"
        )

        # Verify sender was called with correct message
        mock_sender.send.assert_called_once()
        call_args = mock_sender.send.call_args[0][0]  # Get the MailMessage argument

        assert isinstance(call_args, MailMessage)
        assert call_args.to == "recipient@example.com"
        assert call_args.subject == "Test Subject"
        assert call_args.html == "<p>Test content</p>"
        assert call_args.from_ == "sender@example.com"

    @patch("extensions.ext_mail.MailSenderFactory.create_from_dify_config")
    def test_mail_extension_not_initialized(self, mock_create_sender):
        """Test error when trying to send without initialization."""
        mock_create_sender.return_value = None  # No mail configured

        mail = Mail()
        mock_app = Mock()
        mail.init_app(mock_app)

        # Should raise error when trying to send
        with pytest.raises(ValueError, match="Mail sender is not initialized"):
            mail.send(to="recipient@example.com", subject="Test Subject", html="<p>Test content</p>")


class TestEndToEndMailFlow:
    """Test end-to-end mail sending flow."""

    @patch("libs.mail.smtp_basic.smtplib.SMTP")
    def test_smtp_basic_auth_flow(self, mock_smtp_class):
        """Test complete SMTP Basic Auth flow."""
        # Setup mock SMTP
        mock_smtp = Mock()
        mock_smtp_class.return_value = mock_smtp

        # Create mock config
        mock_config = Mock()
        mock_config.MAIL_TYPE = "smtp"
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@example.com"
        mock_config.SMTP_SERVER = "smtp.example.com"
        mock_config.SMTP_PORT = 587
        mock_config.SMTP_USERNAME = "user@example.com"
        mock_config.SMTP_PASSWORD = "password"
        mock_config.SMTP_USE_TLS = False
        mock_config.SMTP_OPPORTUNISTIC_TLS = False
        mock_config.SMTP_AUTH_TYPE = "basic"
        mock_config.SMTP_CLIENT_ID = None
        mock_config.SMTP_CLIENT_SECRET = None
        mock_config.SMTP_TENANT_ID = None
        mock_config.SMTP_REFRESH_TOKEN = None
        mock_config.SMTP_OAUTH2_PROVIDER = "microsoft"

        # Create sender from config
        sender = MailSenderFactory.create_from_dify_config(mock_config)

        # Create and send message
        message = MailMessage(
            to="recipient@example.com", subject="Test Subject", html="<p>Test content</p>", from_="sender@example.com"
        )

        sender.send(message)

        # Verify SMTP interaction
        mock_smtp_class.assert_called_once_with("smtp.example.com", 587, timeout=10)
        mock_smtp.login.assert_called_once_with("user@example.com", "password")
        mock_smtp.sendmail.assert_called_once()
        mock_smtp.quit.assert_called_once()

    @patch("libs.mail.oauth2_handler.requests.post")
    @patch("libs.mail.smtp_oauth2.smtplib.SMTP_SSL")
    def test_smtp_oauth2_flow(self, mock_smtp_class, mock_requests_post):
        """Test complete SMTP OAuth2 flow."""
        # Setup mock OAuth2 token response
        mock_response = Mock()
        mock_response.json.return_value = {"access_token": "test-access-token", "expires_in": 3600}
        mock_response.raise_for_status.return_value = None
        mock_requests_post.return_value = mock_response

        # Setup mock SMTP
        mock_smtp = Mock()
        mock_smtp_class.return_value = mock_smtp

        # Create mock config for OAuth2
        mock_config = Mock()
        mock_config.MAIL_TYPE = "smtp"
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@company.com"
        mock_config.SMTP_SERVER = "smtp.office365.com"
        mock_config.SMTP_PORT = 587
        mock_config.SMTP_USERNAME = "user@company.com"
        mock_config.SMTP_PASSWORD = None
        mock_config.SMTP_USE_TLS = True
        mock_config.SMTP_OPPORTUNISTIC_TLS = False
        mock_config.SMTP_AUTH_TYPE = "oauth2"
        mock_config.SMTP_CLIENT_ID = "test-client-id"
        mock_config.SMTP_CLIENT_SECRET = "test-client-secret"
        mock_config.SMTP_TENANT_ID = "test-tenant-id"
        mock_config.SMTP_OAUTH2_PROVIDER = "microsoft"

        # Create sender from config
        sender = MailSenderFactory.create_from_dify_config(mock_config)

        # Create and send message
        message = MailMessage(
            to="recipient@company.com",
            subject="Test OAuth2 Subject",
            html="<p>Test OAuth2 content</p>",
            from_="sender@company.com",
        )

        sender.send(message)

        # Verify OAuth2 token request
        mock_requests_post.assert_called_once()
        call_args = mock_requests_post.call_args
        assert "https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token" in call_args[0]

        # Verify SMTP interaction
        mock_smtp_class.assert_called_once_with("smtp.office365.com", 587, timeout=30)
        mock_smtp.docmd.assert_called_once()  # OAuth2 authentication
        mock_smtp.sendmail.assert_called_once()
        mock_smtp.quit.assert_called_once()


class TestConfigurationValidation:
    """Test configuration validation and error handling."""

    def test_invalid_smtp_config(self):
        """Test error handling for invalid SMTP configuration."""
        mock_config = Mock()
        mock_config.MAIL_TYPE = "smtp"
        mock_config.SMTP_SERVER = None  # Invalid: missing server
        mock_config.SMTP_PORT = 587

        with pytest.raises((MailConfigError, ValueError)):  # Should raise configuration error
            MailSenderFactory.create_from_dify_config(mock_config)

    def test_missing_oauth2_credentials(self):
        """Test error handling for missing OAuth2 credentials."""
        mock_config = Mock()
        mock_config.MAIL_TYPE = "smtp"
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@company.com"
        mock_config.SMTP_SERVER = "smtp.office365.com"
        mock_config.SMTP_PORT = 587
        mock_config.SMTP_USERNAME = "user@company.com"
        mock_config.SMTP_USE_TLS = True
        mock_config.SMTP_OPPORTUNISTIC_TLS = False
        mock_config.SMTP_AUTH_TYPE = "oauth2"
        mock_config.SMTP_CLIENT_ID = None  # Missing
        mock_config.SMTP_CLIENT_SECRET = None  # Missing
        mock_config.SMTP_TENANT_ID = "test-tenant-id"
        mock_config.SMTP_OAUTH2_PROVIDER = "microsoft"

        with pytest.raises((MailConfigError, ValueError)):  # Should raise configuration error
            MailSenderFactory.create_from_dify_config(mock_config)
