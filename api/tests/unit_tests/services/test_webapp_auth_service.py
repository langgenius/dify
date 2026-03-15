from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from werkzeug.exceptions import NotFound, Unauthorized

from models import Account, AccountStatus
from services.errors.account import AccountLoginError, AccountNotFoundError, AccountPasswordError
from services.webapp_auth_service import WebAppAuthService, WebAppAuthType

ACCOUNT_LOOKUP_PATH = "services.webapp_auth_service.AccountService.get_account_by_email_with_case_fallback"
TOKEN_GENERATE_PATH = "services.webapp_auth_service.TokenManager.generate_token"
TOKEN_GET_DATA_PATH = "services.webapp_auth_service.TokenManager.get_token_data"


def _account(**kwargs: Any) -> Account:
    return cast(Account, SimpleNamespace(**kwargs))


@pytest.fixture
def mock_db(mocker: MockerFixture) -> MagicMock:
    # Arrange
    mocked_db = mocker.patch("services.webapp_auth_service.db")
    mocked_db.session = MagicMock()
    return mocked_db


def test_authenticate_should_raise_account_not_found_when_email_does_not_exist(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch(ACCOUNT_LOOKUP_PATH, return_value=None)

    # Act + Assert
    with pytest.raises(AccountNotFoundError):
        WebAppAuthService.authenticate("user@example.com", "pwd")


def test_authenticate_should_raise_account_login_error_when_account_is_banned(mocker: MockerFixture) -> None:
    # Arrange
    account = SimpleNamespace(status=AccountStatus.BANNED, password="hash", password_salt="salt")
    mocker.patch(
        ACCOUNT_LOOKUP_PATH,
        return_value=account,
    )

    # Act + Assert
    with pytest.raises(AccountLoginError, match="Account is banned"):
        WebAppAuthService.authenticate("user@example.com", "pwd")


@pytest.mark.parametrize("password_value", [None, "hash"])
def test_authenticate_should_raise_password_error_when_password_is_invalid(
    password_value: str | None,
    mocker: MockerFixture,
) -> None:
    # Arrange
    account = SimpleNamespace(status=AccountStatus.ACTIVE, password=password_value, password_salt="salt")
    mocker.patch(
        ACCOUNT_LOOKUP_PATH,
        return_value=account,
    )
    mocker.patch("services.webapp_auth_service.compare_password", return_value=False)

    # Act + Assert
    with pytest.raises(AccountPasswordError, match="Invalid email or password"):
        WebAppAuthService.authenticate("user@example.com", "pwd")


def test_authenticate_should_return_account_when_credentials_are_valid(mocker: MockerFixture) -> None:
    # Arrange
    account = SimpleNamespace(status=AccountStatus.ACTIVE, password="hash", password_salt="salt")
    mocker.patch(
        ACCOUNT_LOOKUP_PATH,
        return_value=account,
    )
    mocker.patch("services.webapp_auth_service.compare_password", return_value=True)

    # Act
    result = WebAppAuthService.authenticate("user@example.com", "pwd")

    # Assert
    assert result is account


def test_login_should_return_token_from_internal_token_builder(mocker: MockerFixture) -> None:
    # Arrange
    account = _account(id="a1", email="u@example.com")
    mock_get_token = mocker.patch.object(WebAppAuthService, "_get_account_jwt_token", return_value="jwt-token")

    # Act
    result = WebAppAuthService.login(account)

    # Assert
    assert result == "jwt-token"
    mock_get_token.assert_called_once_with(account=account)


def test_get_user_through_email_should_return_none_when_account_not_found(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch(ACCOUNT_LOOKUP_PATH, return_value=None)

    # Act
    result = WebAppAuthService.get_user_through_email("missing@example.com")

    # Assert
    assert result is None


def test_get_user_through_email_should_raise_unauthorized_when_account_banned(mocker: MockerFixture) -> None:
    # Arrange
    account = SimpleNamespace(status=AccountStatus.BANNED)
    mocker.patch(
        ACCOUNT_LOOKUP_PATH,
        return_value=account,
    )

    # Act + Assert
    with pytest.raises(Unauthorized, match="Account is banned"):
        WebAppAuthService.get_user_through_email("user@example.com")


def test_get_user_through_email_should_return_account_when_active(mocker: MockerFixture) -> None:
    # Arrange
    account = SimpleNamespace(status=AccountStatus.ACTIVE)
    mocker.patch(
        ACCOUNT_LOOKUP_PATH,
        return_value=account,
    )

    # Act
    result = WebAppAuthService.get_user_through_email("user@example.com")

    # Assert
    assert result is account


def test_send_email_code_login_email_should_raise_error_when_email_not_provided() -> None:
    # Arrange
    # Act + Assert
    with pytest.raises(ValueError, match="Email must be provided"):
        WebAppAuthService.send_email_code_login_email(account=None, email=None)


def test_send_email_code_login_email_should_generate_token_and_send_mail_for_account(
    mocker: MockerFixture,
) -> None:
    # Arrange
    account = _account(email="user@example.com")
    mocker.patch("services.webapp_auth_service.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6])
    mock_generate_token = mocker.patch(TOKEN_GENERATE_PATH, return_value="token-1")
    mock_delay = mocker.patch("services.webapp_auth_service.send_email_code_login_mail_task.delay")

    # Act
    result = WebAppAuthService.send_email_code_login_email(account=account, language="en-US")

    # Assert
    assert result == "token-1"
    mock_generate_token.assert_called_once()
    assert mock_generate_token.call_args.kwargs["additional_data"] == {"code": "123456"}
    mock_delay.assert_called_once_with(language="en-US", to="user@example.com", code="123456")


def test_send_email_code_login_email_should_send_mail_for_email_without_account(
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch("services.webapp_auth_service.secrets.randbelow", side_effect=[0, 0, 0, 0, 0, 0])
    mocker.patch(TOKEN_GENERATE_PATH, return_value="token-2")
    mock_delay = mocker.patch("services.webapp_auth_service.send_email_code_login_mail_task.delay")

    # Act
    result = WebAppAuthService.send_email_code_login_email(account=None, email="alt@example.com", language="zh-Hans")

    # Assert
    assert result == "token-2"
    mock_delay.assert_called_once_with(language="zh-Hans", to="alt@example.com", code="000000")


def test_get_email_code_login_data_should_delegate_to_token_manager(mocker: MockerFixture) -> None:
    # Arrange
    mock_get_data = mocker.patch(TOKEN_GET_DATA_PATH, return_value={"code": "123"})

    # Act
    result = WebAppAuthService.get_email_code_login_data("token-abc")

    # Assert
    assert result == {"code": "123"}
    mock_get_data.assert_called_once_with("token-abc", "email_code_login")


def test_revoke_email_code_login_token_should_delegate_to_token_manager(mocker: MockerFixture) -> None:
    # Arrange
    mock_revoke = mocker.patch("services.webapp_auth_service.TokenManager.revoke_token")

    # Act
    WebAppAuthService.revoke_email_code_login_token("token-xyz")

    # Assert
    mock_revoke.assert_called_once_with("token-xyz", "email_code_login")


def test_create_end_user_should_raise_not_found_when_site_does_not_exist(mock_db: MagicMock) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(NotFound, match="Site not found"):
        WebAppAuthService.create_end_user("app-code", "user@example.com")


def test_create_end_user_should_raise_not_found_when_app_does_not_exist(mock_db: MagicMock) -> None:
    # Arrange
    site = SimpleNamespace(app_id="app-1")
    app_query = MagicMock()
    app_query.where.return_value.first.return_value = None
    mock_db.session.query.return_value.where.return_value.first.side_effect = [site, None]

    # Act + Assert
    with pytest.raises(NotFound, match="App not found"):
        WebAppAuthService.create_end_user("app-code", "user@example.com")


def test_create_end_user_should_create_and_commit_end_user_when_data_is_valid(mock_db: MagicMock) -> None:
    # Arrange
    site = SimpleNamespace(app_id="app-1")
    app_model = SimpleNamespace(tenant_id="tenant-1", id="app-1")
    mock_db.session.query.return_value.where.return_value.first.side_effect = [site, app_model]

    # Act
    result = WebAppAuthService.create_end_user("app-code", "user@example.com")

    # Assert
    assert result.tenant_id == "tenant-1"
    assert result.app_id == "app-1"
    assert result.session_id == "user@example.com"
    mock_db.session.add.assert_called_once()
    mock_db.session.commit.assert_called_once()


def test_get_account_jwt_token_should_build_payload_and_issue_token(mocker: MockerFixture) -> None:
    # Arrange
    account = _account(id="a1", email="user@example.com")
    mocker.patch("services.webapp_auth_service.dify_config.ACCESS_TOKEN_EXPIRE_MINUTES", 60)
    mock_issue = mocker.patch("services.webapp_auth_service.PassportService.issue", return_value="jwt-1")

    # Act
    token = WebAppAuthService._get_account_jwt_token(account)

    # Assert
    assert token == "jwt-1"
    payload = mock_issue.call_args.args[0]
    assert payload["user_id"] == "a1"
    assert payload["session_id"] == "user@example.com"
    assert payload["token_source"] == "webapp_login_token"
    assert payload["auth_type"] == "internal"
    assert payload["exp"] > int(datetime.now(UTC).timestamp())


@pytest.mark.parametrize(
    ("access_mode", "expected"),
    [
        ("private", True),
        ("private_all", True),
        ("public", False),
    ],
)
def test_is_app_require_permission_check_should_use_access_mode_when_provided(
    access_mode: str,
    expected: bool,
) -> None:
    # Arrange
    # Act
    result = WebAppAuthService.is_app_require_permission_check(access_mode=access_mode)

    # Assert
    assert result is expected


def test_is_app_require_permission_check_should_raise_when_no_identifier_provided() -> None:
    # Arrange
    # Act + Assert
    with pytest.raises(ValueError, match="Either app_code or app_id must be provided"):
        WebAppAuthService.is_app_require_permission_check()


def test_is_app_require_permission_check_should_raise_when_app_id_cannot_be_determined(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch("services.webapp_auth_service.AppService.get_app_id_by_code", return_value=None)

    # Act + Assert
    with pytest.raises(ValueError, match="App ID could not be determined"):
        WebAppAuthService.is_app_require_permission_check(app_code="app-code")


def test_is_app_require_permission_check_should_return_true_when_enterprise_mode_requires_it(
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch("services.webapp_auth_service.AppService.get_app_id_by_code", return_value="app-1")
    mocker.patch(
        "services.webapp_auth_service.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        return_value=SimpleNamespace(access_mode="private"),
    )

    # Act
    result = WebAppAuthService.is_app_require_permission_check(app_code="app-code")

    # Assert
    assert result is True


def test_is_app_require_permission_check_should_return_false_when_enterprise_settings_do_not_require_it(
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch(
        "services.webapp_auth_service.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        return_value=SimpleNamespace(access_mode="public"),
    )

    # Act
    result = WebAppAuthService.is_app_require_permission_check(app_id="app-1")

    # Assert
    assert result is False


@pytest.mark.parametrize(
    ("access_mode", "expected"),
    [
        ("public", WebAppAuthType.PUBLIC),
        ("private", WebAppAuthType.INTERNAL),
        ("private_all", WebAppAuthType.INTERNAL),
        ("sso_verified", WebAppAuthType.EXTERNAL),
    ],
)
def test_get_app_auth_type_should_map_access_modes_correctly(
    access_mode: str,
    expected: WebAppAuthType,
) -> None:
    # Arrange
    # Act
    result = WebAppAuthService.get_app_auth_type(access_mode=access_mode)

    # Assert
    assert result == expected


def test_get_app_auth_type_should_resolve_from_app_code(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch("services.webapp_auth_service.AppService.get_app_id_by_code", return_value="app-1")
    mocker.patch(
        "services.webapp_auth_service.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
        return_value=SimpleNamespace(access_mode="private_all"),
    )

    # Act
    result = WebAppAuthService.get_app_auth_type(app_code="app-code")

    # Assert
    assert result == WebAppAuthType.INTERNAL


def test_get_app_auth_type_should_raise_when_no_input_provided() -> None:
    # Arrange
    # Act + Assert
    with pytest.raises(ValueError, match="Either app_code or access_mode must be provided"):
        WebAppAuthService.get_app_auth_type()


def test_get_app_auth_type_should_raise_when_cannot_determine_type_from_invalid_mode() -> None:
    # Arrange
    # Act + Assert
    with pytest.raises(ValueError, match="Could not determine app authentication type"):
        WebAppAuthService.get_app_auth_type(access_mode="unknown")
