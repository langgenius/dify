import inspect
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from jsonschema import Draft202012Validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, UnprocessableEntity

from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeAccountDeletionRateLimitExceededError,
    EmailCodeError,
)
from controllers.console.error import AccountInFreezeError, EmailDomainSuspendedError
from controllers.console.workspace.account import (
    AccountAvatarApi,
    AccountAvatarQuery,
    AccountDeleteApi,
    AccountDeleteVerifyApi,
    AccountInitApi,
    AccountIntegrateApi,
    AccountInterfaceLanguageApi,
    AccountInterfaceThemeApi,
    AccountNameApi,
    AccountPasswordApi,
    AccountProfileApi,
    AccountProfilePatchPayload,
    AccountTimezoneApi,
    ChangeEmailCheckApi,
    ChangeEmailResetApi,
    CheckEmailUnique,
)
from controllers.console.workspace.error import (
    AccountAlreadyInitedError,
    CurrentPasswordIncorrectError,
    InvalidAccountDeletionCodeError,
    InvalidAccountPasswordRequestError,
    MissingInvitationCodeRequestError,
)
from machinery.context import RequestContext
from models import Account, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from services.account_errors import (
    AccountAlreadyInitializedError,
    AccountDeletionRateLimitError,
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    AvatarFileNotFoundError,
    CurrentAccountPasswordIncorrectError,
    InvalidAccountDeletionVerificationError,
    InvalidAccountPasswordError,
    InvalidChangeEmailCodeError,
    MissingInvitationCodeError,
)
from services.entities.account_entities import AccountIntegrationStatus, AccountProfileChanges


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


class TestAccountInitApi:
    def test_init_success(self, app: Flask):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        initialization = MagicMock()
        payload = {
            "interface_language": "en-US",
            "timezone": "UTC",
            "invitation_code": "code123",
        }

        with (
            app.test_request_context("/account/init", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(initialization=initialization)),
            ),
        ):
            resp = method(api, request_context)

        assert resp["result"] == "success"
        initialization.initialize.assert_called_once_with(
            request_context,
            interface_language="en-US",
            timezone="UTC",
            invitation_code="code123",
        )

    def test_init_already_initialized(self, app: Flask):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)

        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        initialization = MagicMock()
        initialization.initialize.side_effect = AccountAlreadyInitializedError
        payload = {"interface_language": "en-US", "timezone": "UTC"}

        with (
            app.test_request_context("/account/init", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(initialization=initialization)),
            ),
        ):
            with pytest.raises(AccountAlreadyInitedError):
                method(api, request_context)

    def test_init_missing_invitation_code_is_mapped(self, app: Flask):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        initialization = MagicMock()
        initialization.initialize.side_effect = MissingInvitationCodeError("invitation_code is required")
        payload = {"interface_language": "en-US", "timezone": "UTC"}

        with (
            app.test_request_context("/account/init", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(initialization=initialization)),
            ),
        ):
            with pytest.raises(MissingInvitationCodeRequestError) as exc_info:
                method(api, request_context)

        assert exc_info.value.data == {
            "code": "missing_invitation_code",
            "message": "Invitation code is required.",
            "status": 400,
        }


class TestAccountProfileApi:
    def test_get_profile_success(self, app: Flask):
        api = AccountProfileApi()
        method = inspect.unwrap(api.get)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        profile = MagicMock()
        profile.get.return_value = user

        with (
            app.test_request_context("/account/profile"),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(profile=profile)),
            ),
        ):
            result = method(api, request_context)

        assert result["id"] == user.id
        profile.get.assert_called_once_with(request_context)


class TestAccountUpdateApis:
    @pytest.mark.parametrize(
        ("api_cls", "payload", "expected_changes"),
        [
            (AccountNameApi, {"name": "test"}, AccountProfileChanges(name="test")),
            (AccountAvatarApi, {"avatar": "img.png"}, AccountProfileChanges(avatar="img.png")),
            (
                AccountInterfaceLanguageApi,
                {"interface_language": "en-US"},
                AccountProfileChanges(interface_language="en-US"),
            ),
            (
                AccountInterfaceThemeApi,
                {"interface_theme": "dark"},
                AccountProfileChanges(interface_theme="dark"),
            ),
            (AccountTimezoneApi, {"timezone": "UTC"}, AccountProfileChanges(timezone="UTC")),
        ],
    )
    def test_deprecated_update_routes_delegate_to_profile_service(
        self, app: Flask, api_cls, payload, expected_changes: AccountProfileChanges
    ):
        api = api_cls()
        method = inspect.unwrap(api.post)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id=None,
        )
        profile = MagicMock()
        profile.update.return_value = user

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(profile=profile)),
            ),
        ):
            result = method(api, request_context)

        assert result["id"] == user.id
        profile.update.assert_called_once_with(request_context, expected_changes)

    def test_deprecated_update_routes_are_marked_deprecated(self):
        for api_cls in (
            AccountNameApi,
            AccountAvatarApi,
            AccountInterfaceLanguageApi,
            AccountInterfaceThemeApi,
            AccountTimezoneApi,
        ):
            assert api_cls.post.__apidoc__["deprecated"] is True


class TestAccountProfilePatchApi:
    def test_json_schema_matches_runtime_patch_rules(self):
        schema = AccountProfilePatchPayload.model_json_schema()
        validator = Draft202012Validator(schema)

        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        assert "required" not in schema
        assert set(schema["properties"]) == {
            "name",
            "avatar",
            "interface_language",
            "interface_theme",
            "timezone",
        }
        validator.validate({})
        validator.validate({"name": "Jane"})
        validator.validate({"name": "Jane", "interface_language": "en-US", "timezone": "UTC"})
        for payload in (
            {"name": None},
            {"unexpected": "value"},
            {"name": "Jane", "unexpected": "value"},
        ):
            assert list(validator.iter_errors(payload))

    def test_updates_multiple_profile_fields(self, app: Flask):
        api = AccountProfileApi()
        method = inspect.unwrap(api.patch)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        profile = MagicMock()
        profile.update.return_value = user
        payload = {"name": "Jane", "interface_language": "en-US", "timezone": "UTC"}
        args = AccountProfilePatchPayload.model_validate(payload)

        with (
            app.test_request_context("/account/profile", method="PATCH", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(profile=profile)),
            ),
        ):
            result = method(api, args, request_context)

        assert result["id"] == user.id
        profile.update.assert_called_once_with(
            request_context,
            AccountProfileChanges(name="Jane", interface_language="en-US", timezone="UTC"),
        )

    def test_empty_patch_is_a_noop(self, app: Flask):
        api = AccountProfileApi()
        method = inspect.unwrap(api.patch)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        profile = MagicMock()
        profile.update.return_value = user
        args = AccountProfilePatchPayload.model_validate({})

        with (
            app.test_request_context("/account/profile", method="PATCH", json={}),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(profile=profile)),
            ),
        ):
            result = method(api, args, request_context)

        assert result["id"] == user.id
        profile.update.assert_called_once_with(request_context, AccountProfileChanges())

    @pytest.mark.parametrize("payload", [{"name": None}, {"unexpected": "value"}])
    def test_rejects_null_or_unknown_changes(self, payload: dict[str, object]):
        with pytest.raises(ValueError):
            AccountProfilePatchPayload.model_validate(payload)


class TestAccountAvatarApiGet:
    def test_get_avatar_delegates_to_service(self, app: Flask):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)
        file_id = "550e8400-e29b-41d4-a716-446655440000"
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        avatar = MagicMock()
        avatar.resolve.return_value = "https://signed/example"

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(avatar=avatar)),
            ),
        ):
            result = method(api, AccountAvatarQuery(avatar=file_id), request_context)

        assert result == {"avatar_url": "https://signed/example"}
        avatar.resolve.assert_called_once_with(request_context, file_id)

    def test_get_avatar_maps_not_found(self, app: Flask):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)
        file_id = "550e8400-e29b-41d4-a716-446655440001"
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        avatar = MagicMock()
        avatar.resolve.side_effect = AvatarFileNotFoundError

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(avatar=avatar)),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, AccountAvatarQuery(avatar=file_id), request_context)

    def test_get_avatar_missing_query_returns_unprocessable_entity(self, app: Flask):
        account = make_account()

        with (
            app.test_request_context("/account/avatar"),
            patch("controllers.console.wraps._is_setup_completed", return_value=True),
            patch("libs.login.dify_config.LOGIN_DISABLED", True),
            patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(account, "workspace-1"),
            ),
            patch(
                "controllers.console.flask_admission.current_account_with_tenant",
                return_value=SimpleNamespace(account=account, tenant_id="workspace-1"),
            ),
        ):
            with pytest.raises(UnprocessableEntity) as exc_info:
                AccountAvatarApi().get()

        assert exc_info.value.code == 422


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
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        password = MagicMock()
        password.change.return_value = user

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(password=password)),
            ),
        ):
            result = method(api, request_context)

        assert result["id"] == user.id
        password.change.assert_called_once_with(
            request_context,
            current_password="old",
            new_password="new123",
        )

    def test_password_wrong_current(self, app: Flask):
        api = AccountPasswordApi()
        method = inspect.unwrap(api.post)

        payload = {
            "password": "bad",
            "new_password": "new123",
            "repeat_new_password": "new123",
        }
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        password = MagicMock()
        password.change.side_effect = CurrentAccountPasswordIncorrectError

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(password=password)),
            ),
        ):
            with pytest.raises(CurrentPasswordIncorrectError):
                method(api, request_context)

    def test_password_policy_error_is_mapped(self, app: Flask):
        api = AccountPasswordApi()
        method = inspect.unwrap(api.post)
        payload = {
            "password": "old",
            "new_password": "letters-only",
            "repeat_new_password": "letters-only",
        }
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        password = MagicMock()
        password.change.side_effect = InvalidAccountPasswordError(
            "Password must contain letters and numbers, and the length must be at least 8 characters."
        )

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(password=password)),
            ),
        ):
            with pytest.raises(InvalidAccountPasswordRequestError) as exc_info:
                method(api, request_context)

        assert exc_info.value.data == {
            "code": "invalid_account_password",
            "message": "Password must contain letters and numbers, and the length must be at least 8 characters.",
            "status": 400,
        }


class TestAccountIntegrateApi:
    def test_get_integrates(self, app: Flask):
        api = AccountIntegrateApi()
        method = inspect.unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        integrations = MagicMock()
        integrations.list.return_value = [
            AccountIntegrationStatus(provider="github", created_at=datetime(2026, 1, 1), is_bound=True),
            AccountIntegrationStatus(provider="google", created_at=None, is_bound=False),
        ]

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(integrations=integrations)),
            ),
        ):
            result = method(api, request_context)

        integrations.list.assert_called_once_with(request_context)
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
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        deletion = MagicMock()
        deletion.issue_verification.return_value = "token"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(deletion=deletion)),
            ),
        ):
            result = method(api, request_context)

        assert result["result"] == "success"
        assert result["data"] == "token"
        deletion.issue_verification.assert_called_once_with(request_context)

    def test_delete_invalid_code(self, app: Flask):
        api = AccountDeleteApi()
        method = inspect.unwrap(api.post)

        payload = {"token": "t", "code": "x"}
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        deletion = MagicMock()
        deletion.request_deletion.side_effect = InvalidAccountDeletionVerificationError

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(deletion=deletion)),
            ),
        ):
            with pytest.raises(InvalidAccountDeletionCodeError):
                method(api, request_context)

    def test_delete_verify_maps_rate_limit(self, app: Flask):
        api = AccountDeleteVerifyApi()
        method = inspect.unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        deletion = MagicMock()
        deletion.issue_verification.side_effect = AccountDeletionRateLimitError(1)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(deletion=deletion)),
            ),
            pytest.raises(EmailCodeAccountDeletionRateLimitExceededError),
        ):
            method(api, request_context)

    def test_delete_success(self, app: Flask):
        api = AccountDeleteApi()
        method = inspect.unwrap(api.post)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        deletion = MagicMock()
        payload = {"token": "token", "code": "123456"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(deletion=deletion)),
            ),
        ):
            result = method(api, request_context)

        assert result["result"] == "success"
        deletion.request_deletion.assert_called_once_with(request_context, token="token", code="123456")


class TestChangeEmailApis:
    def test_check_email_code_invalid(self, app: Flask):
        api = ChangeEmailCheckApi()
        method = inspect.unwrap(api.post)

        payload = {"email": "a@test.com", "code": "x", "token": "t"}
        user = make_account("acc-1")
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        change_email = MagicMock()
        change_email.verify_code.side_effect = InvalidChangeEmailCodeError

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
            ),
        ):
            with pytest.raises(EmailCodeError):
                method(api, request_context)

    def test_reset_email_already_used(self, app: Flask):
        api = ChangeEmailResetApi()
        method = inspect.unwrap(api.post)

        payload = {"new_email": "x@test.com", "token": "t"}
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        change_email = MagicMock()
        change_email.reset.side_effect = AccountEmailAlreadyInUseError

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
            ),
        ):
            with pytest.raises(EmailAlreadyInUseError):
                method(api, request_context)


class TestCheckEmailUniqueApi:
    def test_email_unique_success(self, app: Flask):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

        payload = {"email": "ok@test.com"}
        change_email = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
            ),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_email_in_freeze(self, app: Flask):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

        payload = {"email": "x@test.com"}
        change_email = MagicMock()
        change_email.ensure_available.side_effect = AccountEmailFrozenError

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
            ),
        ):
            with pytest.raises(AccountInFreezeError):
                method(api)

    def test_email_domain_is_suspended(self, app: Flask):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

        payload = {"email": "user@suspended.example"}
        change_email = MagicMock()
        change_email.ensure_available.side_effect = AccountEmailDomainSuspendedError

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.workspace.account.application_services",
                return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
            ),
        ):
            with pytest.raises(EmailDomainSuspendedError):
                method(api)
