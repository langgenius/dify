"""Unit tests for the outer gateways used by web passport issuance."""

from unittest.mock import MagicMock

import pytest
from werkzeug.exceptions import Unauthorized

from services.enterprise.enterprise_service import WebAppAccessMode, WebAppSettings
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebAppAuthType, WebPassportUnauthorizedError


def test_deployment_auth_gateway_reads_deployment_setting() -> None:
    gateway = DeploymentWebPassportAuthGateway(
        webapp_auth_enabled=True,
        get_app_access_mode=MagicMock(),
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
    get_access_mode = MagicMock(return_value=WebAppSettings(accessMode=access_mode))
    gateway = DeploymentWebPassportAuthGateway(
        webapp_auth_enabled=True,
        get_app_access_mode=get_access_mode,
    )

    assert gateway.get_app_auth_type("app-1") == expected
    get_access_mode.assert_called_once_with("app-1")


def test_passport_token_gateway_delegates_issue_and_verify() -> None:
    passport = MagicMock()
    passport.verify.return_value = {"sub": "account-1"}
    passport.issue.return_value = "issued-token"
    gateway = PassportTokenGateway(passport=passport)

    assert gateway.verify("input-token") == {"sub": "account-1"}
    assert gateway.issue({"sub": "account-1"}) == "issued-token"
    passport.verify.assert_called_once_with("input-token")
    passport.issue.assert_called_once_with({"sub": "account-1"})


def test_passport_token_gateway_translates_unauthorized() -> None:
    passport = MagicMock()
    passport.verify.side_effect = Unauthorized("Token has expired.")
    gateway = PassportTokenGateway(passport=passport)

    with pytest.raises(WebPassportUnauthorizedError, match="Token has expired"):
        gateway.verify("expired-token")


def test_passport_token_gateway_defaults_empty_unauthorized_description() -> None:
    passport = MagicMock()
    passport.verify.side_effect = Unauthorized("")
    gateway = PassportTokenGateway(passport=passport)

    with pytest.raises(WebPassportUnauthorizedError, match="Invalid token"):
        gateway.verify("invalid-token")
