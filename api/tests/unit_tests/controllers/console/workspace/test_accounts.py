import inspect
from collections.abc import Iterator
from datetime import datetime
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
from controllers.console.error import (
    AccountInFreezeError,
    EmailDomainSuspendedError,
    InvalidAccountPasswordRequestError,
)
from controllers.console.workspace.account import (
    AccountAvatarApi,
    AccountAvatarPayload,
    AccountAvatarQuery,
    AccountDeleteApi,
    AccountDeletePayload,
    AccountDeleteVerifyApi,
    AccountInitApi,
    AccountInitPayload,
    AccountIntegrateApi,
    AccountInterfaceLanguageApi,
    AccountInterfaceLanguagePayload,
    AccountInterfaceThemeApi,
    AccountInterfaceThemePayload,
    AccountNameApi,
    AccountNamePayload,
    AccountPasswordApi,
    AccountPasswordPayload,
    AccountProfileApi,
    AccountProfilePatchPayload,
    AccountTimezoneApi,
    AccountTimezonePayload,
    ChangeEmailCheckApi,
    ChangeEmailResetApi,
    ChangeEmailResetPayload,
    ChangeEmailValidityPayload,
    CheckEmailUnique,
    CheckEmailUniquePayload,
)
from controllers.console.workspace.error import (
    AccountAlreadyInitedError,
    CurrentPasswordIncorrectError,
    InvalidAccountDeletionCodeError,
    MissingInvitationCodeRequestError,
)
from extensions.application_services.account import AccountServices
from extensions.ext_application_services import ApplicationServices
from libs.login import AccountWithTenant
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
from tests.unit_tests.config_override import config_overrides_context


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


@pytest.fixture
def account_services(
    account_application_services: ApplicationServices,
) -> Iterator[AccountServices]:
    """Use the real application-service composition root in controller tests."""
    with patch(
        "controllers.console.workspace.account.application_services",
        return_value=account_application_services,
    ):
        yield account_application_services.accounts


class TestAccountInitApi:
    def test_init_success(self, app: Flask, account_services: AccountServices):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        initialize_calls: list[tuple[RequestContext, str, str, str | None]] = []

        def initialize(
            context: RequestContext,
            *,
            interface_language: str,
            timezone: str,
            invitation_code: str | None,
        ) -> None:
            initialize_calls.append((context, interface_language, timezone, invitation_code))

        payload = {
            "interface_language": "en-US",
            "timezone": "UTC",
            "invitation_code": "code123",
        }

        with (
            app.test_request_context("/account/init", json=payload),
            patch.object(account_services.initialization, "initialize", initialize),
        ):
            resp = method(api, AccountInitPayload.model_validate(payload), request_context)

        assert resp["result"] == "success"
        assert initialize_calls == [(request_context, "en-US", "UTC", "code123")]

    def test_init_already_initialized(self, app: Flask, account_services: AccountServices):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)

        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )

        def initialize(*_args: object, **_kwargs: object) -> None:
            raise AccountAlreadyInitializedError

        payload = {"interface_language": "en-US", "timezone": "UTC"}

        with (
            app.test_request_context("/account/init", json=payload),
            patch.object(account_services.initialization, "initialize", initialize),
        ):
            with pytest.raises(AccountAlreadyInitedError):
                method(api, AccountInitPayload.model_validate(payload), request_context)

    def test_init_missing_invitation_code_is_mapped(self, app: Flask, account_services: AccountServices):
        api = AccountInitApi()
        method = inspect.unwrap(api.post)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )

        def initialize(*_args: object, **_kwargs: object) -> None:
            raise MissingInvitationCodeError("invitation_code is required")

        payload = {"interface_language": "en-US", "timezone": "UTC"}

        with (
            app.test_request_context("/account/init", json=payload),
            patch.object(account_services.initialization, "initialize", initialize),
        ):
            with pytest.raises(MissingInvitationCodeRequestError) as exc_info:
                method(api, AccountInitPayload.model_validate(payload), request_context)

        assert exc_info.value.data == {
            "code": "missing_invitation_code",
            "message": "Invitation code is required.",
            "status": 400,
        }


class TestAccountProfileApi:
    def test_get_profile_success(self, app: Flask, account_services: AccountServices):
        api = AccountProfileApi()
        method = inspect.unwrap(api.get)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        get_profile = MagicMock(return_value=user)

        with (
            app.test_request_context("/account/profile"),
            patch.object(account_services.profile, "get", get_profile),
        ):
            result = method(api, request_context)

        assert result["id"] == user.id
        get_profile.assert_called_once_with(request_context)


class TestAccountUpdateApis:
    @pytest.mark.parametrize(
        ("api_cls", "payload_model", "payload", "expected_changes"),
        [
            (AccountNameApi, AccountNamePayload, {"name": "test"}, AccountProfileChanges(name="test")),
            (AccountAvatarApi, AccountAvatarPayload, {"avatar": "img.png"}, AccountProfileChanges(avatar="img.png")),
            (
                AccountInterfaceLanguageApi,
                AccountInterfaceLanguagePayload,
                {"interface_language": "en-US"},
                AccountProfileChanges(interface_language="en-US"),
            ),
            (
                AccountInterfaceThemeApi,
                AccountInterfaceThemePayload,
                {"interface_theme": "dark"},
                AccountProfileChanges(interface_theme="dark"),
            ),
            (AccountTimezoneApi, AccountTimezonePayload, {"timezone": "UTC"}, AccountProfileChanges(timezone="UTC")),
        ],
    )
    def test_deprecated_update_routes_delegate_to_profile_service(
        self,
        app: Flask,
        account_services: AccountServices,
        api_cls,
        payload_model,
        payload,
        expected_changes: AccountProfileChanges,
    ):
        api = api_cls()
        method = inspect.unwrap(api.post)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        update_profile = MagicMock(return_value=user)

        with (
            app.test_request_context("/", json=payload),
            patch.object(account_services.profile, "update", update_profile),
        ):
            result = method(api, payload_model.model_validate(payload), request_context)

        assert result["id"] == user.id
        update_profile.assert_called_once_with(request_context, expected_changes)

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

    def test_updates_multiple_profile_fields(self, app: Flask, account_services: AccountServices):
        api = AccountProfileApi()
        method = inspect.unwrap(api.patch)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        update_profile = MagicMock(return_value=user)
        payload = {"name": "Jane", "interface_language": "en-US", "timezone": "UTC"}
        args = AccountProfilePatchPayload.model_validate(payload)

        with (
            app.test_request_context("/account/profile", method="PATCH", json=payload),
            patch.object(account_services.profile, "update", update_profile),
        ):
            result = method(api, args, request_context)

        assert result["id"] == user.id
        update_profile.assert_called_once_with(
            request_context,
            AccountProfileChanges(name="Jane", interface_language="en-US", timezone="UTC"),
        )

    def test_empty_patch_is_a_noop(self, app: Flask, account_services: AccountServices):
        api = AccountProfileApi()
        method = inspect.unwrap(api.patch)
        user = make_account()
        request_context = RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id=user.id,
            active_workspace_id="workspace-1",
        )
        update_profile = MagicMock(return_value=user)
        args = AccountProfilePatchPayload.model_validate({})

        with (
            app.test_request_context("/account/profile", method="PATCH", json={}),
            patch.object(account_services.profile, "update", update_profile),
        ):
            result = method(api, args, request_context)

        assert result["id"] == user.id
        update_profile.assert_called_once_with(request_context, AccountProfileChanges())

    @pytest.mark.parametrize("payload", [{"name": None}, {"unexpected": "value"}])
    def test_rejects_null_or_unknown_changes(self, payload: dict[str, object]):
        with pytest.raises(ValueError):
            AccountProfilePatchPayload.model_validate(payload)


class TestAccountAvatarApiGet:
    def test_get_avatar_delegates_to_service(self, app: Flask, account_services: AccountServices):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)
        file_id = "550e8400-e29b-41d4-a716-446655440000"
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        resolve_avatar = MagicMock(return_value="https://signed/example")

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch.object(account_services.avatar, "resolve", resolve_avatar),
        ):
            result = method(api, AccountAvatarQuery(avatar=file_id), request_context)

        assert result == {"avatar_url": "https://signed/example"}
        resolve_avatar.assert_called_once_with(request_context, file_id)

    def test_get_avatar_maps_not_found(self, app: Flask, account_services: AccountServices):
        api = AccountAvatarApi()
        method = inspect.unwrap(api.get)
        file_id = "550e8400-e29b-41d4-a716-446655440001"
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        resolve_avatar = MagicMock(side_effect=AvatarFileNotFoundError)

        with (
            app.test_request_context(f"/account/avatar?avatar={file_id}"),
            patch.object(account_services.avatar, "resolve", resolve_avatar),
        ):
            with pytest.raises(NotFound):
                method(api, AccountAvatarQuery(avatar=file_id), request_context)

    def test_get_avatar_missing_query_returns_unprocessable_entity(self, app: Flask):
        account = make_account()

        with (
            app.test_request_context("/account/avatar"),
            patch("controllers.console.wraps._is_setup_completed", return_value=True),
            config_overrides_context(LOGIN_DISABLED=True),
            patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(account, "workspace-1"),
            ),
            patch(
                "controllers.console.flask_admission.current_account_with_tenant",
                return_value=AccountWithTenant(account=account, tenant_id="workspace-1"),
            ),
        ):
            with pytest.raises(UnprocessableEntity) as exc_info:
                AccountAvatarApi().get()

        assert exc_info.value.code == 422


class TestConvertedPostDecorator:
    def test_rejects_an_invalid_body_through_the_decorator(self, app: Flask):
        """The decorator validates the JSON body before the view runs, for the POST handlers too."""
        account = make_account()

        with (
            app.test_request_context("/account/name", method="POST", json={}),
            patch("controllers.console.wraps._is_setup_completed", return_value=True),
            config_overrides_context(LOGIN_DISABLED=True),
            patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(account, "workspace-1"),
            ),
            patch(
                "controllers.console.flask_admission.current_account_with_tenant",
                return_value=AccountWithTenant(account=account, tenant_id="workspace-1"),
            ),
        ):
            with pytest.raises(UnprocessableEntity) as exc_info:
                AccountNameApi().post()

        assert exc_info.value.code == 422


class TestAccountPasswordApi:
    def test_password_success(self, app: Flask, account_services: AccountServices):
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
        change_password = MagicMock(return_value=user)

        with (
            app.test_request_context("/", json=payload),
            patch.object(account_services.password, "change", change_password),
        ):
            result = method(api, AccountPasswordPayload.model_validate(payload), request_context)

        assert result["id"] == user.id
        change_password.assert_called_once_with(
            request_context,
            current_password="old",
            new_password="new123",
        )

    def test_password_wrong_current(self, app: Flask, account_services: AccountServices):
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
        change_password = MagicMock(side_effect=CurrentAccountPasswordIncorrectError)

        with (
            app.test_request_context("/", json=payload),
            patch.object(account_services.password, "change", change_password),
        ):
            with pytest.raises(CurrentPasswordIncorrectError):
                method(api, AccountPasswordPayload.model_validate(payload), request_context)

    def test_password_policy_error_is_mapped(self, app: Flask, account_services: AccountServices):
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
        change_password = MagicMock(
            side_effect=InvalidAccountPasswordError(
                "Password must contain letters and numbers, and the length must be at least 8 characters."
            )
        )

        with (
            app.test_request_context("/", json=payload),
            patch.object(account_services.password, "change", change_password),
        ):
            with pytest.raises(InvalidAccountPasswordRequestError) as exc_info:
                method(api, AccountPasswordPayload.model_validate(payload), request_context)

        assert exc_info.value.data == {
            "code": "invalid_account_password",
            "message": "Password must contain letters and numbers, and the length must be at least 8 characters.",
            "status": 400,
        }


class TestAccountIntegrateApi:
    def test_get_integrates(self, app: Flask, account_services: AccountServices):
        api = AccountIntegrateApi()
        method = inspect.unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        list_integrations = MagicMock(
            return_value=[
                AccountIntegrationStatus(provider="github", created_at=datetime(2026, 1, 1), is_bound=True),
                AccountIntegrationStatus(provider="google", created_at=None, is_bound=False),
            ]
        )

        with (
            app.test_request_context("/"),
            patch.object(account_services.integrations, "list", list_integrations),
        ):
            result = method(api, request_context)

        list_integrations.assert_called_once_with(request_context)
        assert result["data"][0]["provider"] == "github"
        assert result["data"][0]["is_bound"] is True
        assert result["data"][0]["link"] is None
        assert result["data"][1]["provider"] == "google"
        assert result["data"][1]["is_bound"] is False
        assert result["data"][1]["link"].endswith("/console/api/oauth/login/google")


class TestAccountDeleteApi:
    def test_delete_verify_success(self, app: Flask, account_services: AccountServices):
        api = AccountDeleteVerifyApi()
        method = inspect.unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        issue_verification = MagicMock(return_value="token")

        with (
            app.test_request_context("/"),
            patch.object(account_services.deletion, "issue_verification", issue_verification),
        ):
            result = method(api, request_context)

        assert result["result"] == "success"
        assert result["data"] == "token"
        issue_verification.assert_called_once_with(request_context)

    def test_delete_invalid_code(self, app: Flask, account_services: AccountServices):
        api = AccountDeleteApi()
        method = inspect.unwrap(api.post)

        payload = {"token": "t", "code": "x"}
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        request_deletion = MagicMock(side_effect=InvalidAccountDeletionVerificationError)

        with (
            app.test_request_context("/", json=payload),
            patch.object(account_services.deletion, "request_deletion", request_deletion),
        ):
            with pytest.raises(InvalidAccountDeletionCodeError):
                method(api, AccountDeletePayload.model_validate(payload), request_context)

    def test_delete_verify_maps_rate_limit(self, app: Flask, account_services: AccountServices):
        api = AccountDeleteVerifyApi()
        method = inspect.unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        issue_verification = MagicMock(side_effect=AccountDeletionRateLimitError(1))

        with (
            app.test_request_context("/"),
            patch.object(account_services.deletion, "issue_verification", issue_verification),
            pytest.raises(EmailCodeAccountDeletionRateLimitExceededError),
        ):
            method(api, request_context)

    def test_delete_success(self, app: Flask, account_services: AccountServices):
        api = AccountDeleteApi()
        method = inspect.unwrap(api.post)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id="workspace-1",
        )
        request_deletion = MagicMock()
        payload = {"token": "token", "code": "123456"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(account_services.deletion, "request_deletion", request_deletion),
        ):
            result = method(api, AccountDeletePayload.model_validate(payload), request_context)

        assert result["result"] == "success"
        request_deletion.assert_called_once_with(request_context, token="token", code="123456")


class TestChangeEmailApis:
    def test_check_email_code_invalid(self, app: Flask, account_services: AccountServices):
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
        verify_code = MagicMock(side_effect=InvalidChangeEmailCodeError)

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(account_services.change_email, "verify_code", verify_code),
        ):
            with pytest.raises(EmailCodeError):
                method(api, ChangeEmailValidityPayload.model_validate(payload), request_context)

    def test_reset_email_already_used(self, app: Flask, account_services: AccountServices):
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
        reset_email = MagicMock(side_effect=AccountEmailAlreadyInUseError)

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(account_services.change_email, "reset", reset_email),
        ):
            with pytest.raises(EmailAlreadyInUseError):
                method(api, ChangeEmailResetPayload.model_validate(payload), request_context)


class TestCheckEmailUniqueApi:
    def test_email_unique_success(self, app: Flask, account_services: AccountServices):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

        payload = {"email": "ok@test.com"}
        ensure_available = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(account_services.change_email, "ensure_available", ensure_available),
        ):
            result = method(api, CheckEmailUniquePayload.model_validate(payload))

        assert result["result"] == "success"

    def test_email_in_freeze(self, app: Flask, account_services: AccountServices):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

        payload = {"email": "x@test.com"}
        ensure_available = MagicMock(side_effect=AccountEmailFrozenError)

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(account_services.change_email, "ensure_available", ensure_available),
        ):
            with pytest.raises(AccountInFreezeError):
                method(api, CheckEmailUniquePayload.model_validate(payload))

    def test_email_domain_is_suspended(self, app: Flask, account_services: AccountServices):
        api = CheckEmailUnique()
        method = inspect.unwrap(api.post)

        payload = {"email": "user@suspended.example"}
        ensure_available = MagicMock(side_effect=AccountEmailDomainSuspendedError)

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(account_services.change_email, "ensure_available", ensure_available),
        ):
            with pytest.raises(EmailDomainSuspendedError):
                method(api, CheckEmailUniquePayload.model_validate(payload))
