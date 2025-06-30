"""
Unified SMTP mail sender that automatically selects authentication method.

This module provides a single SMTP sender that can automatically choose
between Basic Auth and OAuth2 based on configuration.
"""

import logging
from typing import Optional, Union

from .exceptions import MailConfigError
from .protocol import MailMessage
from .smtp_basic import SMTPBasicAuthSender
from .smtp_oauth2 import SMTPOAuth2Sender

logger = logging.getLogger(__name__)


class SMTPSender:
    """
    Unified SMTP sender that automatically selects authentication method.

    This class acts as a facade that automatically chooses between Basic Auth
    and OAuth2 authentication based on the provided configuration.
    """

    def __init__(
        self,
        server: str,
        port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
        auth_type: str = "basic",
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        tenant_id: Optional[str] = None,
        oauth2_provider: str = "microsoft",
        use_tls: bool = False,
        opportunistic_tls: bool = False,
        default_from: Optional[str] = None,
        **kwargs,
    ):
        """
        Initialize SMTP sender with automatic authentication method selection.

        Args:
            server: SMTP server hostname
            port: SMTP server port
            username: Username/email for authentication
            password: Password for Basic Auth
            auth_type: Authentication type ('basic' or 'oauth2')
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
            tenant_id: OAuth2 tenant ID (required for Microsoft OAuth2)
            oauth2_provider: OAuth2 provider (currently only 'microsoft' is supported)
            use_tls: Whether to use TLS encryption
            opportunistic_tls: Whether to use opportunistic TLS
            default_from: Default sender email address
        """
        # Auto-detect authentication type if not explicitly specified
        auth_type = auth_type.lower()

        if auth_type == "basic":
            # Validate Basic Auth configuration
            if not username or not password:
                logger.warning("Username or password missing for Basic Auth, checking for OAuth2 config")
                # Check if OAuth2 config is available
                if client_id and client_secret:
                    auth_type = "oauth2"
                    logger.info("Auto-switching to OAuth2 authentication")
                else:
                    raise MailConfigError("Username and password are required for Basic Auth")

        elif auth_type == "oauth2":
            # Validate OAuth2 configuration
            if not client_id or not client_secret:
                raise MailConfigError("Client ID and client secret are required for OAuth2")

            provider = oauth2_provider.lower()
            if provider != "microsoft":
                raise MailConfigError("Only Microsoft OAuth2 is supported")

            if not tenant_id:
                raise MailConfigError("Tenant ID is required for Microsoft OAuth2")

            if not username:
                raise MailConfigError("Username is required for OAuth2")
        else:
            raise MailConfigError(f"Unsupported authentication type: {auth_type}")

        self.auth_type = auth_type

        # Create the appropriate sender based on auth type
        self._sender: Union[SMTPBasicAuthSender, SMTPOAuth2Sender]
        if self.auth_type == "basic":
            self._sender = SMTPBasicAuthSender(
                server=server,
                port=port,
                username=username,
                password=password,
                use_tls=use_tls,
                opportunistic_tls=opportunistic_tls,
                default_from=default_from,
            )
        elif self.auth_type == "oauth2":
            # Type assertions after validation
            assert username is not None
            assert client_id is not None
            assert client_secret is not None
            assert tenant_id is not None

            self._sender = SMTPOAuth2Sender(
                server=server,
                port=port,
                username=username,
                oauth2_provider=oauth2_provider,
                client_id=client_id,
                client_secret=client_secret,
                tenant_id=tenant_id,
                use_tls=use_tls,
                opportunistic_tls=opportunistic_tls,
                default_from=default_from,
            )

        logger.info(f"Initialized SMTP sender with {self.auth_type} authentication")

    def send(self, message: MailMessage) -> None:
        """
        Send an email message.

        Args:
            message: The email message to send
        """
        self._sender.send(message)

    def is_configured(self) -> bool:
        """
        Check if the SMTP sender is properly configured.

        Returns:
            True if properly configured
        """
        return self._sender.is_configured()

    def test_connection(self) -> bool:
        """
        Test connection to the SMTP server.

        Returns:
            True if connection is successful
        """
        return self._sender.test_connection()

    @property
    def sender_type(self) -> str:
        """
        Get the type of the underlying sender.

        Returns:
            Sender type description
        """
        return f"SMTP ({self.auth_type})"
