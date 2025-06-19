"""
OAuth2 authentication handlers for mail services.

This module provides OAuth2 authentication support for various mail providers,
with automatic token management and refresh capabilities.
"""

import logging
import time
from abc import ABC, abstractmethod
from typing import Optional

import requests

from .exceptions import MailAuthError, MailConfigError

logger = logging.getLogger(__name__)


class OAuth2Handler(ABC):
    """
    Abstract base class for OAuth2 authentication handlers.

    This class defines the interface for OAuth2 authentication with
    automatic token management and refresh.
    """

    def __init__(self, client_id: str, client_secret: str):
        """
        Initialize OAuth2 handler.

        Args:
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._token_expires_at: Optional[float] = None

    def get_access_token(self) -> str:
        """
        Get a valid access token, refreshing if necessary.

        Returns:
            Valid access token

        Raises:
            MailAuthError: If token cannot be obtained
        """
        if self._is_token_valid():
            assert self._access_token is not None
            return self._access_token

        if self._refresh_token:
            try:
                self._refresh_access_token()
                assert self._access_token is not None
                return self._access_token
            except Exception as e:
                logger.warning(f"Token refresh failed, attempting new token: {e}")

        # Get new token using client credentials
        self._get_new_token()
        assert self._access_token is not None
        return self._access_token

    def _is_token_valid(self) -> bool:
        """
        Check if current access token is valid.

        Returns:
            True if token is valid and not expired
        """
        if not self._access_token:
            return False

        if not self._token_expires_at:
            return True  # No expiration info, assume valid

        # Add 60 second buffer before expiration
        return time.time() < (self._token_expires_at - 60)

    @abstractmethod
    def _get_new_token(self) -> None:
        """
        Obtain a new access token using client credentials.

        This method should update _access_token, _refresh_token, and _token_expires_at.
        """
        pass

    @abstractmethod
    def _refresh_access_token(self) -> None:
        """
        Refresh the access token using the refresh token.

        This method should update _access_token and _token_expires_at.
        """
        pass


class MicrosoftOAuth2Handler(OAuth2Handler):
    """
    OAuth2 handler for Microsoft/Office 365 services.

    This handler supports the Client Credentials flow for server-to-server
    authentication with Microsoft Graph API for sending emails.
    """

    def __init__(self, client_id: str, client_secret: str, tenant_id: str):
        """
        Initialize Microsoft OAuth2 handler.

        Args:
            client_id: Azure AD application client ID
            client_secret: Azure AD application client secret
            tenant_id: Azure AD tenant ID
        """
        super().__init__(client_id, client_secret)
        self.tenant_id = tenant_id

        if not tenant_id:
            raise MailConfigError("Tenant ID is required for Microsoft OAuth2")

        self.token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    def _get_new_token(self) -> None:
        """
        Get new access token using Client Credentials flow.

        This uses the Client Credentials flow which is suitable for
        server-to-server authentication without user interaction.
        """
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }

        try:
            response = requests.post(self.token_url, data=data, timeout=30)
            response.raise_for_status()

            token_data = response.json()

            self._access_token = token_data["access_token"]
            self._refresh_token = token_data.get("refresh_token")  # May not be present in client credentials flow

            # Calculate expiration time
            expires_in = token_data.get("expires_in", 3600)
            self._token_expires_at = time.time() + expires_in

            logger.info("Successfully obtained Microsoft OAuth2 access token")

        except requests.RequestException as e:
            logger.exception("Failed to obtain Microsoft OAuth2 token")
            raise MailAuthError(f"Failed to obtain access token: {e}")
        except KeyError as e:
            logger.exception("Invalid token response from Microsoft")
            raise MailAuthError(f"Invalid token response: {e}")

    def _refresh_access_token(self) -> None:
        """
        Refresh access token using refresh token.

        Note: Client Credentials flow typically doesn't provide refresh tokens,
        so this will usually fall back to getting a new token.
        """
        if not self._refresh_token:
            # Client credentials flow doesn't provide refresh tokens
            # Fall back to getting a new token
            self._get_new_token()
            return

        data = {
            "grant_type": "refresh_token",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self._refresh_token,
        }

        try:
            response = requests.post(self.token_url, data=data, timeout=30)
            response.raise_for_status()

            token_data = response.json()

            self._access_token = token_data["access_token"]
            if "refresh_token" in token_data:
                self._refresh_token = token_data["refresh_token"]

            expires_in = token_data.get("expires_in", 3600)
            self._token_expires_at = time.time() + expires_in

            logger.info("Successfully refreshed Microsoft OAuth2 access token")

        except requests.RequestException as e:
            logger.exception("Failed to refresh Microsoft OAuth2 token")
            raise MailAuthError(f"Failed to refresh access token: {e}")


def create_oauth2_handler(provider: str, **config) -> OAuth2Handler:
    """
    Factory function to create OAuth2 handlers.

    Args:
        provider: OAuth2 provider name (currently only 'microsoft' is supported)
        **config: Provider-specific configuration

    Returns:
        Configured OAuth2 handler

    Raises:
        MailConfigError: If provider is not supported or configuration is invalid
    """
    if provider.lower() == "microsoft":
        # Validate required configuration parameters
        required_params = ["client_id", "client_secret", "tenant_id"]
        for param in required_params:
            if param not in config:
                raise MailConfigError(f"Missing required parameter '{param}' for Microsoft OAuth2 configuration")
            if not config[param] or not config[param].strip():
                raise MailConfigError(f"Parameter '{param}' cannot be empty for Microsoft OAuth2 configuration")

        # Create handler with validated parameters
        return MicrosoftOAuth2Handler(
            client_id=config["client_id"], client_secret=config["client_secret"], tenant_id=config["tenant_id"]
        )
    else:
        raise MailConfigError(f"Unsupported OAuth2 provider: {provider}. Only 'microsoft' is supported.")
