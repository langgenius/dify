import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.auth.error import InvalidTokenError
from controllers.console.error import EmailDomainSuspendedError
from controllers.console.workspace.account import (
    AccountDeleteUpdateFeedbackApi,
    ChangeEmailCheckApi,
    ChangeEmailResetApi,
    ChangeEmailSendEmailApi,
    CheckEmailUnique,
    EducationApi,
)
from machinery.context import RequestContext
from models import Account, AccountStatus, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from services import account_errors
from services.account_service import AccountService
from services.entities.account_entities import ChangeEmailVerification
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
    ChangeEmailPhase,
)


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_MASK_HEADER"] = "X-Fields"
    setattr(app, "login_manager", SimpleNamespace(load_user_from_request_context=lambda: None))  # noqa: B010
    return app


def _build_account(email: str, account_id: str = "acc", tenant: Tenant | None = None) -> Account:
    if tenant is None:
        tenant_obj = Tenant(name="Tenant")
        tenant_obj.id = "tenant-id"
    else:
        tenant_obj = tenant
    account = Account(name=account_id, email=email)
    account.email = email
    account.id = account_id
    account.status = AccountStatus.ACTIVE
    account._current_tenant = tenant_obj
    return account


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _persist_account_with_tenant(session: Session, email: str, account_name: str = "account") -> tuple[Account, Tenant]:
    tenant = Tenant(name=f"{account_name} tenant")
    tenant.id = _stable_uuid(f"tenant:{account_name}")
    account = Account(name=account_name, email=email, status=AccountStatus.ACTIVE)
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


def _build_change_email_token(
    phase: str,
    *,
    account_id: str = "acc",
    email: str,
    old_email: str,
    code: str = "1234",
):
    token_kwargs = {
        "account_id": account_id,
        "email": email,
        "old_email": old_email,
        "code": code,
    }
    if phase == AccountService.CHANGE_EMAIL_PHASE_OLD:
        return ChangeEmailOldEmailToken(**token_kwargs)
    if phase == ChangeEmailPhase.OLD_EMAIL_VERIFIED:
        return ChangeEmailOldEmailVerifiedToken(**token_kwargs)
    if phase == AccountService.CHANGE_EMAIL_PHASE_NEW:
        return ChangeEmailNewEmailToken(**token_kwargs)
    if phase == ChangeEmailPhase.NEW_EMAIL_VERIFIED:
        return ChangeEmailNewEmailVerifiedToken(**token_kwargs)
    raise AssertionError(f"Unsupported phase for test helper: {phase}")


class TestEducationApi:
    def test_post_activates_education_discount(self, app: Flask):
        education = MagicMock()
        education.activate.return_value = {"message": "success"}
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
            result = method(api, request_context)

        assert result == {"message": "success"}
        education.activate.assert_called_once_with(
            request_context,
            token="education-token",
            institution="Dify University",
            role="Student",
        )


def _change_email_context(account_id: str = "acc") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id=account_id,
        active_workspace_id="workspace-1",
    )


class TestChangeEmailControllers:
    def test_send_delegates_parsed_request_to_application_service(self, app: Flask):
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
            response = inspect.unwrap(api.post)(api, context)

        assert response == {"result": "success", "data": "change-token"}
        change_email.send_code.assert_called_once_with(
            context,
            requested_email="new@example.com",
            language="zh-Hans",
            phase="new_email",
            predecessor_token="verified-old-token",
            ip_address="127.0.0.1",
        )

    def test_send_maps_invalid_state_to_http_error(self, app: Flask):
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
                method(api, _change_email_context())

    def test_validity_serializes_promoted_token(self, app: Flask):
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
            response = inspect.unwrap(api.post)(api, context)

        assert response == {"is_valid": True, "email": "new@example.com", "token": "verified-token"}
        change_email.verify_code.assert_called_once_with(
            context,
            email="New@Example.com",
            code="123456",
            token="pending-token",
        )

    def test_reset_returns_updated_account(self, app: Flask):
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
            response = inspect.unwrap(api.post)(api, context)

        assert response["email"] == "new@example.com"
        change_email.reset.assert_called_once_with(
            context,
            new_email="New@Example.com",
            token="verified-token",
        )

    def test_reset_maps_suspended_email_domain(self, app: Flask):
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
                inspect.unwrap(api.post)(api, _change_email_context())


class TestAccountServiceSendChangeEmailEmail:
    """Service-level coverage for the phase-bound changes in `send_change_email_email`."""

    def test_should_raise_value_error_for_invalid_phase(self):
        with pytest.raises(ValueError, match="phase must be one of"):
            AccountService.send_change_email_email(
                account=_build_account("old@example.com", "acc"),
                email="new@example.com",
                old_email="user@example.com",
                phase="old_email_verified",
            )

    @patch("services.account_service.send_change_mail_task")
    @patch("services.account_service.AccountService.change_email_rate_limiter")
    @patch("services.account_service.AccountService.generate_change_email_token")
    def test_should_bind_account_id_and_target_email_into_generated_token(
        self,
        mock_generate_token: MagicMock,
        mock_rate_limiter: MagicMock,
        mock_mail_task: MagicMock,
    ):
        mock_rate_limiter.is_rate_limited.return_value = False
        mock_generate_token.return_value = "the-token"
        account = _build_account("old@example.com", "acc-123")

        returned = AccountService.send_change_email_email(
            account=account,
            email="new@example.com",
            old_email="old@example.com",
            language="en-US",
            phase=AccountService.CHANGE_EMAIL_PHASE_NEW,
        )

        assert returned == "the-token"
        mock_generate_token.assert_called_once_with(
            _build_change_email_token(
                AccountService.CHANGE_EMAIL_PHASE_NEW,
                account_id="acc-123",
                email="new@example.com",
                old_email="old@example.com",
                code=mock_mail_task.delay.call_args.kwargs["code"],
            ),
            account,
        )
        mock_mail_task.delay.assert_called_once_with(
            language="en-US",
            to="new@example.com",
            code=mock_mail_task.delay.call_args.kwargs["code"],
            phase=AccountService.CHANGE_EMAIL_PHASE_NEW,
        )
        mock_rate_limiter.increment_rate_limit.assert_called_once_with("new@example.com")


class TestAccountServiceGetChangeEmailData:
    @patch("services.account_service.TokenManager.get_token_data")
    def test_should_parse_change_email_token_into_discriminated_union_model(self, mock_get_token_data):
        mock_get_token_data.return_value = {
            "token_type": "change_email",
            "account_id": "acc-1",
            "email": "new@example.com",
            "old_email": "old@example.com",
            "code": "654321",
            "email_change_phase": ChangeEmailPhase.NEW_EMAIL_VERIFIED,
        }

        token_data = AccountService.get_change_email_data("token-123")

        assert token_data == _build_change_email_token(
            ChangeEmailPhase.NEW_EMAIL_VERIFIED,
            account_id="acc-1",
            email="new@example.com",
            old_email="old@example.com",
            code="654321",
        )

    @patch("services.account_service.TokenManager.get_token_data")
    def test_should_reject_change_email_token_without_account_id(self, mock_get_token_data):
        mock_get_token_data.return_value = {
            "token_type": "change_email",
            "email": "new@example.com",
            "old_email": "old@example.com",
            "code": "654321",
            "email_change_phase": AccountService.CHANGE_EMAIL_PHASE_NEW,
        }

        assert AccountService.get_change_email_data("token-123") is None


class TestAccountDeletionFeedback:
    def test_delegates_feedback_to_application_service(self, app: Flask):
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
            response = method(api)

        assert response == {"result": "success"}
        deletion_feedback.submit.assert_called_once_with(email="User@Example.com", feedback="test")


class TestCheckEmailUnique:
    def test_delegates_to_email_availability_policy(self, app: Flask):
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
            response = inspect.unwrap(api.post)(api)

        assert response == {"result": "success"}
        change_email.ensure_available.assert_called_once_with("Case@Test.com")

    def test_maps_suspended_email_domain(self, app: Flask):
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
                inspect.unwrap(api.post)(api)


@pytest.mark.parametrize(
    "sqlite_session",
    [(Account, Tenant, TenantAccountJoin)],
    indirect=True,
)
def test_get_account_by_email_with_case_fallback_uses_lowercase_lookup(sqlite_session: Session):
    expected_account, _ = _persist_account_with_tenant(
        sqlite_session,
        "mixed@test.com",
        "case-fallback-account",
    )

    result = AccountService.get_account_by_email_with_case_fallback("Mixed@Test.com", session=sqlite_session)

    assert result is expected_account
