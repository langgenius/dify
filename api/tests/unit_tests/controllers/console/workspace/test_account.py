import inspect
from collections.abc import Iterator
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask, request
from jsonschema import Draft202012Validator
from sqlalchemy.orm import Session
from typing_extensions import TypedDict
from werkzeug.exceptions import NotFound, UnprocessableEntity

from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeAccountDeletionRateLimitExceededError,
    EmailCodeError,
    InvalidTokenError,
)
from controllers.console.error import (
    AccountInFreezeError,
    EducationActivateLimitError,
    EducationVerifyLimitError,
    EmailDomainSuspendedError,
    InvalidAccountPasswordRequestError,
)
from controllers.console.workspace.account import (
    AccountAvatarApi,
    AccountAvatarPayload,
    AccountAvatarQuery,
    AccountDeleteApi,
    AccountDeletePayload,
    AccountDeleteUpdateFeedbackApi,
    AccountDeleteVerifyApi,
    AccountDeletionFeedbackPayload,
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
    ChangeEmailSendEmailApi,
    ChangeEmailSendPayload,
    ChangeEmailValidityPayload,
    CheckEmailUnique,
    CheckEmailUniquePayload,
    EducationActivatePayload,
    EducationApi,
    EducationVerifyApi,
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
from models import AccountStatus as _workspace_account_AccountStatus
from models.account import AccountStatus as _accounts_AccountStatus
from models.account import TenantAccountRole
from services import account_errors
from services.account_email import normalize_email
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
from services.entities.account_entities import (
    AccountEducationActivation,
    AccountIntegrationStatus,
    AccountProfileChanges,
    ChangeEmailVerification,
)
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
    ChangeEmailPhase,
    ChangeEmailTokenBase,
)
from tests.helpers.unit.config_override import config_overrides_context


def _build_account(email: str, account_id: str = "acc", tenant: Tenant | None = None) -> Account:
    if tenant is None:
        tenant_obj = Tenant(name="Tenant")
        tenant_obj.id = "tenant-id"
    else:
        tenant_obj = tenant
    account = Account(name=account_id, email=email)
    account.email = email
    account.id = account_id
    account.status = _workspace_account_AccountStatus.ACTIVE
    account._current_tenant = tenant_obj
    return account


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _persist_account_with_tenant(session: Session, email: str, account_name: str = "account") -> tuple[Account, Tenant]:
    tenant = Tenant(name=f"{account_name} tenant")
    tenant.id = _stable_uuid(f"tenant:{account_name}")
    account = Account(
        name=account_name,
        email=email,
        normalized_email=normalize_email(email),
        status=_workspace_account_AccountStatus.ACTIVE,
    )
    account.id = _stable_uuid(f"account:{account_name}")
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


class _ChangeEmailTokenKwargs(TypedDict, closed=True):
    account_id: str
    email: str
    old_email: str
    code: str


def _build_change_email_token(
    phase: str,
    *,
    account_id: str = "acc",
    email: str,
    old_email: str,
    code: str = "1234",
) -> ChangeEmailTokenBase:
    token_kwargs: _ChangeEmailTokenKwargs = {
        "account_id": account_id,
        "email": email,
        "old_email": old_email,
        "code": code,
    }
    if phase == "old_email":
        return ChangeEmailOldEmailToken(**token_kwargs)
    if phase == ChangeEmailPhase.OLD_EMAIL_VERIFIED:
        return ChangeEmailOldEmailVerifiedToken(**token_kwargs)
    if phase == "new_email":
        return ChangeEmailNewEmailToken(**token_kwargs)
    if phase == ChangeEmailPhase.NEW_EMAIL_VERIFIED:
        return ChangeEmailNewEmailVerifiedToken(**token_kwargs)
    raise AssertionError(f"Unsupported phase for test helper: {phase}")


def _change_email_context(account_id: str = "acc") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id=account_id,
        active_workspace_id="workspace-1",
    )


class TestWorkspaceAccountCases:
    @staticmethod
    @pytest.fixture
    def app() -> Flask:
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        setattr(app, "login_manager", SimpleNamespace(load_user_from_request_context=lambda: None))  # noqa: B010
        return app

    class TestEducationApi:
        def test_post_activates_education_discount(self, app: Flask) -> None:
            education = MagicMock()
            education.activate.return_value = AccountEducationActivation(message="success")
            request_context = RequestContext(
                request_id="request-1",
                trace_id=None,
                account_id="account-1",
                active_workspace_id="workspace-1",
            )

            with (
                app.test_request_context(
                    "/account/education",
                    method="POST",
                    json={"token": "education-token", "institution": "Dify University", "role": "Student"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(education=education)),
                ),
            ):
                api = EducationApi()
                method = inspect.unwrap(api.post)
                result = method(api, EducationActivatePayload.model_validate(request.get_json() or {}), request_context)

            assert result == {"message": "success"}
            education.activate.assert_called_once_with(
                request_context,
                token="education-token",
                institution="Dify University",
                role="Student",
            )

        def test_verify_maps_rate_limit_error(self, app: Flask) -> None:
            education = MagicMock()
            education.verify.side_effect = account_errors.EducationRateLimitExceededError
            request_context = RequestContext(
                request_id="request-1",
                trace_id=None,
                account_id="account-1",
                active_workspace_id="workspace-1",
            )

            with (
                app.test_request_context("/account/education/verify", method="GET"),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(education=education)),
                ),
            ):
                api = EducationVerifyApi()
                with pytest.raises(EducationVerifyLimitError):
                    inspect.unwrap(api.get)(api, request_context)

        def test_post_maps_rate_limit_error(self, app: Flask) -> None:
            education = MagicMock()
            education.activate.side_effect = account_errors.EducationRateLimitExceededError
            request_context = RequestContext(
                request_id="request-1",
                trace_id=None,
                account_id="account-1",
                active_workspace_id="workspace-1",
            )

            with (
                app.test_request_context(
                    "/account/education",
                    method="POST",
                    json={"token": "education-token", "institution": "Dify University", "role": "Student"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(education=education)),
                ),
            ):
                api = EducationApi()
                with pytest.raises(EducationActivateLimitError):
                    inspect.unwrap(api.post)(
                        api, EducationActivatePayload.model_validate(request.get_json() or {}), request_context
                    )

    class TestChangeEmailControllers:
        def test_send_delegates_parsed_request_to_application_service(self, app: Flask) -> None:
            change_email = MagicMock()
            change_email.send_code.return_value = "change-token"
            context = _change_email_context()
            payload = {
                "email": "new@example.com",
                "language": "zh-Hans",
                "phase": "new_email",
                "token": "verified-old-token",
            }

            with (
                app.test_request_context(
                    "/account/change-email",
                    method="POST",
                    json=payload,
                    environ_base={"REMOTE_ADDR": "127.0.0.1"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = ChangeEmailSendEmailApi()
                response = inspect.unwrap(api.post)(
                    api, ChangeEmailSendPayload.model_validate(request.get_json() or {}), context
                )

            assert response == {"result": "success", "data": "change-token"}
            change_email.send_code.assert_called_once_with(
                context,
                requested_email="new@example.com",
                language="zh-Hans",
                phase="new_email",
                predecessor_token="verified-old-token",
                ip_address="127.0.0.1",
            )

        def test_send_maps_invalid_state_to_http_error(self, app: Flask) -> None:
            change_email = MagicMock()
            change_email.send_code.side_effect = account_errors.InvalidChangeEmailTokenError

            with (
                app.test_request_context(
                    "/account/change-email",
                    method="POST",
                    json={"email": "new@example.com", "phase": "new_email"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = ChangeEmailSendEmailApi()
                method = inspect.unwrap(api.post)
                with pytest.raises(InvalidTokenError):
                    method(
                        api, ChangeEmailSendPayload.model_validate(request.get_json() or {}), _change_email_context()
                    )

        def test_validity_serializes_promoted_token(self, app: Flask) -> None:
            change_email = MagicMock()
            change_email.verify_code.return_value = ChangeEmailVerification(
                email="new@example.com",
                token="verified-token",
            )
            context = _change_email_context()

            with (
                app.test_request_context(
                    "/account/change-email/validity",
                    method="POST",
                    json={"email": "New@Example.com", "code": "123456", "token": "pending-token"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = ChangeEmailCheckApi()
                response = inspect.unwrap(api.post)(
                    api, ChangeEmailValidityPayload.model_validate(request.get_json() or {}), context
                )

            assert response == {"is_valid": True, "email": "new@example.com", "token": "verified-token"}
            change_email.verify_code.assert_called_once_with(
                context,
                email="New@Example.com",
                code="123456",
                token="pending-token",
            )

        def test_reset_returns_updated_account(self, app: Flask) -> None:
            change_email = MagicMock()
            updated_account = _build_account("new@example.com", "acc")
            change_email.reset.return_value = updated_account
            context = _change_email_context()

            with (
                app.test_request_context(
                    "/account/change-email/reset",
                    method="POST",
                    json={"new_email": "New@Example.com", "token": "verified-token"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = ChangeEmailResetApi()
                response = inspect.unwrap(api.post)(
                    api, ChangeEmailResetPayload.model_validate(request.get_json() or {}), context
                )

            assert response["email"] == "new@example.com"
            change_email.reset.assert_called_once_with(
                context,
                new_email="New@Example.com",
                token="verified-token",
            )

        def test_reset_maps_suspended_email_domain(self, app: Flask) -> None:
            change_email = MagicMock()
            change_email.reset.side_effect = account_errors.AccountEmailDomainSuspendedError

            with (
                app.test_request_context(
                    "/account/change-email/reset",
                    method="POST",
                    json={"new_email": "user@suspended.example", "token": "verified-token"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = ChangeEmailResetApi()
                with pytest.raises(EmailDomainSuspendedError):
                    inspect.unwrap(api.post)(
                        api, ChangeEmailResetPayload.model_validate(request.get_json() or {}), _change_email_context()
                    )

    class TestAccountDeletionFeedback:
        def test_delegates_feedback_to_application_service(self, app: Flask) -> None:
            deletion_feedback = MagicMock()
            with (
                app.test_request_context(
                    "/account/delete/feedback",
                    method="POST",
                    json={"email": "User@Example.com", "feedback": "test"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(
                        accounts=SimpleNamespace(deletion_feedback=deletion_feedback),
                    ),
                ),
            ):
                api = AccountDeleteUpdateFeedbackApi()
                method = inspect.unwrap(api.post)
                response = method(api, AccountDeletionFeedbackPayload.model_validate(request.get_json() or {}))

            assert response == {"result": "success"}
            deletion_feedback.submit.assert_called_once_with(email="User@Example.com", feedback="test")

    class TestCheckEmailUnique:
        def test_delegates_to_email_availability_policy(self, app: Flask) -> None:
            change_email = MagicMock()

            with (
                app.test_request_context(
                    "/account/change-email/check-email-unique",
                    method="POST",
                    json={"email": "Case@Test.com"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = CheckEmailUnique()
                response = inspect.unwrap(api.post)(
                    api, CheckEmailUniquePayload.model_validate(request.get_json() or {})
                )

            assert response == {"result": "success"}
            change_email.ensure_available.assert_called_once_with("Case@Test.com")

        def test_maps_suspended_email_domain(self, app: Flask) -> None:
            change_email = MagicMock()
            change_email.ensure_available.side_effect = account_errors.AccountEmailDomainSuspendedError

            with (
                app.test_request_context(
                    "/account/change-email/check-email-unique",
                    method="POST",
                    json={"email": "user@suspended.example"},
                ),
                patch(
                    "controllers.console.workspace.account.application_services",
                    return_value=SimpleNamespace(accounts=SimpleNamespace(change_email=change_email)),
                ),
            ):
                api = CheckEmailUnique()
                with pytest.raises(EmailDomainSuspendedError):
                    inspect.unwrap(api.post)(api, CheckEmailUniquePayload.model_validate(request.get_json() or {}))


def make_account(
    account_id: str = "u1", *, status: _accounts_AccountStatus = _accounts_AccountStatus.ACTIVE
) -> Account:
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
    status: _accounts_AccountStatus = _accounts_AccountStatus.ACTIVE,
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


class TestAccountsCases:
    @staticmethod
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
                (
                    AccountAvatarApi,
                    AccountAvatarPayload,
                    {"avatar": "img.png"},
                    AccountProfileChanges(avatar="img.png"),
                ),
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
                (
                    AccountTimezoneApi,
                    AccountTimezonePayload,
                    {"timezone": "UTC"},
                    AccountProfileChanges(timezone="UTC"),
                ),
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
            with pytest.raises(
                ValueError,
                match=(
                    "(?:1 validation error for AccountProfilePatchPayload\\\nname|1 "
                    "validation error for AccountProfilePatchPayload\\\nunexpected)"
                ),
            ):
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
