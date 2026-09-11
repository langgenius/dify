"""Infrastructure adapters for Web app access policy queries."""

import json
from typing import Protocol, override

import httpx
from pydantic import ValidationError

from enums import WebAppAccessMode
from services.enterprise.enterprise_service import WebAppSettings
from services.errors.enterprise import EnterpriseServiceError
from services.webapp_access_query_service import WebAppAccessPolicyGateway, WebAppAccessUnavailableError


class EnterpriseWebAppAuthService(Protocol):
    def get_app_access_mode_by_id(self, app_id: str) -> WebAppSettings: ...

    def is_user_allowed_to_access_webapp(self, user_id: str, app_id: str) -> bool: ...


class EnterpriseWebAppAccessPolicyGateway(WebAppAccessPolicyGateway):
    def __init__(self, *, webapp_auth: EnterpriseWebAppAuthService) -> None:
        self._webapp_auth = webapp_auth

    @override
    def get_access_mode(self, app_id: str) -> WebAppAccessMode:
        try:
            settings = self._webapp_auth.get_app_access_mode_by_id(app_id)
        except (
            EnterpriseServiceError,
            httpx.RequestError,
            json.JSONDecodeError,
            UnicodeDecodeError,
            ValidationError,
        ) as error:
            raise WebAppAccessUnavailableError from error

        try:
            return WebAppAccessMode(settings.access_mode)
        except ValueError as error:
            raise WebAppAccessUnavailableError from error

    @override
    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        try:
            return self._webapp_auth.is_user_allowed_to_access_webapp(user_id, app_id)
        except (EnterpriseServiceError, httpx.RequestError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise WebAppAccessUnavailableError from error
