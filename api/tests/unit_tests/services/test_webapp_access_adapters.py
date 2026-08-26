import json
from dataclasses import dataclass, field

import httpx
import pytest
from pydantic import ValidationError

from enums import WebAppAccessMode
from services.enterprise.enterprise_service import WebAppSettings
from services.errors.enterprise import EnterpriseAPIError, EnterpriseAPINotFoundError
from services.webapp_access_adapters import EnterpriseWebAppAccessPolicyGateway
from services.webapp_access_query_service import WebAppAccessUnavailableError


@dataclass
class EnterpriseWebAppAuthStub:
    access_mode: str = WebAppAccessMode.PRIVATE.value
    allowed: bool = True
    access_mode_error: Exception | None = None
    permission_error: Exception | None = None
    access_mode_calls: list[str] = field(default_factory=list)
    permission_calls: list[tuple[str, str]] = field(default_factory=list)

    def get_app_access_mode_by_id(self, app_id: str) -> WebAppSettings:
        self.access_mode_calls.append(app_id)
        if self.access_mode_error is not None:
            raise self.access_mode_error
        return WebAppSettings(accessMode=self.access_mode)

    def is_user_allowed_to_access_webapp(self, user_id: str, app_id: str) -> bool:
        self.permission_calls.append((user_id, app_id))
        if self.permission_error is not None:
            raise self.permission_error
        return self.allowed


def test_get_access_mode_converts_enterprise_settings() -> None:
    webapp_auth = EnterpriseWebAppAuthStub(access_mode=WebAppAccessMode.PRIVATE_ALL.value)
    gateway = EnterpriseWebAppAccessPolicyGateway(webapp_auth=webapp_auth)

    assert gateway.get_access_mode("app-1") is WebAppAccessMode.PRIVATE_ALL
    assert webapp_auth.access_mode_calls == ["app-1"]


@pytest.mark.parametrize(
    "enterprise_error",
    [
        pytest.param(EnterpriseAPINotFoundError(), id="not-found"),
        pytest.param(EnterpriseAPIError(), id="api-error"),
        pytest.param(httpx.ConnectError("connection failed"), id="transport"),
        pytest.param(json.JSONDecodeError("invalid", "", 0), id="invalid-json"),
        pytest.param(UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid"), id="invalid-encoding"),
        pytest.param(
            ValidationError.from_exception_data(WebAppSettings.__name__, []),
            id="invalid-response",
        ),
    ],
)
def test_get_access_mode_maps_known_enterprise_errors(enterprise_error: Exception) -> None:
    gateway = EnterpriseWebAppAccessPolicyGateway(
        webapp_auth=EnterpriseWebAppAuthStub(access_mode_error=enterprise_error)
    )

    with pytest.raises(WebAppAccessUnavailableError) as raised:
        gateway.get_access_mode("app-1")

    assert raised.value.__cause__ is enterprise_error


def test_get_access_mode_maps_unknown_mode_to_unavailable() -> None:
    gateway = EnterpriseWebAppAccessPolicyGateway(webapp_auth=EnterpriseWebAppAuthStub(access_mode="invalid"))

    with pytest.raises(WebAppAccessUnavailableError) as raised:
        gateway.get_access_mode("app-1")

    assert isinstance(raised.value.__cause__, ValueError)


def test_get_access_mode_does_not_hide_unknown_errors() -> None:
    failure = TypeError("adapter bug")
    gateway = EnterpriseWebAppAccessPolicyGateway(webapp_auth=EnterpriseWebAppAuthStub(access_mode_error=failure))

    with pytest.raises(TypeError) as raised:
        gateway.get_access_mode("app-1")

    assert raised.value is failure


def test_is_user_allowed_delegates_to_enterprise_service() -> None:
    webapp_auth = EnterpriseWebAppAuthStub(allowed=False)
    gateway = EnterpriseWebAppAccessPolicyGateway(webapp_auth=webapp_auth)

    assert gateway.is_user_allowed(user_id="user-1", app_id="app-1") is False
    assert webapp_auth.permission_calls == [("user-1", "app-1")]


def test_is_user_allowed_maps_connection_failure() -> None:
    failure = httpx.ConnectError("connection failed")
    gateway = EnterpriseWebAppAccessPolicyGateway(webapp_auth=EnterpriseWebAppAuthStub(permission_error=failure))

    with pytest.raises(WebAppAccessUnavailableError) as raised:
        gateway.is_user_allowed(user_id="user-1", app_id="app-1")

    assert raised.value.__cause__ is failure
