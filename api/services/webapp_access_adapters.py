"""Infrastructure adapters for Web app access policy queries."""

import json
from typing import Final, Protocol, override

import httpx
from pydantic import ValidationError

from enums import WebAppAccessMode
from services.enterprise.enterprise_service import WebAppSettings
from services.errors.enterprise import EnterpriseServiceError
from services.webapp_access_query_service import WebAppAccessPolicyGateway, WebAppAccessUnavailableError

ENTERPRISE_UNAVAILABLE_ERRORS: Final = (
    EnterpriseServiceError,
    httpx.RequestError,
    json.JSONDecodeError,
    UnicodeDecodeError,
    ValidationError,
)


class EnterpriseWebAppAuthService(Protocol):
    def get_app_access_mode_by_id(self, app_id: str) -> WebAppSettings: ...

    def update_app_access_mode(self, app_id: str, access_mode: str) -> object: ...

    def is_user_allowed_to_access_webapp(self, user_id: str, app_id: str) -> bool: ...


class EnterpriseWebAppAccessPolicyGateway(WebAppAccessPolicyGateway):
    def __init__(self, *, webapp_auth: EnterpriseWebAppAuthService) -> None:
        self._webapp_auth = webapp_auth

    @override
    def get_access_mode(self, app_id: str) -> WebAppAccessMode:
        try:
            settings = self._webapp_auth.get_app_access_mode_by_id(app_id)
        except ENTERPRISE_UNAVAILABLE_ERRORS as error:
            raise WebAppAccessUnavailableError from error

        try:
            return WebAppAccessMode(settings.access_mode)
        except ValueError as error:
            raise WebAppAccessUnavailableError from error

    @override
    def update_access_mode(self, app_id: str, access_mode: WebAppAccessMode) -> None:
        try:
            self._webapp_auth.update_app_access_mode(app_id, access_mode)
        except ENTERPRISE_UNAVAILABLE_ERRORS as error:
            raise WebAppAccessUnavailableError from error

    @override
    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        try:
            return self._webapp_auth.is_user_allowed_to_access_webapp(user_id, app_id)
        except (EnterpriseServiceError, httpx.RequestError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise WebAppAccessUnavailableError from error
