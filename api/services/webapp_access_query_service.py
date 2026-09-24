"""Application service for resolving web-app access."""

from collections.abc import Callable, Mapping, Sequence
from typing import Protocol

from enums import WebAppAccessMode

_PERMISSION_CHECK_MODES = frozenset({WebAppAccessMode.PRIVATE, WebAppAccessMode.PRIVATE_ALL})


class WebAppAccessQuery(Protocol):
    def find_app_id_by_code(self, app_code: str) -> str | None: ...


class WebAppAccessModesQuery(Protocol):
    def __call__(self, *, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]: ...


class WebAppUserPermissionsQuery(Protocol):
    def __call__(self, *, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]: ...


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
        get_access_modes: WebAppAccessModesQuery,
        get_user_permissions: WebAppUserPermissionsQuery,
    ) -> None:
        self._access: WebAppAccessQuery = access
        self._webapp_auth_enabled: bool = webapp_auth_enabled
        self._access_mode_for_app: Callable[[str], WebAppAccessMode] = access_mode_for_app
        self._is_user_allowed_for_app: Callable[[str, str], bool] = is_user_allowed_for_app
        self._get_access_modes: WebAppAccessModesQuery = get_access_modes
        self._get_user_permissions: WebAppUserPermissionsQuery = get_user_permissions

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

    def batch_get_access_modes(self, *, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
        """Return successfully parsed modes; missing IDs do not grant access."""
        if not self._webapp_auth_enabled or not app_ids:
            return dict.fromkeys(app_ids, WebAppAccessMode.PUBLIC)

        return self._get_access_modes(app_ids=app_ids)

    def batch_get_user_permissions(self, *, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
        if not self._webapp_auth_enabled or not app_ids:
            return dict.fromkeys(app_ids, True)

        return self._get_user_permissions(user_id=user_id, app_ids=app_ids)
