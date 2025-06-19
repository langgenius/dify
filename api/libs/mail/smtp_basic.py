"""
SMTP mail sender with Basic Authentication support.

This module provides SMTP email sending functionality using traditional
username/password authentication.
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from .exceptions import MailConfigError, MailConnectionError, MailSendError, MailTimeoutError
from .protocol import MailMessage, MailSenderBase

logger = logging.getLogger(__name__)


class SMTPBasicAuthSender(MailSenderBase):
    """
    SMTP mail sender using Basic Authentication (username/password).

    This implementation provides traditional SMTP email sending with
    username and password authentication.
    """

    def __init__(
        self,
        server: str,
        port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
        use_tls: bool = False,
        opportunistic_tls: bool = False,
        default_from: Optional[str] = None,
    ):
        """
        Initialize SMTP Basic Auth sender.

        Args:
            server: SMTP server hostname
            port: SMTP server port
            username: Username for authentication (optional)
            password: Password for authentication (optional)
            use_tls: Whether to use TLS encryption
            opportunistic_tls: Whether to use opportunistic TLS
            default_from: Default sender email address
        """
        super().__init__(default_from)

        self.server = server
        self.port = port
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.opportunistic_tls = opportunistic_tls

        # Validate configuration
        if not server or not port:
            raise MailConfigError("SMTP server and port are required")

        if opportunistic_tls and not use_tls:
            raise MailConfigError("Opportunistic TLS requires TLS to be enabled")

    def _send_message(self, message: MailMessage) -> None:
        """
        Send email message using SMTP with Basic Auth.

        Args:
            message: The email message to send

        Raises:
            MailSendError: If the email could not be sent
        """
        smtp = None
        try:
            # Establish SMTP connection
            smtp = self._create_smtp_connection()

            # Authenticate if credentials are provided
            if self._should_authenticate():
                assert self.username is not None
                assert self.password is not None
                smtp.login(self.username, self.password)

            # Create email message
            msg = self._create_mime_message(message)

            # Send the email
            assert message.from_ is not None
            smtp.sendmail(message.from_, message.to, msg.as_string())

            logger.info(f"Email sent successfully to {message.to}")

        except smtplib.SMTPAuthenticationError as e:
            logger.exception("SMTP authentication failed")
            raise MailSendError(f"Authentication failed: {e}", e)
        except smtplib.SMTPRecipientsRefused as e:
            logger.exception("Recipients refused")
            raise MailSendError(f"Recipients refused: {e}", e)
        except smtplib.SMTPException as e:
            logger.exception("SMTP error occurred")
            raise MailSendError(f"SMTP error: {e}", e)
        except TimeoutError as e:
            logger.exception("Timeout occurred while sending email")
            raise MailTimeoutError(f"Email sending timed out: {e}")
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
                    smtp = smtplib.SMTP(self.server, self.port, timeout=10)
                    smtp.starttls()
                else:
                    smtp = smtplib.SMTP_SSL(self.server, self.port, timeout=10)
            else:
                smtp = smtplib.SMTP(self.server, self.port, timeout=10)

            return smtp
        except Exception as e:
            raise MailConnectionError(f"Failed to connect to SMTP server: {e}")

    def _should_authenticate(self) -> bool:
        """
        Check if authentication should be performed.

        Returns:
            True if authentication credentials are available and valid
        """
        return bool(self.username and self.password and self.username.strip() and self.password.strip())

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
        Check if the SMTP sender is properly configured.

        Returns:
            True if properly configured
        """
        return bool(self.server and self.port)

    def test_connection(self) -> bool:
        """
        Test connection to SMTP server.

        Returns:
            True if connection is successful
        """
        try:
            smtp = self._create_smtp_connection()
            if self._should_authenticate():
                assert self.username is not None
                assert self.password is not None
                smtp.login(self.username, self.password)
            smtp.quit()
            return True
        except Exception as e:
            logger.warning(f"SMTP connection test failed: {e}")
            return False
