"""Application service for resolving web-app access."""

from collections.abc import Callable
from typing import Protocol

from enums import WebAppAccessMode

_PERMISSION_CHECK_MODES = frozenset({WebAppAccessMode.PRIVATE, WebAppAccessMode.PRIVATE_ALL})


class WebAppAccessQuery(Protocol):
    def find_app_id_by_code(self, app_code: str) -> str | None: ...

    def is_app_available(self, app_id: str) -> bool: ...


class WebAppAccessReferenceRequiredError(ValueError):
    """Raised when neither an app ID nor an app code was provided."""


class WebAppAccessAppNotFoundError(LookupError):
    """Raised when an app code does not resolve to an app."""


class WebAppAccessUnavailableError(RuntimeError):
    """Raised when an access dependency cannot answer the query."""


class WebAppAccessQueryService:
    def __init__(
        self,
        *,
        access: WebAppAccessQuery,
        webapp_auth_enabled: bool,
        access_mode_for_app: Callable[[str], WebAppAccessMode],
        is_user_allowed_for_app: Callable[[str, str], bool],
    ) -> None:
        self._access = access
        self._webapp_auth_enabled = webapp_auth_enabled
        self._access_mode_for_app = access_mode_for_app
        self._is_user_allowed_for_app = is_user_allowed_for_app

    def resolve_app_id(self, *, app_id: str | None = None, app_code: str | None = None) -> str:
        """Resolve a published public App identity without tokens or user writes."""
        if app_code:
            app_id = self._access.find_app_id_by_code(app_code)
            if app_id is None:
                raise WebAppAccessAppNotFoundError
        elif app_id and not self._access.is_app_available(app_id):
            raise WebAppAccessAppNotFoundError
        if not app_id:
            raise WebAppAccessReferenceRequiredError("appId or appCode must be provided")
        return app_id

    def get_access_mode(self, *, app_id: str | None, app_code: str | None) -> WebAppAccessMode:
        # Preserve the auth-disabled, reference-free bootstrap shortcut. Supplied
        # references must still resolve to a live App regardless of auth settings.
        if not self._webapp_auth_enabled and not app_id and not app_code:
            return WebAppAccessMode.PUBLIC
        app_id = self.resolve_app_id(app_id=app_id, app_code=app_code)
        if not self._webapp_auth_enabled:
            return WebAppAccessMode.PUBLIC
        return self._access_mode_for_app(app_id)

    def requires_permission_check(self, app_id: str) -> bool:
        return self._access_mode_for_app(app_id) in _PERMISSION_CHECK_MODES

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        if not self._webapp_auth_enabled:
            return True

        return self._is_user_allowed_for_app(user_id, app_id)
