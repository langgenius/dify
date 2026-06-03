"""Authentication and authorization exceptions for API v2 routes."""

from __future__ import annotations

from api_fastapi.exceptions.base import APIError


class UnauthorizedError(APIError):
    """Authentication failure that should include a bearer challenge."""

    error_code = "unauthorized"
    description = "Unauthorized."
    code = 401


class UnauthorizedAndForceLogoutError(UnauthorizedError):
    """Authentication failure that clears console auth cookies."""

    error_code = "unauthorized_and_force_logout"
    description = "Unauthorized and force logout."


class InvalidAuthTokenError(UnauthorizedError):
    """Invalid console access token."""

    error_code = "invalid_authorization_token"
    description = "Invalid Authorization token."


class AccountBannedError(UnauthorizedError):
    """Rejected request from a banned account."""

    error_code = "account_banned"
    description = "Account is banned."


class CsrfTokenError(UnauthorizedError):
    """Missing, mismatched, or invalid console CSRF token pair."""

    error_code = "csrf_token_invalid"
    description = "CSRF token is missing or invalid."


class AccountNotInitializedError(APIError):
    """Authenticated account has not completed initialization."""

    error_code = "account_not_initialized"
    description = "The account has not been initialized yet. Please proceed with the initialization process first."
    code = 400


class ForbiddenError(APIError):
    """Authenticated principal lacks permission for the requested operation."""

    error_code = "forbidden"
    description = "Forbidden."
    code = 403


class NotSetupError(APIError):
    """Self-hosted instance has not completed setup."""

    error_code = "not_setup"
    description = (
        "Dify has not been initialized and installed yet. "
        "Please proceed with the initialization and installation process first."
    )
    code = 401
