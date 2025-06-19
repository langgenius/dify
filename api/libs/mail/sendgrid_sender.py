"""
SendGrid mail sender implementation.

This module provides email sending functionality using the SendGrid service.
"""

import logging
from typing import Optional

from .exceptions import MailConfigError, MailSendError
from .protocol import MailMessage, MailSenderBase

logger = logging.getLogger(__name__)


class SendGridSender(MailSenderBase):
    """
    Mail sender using SendGrid service.

    This implementation provides email sending through the SendGrid API.
    """

    # Constants for SendGrid mail classes
    _MAIL_CLASS = "MAIL_CLASS"
    _EMAIL_CLASS = "EMAIL_CLASS"
    _TO_CLASS = "TO_CLASS"
    _CONTENT_CLASS = "CONTENT_CLASS"

    def __init__(
        self,
        api_key: str,
        default_from: Optional[str] = None,
    ):
        """
        Initialize SendGrid sender.

        Args:
            api_key: SendGrid API key
            default_from: Default sender email address
        """
        super().__init__(default_from)

        if not api_key:
            raise MailConfigError("SendGrid API key is required")

        self.api_key = api_key

        # Initialize SendGrid client
        self._init_sendgrid_client()

    def _init_sendgrid_client(self):
        """Initialize the SendGrid client."""
        try:
            import sendgrid  # type: ignore
            from sendgrid.helpers.mail import Content, Email, Mail, To  # type: ignore

            self._client = sendgrid.SendGridAPIClient(api_key=self.api_key)
            self._mail_classes = {
                self._MAIL_CLASS: Mail,
                self._EMAIL_CLASS: Email,
                self._TO_CLASS: To,
                self._CONTENT_CLASS: Content,
            }

        except ImportError:
            raise MailConfigError("SendGrid package is not installed. Install with: pip install sendgrid")
        except Exception as e:
            raise MailConfigError(f"Failed to initialize SendGrid client: {e}")

    def _send_message(self, message: MailMessage) -> None:
        """
        Send email message using SendGrid.

        Args:
            message: The email message to send

        Raises:
            MailSendError: If the email could not be sent
        """
        try:
            # Create SendGrid mail object
            from_email = self._mail_classes[self._EMAIL_CLASS](message.from_)
            to_email = self._mail_classes[self._TO_CLASS](message.to)
            subject = message.subject
            content = self._mail_classes[self._CONTENT_CLASS]("text/html", message.html)

            mail = self._mail_classes[self._MAIL_CLASS](from_email, to_email, subject, content)

            # Add optional fields
            if message.cc:
                for cc_email in message.cc:
                    mail.add_cc(self._mail_classes[self._EMAIL_CLASS](cc_email))

            if message.bcc:
                for bcc_email in message.bcc:
                    mail.add_bcc(self._mail_classes[self._EMAIL_CLASS](bcc_email))

            if message.reply_to:
                mail.reply_to = self._mail_classes[self._EMAIL_CLASS](message.reply_to)

            # Send the email
            mail_json = mail.get()
            response = self._client.client.mail.send.post(request_body=mail_json)  # type: ignore

            logger.info(f"Email sent successfully to {message.to} via SendGrid (Status: {response.status_code})")

            # Check for errors
            if response.status_code >= 400:
                raise MailSendError(f"SendGrid returned status {response.status_code}: {response.body}")

        except Exception as e:
            logger.exception("Failed to send email via SendGrid")
            if isinstance(e, MailSendError):
                raise
            raise MailSendError(f"SendGrid error: {e}", e)

    def is_configured(self) -> bool:
        """
        Check if the SendGrid sender is properly configured.

        Returns:
            True if properly configured
        """
        return bool(self.api_key and self._client)

    def test_connection(self) -> bool:
        """
        Test connection to SendGrid service.

        Returns:
            True if connection is successful
        """
        try:
            # Test API key by making a simple API call
            response = self._client.client.api_keys.get()  # type: ignore
            return bool(response.status_code == 200)
        except Exception as e:
            logger.warning(f"SendGrid connection test failed: {e}")
            return False
