"""Application service for resolving web-app access."""

from collections.abc import Callable
from typing import Protocol

from enums import WebAppAccessMode

_PERMISSION_CHECK_MODES = frozenset({WebAppAccessMode.PRIVATE, WebAppAccessMode.PRIVATE_ALL})


class WebAppAccessQuery(Protocol):
    def find_app_id_by_code(self, app_code: str) -> str | None: ...


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

    def get_access_mode(self, *, app_id: str | None, app_code: str | None) -> WebAppAccessMode:
        if not self._webapp_auth_enabled:
            return WebAppAccessMode.PUBLIC

        if app_code:
            app_id = self._access.find_app_id_by_code(app_code)
            if app_id is None:
                raise WebAppAccessAppNotFoundError

        if not app_id:
            raise WebAppAccessReferenceRequiredError("appId or appCode must be provided")

        return self._access_mode_for_app(app_id)

    def requires_permission_check(self, app_id: str) -> bool:
        return self._access_mode_for_app(app_id) in _PERMISSION_CHECK_MODES

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        if not self._webapp_auth_enabled:
            return True

        return self._is_user_allowed_for_app(user_id, app_id)
