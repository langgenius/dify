"""
SMTP mail sender with OAuth2 authentication support.

This module provides SMTP email sending functionality using OAuth2
authentication for modern email providers like Microsoft and Google.
"""

import base64
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from .exceptions import MailAuthError, MailConfigError, MailConnectionError, MailSendError
from .oauth2_handler import create_oauth2_handler
from .protocol import MailMessage, MailSenderBase

logger = logging.getLogger(__name__)


class SMTPOAuth2Sender(MailSenderBase):
    """
    SMTP mail sender using OAuth2 authentication.

    This implementation provides SMTP email sending with OAuth2 authentication
    for providers like Microsoft Office 365 and Google Gmail.
    """

    def __init__(
        self,
        server: str,
        port: int,
        username: str,
        client_id: str,
        client_secret: str,
        tenant_id: str,
        oauth2_provider: str = "microsoft",
        use_tls: bool = True,
        opportunistic_tls: bool = False,
        default_from: Optional[str] = None,
    ):
        """
        Initialize SMTP OAuth2 sender.

        Args:
            server: SMTP server hostname
            port: SMTP server port
            username: Email address for authentication
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
            tenant_id: Azure AD tenant ID (required for Microsoft OAuth2)
            oauth2_provider: OAuth2 provider (currently only 'microsoft' is supported)
            use_tls: Whether to use TLS encryption
            opportunistic_tls: Whether to use opportunistic TLS
            default_from: Default sender email address
        """
        super().__init__(default_from)

        self.server = server
        self.port = port
        self.username = username
        self.use_tls = use_tls
        self.opportunistic_tls = opportunistic_tls

        # Validate configuration
        if not all([server, port, username, client_id, client_secret, tenant_id]):
            raise MailConfigError("Server, port, username, client ID, client secret, and tenant ID are required")

        if opportunistic_tls and not use_tls:
            raise MailConfigError("Opportunistic TLS requires TLS to be enabled")

        # Validate OAuth2 provider
        if oauth2_provider.lower() != "microsoft":
            raise MailConfigError("Only Microsoft OAuth2 is supported")

        # Create OAuth2 handler
        oauth_config = {
            "client_id": client_id,
            "client_secret": client_secret,
            "tenant_id": tenant_id,
        }

        try:
            self.oauth2_handler = create_oauth2_handler(oauth2_provider, **oauth_config)
        except Exception as e:
            raise MailConfigError(f"Failed to create OAuth2 handler: {e}")

    def _send_message(self, message: MailMessage) -> None:
        """
        Send email message using SMTP with OAuth2 authentication.

        Args:
            message: The email message to send

        Raises:
            MailSendError: If the email could not be sent
        """
        smtp = None
        try:
            # Get access token
            access_token = self.oauth2_handler.get_access_token()

            # Establish SMTP connection
            smtp = self._create_smtp_connection()

            # Authenticate using OAuth2
            self._oauth2_authenticate(smtp, access_token)

            # Create email message
            msg = self._create_mime_message(message)

            # Send the email
            assert message.from_ is not None
            smtp.sendmail(message.from_, message.to, msg.as_string())

            logger.info(f"Email sent successfully to {message.to} using OAuth2")

        except MailAuthError:
            raise  # Re-raise auth errors as-is
        except smtplib.SMTPAuthenticationError as e:
            logger.exception("SMTP OAuth2 authentication failed")
            raise MailAuthError(f"OAuth2 authentication failed: {e}")
        except smtplib.SMTPRecipientsRefused as e:
            logger.exception("Recipients refused")
            raise MailSendError(f"Recipients refused: {e}", e)
        except smtplib.SMTPException as e:
            logger.exception("SMTP error occurred")
            raise MailSendError(f"SMTP error: {e}", e)
        except Exception as e:
            logger.exception(f"Unexpected error while sending email to {message.to}")
            raise MailSendError(f"Unexpected error: {e}", e)
        finally:
            if smtp:
                try:
                    smtp.quit()
                except Exception:
                    pass  # Ignore errors when closing connection

    def _create_smtp_connection(self) -> smtplib.SMTP:
        """
        Create and configure SMTP connection.

        Returns:
            Configured SMTP connection

        Raises:
            MailConnectionError: If connection cannot be established
        """
        try:
            if self.use_tls:
                if self.opportunistic_tls:
                    smtp = smtplib.SMTP(self.server, self.port, timeout=30)
                    smtp.starttls()
                else:
                    smtp = smtplib.SMTP_SSL(self.server, self.port, timeout=30)
            else:
                smtp = smtplib.SMTP(self.server, self.port, timeout=30)

            return smtp
        except Exception as e:
            raise MailConnectionError(f"Failed to connect to SMTP server: {e}")

    def _oauth2_authenticate(self, smtp: smtplib.SMTP, access_token: str) -> None:
        """
        Authenticate with SMTP server using OAuth2.

        Args:
            smtp: SMTP connection
            access_token: OAuth2 access token

        Raises:
            MailAuthError: If authentication fails
        """
        try:
            # Create OAuth2 authentication string
            auth_string = self._create_oauth2_auth_string(access_token)

            # Authenticate using XOAUTH2
            smtp.docmd("AUTH", "XOAUTH2 " + auth_string)

        except smtplib.SMTPAuthenticationError as e:
            raise MailAuthError(f"OAuth2 authentication failed: {e}")
        except Exception as e:
            raise MailAuthError(f"OAuth2 authentication error: {e}")

    def _create_oauth2_auth_string(self, access_token: str) -> str:
        """
        Create OAuth2 authentication string for SMTP.

        Args:
            access_token: OAuth2 access token

        Returns:
            Base64-encoded authentication string
        """
        # Create the authentication string in the format:
        # user=username\x01auth=Bearer access_token\x01\x01
        auth_bytes = f"user={self.username}\x01auth=Bearer {access_token}\x01\x01".encode("ascii")
        return base64.b64encode(auth_bytes).decode("ascii")

    def _create_mime_message(self, message: MailMessage) -> MIMEMultipart:
        """
        Create MIME message from MailMessage.

        Args:
            message: The mail message to convert

        Returns:
            MIME multipart message
        """
        msg = MIMEMultipart()
        msg["Subject"] = message.subject
        assert message.from_ is not None
        msg["From"] = message.from_
        msg["To"] = message.to

        if message.cc:
            msg["Cc"] = ", ".join(message.cc)

        if message.reply_to:
            msg["Reply-To"] = message.reply_to

        # Attach HTML content
        msg.attach(MIMEText(message.html, "html"))

        return msg

    def is_configured(self) -> bool:
        """
        Check if the SMTP OAuth2 sender is properly configured.

        Returns:
            True if properly configured
        """
        return bool(self.server and self.port and self.username and self.oauth2_handler)

    def test_connection(self) -> bool:
        """
        Test connection and authentication with SMTP server.

        Returns:
            True if connection and authentication are successful
        """
        try:
            # Test OAuth2 token acquisition
            access_token = self.oauth2_handler.get_access_token()

            # Test SMTP connection and authentication
            smtp = self._create_smtp_connection()
            self._oauth2_authenticate(smtp, access_token)
            smtp.quit()

            return True
        except Exception as e:
            logger.warning(f"SMTP OAuth2 connection test failed: {e}")
            return False
