"""Application service for resolving web-app access."""

from typing import Protocol

from enums import WebAppAccessMode

_PERMISSION_CHECK_MODES = frozenset({WebAppAccessMode.PRIVATE, WebAppAccessMode.PRIVATE_ALL})


class WebAppAccessQuery(Protocol):
    def find_app_id_by_code(self, app_code: str) -> str | None: ...


class WebAppAccessPolicyGateway(Protocol):
    def get_access_mode(self, app_id: str) -> WebAppAccessMode: ...

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool: ...


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
        policy: WebAppAccessPolicyGateway,
        webapp_auth_enabled: bool,
    ) -> None:
        self._access = access
        self._policy = policy
        self._webapp_auth_enabled = webapp_auth_enabled

    def get_access_mode(self, *, app_id: str | None, app_code: str | None) -> WebAppAccessMode:
        if not self._webapp_auth_enabled:
            return WebAppAccessMode.PUBLIC

        if app_code:
            app_id = self._access.find_app_id_by_code(app_code)
            if app_id is None:
                raise WebAppAccessAppNotFoundError

        if not app_id:
            raise WebAppAccessReferenceRequiredError("appId or appCode must be provided")

        return self._policy.get_access_mode(app_id)

    def find_app_id_by_code(self, app_code: str) -> str | None:
        return self._access.find_app_id_by_code(app_code)

    def requires_permission_check(self, app_id: str) -> bool:
        return self._policy.get_access_mode(app_id) in _PERMISSION_CHECK_MODES

    def requires_authentication(self, app_id: str) -> bool:
        return self._webapp_auth_enabled and self._policy.get_access_mode(app_id) != WebAppAccessMode.PUBLIC

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        if not self._webapp_auth_enabled:
            return True

        return self._policy.is_user_allowed(user_id=user_id, app_id=app_id)
