"""Outer gateways used by the web passport application service."""

from collections.abc import Callable, Mapping
from typing import Any

from werkzeug.exceptions import Unauthorized

from services.enterprise.enterprise_service import PERMISSION_CHECK_MODES, WebAppAccessMode, WebAppSettings
from services.web_passport_service import WebAppAuthType, WebPassportUnauthorizedError


class DeploymentWebPassportAuthGateway:
    def __init__(
        self,
        *,
        webapp_auth_enabled: bool,
        get_app_access_mode: Callable[[str], WebAppSettings],
    ) -> None:
        self._webapp_auth_enabled = webapp_auth_enabled
        self._get_app_access_mode = get_app_access_mode

    def is_webapp_auth_enabled(self) -> bool:
        return self._webapp_auth_enabled

    def get_app_auth_type(self, app_id: str) -> WebAppAuthType:
        access_mode = self._get_app_access_mode(app_id).access_mode
        if access_mode == WebAppAccessMode.PUBLIC:
            return WebAppAuthType.PUBLIC
        if access_mode in PERMISSION_CHECK_MODES:
            return WebAppAuthType.INTERNAL
        if access_mode == WebAppAccessMode.SSO_VERIFIED:
            return WebAppAuthType.EXTERNAL
        raise ValueError(f"Unsupported web app access mode: {access_mode}")


class PassportTokenGateway:
    def __init__(self, *, passport: Any) -> None:
        self._passport = passport

    def verify(self, token: str) -> Mapping[str, Any]:
        try:
            return self._passport.verify(token)
        except Unauthorized as exc:
            description = getattr(exc, "description", None) or "Invalid token."
            raise WebPassportUnauthorizedError(description) from exc

    def issue(self, payload: Mapping[str, Any]) -> str:
        return self._passport.issue(dict(payload))
