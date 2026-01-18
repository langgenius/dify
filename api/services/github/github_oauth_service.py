import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import redis

from configs import dify_config
from core.helper.ssrf_proxy import make_request
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.github_connection import GitHubConnection
from services.plugin.oauth_service import OAuthProxyService

logger = logging.getLogger(__name__)

GITHUB_OAUTH_BASE_URL = "https://github.com"
GITHUB_API_BASE_URL = "https://api.github.com"
OAUTH_STATE_TTL = 5 * 60  # 5 minutes
GITHUB_OAUTH_TOKEN_TTL = 10 * 60  # 10 minutes for temporary token storage in Redis


@dataclass
class OAuthResult:
    oauth_state: str
    repository_owner: str
    app_id: str | None = None


class GitHubOAuthService:
    """
    Handles GitHub OAuth authentication flow.
    """

    @staticmethod
    def get_authorization_url(
        tenant_id: str,
        user_id: str,
        app_id: str | None = None,
        redirect_uri: str | None = None,
    ) -> tuple[str, str]:
        """
        Get GitHub OAuth authorization URL.

        Args:
            tenant_id: Tenant ID
            user_id: User ID
            app_id: Optional app ID for app-specific connections
            redirect_uri: Optional custom redirect URI

        Returns:
            Tuple of (authorization_url, state)
        """
        if not dify_config.GITHUB_CLIENT_ID:
            raise ValueError("GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.")

        # Build authorization URL
        # Callback URL should point to backend API, not frontend
        if not dify_config.CONSOLE_API_URL:
            raise ValueError("CONSOLE_API_URL is not configured. Please set CONSOLE_API_URL in your environment.")

        default_redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/github/oauth/callback"

        # Create proxy context for CSRF protection
        extra_data = {}
        if app_id:
            extra_data["app_id"] = app_id
        if redirect_uri:
            extra_data["redirect_uri"] = redirect_uri

        try:
            state = OAuthProxyService.create_proxy_context(
                user_id=user_id,
                tenant_id=tenant_id,
                plugin_id="github",  # Using "github" as plugin_id for consistency
                provider="github",
                extra_data=extra_data,
            )
        except (redis.RedisError, ConnectionError, OSError) as e:
            logger.exception("Redis connection error during OAuth proxy context creation")
            raise ValueError(f"Redis connection failed: {str(e)}") from e
        except ValueError:
            # Re-raise ValueError as-is
            raise
        except Exception as e:
            logger.exception("Failed to create OAuth proxy context: %s", type(e).__name__)
            raise ValueError(f"Failed to initialize OAuth flow: {str(e)}") from e
        params = {
            "client_id": dify_config.GITHUB_CLIENT_ID,
            "redirect_uri": redirect_uri or default_redirect_uri,
            "scope": "repo",
            "state": state,
            "response_type": "code",
        }

        auth_url = f"{GITHUB_OAUTH_BASE_URL}/login/oauth/authorize?{urlencode(params)}"
        return auth_url, state

    @staticmethod
    def handle_callback(code: str, state: str) -> OAuthResult:
        """
        Handle OAuth callback and store GitHub token temporarily in Redis.

        Args:
            code: Authorization code from GitHub
            state: State parameter for CSRF protection

        Returns:
            OAuthResult instance with oauth_state and repository_owner
        """
        # Validate state
        try:
            context_data = OAuthProxyService.use_proxy_context(state)
        except ValueError as e:
            logger.exception("Invalid OAuth state")
            raise ValueError("Invalid or expired OAuth state") from e

        tenant_id = context_data["tenant_id"]
        user_id = context_data["user_id"]
        app_id = context_data.get("app_id")
        redirect_uri = context_data.get("redirect_uri")

        if not dify_config.GITHUB_CLIENT_ID or not dify_config.GITHUB_CLIENT_SECRET:
            raise ValueError("GitHub OAuth is not configured.")

        # Exchange code for access token
        default_redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/github/oauth/callback"
        token_data = GitHubOAuthService._exchange_code_for_token(
            code=code,
            redirect_uri=redirect_uri or default_redirect_uri,
        )

        access_token = token_data["access_token"]
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in")
        token_expires_at = None
        if expires_in:
            token_expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)

        # Get user info to determine repository access
        user_info = GitHubOAuthService._get_user_info(access_token)

        # Store OAuth token temporarily in Redis instead of creating incomplete connection
        # Connection will be created only when user selects a repository
        oauth_token_key = f"github_oauth_token:{state}"
        token_data_to_store = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_expires_at": token_expires_at.isoformat() if token_expires_at else None,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "app_id": app_id,
            "repository_owner": user_info.get("login", ""),
        }
        # Store for 10 minutes (enough time to select repository)
        redis_client.setex(
            oauth_token_key,
            10 * 60,  # 10 minutes
            json.dumps(token_data_to_store),
        )

        logger.info(
            "GitHub OAuth token stored temporarily: tenant_id=%s, user_id=%s, app_id=%s, state=%s",
            tenant_id,
            user_id,
            app_id,
            state,
        )

        # Return OAuthResult with info needed for redirect
        # Connection will be created only when repository is selected
        return OAuthResult(
            oauth_state=state,
            repository_owner=user_info.get("login", ""),
            app_id=app_id,
        )

    @staticmethod
    def _exchange_code_for_token(code: str, redirect_uri: str) -> dict[str, Any]:
        """
        Exchange authorization code for access token.

        Args:
            code: Authorization code
            redirect_uri: Redirect URI used in authorization

        Returns:
            Token response data
        """
        url = f"{GITHUB_OAUTH_BASE_URL}/login/oauth/access_token"
        # GitHub OAuth token endpoint expects form-encoded data
        data = {
            "client_id": dify_config.GITHUB_CLIENT_ID,
            "client_secret": dify_config.GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": redirect_uri,
        }

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        try:
            # Use form-encoded data for GitHub OAuth token exchange
            response = make_request("POST", url, data=data, headers=headers, timeout=30.0)
            response.raise_for_status()
            token_data = response.json()

            if "error" in token_data:
                error_msg = token_data.get("error_description", token_data.get("error", "Unknown error"))
                logger.error("GitHub OAuth token exchange failed: %s", error_msg)
                raise ValueError(f"Failed to exchange code for token: {error_msg}")

            return token_data
        except httpx.HTTPStatusError as e:
            error_text = e.response.text if hasattr(e.response, "text") else str(e)
            logger.exception(
                "GitHub OAuth token exchange failed: status=%s, response=%s",
                e.response.status_code,
                error_text,
            )
            raise ValueError(f"Failed to exchange code for token: HTTP {e.response.status_code} - {error_text}") from e
        except httpx.HTTPError as e:
            logger.exception("HTTP error during GitHub OAuth token exchange")
            raise ValueError(f"Failed to exchange code for token: {str(e)}") from e

    @staticmethod
    def _get_user_info(access_token: str) -> dict[str, Any]:
        """
        Get GitHub user information.

        Args:
            access_token: GitHub access token

        Returns:
            User information
        """
        url = f"{GITHUB_API_BASE_URL}/user"
        headers = {
            "Authorization": f"token {access_token}",
            "Accept": "application/vnd.github.v3+json",
        }

        try:
            response = make_request("GET", url, headers=headers, timeout=30.0)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.exception("HTTP error during GitHub user info fetch")
            raise ValueError(f"Failed to get user info: {str(e)}") from e

    @staticmethod
    def refresh_token(connection_id: str) -> GitHubConnection:
        """
        Refresh expired access token.

        Args:
            connection_id: Connection ID

        Returns:
            Updated GitHubConnection
        """
        connection = db.session.get(GitHubConnection, connection_id)
        if not connection:
            raise ValueError(f"GitHub connection not found: {connection_id}")

        refresh_token = connection.get_decrypted_refresh_token()
        if not refresh_token:
            raise ValueError("No refresh token available for this connection")

        # GitHub doesn't support refresh tokens in the standard OAuth flow
        # This would require implementing token refresh if GitHub provides it
        # For now, we'll raise an error and require re-authentication
        raise NotImplementedError("GitHub OAuth refresh token flow is not yet implemented")

    @staticmethod
    def revoke_connection(connection_id: str, tenant_id: str) -> None:
        """
        Revoke and delete GitHub connection.

        Args:
            connection_id: Connection ID
            tenant_id: Tenant ID for security check
        """
        connection = (
            db.session.query(GitHubConnection)
            .where(GitHubConnection.id == connection_id, GitHubConnection.tenant_id == tenant_id)
            .first()
        )

        if not connection:
            raise ValueError(f"GitHub connection not found: {connection_id}")

        # Revoke webhook if exists
        if connection.webhook_id:
            try:
                GitHubOAuthService._revoke_webhook(connection)
            except Exception as e:
                logger.warning("Failed to revoke webhook: %s", e)

        db.session.delete(connection)
        db.session.commit()

        logger.info("GitHub connection revoked: connection_id=%s", connection_id)

    @staticmethod
    def _revoke_webhook(connection: GitHubConnection) -> None:
        """Revoke GitHub webhook."""
        # This will be implemented when webhook support is added
        pass
