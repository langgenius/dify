"""Comprehensive tests for SMTP implementation with OAuth 2.0 support"""

import base64
import smtplib
from unittest.mock import MagicMock, Mock

import pytest

from libs.mail.smtp import SMTPAuthenticator, SMTPClient, SMTPMessageBuilder
from libs.mail.smtp_connection import SMTPConnectionFactory, SMTPConnectionProtocol


class MockSMTPConnection:
    """Mock SMTP connection for testing"""

    def __init__(self):
        self.ehlo_called = 0
        self.starttls_called = False
        self.login_called = False
        self.docmd_called = False
        self.sendmail_called = False
        self.quit_called = False
        self.last_docmd_args = None
        self.last_login_args = None
        self.last_sendmail_args = None

    def ehlo(self, name: str = "") -> tuple:
        self.ehlo_called += 1
        return (250, b"OK")

    def starttls(self) -> tuple:
        self.starttls_called = True
        return (220, b"TLS started")

    def login(self, user: str, password: str) -> tuple:
        self.login_called = True
        self.last_login_args = (user, password)
        return (235, b"Authentication successful")

    def docmd(self, cmd: str, args: str = "") -> tuple:
        self.docmd_called = True
        self.last_docmd_args = (cmd, args)
        return (235, b"Authentication successful")

    def sendmail(self, from_addr: str, to_addrs: str, msg: str) -> dict:
        self.sendmail_called = True
        self.last_sendmail_args = (from_addr, to_addrs, msg)
        return {}

    def quit(self) -> tuple:
        self.quit_called = True
        return (221, b"Bye")


class MockSMTPConnectionFactory(SMTPConnectionFactory):
    """Mock factory for creating mock SMTP connections"""

    def __init__(self, connection: MockSMTPConnection):
        self.connection = connection
        self.create_called = False

    def create_connection(self, server: str, port: int, timeout: int = 10) -> SMTPConnectionProtocol:
        self.create_called = True
        self.last_create_args = (server, port, timeout)
        return self.connection


class TestSMTPAuthenticator:
    """Test cases for SMTPAuthenticator"""

    def test_create_sasl_xoauth2_string(self):
        """Test SASL XOAUTH2 string creation"""
        authenticator = SMTPAuthenticator()
        username = "test@example.com"
        access_token = "test_token_123"

        result = authenticator.create_sasl_xoauth2_string(username, access_token)

        # Decode and verify
        decoded = base64.b64decode(result).decode()
        expected = f"user={username}\x01auth=Bearer {access_token}\x01\x01"
        assert decoded == expected

    def test_authenticate_basic_with_valid_credentials(self):
        """Test basic authentication with valid credentials"""
        authenticator = SMTPAuthenticator()
        connection = MockSMTPConnection()

        authenticator.authenticate_basic(connection, "user@example.com", "password123")

        assert connection.login_called
        assert connection.last_login_args == ("user@example.com", "password123")

    def test_authenticate_basic_with_empty_credentials(self):
        """Test basic authentication skips with empty credentials"""
        authenticator = SMTPAuthenticator()
        connection = MockSMTPConnection()

        authenticator.authenticate_basic(connection, "", "")

        assert not connection.login_called

    def test_authenticate_oauth2_success(self):
        """Test successful OAuth2 authentication"""
        authenticator = SMTPAuthenticator()
        connection = MockSMTPConnection()

        authenticator.authenticate_oauth2(connection, "user@example.com", "oauth_token_123")

        assert connection.docmd_called
        assert connection.last_docmd_args[0] == "AUTH"
        assert connection.last_docmd_args[1].startswith("XOAUTH2 ")

        # Verify the auth string
        auth_string = connection.last_docmd_args[1].split(" ")[1]
        decoded = base64.b64decode(auth_string).decode()
        assert "user=user@example.com" in decoded
        assert "auth=Bearer oauth_token_123" in decoded

    def test_authenticate_oauth2_missing_credentials(self):
        """Test OAuth2 authentication fails with missing credentials"""
        authenticator = SMTPAuthenticator()
        connection = MockSMTPConnection()

        with pytest.raises(ValueError, match="Username and OAuth access token are required"):
            authenticator.authenticate_oauth2(connection, "", "token")

        with pytest.raises(ValueError, match="Username and OAuth access token are required"):
            authenticator.authenticate_oauth2(connection, "user", "")

    def test_authenticate_oauth2_auth_failure(self):
        """Test OAuth2 authentication handles auth errors"""
        authenticator = SMTPAuthenticator()
        connection = Mock()
        connection.docmd.side_effect = smtplib.SMTPAuthenticationError(535, b"Authentication failed")

        with pytest.raises(ValueError, match="OAuth2 authentication failed"):
            authenticator.authenticate_oauth2(connection, "user@example.com", "bad_token")


class TestSMTPMessageBuilder:
    """Test cases for SMTPMessageBuilder"""

    def test_build_message(self):
        """Test message building"""
        builder = SMTPMessageBuilder()
        mail_data = {"to": "recipient@example.com", "subject": "Test Subject", "html": "<p>Test HTML content</p>"}
        from_addr = "sender@example.com"

        msg = builder.build_message(mail_data, from_addr)

        assert msg["To"] == "recipient@example.com"
        assert msg["From"] == "sender@example.com"
        assert msg["Subject"] == "Test Subject"
        assert "<p>Test HTML content</p>" in msg.as_string()


class TestSMTPClient:
    """Test cases for SMTPClient"""

    @pytest.fixture
    def mock_connection(self):
        """Create a mock SMTP connection"""
        return MockSMTPConnection()

    @pytest.fixture
    def mock_factories(self, mock_connection):
        """Create mock connection factories"""
        return {
            "connection_factory": MockSMTPConnectionFactory(mock_connection),
            "ssl_connection_factory": MockSMTPConnectionFactory(mock_connection),
        }

    def test_basic_auth_send_success(self, mock_connection, mock_factories):
        """Test successful email send with basic auth"""
        client = SMTPClient(
            server="smtp.example.com",
            port=587,
            username="user@example.com",
            password="password123",
            from_addr="sender@example.com",
            use_tls=True,
            opportunistic_tls=True,
            auth_type="basic",
            **mock_factories,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test Subject", "html": "<p>Test content</p>"}

        client.send(mail_data)

        # Verify connection sequence
        assert mock_connection.ehlo_called == 2  # Before and after STARTTLS
        assert mock_connection.starttls_called
        assert mock_connection.login_called
        assert mock_connection.last_login_args == ("user@example.com", "password123")
        assert mock_connection.sendmail_called
        assert mock_connection.quit_called

    def test_oauth2_send_success(self, mock_connection, mock_factories):
        """Test successful email send with OAuth2"""
        client = SMTPClient(
            server="smtp.office365.com",
            port=587,
            username="user@contoso.com",
            password="",
            from_addr="sender@contoso.com",
            use_tls=True,
            opportunistic_tls=True,
            oauth_access_token="oauth_token_123",
            auth_type="oauth2",
            **mock_factories,
        )

        mail_data = {"to": "recipient@example.com", "subject": "OAuth Test", "html": "<p>OAuth test content</p>"}

        client.send(mail_data)

        # Verify OAuth authentication was used
        assert mock_connection.docmd_called
        assert not mock_connection.login_called
        assert mock_connection.sendmail_called
        assert mock_connection.quit_called

    def test_ssl_connection_used_when_configured(self, mock_connection):
        """Test SSL connection is used when configured"""
        ssl_factory = MockSMTPConnectionFactory(mock_connection)
        regular_factory = MockSMTPConnectionFactory(mock_connection)

        client = SMTPClient(
            server="smtp.example.com",
            port=465,
            username="user@example.com",
            password="password123",
            from_addr="sender@example.com",
            use_tls=True,
            opportunistic_tls=False,  # Use SSL, not STARTTLS
            connection_factory=regular_factory,
            ssl_connection_factory=ssl_factory,
        )

        mail_data = {"to": "recipient@example.com", "subject": "SSL Test", "html": "<p>SSL test content</p>"}

        client.send(mail_data)

        # Verify SSL factory was used
        assert ssl_factory.create_called
        assert not regular_factory.create_called
        # No STARTTLS with SSL connection
        assert not mock_connection.starttls_called

    def test_connection_cleanup_on_error(self, mock_connection, mock_factories):
        """Test connection is cleaned up even on error"""
        # Make sendmail fail
        mock_connection.sendmail = Mock(side_effect=smtplib.SMTPException("Send failed"))

        client = SMTPClient(
            server="smtp.example.com",
            port=587,
            username="user@example.com",
            password="password123",
            from_addr="sender@example.com",
            **mock_factories,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Test</p>"}

        with pytest.raises(smtplib.SMTPException):
            client.send(mail_data)

        # Verify quit was still called
        assert mock_connection.quit_called

    def test_custom_authenticator_injection(self, mock_connection, mock_factories):
        """Test custom authenticator can be injected"""
        custom_authenticator = Mock(spec=SMTPAuthenticator)

        client = SMTPClient(
            server="smtp.example.com",
            port=587,
            username="user@example.com",
            password="password123",
            from_addr="sender@example.com",
            authenticator=custom_authenticator,
            **mock_factories,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Test</p>"}

        client.send(mail_data)

        # Verify custom authenticator was used
        custom_authenticator.authenticate_basic.assert_called_once()

    def test_custom_message_builder_injection(self, mock_connection, mock_factories):
        """Test custom message builder can be injected"""
        custom_builder = Mock(spec=SMTPMessageBuilder)
        custom_msg = MagicMock()
        custom_msg.as_string.return_value = "custom message"
        custom_builder.build_message.return_value = custom_msg

        client = SMTPClient(
            server="smtp.example.com",
            port=587,
            username="user@example.com",
            password="password123",
            from_addr="sender@example.com",
            message_builder=custom_builder,
            **mock_factories,
        )

        mail_data = {"to": "recipient@example.com", "subject": "Test", "html": "<p>Test</p>"}

        client.send(mail_data)

        # Verify custom builder was used
        custom_builder.build_message.assert_called_once_with(mail_data, "sender@example.com")
        assert mock_connection.last_sendmail_args[2] == "custom message"


class TestIntegration:
    """Integration tests showing how components work together"""

    def test_complete_oauth_flow_without_io(self):
        """Test complete OAuth flow without any real I/O"""
        # Create all mocks
        mock_connection = MockSMTPConnection()
        connection_factory = MockSMTPConnectionFactory(mock_connection)

        # Create client with OAuth
        client = SMTPClient(
            server="smtp.office365.com",
            port=587,
            username="test@contoso.com",
            password="",
            from_addr="test@contoso.com",
            use_tls=True,
            opportunistic_tls=True,
            oauth_access_token="mock_oauth_token",
            auth_type="oauth2",
            connection_factory=connection_factory,
            ssl_connection_factory=connection_factory,
        )

        # Send email
        mail_data = {
            "to": "recipient@example.com",
            "subject": "OAuth Integration Test",
            "html": "<h1>Hello OAuth!</h1>",
        }

        client.send(mail_data)

        # Verify complete flow
        assert connection_factory.create_called
        assert mock_connection.ehlo_called == 2
        assert mock_connection.starttls_called
        assert mock_connection.docmd_called
        assert "XOAUTH2" in mock_connection.last_docmd_args[1]
        assert mock_connection.sendmail_called
        assert mock_connection.quit_called

        # Verify email data
        from_addr, to_addr, msg_str = mock_connection.last_sendmail_args
        assert from_addr == "test@contoso.com"
        assert to_addr == "recipient@example.com"
        assert "OAuth Integration Test" in msg_str
        assert "Hello OAuth!" in msg_str
