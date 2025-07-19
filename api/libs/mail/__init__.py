"""
Mail sending library with pluggable authentication and transport protocols.

This module provides a clean abstraction for sending emails with support for
multiple authentication methods (Basic Auth, OAuth2) and transport protocols.
"""

# Import all sender implementations to ensure they are registered
from . import resend_sender, sendgrid_sender, smtp_sender
from .exceptions import MailAuthError, MailConfigError, MailConnectionError, MailError, MailSendError, MailTimeoutError
from .factory import MailSenderFactory
from .protocol import MailMessage, MailSender, MailSenderBase

__all__ = [
    "MailAuthError",
    "MailConfigError",
    "MailConnectionError",
    "MailError",
    "MailMessage",
    "MailSendError",
    "MailSender",
    "MailSenderBase",
    "MailSenderFactory",
    "MailTimeoutError",
]
