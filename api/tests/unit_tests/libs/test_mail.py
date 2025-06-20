"""
Unit tests for the mail sending library.

This module tests the new mail sending architecture with Protocol-based design.
"""

from unittest.mock import Mock, patch

import pytest

from libs.mail import MailConfigError, MailMessage, MailSenderFactory
from libs.mail.smtp_basic import SMTPBasicAuthSender
from libs.mail.smtp_oauth2 import SMTPOAuth2Sender
from libs.mail.smtp_sender import SMTPSender


class TestMailMessage:
    """Test the MailMessage data structure."""

    def test_valid_message_creation(self):
        """Test creating a valid mail message."""
        message = MailMessage(
            to="test@example.com", subject="Test Subject", html="<p>Test content</p>", from_="sender@example.com"
        )

        assert message.to == "test@example.com"
        assert message.subject == "Test Subject"
        assert message.html == "<p>Test content</p>"
        assert message.from_ == "sender@example.com"

    def test_message_validation(self):
        """Test message validation for required fields."""
        # Missing recipient
        with pytest.raises(ValueError, match="Recipient email address is required"):
            MailMessage(to="", subject="Test", html="<p>Test</p>")

        # Missing subject
        with pytest.raises(ValueError, match="Email subject is required"):
            MailMessage(to="test@example.com", subject="", html="<p>Test</p>")

        # Missing content
        with pytest.raises(ValueError, match="Email content is required"):
            MailMessage(to="test@example.com", subject="Test", html="")


class TestMailSenderFactory:
    """Test the mail sender factory."""

    def test_register_and_create_sender(self):
        """Test registering and creating a mail sender."""
        # Create a mock sender class
        mock_sender_class = Mock()
        mock_sender_instance = Mock()
        mock_sender_class.return_value = mock_sender_instance

        # Register the mock sender
        MailSenderFactory.register_sender("test", mock_sender_class)

        # Create sender instance
        config = {"test_param": "test_value"}
        sender = MailSenderFactory.create_sender("test", config)

        # Verify
        mock_sender_class.assert_called_once_with(**config)
        assert sender == mock_sender_instance

    def test_unsupported_mail_type(self):
        """Test error handling for unsupported mail types."""
        with pytest.raises(MailConfigError, match="Unsupported mail type: nonexistent"):
            MailSenderFactory.create_sender("nonexistent", {})

    def test_get_supported_types(self):
        """Test getting list of supported mail types."""
        # Register a test sender
        MailSenderFactory.register_sender("test_type", Mock)

        supported_types = MailSenderFactory.get_supported_types()
        assert "test_type" in supported_types


class TestSMTPBasicAuthSender:
    """Test SMTP Basic Auth sender."""

    def test_initialization(self):
        """Test SMTP Basic Auth sender initialization."""
        sender = SMTPBasicAuthSender(
            server="smtp.example.com", port=587, username="user@example.com", password="password", use_tls=True
        )

        assert sender.server == "smtp.example.com"
        assert sender.port == 587
        assert sender.username == "user@example.com"
        assert sender.password == "password"
        assert sender.use_tls is True

    def test_invalid_configuration(self):
        """Test error handling for invalid configuration."""
        # Missing server
        with pytest.raises(MailConfigError, match="SMTP server and port are required"):
            SMTPBasicAuthSender(server="", port=587)

        # Invalid TLS configuration
        with pytest.raises(MailConfigError, match="Opportunistic TLS requires TLS to be enabled"):
            SMTPBasicAuthSender(server="smtp.example.com", port=587, use_tls=False, opportunistic_tls=True)

    def test_is_configured(self):
        """Test configuration check."""
        sender = SMTPBasicAuthSender(server="smtp.example.com", port=587)
        assert sender.is_configured() is True

        # Test with missing server
        sender.server = ""
        assert sender.is_configured() is False

    @patch("libs.mail.smtp_basic.smtplib.SMTP")
    def test_send_message_success(self, mock_smtp_class):
        """Test successful email sending."""
        # Setup mock
        mock_smtp = Mock()
        mock_smtp_class.return_value = mock_smtp

        sender = SMTPBasicAuthSender(
            server="smtp.example.com", port=587, username="user@example.com", password="password"
        )

        message = MailMessage(
            to="recipient@example.com", subject="Test Subject", html="<p>Test content</p>", from_="sender@example.com"
        )

        # Send message
        sender.send(message)

        # Verify SMTP calls
        mock_smtp_class.assert_called_once_with("smtp.example.com", 587, timeout=10)
        mock_smtp.login.assert_called_once_with("user@example.com", "password")
        mock_smtp.sendmail.assert_called_once()
        mock_smtp.quit.assert_called_once()


class TestSMTPOAuth2Sender:
    """Test SMTP OAuth2 sender."""

    @patch("libs.mail.smtp_oauth2.create_oauth2_handler")
    def test_initialization_microsoft(self, mock_create_handler):
        """Test SMTP OAuth2 sender initialization for Microsoft."""
        mock_handler = Mock()
        mock_create_handler.return_value = mock_handler

        sender = SMTPOAuth2Sender(
            server="smtp.office365.com",
            port=587,
            username="user@company.com",
            oauth2_provider="microsoft",
            client_id="client-id",
            client_secret="client-secret",
            tenant_id="tenant-id",
        )

        assert sender.server == "smtp.office365.com"
        assert sender.port == 587
        assert sender.username == "user@company.com"
        assert sender.oauth2_handler == mock_handler

        mock_create_handler.assert_called_once_with(
            "microsoft", client_id="client-id", client_secret="client-secret", tenant_id="tenant-id"
        )

    def test_missing_tenant_id_for_microsoft(self):
        """Test error when tenant ID is missing for Microsoft OAuth2."""
        with pytest.raises(TypeError, match="missing 1 required positional argument: 'tenant_id'"):
            SMTPOAuth2Sender(
                server="smtp.office365.com",
                port=587,
                username="user@company.com",
                client_id="client-id",
                client_secret="client-secret",
                # tenant_id is missing
            )


class TestSMTPSender:
    """Test unified SMTP sender."""

    @patch("libs.mail.smtp_sender.SMTPBasicAuthSender")
    def test_basic_auth_selection(self, mock_basic_sender):
        """Test automatic selection of Basic Auth."""
        mock_instance = Mock()
        mock_basic_sender.return_value = mock_instance

        sender = SMTPSender(
            server="smtp.example.com", port=587, username="user@example.com", password="password", auth_type="basic"
        )

        assert sender.auth_type == "basic"
        mock_basic_sender.assert_called_once()

    @patch("libs.mail.smtp_sender.SMTPOAuth2Sender")
    def test_oauth2_selection(self, mock_oauth2_sender):
        """Test automatic selection of OAuth2."""
        mock_instance = Mock()
        mock_oauth2_sender.return_value = mock_instance

        sender = SMTPSender(
            server="smtp.office365.com",
            port=587,
            username="user@company.com",
            auth_type="oauth2",
            oauth2_provider="microsoft",
            client_id="client-id",
            client_secret="client-secret",
            tenant_id="tenant-id",
        )

        assert sender.auth_type == "oauth2"
        mock_oauth2_sender.assert_called_once()

    def test_unsupported_auth_type(self):
        """Test error for unsupported authentication type."""
        with pytest.raises(MailConfigError, match="Unsupported authentication type: invalid"):
            SMTPSender(server="smtp.example.com", port=587, auth_type="invalid")


class TestFactoryIntegration:
    """Test factory integration with Dify config."""

    def test_create_from_dify_config_smtp_basic(self):
        """Test creating SMTP Basic Auth sender from Dify config."""
        mock_config = Mock()
        mock_config.MAIL_TYPE = "smtp"
        mock_config.MAIL_DEFAULT_SEND_FROM = "noreply@example.com"
        mock_config.SMTP_SERVER = "smtp.example.com"
        mock_config.SMTP_PORT = 587
        mock_config.SMTP_USERNAME = "user@example.com"
        mock_config.SMTP_PASSWORD = "password"
        mock_config.SMTP_USE_TLS = True
        mock_config.SMTP_OPPORTUNISTIC_TLS = False

        # Add attributes that will be accessed by getattr
        mock_config.SMTP_AUTH_TYPE = "basic"
        mock_config.SMTP_CLIENT_ID = None
        mock_config.SMTP_CLIENT_SECRET = None
        mock_config.SMTP_TENANT_ID = None
        mock_config.SMTP_REFRESH_TOKEN = None
        mock_config.SMTP_OAUTH2_PROVIDER = "microsoft"

        result = MailSenderFactory.create_from_dify_config(mock_config)

        # Verify that a sender was created and it's the right type
        assert result is not None
        assert hasattr(result, "send")
        assert hasattr(result, "is_configured")
        assert result.is_configured()

    def test_create_from_dify_config_no_mail_type(self):
        """Test handling when MAIL_TYPE is not set."""
        mock_config = Mock()
        mock_config.MAIL_TYPE = None

        result = MailSenderFactory.create_from_dify_config(mock_config)
        assert result is None
