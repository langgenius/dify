"""
Exception classes for mail sending operations.

This module defines specific exceptions that can be raised during mail
sending operations, providing clear error handling and debugging information.
"""


class MailError(Exception):
    """Base exception for all mail-related errors."""

    pass


class MailConfigError(MailError):
    """Raised when mail sender configuration is invalid or incomplete."""

    pass


class MailSendError(MailError):
    """Raised when an email could not be sent."""

    def __init__(self, message: str, original_error: Exception | None = None):
        """
        Initialize the mail send error.

        Args:
            message: Error description
            original_error: The original exception that caused this error
        """
        super().__init__(message)
        self.original_error = original_error


class MailAuthError(MailError):
    """Raised when authentication with the mail service fails."""

    pass


class MailConnectionError(MailError):
    """Raised when connection to the mail service fails."""

    pass


class MailTimeoutError(MailError):
    """Raised when mail operation times out."""

    pass
