"""Enhanced SMTP client with dependency injection for better testability"""

import base64
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from .smtp_connection import (
    SMTPConnectionFactory,
    SMTPConnectionProtocol,
    SSLSMTPConnectionFactory,
    StandardSMTPConnectionFactory,
)


class SMTPAuthenticator:
    """Handles SMTP authentication logic"""

    @staticmethod
    def create_sasl_xoauth2_string(username: str, access_token: str) -> str:
        """Create SASL XOAUTH2 authentication string for SMTP OAuth2

        References:
        - SASL XOAUTH2 Mechanism: https://developers.google.com/gmail/imap/xoauth2-protocol
        - Microsoft XOAUTH2 Format: https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth#sasl-xoauth2
        """
        auth_string = f"user={username}\x01auth=Bearer {access_token}\x01\x01"
        return base64.b64encode(auth_string.encode()).decode()

    def authenticate_basic(self, connection: SMTPConnectionProtocol, username: str, password: str) -> None:
        """Perform basic authentication"""
        if username and password and username.strip() and password.strip():
            connection.login(username, password)

    def authenticate_oauth2(self, connection: SMTPConnectionProtocol, username: str, access_token: str) -> None:
        """Perform OAuth 2.0 authentication using SASL XOAUTH2 mechanism

        References:
        - Microsoft OAuth 2.0 and SMTP: https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
        - SASL XOAUTH2 Mechanism: https://developers.google.com/gmail/imap/xoauth2-protocol
        - RFC 4954 - SMTP AUTH: https://tools.ietf.org/html/rfc4954
        """
        if not username or not access_token:
            raise ValueError("Username and OAuth access token are required for OAuth2 authentication")

        auth_string = self.create_sasl_xoauth2_string(username, access_token)

        try:
            connection.docmd("AUTH", f"XOAUTH2 {auth_string}")
        except smtplib.SMTPAuthenticationError as e:
            logging.exception(f"OAuth2 authentication failed for user {username}")
            raise ValueError(f"OAuth2 authentication failed: {str(e)}")
        except Exception:
            logging.exception(f"Unexpected error during OAuth2 authentication for user {username}")
            raise


class SMTPMessageBuilder:
    """Builds SMTP messages"""

    @staticmethod
    def build_message(mail_data: dict[str, str], from_addr: str) -> MIMEMultipart:
        """Build a MIME message from mail data"""
        msg = MIMEMultipart()
        msg["Subject"] = mail_data["subject"]
        msg["From"] = from_addr
        msg["To"] = mail_data["to"]
        msg.attach(MIMEText(mail_data["html"], "html"))
        return msg


class SMTPClient:
    """SMTP client with OAuth 2.0 support and dependency injection for better testability"""

    def __init__(
        self,
        server: str,
        port: int,
        username: str,
        password: str,
        from_addr: str,
        use_tls: bool = False,
        opportunistic_tls: bool = False,
        oauth_access_token: Optional[str] = None,
        auth_type: str = "basic",
        connection_factory: Optional[SMTPConnectionFactory] = None,
        ssl_connection_factory: Optional[SMTPConnectionFactory] = None,
        authenticator: Optional[SMTPAuthenticator] = None,
        message_builder: Optional[SMTPMessageBuilder] = None,
    ):
        self.server = server
        self.port = port
        self.from_addr = from_addr
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.opportunistic_tls = opportunistic_tls
        self.oauth_access_token = oauth_access_token
        self.auth_type = auth_type

        # Use injected dependencies or create defaults
        self.connection_factory = connection_factory or StandardSMTPConnectionFactory()
        self.ssl_connection_factory = ssl_connection_factory or SSLSMTPConnectionFactory()
        self.authenticator = authenticator or SMTPAuthenticator()
        self.message_builder = message_builder or SMTPMessageBuilder()

    def _create_connection(self) -> SMTPConnectionProtocol:
        """Create appropriate SMTP connection based on TLS settings"""
        if self.use_tls and not self.opportunistic_tls:
            return self.ssl_connection_factory.create_connection(self.server, self.port)
        else:
            return self.connection_factory.create_connection(self.server, self.port)

    def _setup_tls_if_needed(self, connection: SMTPConnectionProtocol) -> None:
        """Setup TLS if opportunistic TLS is enabled"""
        if self.use_tls and self.opportunistic_tls:
            connection.ehlo(self.server)
            connection.starttls()
            connection.ehlo(self.server)

    def _authenticate(self, connection: SMTPConnectionProtocol) -> None:
        """Authenticate with the SMTP server"""
        if self.auth_type == "oauth2":
            if not self.oauth_access_token:
                raise ValueError("OAuth access token is required for oauth2 auth_type")
            self.authenticator.authenticate_oauth2(connection, self.username, self.oauth_access_token)
        else:
            self.authenticator.authenticate_basic(connection, self.username, self.password)

    def send(self, mail: dict[str, str]) -> None:
        """Send email using SMTP"""
        connection = None
        try:
            # Create connection
            connection = self._create_connection()

            # Setup TLS if needed
            self._setup_tls_if_needed(connection)

            # Authenticate
            self._authenticate(connection)

            # Build and send message
            msg = self.message_builder.build_message(mail, self.from_addr)
            connection.sendmail(self.from_addr, mail["to"], msg.as_string())

        except smtplib.SMTPException:
            logging.exception("SMTP error occurred")
            raise
        except TimeoutError:
            logging.exception("Timeout occurred while sending email")
            raise
        except Exception:
            logging.exception(f"Unexpected error occurred while sending email to {mail['to']}")
            raise
        finally:
            if connection:
                try:
                    connection.quit()
                except Exception:
                    # Ignore errors during cleanup
                    pass
