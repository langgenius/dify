"""Mail module for email functionality

This module provides comprehensive email support including:
- SMTP clients with OAuth 2.0 support
- Microsoft Exchange/Outlook integration
- Email authentication and connection management
- Support for TLS/SSL encryption
"""

from .oauth_email import EmailOAuth, MicrosoftEmailOAuth, OAuthUserInfo
from .oauth_http_client import OAuthHTTPClient, OAuthHTTPClientProtocol
from .smtp import SMTPAuthenticator, SMTPClient, SMTPMessageBuilder
from .smtp_connection import SMTPConnectionFactory, SMTPConnectionProtocol

__all__ = [
    "EmailOAuth",
    "MicrosoftEmailOAuth",
    "OAuthHTTPClient",
    "OAuthHTTPClientProtocol",
    "OAuthUserInfo",
    "SMTPAuthenticator",
    "SMTPClient",
    "SMTPConnectionFactory",
    "SMTPConnectionProtocol",
    "SMTPMessageBuilder",
]
