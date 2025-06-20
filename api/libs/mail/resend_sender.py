"""
Resend mail sender implementation.

This module provides email sending functionality using the Resend service.
"""

import logging
from typing import Optional

from .exceptions import MailConfigError, MailSendError
from .protocol import MailMessage, MailSenderBase

logger = logging.getLogger(__name__)


class ResendSender(MailSenderBase):
    """
    Mail sender using Resend service.

    This implementation provides email sending through the Resend API.
    """

    def __init__(
        self,
        api_key: str,
        api_url: Optional[str] = None,
        default_from: Optional[str] = None,
    ):
        """
        Initialize Resend sender.

        Args:
            api_key: Resend API key
            api_url: Custom Resend API URL (optional)
            default_from: Default sender email address
        """
        super().__init__(default_from)

        if not api_key:
            raise MailConfigError("Resend API key is required")

        self.api_key = api_key
        self.api_url = api_url

        # Initialize Resend client
        self._init_resend_client()

    def _init_resend_client(self):
        """Initialize the Resend client."""
        try:
            import resend

            if self.api_url:
                resend.api_url = self.api_url

            resend.api_key = self.api_key
            self._client = resend.Emails

        except ImportError:
            raise MailConfigError("Resend package is not installed. Install with: pip install resend")
        except Exception as e:
            raise MailConfigError(f"Failed to initialize Resend client: {e}")

    def _send_message(self, message: MailMessage) -> None:
        """
        Send email message using Resend.

        Args:
            message: The email message to send

        Raises:
            MailSendError: If the email could not be sent
        """
        try:
            # Prepare email data for Resend
            email_data = {
                "from": message.from_,
                "to": message.to,
                "subject": message.subject,
                "html": message.html,
            }

            # Add optional fields
            if message.cc:
                email_data["cc"] = message.cc  # type: ignore

            if message.bcc:
                email_data["bcc"] = message.bcc  # type: ignore

            if message.reply_to:
                email_data["reply_to"] = message.reply_to

            # Send the email
            response = self._client.send(email_data)  # type: ignore

            logger.info(f"Email sent successfully to {message.to} via Resend (ID: {response.get('id', 'unknown')})")

        except Exception as e:
            logger.exception("Failed to send email via Resend")
            raise MailSendError(f"Resend error: {e}", e)

    def is_configured(self) -> bool:
        """
        Check if the Resend sender is properly configured.

        Returns:
            True if properly configured
        """
        return bool(self.api_key and self._client)

    def test_connection(self) -> bool:
        """
        Test connection to Resend service.

        Returns:
            True if connection is successful
        """
        try:
            # Resend doesn't have a specific health check endpoint
            # We'll just verify that the client is initialized
            return self.is_configured()
        except Exception as e:
            logger.warning(f"Resend connection test failed: {e}")
            return False
