from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from werkzeug.exceptions import NotFound

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
from models.enums import CreatorUserRole
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
            patch("controllers.console.workspace.account.db.session.scalar") as scalar_mock,
        ):
            scalar_mock.return_value = MagicMock(status="unused")
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


class TestAccountAvatarApiGet:
    """GET /account/avatar must not sign arbitrary upload_file IDs (IDOR)."""

    def test_get_avatar_signed_url_when_upload_owned_by_current_account(self, app):
        api = AccountAvatarApi()
        method = unwrap(api.get)

        user = MagicMock()
        user.id = "acc-owner"
        tenant_id = "tenant-1"
        file_id = "550e8400-e29b-41d4-a716-446655440000"

        upload_file = MagicMock()
        upload_file.id = file_id
        upload_file.tenant_id = tenant_id
        upload_file.created_by = user.id
        upload_file.created_by_role = CreatorUserRole.ACCOUNT

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch("controllers.console.workspace.account.db.session.scalar", return_value=upload_file),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/example",
            ) as sign_mock,
        ):
            result = method(api)

        assert result == {"avatar_url": "https://signed/example"}
        sign_mock.assert_called_once_with(upload_file_id=file_id)

    def test_get_avatar_not_found_when_upload_created_by_other_account_same_tenant(self, app):
        api = AccountAvatarApi()
        method = unwrap(api.get)

        user = MagicMock()
        user.id = "acc-a"
        tenant_id = "tenant-1"
        file_id = "550e8400-e29b-41d4-a716-446655440001"

        upload_file = MagicMock()
        upload_file.id = file_id
        upload_file.tenant_id = tenant_id
        upload_file.created_by = "acc-b"
        upload_file.created_by_role = CreatorUserRole.ACCOUNT

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch("controllers.console.workspace.account.db.session.scalar", return_value=upload_file),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/leak",
            ) as sign_mock,
        ):
            with pytest.raises(NotFound):
                method(api)

        sign_mock.assert_not_called()

    def test_get_avatar_not_found_when_upload_belongs_to_other_tenant(self, app):
        api = AccountAvatarApi()
        method = unwrap(api.get)

        user = MagicMock()
        user.id = "acc-owner"
        tenant_id = "tenant-1"
        file_id = "550e8400-e29b-41d4-a716-446655440002"

        upload_file = MagicMock()
        upload_file.id = file_id
        upload_file.tenant_id = "tenant-other"
        upload_file.created_by = user.id
        upload_file.created_by_role = CreatorUserRole.ACCOUNT

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch("controllers.console.workspace.account.db.session.scalar", return_value=upload_file),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/leak",
            ) as sign_mock,
        ):
            with pytest.raises(NotFound):
                method(api)

        sign_mock.assert_not_called()

    def test_get_avatar_https_pass_through_without_signing(self, app):
        api = AccountAvatarApi()
        method = unwrap(api.get)

        user = MagicMock()
        user.id = "acc-owner"
        tenant_id = "tenant-1"
        external = "https://cdn.example/avatar.png"

        with (
            app.test_request_context(f"/account/avatar?avatar={external}"),
            patch(
                "controllers.console.workspace.account.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/should-not-use",
            ) as sign_mock,
        ):
            result = method(api)

        assert result == {"avatar_url": external}
        sign_mock.assert_not_called()


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
