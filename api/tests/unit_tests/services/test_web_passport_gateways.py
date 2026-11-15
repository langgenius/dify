"""Unit tests for the outer gateways used by web passport issuance."""

import pytest

from libs.passport import PassportService
from services.enterprise.enterprise_service import WebAppAccessMode, WebAppSettings
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebAppAuthType, WebPassportUnauthorizedError


def _passport() -> PassportService:
    passport = PassportService()
    passport.sk = "test-secret-key-with-at-least-32-bytes"
    return passport


def test_deployment_auth_gateway_reads_deployment_setting() -> None:
    gateway = DeploymentWebPassportAuthGateway(
        webapp_auth_enabled=True,
        get_app_access_mode=lambda _app_id: WebAppSettings(accessMode=WebAppAccessMode.PUBLIC),
    )

    assert gateway.is_webapp_auth_enabled() is True


@pytest.mark.parametrize(
    ("access_mode", "expected"),
    [
        (WebAppAccessMode.PUBLIC, WebAppAuthType.PUBLIC),
        (WebAppAccessMode.PRIVATE, WebAppAuthType.INTERNAL),
        (WebAppAccessMode.PRIVATE_ALL, WebAppAuthType.INTERNAL),
        (WebAppAccessMode.SSO_VERIFIED, WebAppAuthType.EXTERNAL),
    ],
)
def test_deployment_auth_gateway_delegates_access_mode_mapping(
    access_mode: WebAppAccessMode,
    expected: WebAppAuthType,
) -> None:
    requested_app_ids: list[str] = []

    def get_access_mode(app_id: str) -> WebAppSettings:
        requested_app_ids.append(app_id)
        return WebAppSettings(accessMode=access_mode)

    gateway = DeploymentWebPassportAuthGateway(
        webapp_auth_enabled=True,
        get_app_access_mode=get_access_mode,
    )

    assert gateway.get_app_auth_type("app-1") == expected
    assert requested_app_ids == ["app-1"]


def test_passport_token_gateway_delegates_issue_and_verify() -> None:
    passport = _passport()
    gateway = PassportTokenGateway(passport=passport)

    token = gateway.issue({"sub": "account-1"})

    assert gateway.verify(token) == {"sub": "account-1"}


def test_passport_token_gateway_translates_unauthorized() -> None:
    passport = _passport()
    gateway = PassportTokenGateway(passport=passport)
    expired_token = passport.issue({"exp": 0})

    with pytest.raises(WebPassportUnauthorizedError, match="Token has expired"):
        gateway.verify(expired_token)


def test_passport_token_gateway_translates_invalid_token() -> None:
    passport = _passport()
    gateway = PassportTokenGateway(passport=passport)

    with pytest.raises(WebPassportUnauthorizedError, match="Invalid token"):
        gateway.verify("invalid-token")
