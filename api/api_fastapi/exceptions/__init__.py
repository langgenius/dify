"""API v2 exception categories for route and dependency code."""

from api_fastapi.exceptions.auth import (
    AccountBannedError,
    AccountNotInitializedError,
    CsrfTokenError,
    ForbiddenError,
    InvalidAuthTokenError,
    NotSetupError,
    UnauthorizedAndForceLogoutError,
    UnauthorizedError,
)
from api_fastapi.exceptions.base import APIError
from api_fastapi.exceptions.workflow import (
    AppNotFoundError,
    DraftWorkflowNotExistError,
    DraftWorkflowNotSyncError,
)

__all__ = [
    "APIError",
    "AccountBannedError",
    "AccountNotInitializedError",
    "AppNotFoundError",
    "CsrfTokenError",
    "DraftWorkflowNotExistError",
    "DraftWorkflowNotSyncError",
    "ForbiddenError",
    "InvalidAuthTokenError",
    "NotSetupError",
    "UnauthorizedAndForceLogoutError",
    "UnauthorizedError",
]
