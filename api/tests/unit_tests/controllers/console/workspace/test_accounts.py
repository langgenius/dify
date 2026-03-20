from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeError,
)
from controllers.console.error import AccountInFreezeError
from controllers.console.workspace.account import (
    AccountAvatarApi,
    AccountDeleteApi,
    AccountDeleteVerifyApi,
    AccountInitApi,
    AccountIntegrateApi,
    AccountInterfaceLanguageApi,
    AccountInterfaceThemeApi,
    AccountNameApi,
    AccountPasswordApi,
    AccountProfileApi,
    AccountTimezoneApi,
    ChangeEmailCheckApi,
    ChangeEmailResetApi,
    CheckEmailUnique,
)
from controllers.console.workspace.error import (
    AccountAlreadyInitedError,
    CurrentPasswordIncorrectError,
    InvalidAccountDeletionCodeError,
)
from services.errors.account import CurrentPasswordIncorrectError as ServicePwdError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestAccountInitApi:
    def test_init_success(self, app):
        api = AccountInitApi()
        method = unwrap(api.post)

        account = MagicMock(status="inactive")
        payload = {
            "interface_language": "en-US",
            "timezone": "UTC",
            "invitation_code": "code123",
        }

        with (
            app.test_request_context("/account/init", json=payload),
            patch("controllers.console.workspace.account.current_account_with_tenant", return_value=(account, "t1")),
            patch("controllers.console.workspace.account.db.session.commit", return_value=None),
            patch("controllers.console.workspace.account.dify_config.EDITION", "CLOUD"),
            patch("controllers.console.workspace.account.db.session.query") as query_mock,
        ):
            query_mock.return_value.where.return_value.first.return_value = MagicMock(status="unused")
            resp = method(api)

        assert resp["result"] == "success"

    def test_init_already_initialized(self, app):
        api = AccountInitApi()
        method = unwrap(api.post)

        account = MagicMock(status="active")

        with (
            app.test_request_context("/account/init"),
            patch("controllers.console.workspace.account.current_account_with_tenant", return_value=(account, "t1")),
        ):
            with pytest.raises(AccountAlreadyInitedError):
                method(api)


class TestAccountProfileApi:
    def test_get_profile_success(self, app):
        api = AccountProfileApi()
        method = unwrap(api.get)

        user = MagicMock()
        user.id = "u1"
        user.name = "John"
        user.email = "john@test.com"
        user.avatar = "avatar.png"
        user.interface_language = "en-US"
        user.interface_theme = "light"
        user.timezone = "UTC"
        user.last_login_ip = "127.0.0.1"

        with (
            app.test_request_context("/account/profile"),
            patch("controllers.console.workspace.account.current_account_with_tenant", return_value=(user, "t1")),
        ):
            result = method(api)

        assert result["id"] == "u1"


class TestAccountUpdateApis:
    @pytest.mark.parametrize(
        ("api_cls", "payload"),
        [
            (AccountNameApi, {"name": "test"}),
            (AccountAvatarApi, {"avatar": "img.png"}),
            (AccountInterfaceLanguageApi, {"interface_language": "en-US"}),
            (AccountInterfaceThemeApi, {"interface_theme": "dark"}),
            (AccountTimezoneApi, {"timezone": "UTC"}),
        ],
    )
    def test_update_success(self, app, api_cls, payload):
        api = api_cls()
        method = unwrap(api.post)

        user = MagicMock()
        user.id = "u1"
        user.name = "John"
        user.email = "john@test.com"
        user.avatar = "avatar.png"
        user.interface_language = "en-US"
        user.interface_theme = "light"
        user.timezone = "UTC"
        user.last_login_ip = "127.0.0.1"

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.account.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.account.AccountService.update_account", return_value=user),
        ):
            result = method(api)

        assert result["id"] == "u1"


class TestAccountPasswordApi:
    def test_password_success(self, app):
        api = AccountPasswordApi()
        method = unwrap(api.post)

        payload = {
            "password": "old",
            "new_password": "new123",
            "repeat_new_password": "new123",
        }

        user = MagicMock()
        user.id = "u1"
        user.name = "John"
        user.email = "john@test.com"
        user.avatar = "avatar.png"
        user.interface_language = "en-US"
        user.interface_theme = "light"
        user.timezone = "UTC"
        user.last_login_ip = "127.0.0.1"

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.account.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.account.AccountService.update_account_password", return_value=None),
        ):
            result = method(api)

        assert result["id"] == "u1"

    def test_password_wrong_current(self, app):
        api = AccountPasswordApi()
        method = unwrap(api.post)

        payload = {
            "password": "bad",
            "new_password": "new123",
            "repeat_new_password": "new123",
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch(
                "controllers.console.workspace.account.AccountService.update_account_password",
                side_effect=ServicePwdError(),
            ),
        ):
            with pytest.raises(CurrentPasswordIncorrectError):
                method(api)


class TestAccountIntegrateApi:
    def test_get_integrates(self, app):
        api = AccountIntegrateApi()
        method = unwrap(api.get)

        account = MagicMock(id="acc1")

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.account.current_account_with_tenant", return_value=(account, "t1")),
            patch("controllers.console.workspace.account.db.session.scalars") as scalars_mock,
        ):
            scalars_mock.return_value.all.return_value = []
            result = method(api)

        assert "data" in result
        assert len(result["data"]) == 2


class TestAccountDeleteApi:
    def test_delete_verify_success(self, app):
        api = AccountDeleteVerifyApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch(
                "controllers.console.workspace.account.AccountService.generate_account_deletion_verification_code",
                return_value=("token", "1234"),
            ),
            patch(
                "controllers.console.workspace.account.AccountService.send_account_deletion_verification_email",
                return_value=None,
            ),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_delete_invalid_code(self, app):
        api = AccountDeleteApi()
        method = unwrap(api.post)

        payload = {"token": "t", "code": "x"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant", return_value=(MagicMock(), "t1")
            ),
            patch(
                "controllers.console.workspace.account.AccountService.verify_account_deletion_code",
                return_value=False,
            ),
        ):
            with pytest.raises(InvalidAccountDeletionCodeError):
                method(api)


class TestChangeEmailApis:
    def test_check_email_code_invalid(self, app):
        api = ChangeEmailCheckApi()
        method = unwrap(api.post)

        payload = {"email": "a@test.com", "code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.workspace.account.AccountService.is_change_email_error_rate_limit",
                return_value=False,
            ),
            patch(
                "controllers.console.workspace.account.AccountService.get_change_email_data",
                return_value={"email": "a@test.com", "code": "y"},
            ),
        ):
            with pytest.raises(EmailCodeError):
                method(api)

    def test_reset_email_already_used(self, app):
        api = ChangeEmailResetApi()
        method = unwrap(api.post)

        payload = {"new_email": "x@test.com", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch("controllers.console.workspace.account.AccountService.is_account_in_freeze", return_value=False),
            patch("controllers.console.workspace.account.AccountService.check_email_unique", return_value=False),
        ):
            with pytest.raises(EmailAlreadyInUseError):
                method(api)


class TestCheckEmailUniqueApi:
    def test_email_unique_success(self, app):
        api = CheckEmailUnique()
        method = unwrap(api.post)

        payload = {"email": "ok@test.com"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch("controllers.console.workspace.account.AccountService.is_account_in_freeze", return_value=False),
            patch("controllers.console.workspace.account.AccountService.check_email_unique", return_value=True),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_email_in_freeze(self, app):
        api = CheckEmailUnique()
        method = unwrap(api.post)

        payload = {"email": "x@test.com"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch("controllers.console.workspace.account.AccountService.is_account_in_freeze", return_value=True),
        ):
            with pytest.raises(AccountInFreezeError):
                method(api)
