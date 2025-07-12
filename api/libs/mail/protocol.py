"""
Core protocols and data structures for mail sending.

This module defines the abstract interfaces that all mail sending implementations
must follow, ensuring consistency and interchangeability.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable


@dataclass
class MailMessage:
    """
    Represents an email message with all necessary information.

    This is the standard data structure used across all mail sending implementations.
    """

    to: str
    subject: str
    html: str
    from_: Optional[str] = None
    cc: Optional[list[str]] = None
    bcc: Optional[list[str]] = None
    reply_to: Optional[str] = None
    attachments: Optional[list[dict]] = None  # Future extension for attachments

    def __post_init__(self):
        """Validate required fields."""
        if not self.to:
            raise ValueError("Recipient email address is required")
        if not self.subject:
            raise ValueError("Email subject is required")
        if not self.html:
            raise ValueError("Email content is required")


@runtime_checkable
class MailSender(Protocol):
    """
    Protocol defining the interface for all mail sending implementations.

    This protocol ensures that all mail senders (SMTP Basic Auth, SMTP OAuth2,
    third-party services like SendGrid, etc.) provide a consistent interface.
    """

    @abstractmethod
    def send(self, message: MailMessage) -> None:
        """
        Send an email message.

        Args:
            message: The email message to send

        Raises:
            MailSendError: If the email could not be sent
            MailConfigError: If the mail sender is not properly configured
        """
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """
        Check if the mail sender is properly configured and ready to send emails.

        Returns:
            True if the sender is configured and ready, False otherwise
        """
        pass

    @abstractmethod
    def test_connection(self) -> bool:
        """
        Test the connection to the mail service.

        Returns:
            True if connection is successful, False otherwise
        """
        pass


class MailSenderBase(ABC):
    """
    Abstract base class providing common functionality for mail senders.

    This class implements the MailSender protocol and provides common
    functionality that can be shared across different implementations.
    """

    def __init__(self, default_from: Optional[str] = None):
        """
        Initialize the mail sender.

        Args:
            default_from: Default sender email address
        """
        self.default_from = default_from

    def send(self, message: MailMessage) -> None:
        """
        Send an email message with validation and preprocessing.

        Args:
            message: The email message to send
        """
        # Set default from address if not specified
        if not message.from_ and self.default_from:
            message.from_ = self.default_from

        # Validate the message
        self._validate_message(message)

        # Send the message using the specific implementation
        self._send_message(message)

    def _validate_message(self, message: MailMessage) -> None:
        """
        Validate the email message before sending.

        Args:
            message: The message to validate

        Raises:
            ValueError: If the message is invalid
        """
        if not message.from_:
            raise ValueError("Sender email address is required")

    @abstractmethod
    def _send_message(self, message: MailMessage) -> None:
        """
        Send the email message using the specific implementation.

        This method must be implemented by concrete classes.

        Args:
            message: The validated message to send
        """
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Check if the mail sender is properly configured."""
        pass

    @abstractmethod
    def test_connection(self) -> bool:
        """Test the connection to the mail service."""
        pass
