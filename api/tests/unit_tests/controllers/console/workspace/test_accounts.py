import inspect
from datetime import UTC, datetime
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from sqlalchemy.orm import Session
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
from extensions.storage.storage_type import StorageType
from models import Account, AccountIntegrate, InvitationCode, Tenant, TenantAccountJoin
from models.account import AccountStatus, InvitationCodeStatus, TenantAccountRole
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.errors.account import CurrentPasswordIncorrectError as ServicePwdError


def make_account(account_id: str = "u1", *, status: AccountStatus = AccountStatus.ACTIVE) -> Account:
    account = Account(name="John", email=f"{account_id}@test.com", status=status)
    account.id = str(uuid5(NAMESPACE_URL, f"account:{account_id}"))
    account.avatar = "avatar.png"
    account.interface_language = "en-US"
    account.interface_theme = "light"
    account.timezone = "UTC"
    account.last_login_ip = "127.0.0.1"
    return account


def persist_account_with_tenant(
    session: Session,
    account_id: str = "u1",
    *,
    status: AccountStatus = AccountStatus.ACTIVE,
    tenant_id: str = "tenant-1",
) -> tuple[Account, Tenant]:
    account = make_account(account_id, status=status)
    tenant = Tenant(name=tenant_id)
    tenant.id = str(uuid5(NAMESPACE_URL, f"tenant:{tenant_id}"))
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    session.add_all([account, tenant, membership])
    session.commit()
    account._current_tenant = tenant
    account.role = TenantAccountRole.OWNER
    return account, tenant


def make_upload_file(*, tenant_id: str, created_by: str) -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="avatar.png",
        name="avatar.png",
        size=128,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )


class TestAccountInitApi:
    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin, InvitationCode)],
        indirect=True,
    )
    def test_init_success(self, app: Flask, sqlite_session: Session):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)

        account, tenant = persist_account_with_tenant(
            sqlite_session,
            status=AccountStatus.UNINITIALIZED,
        )
        invitation_code = InvitationCode(batch="batch-1", code="code123")
        sqlite_session.add(invitation_code)
        sqlite_session.commit()
        payload = {
            "interface_language": "en-US",
            "timezone": "UTC",
            "invitation_code": "code123",
        }

        with (
            app.test_request_context("/account/init", json=payload),
            patch("controllers.console.workspace.account.dify_config.EDITION", "CLOUD"),
            patch("controllers.console.workspace.account.db.session", sqlite_session),
        ):
            resp = method(api, account)

        assert resp["result"] == "success"
        sqlite_session.expire_all()
        persisted_account = sqlite_session.get(Account, account.id)
        persisted_invitation = sqlite_session.get(InvitationCode, invitation_code.id)
        assert persisted_account is not None
        assert persisted_account.status == AccountStatus.ACTIVE
        assert persisted_account.interface_language == "en-US"
        assert persisted_account.timezone == "UTC"
        assert persisted_account.initialized_at is not None
        assert persisted_invitation is not None
        assert persisted_invitation.status == InvitationCodeStatus.USED
        assert persisted_invitation.used_by_account_id == account.id
        assert persisted_invitation.used_by_tenant_id == tenant.id

    def test_init_already_initialized(self, app: Flask):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)

        account = make_account()

        with app.test_request_context("/account/init"):
            with pytest.raises(AccountAlreadyInitedError):
                method(api, account)


class TestAccountProfileApi:
    def test_get_profile_success(self, app: Flask):
        api = AccountProfileApi()
        method = inspect.unwrap(api.get)

        user = make_account()

        with app.test_request_context("/account/profile"):
            result = method(api, user)

        assert result["id"] == user.id


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
    def test_update_success(self, app: Flask, api_cls, payload):
        api = api_cls()
        method = inspect.unwrap(api.post)

        user = make_account()

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.account.AccountService.update_account", return_value=user),
        ):
            result = method(api, user)

        assert result["id"] == user.id


class TestAccountAvatarApiGet:
    """GET /account/avatar must not sign arbitrary upload_file IDs (IDOR)."""

    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin, UploadFile)],
        indirect=True,
    )
    def test_get_avatar_signed_url_when_upload_owned_by_current_account(self, app: Flask, sqlite_session: Session):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)

        user, tenant = persist_account_with_tenant(sqlite_session, "acc-owner")
        tenant_id = tenant.id
        file_id = "550e8400-e29b-41d4-a716-446655440000"

        upload_file = make_upload_file(tenant_id=tenant_id, created_by=user.id)
        upload_file.id = file_id
        sqlite_session.add(upload_file)
        sqlite_session.commit()

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch("controllers.console.workspace.account.db.session", sqlite_session),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/example",
            ) as sign_mock,
        ):
            result = method(api, tenant_id, user)

        assert result == {"avatar_url": "https://signed/example"}
        sign_mock.assert_called_once_with(upload_file_id=file_id)

    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin, UploadFile)],
        indirect=True,
    )
    def test_get_avatar_not_found_when_upload_created_by_other_account_same_tenant(
        self, app: Flask, sqlite_session: Session
    ):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)

        user, tenant = persist_account_with_tenant(sqlite_session, "acc-a")
        tenant_id = tenant.id
        file_id = "550e8400-e29b-41d4-a716-446655440001"

        other_account = make_account("acc-b")
        other_membership = TenantAccountJoin(
            tenant_id=tenant_id,
            account_id=other_account.id,
            role=TenantAccountRole.NORMAL,
        )
        upload_file = make_upload_file(tenant_id=tenant_id, created_by=other_account.id)
        upload_file.id = file_id
        sqlite_session.add_all([other_account, other_membership, upload_file])
        sqlite_session.commit()

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch("controllers.console.workspace.account.db.session", sqlite_session),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/leak",
            ) as sign_mock,
        ):
            with pytest.raises(NotFound):
                method(api, tenant_id, user)

        sign_mock.assert_not_called()

    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin, UploadFile)],
        indirect=True,
    )
    def test_get_avatar_not_found_when_upload_belongs_to_other_tenant(self, app: Flask, sqlite_session: Session):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)

        user, tenant = persist_account_with_tenant(sqlite_session, "acc-owner")
        tenant_id = tenant.id
        file_id = "550e8400-e29b-41d4-a716-446655440002"

        other_tenant = Tenant(name="tenant-other")
        other_tenant.id = str(uuid5(NAMESPACE_URL, "tenant:tenant-other"))
        upload_file = make_upload_file(tenant_id=other_tenant.id, created_by=user.id)
        upload_file.id = file_id
        sqlite_session.add_all([other_tenant, upload_file])
        sqlite_session.commit()

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch("controllers.console.workspace.account.db.session", sqlite_session),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/leak",
            ) as sign_mock,
        ):
            with pytest.raises(NotFound):
                method(api, tenant_id, user)

        sign_mock.assert_not_called()

    def test_get_avatar_https_pass_through_without_signing(self, app: Flask):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)

        user = make_account("acc-owner")
        tenant_id = "tenant-1"
        external = "https://cdn.example/avatar.png"

        with (
            app.test_request_context(f"/account/avatar?avatar={external}"),
            patch(
                "controllers.console.workspace.account.file_helpers.get_signed_file_url",
                return_value="https://signed/should-not-use",
            ) as sign_mock,
        ):
            result = method(api, tenant_id, user)

        assert result == {"avatar_url": external}
        sign_mock.assert_not_called()


class TestAccountPasswordApi:
    def test_password_success(self, app: Flask):
        api = AccountPasswordApi()
        method = inspect.unwrap(api.post)

        payload = {
            "password": "old",
            "new_password": "new123",
            "repeat_new_password": "new123",
        }

        user = make_account()

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.account.AccountService.update_account_password", return_value=None),
        ):
            result = method(api, user)

        assert result["id"] == user.id

    def test_password_wrong_current(self, app: Flask):
        api = AccountPasswordApi()
        method = inspect.unwrap(api.post)

        payload = {
            "password": "bad",
            "new_password": "new123",
            "repeat_new_password": "new123",
        }
        user = make_account()

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.AccountService.update_account_password",
                side_effect=ServicePwdError(),
            ),
        ):
            with pytest.raises(CurrentPasswordIncorrectError):
                method(api, user)


class TestAccountIntegrateApi:
    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin, AccountIntegrate)],
        indirect=True,
    )
    def test_get_integrates(self, app: Flask, sqlite_session: Session):
        api = AccountIntegrateApi()
        method = inspect.unwrap(api.get)

        account, _ = persist_account_with_tenant(sqlite_session, "acc1")
        sqlite_session.add(
            AccountIntegrate(
                account_id=account.id,
                provider="github",
                open_id="github-user",
                encrypted_token="encrypted-token",
            )
        )
        sqlite_session.commit()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.account.db.session", sqlite_session),
        ):
            result = method(api, account)

        assert result["data"][0]["provider"] == "github"
        assert result["data"][0]["is_bound"] is True
        assert result["data"][0]["link"] is None
        assert result["data"][1]["provider"] == "google"
        assert result["data"][1]["is_bound"] is False
        assert result["data"][1]["link"].endswith("/console/api/oauth/login/google")


class TestAccountDeleteApi:
    def test_delete_verify_success(self, app: Flask):
        api = AccountDeleteVerifyApi()
        method = inspect.unwrap(api.get)
        user = make_account()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.account.AccountService.generate_account_deletion_verification_code",
                return_value=("token", "1234"),
            ),
            patch(
                "controllers.console.workspace.account.AccountService.send_account_deletion_verification_email",
                return_value=None,
            ),
        ):
            result = method(api, user)

        assert result["result"] == "success"

    def test_delete_invalid_code(self, app: Flask):
        api = AccountDeleteApi()
        method = inspect.unwrap(api.post)

        payload = {"token": "t", "code": "x"}
        user = make_account()

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.AccountService.verify_account_deletion_code",
                return_value=False,
            ),
        ):
            with pytest.raises(InvalidAccountDeletionCodeError):
                method(api, user)


class TestChangeEmailApis:
    def test_check_email_code_invalid(self, app: Flask):
        api = ChangeEmailCheckApi()
        method = inspect.unwrap(api.post)

        payload = {"email": "a@test.com", "code": "x", "token": "t"}
        user = make_account("acc-1")

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
                return_value=MagicMock(
                    email="a@test.com",
                    code="y",
                    is_bound_to_account=MagicMock(return_value=True),
                ),
            ),
        ):
            with pytest.raises(EmailCodeError):
                method(api, user)

    def test_reset_email_already_used(self, app: Flask):
        api = ChangeEmailResetApi()
        method = inspect.unwrap(api.post)

        payload = {"new_email": "x@test.com", "token": "t"}
        user = make_account()

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
                method(api, user)


class TestCheckEmailUniqueApi:
    def test_email_unique_success(self, app: Flask):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

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

    def test_email_in_freeze(self, app: Flask):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

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
