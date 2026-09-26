import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session

from controllers.console.auth.error import InvalidTokenError
from controllers.console.error import EducationActivateLimitError, EducationVerifyLimitError, EmailDomainSuspendedError
from controllers.console.workspace.account import (
    AccountDeleteUpdateFeedbackApi,
    AccountDeletionFeedbackPayload,
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
from machinery.context import RequestContext
from models import Account, AccountStatus, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from services import account_errors
from services.account_email import normalize_email
from services.entities.account_entities import AccountEducationActivation, ChangeEmailVerification
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
    account = Account(
        name=account_name, email=email, normalized_email=normalize_email(email), status=AccountStatus.ACTIVE
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
    if phase == "old_email":
        return ChangeEmailOldEmailToken(**token_kwargs)
    if phase == ChangeEmailPhase.OLD_EMAIL_VERIFIED:
        return ChangeEmailOldEmailVerifiedToken(**token_kwargs)
    if phase == "new_email":
        return ChangeEmailNewEmailToken(**token_kwargs)
    if phase == ChangeEmailPhase.NEW_EMAIL_VERIFIED:
        return ChangeEmailNewEmailVerifiedToken(**token_kwargs)
    raise AssertionError(f"Unsupported phase for test helper: {phase}")


class TestEducationApi:
    def test_post_activates_education_discount(self, app: Flask):
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

    def test_verify_maps_rate_limit_error(self, app: Flask):
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

    def test_post_maps_rate_limit_error(self, app: Flask):
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
                method(api, ChangeEmailSendPayload.model_validate(request.get_json() or {}), _change_email_context())

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
            response = inspect.unwrap(api.post)(
                api, ChangeEmailResetPayload.model_validate(request.get_json() or {}), context
            )

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
                inspect.unwrap(api.post)(
                    api, ChangeEmailResetPayload.model_validate(request.get_json() or {}), _change_email_context()
                )


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
            response = method(api, AccountDeletionFeedbackPayload.model_validate(request.get_json() or {}))

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
            response = inspect.unwrap(api.post)(api, CheckEmailUniquePayload.model_validate(request.get_json() or {}))

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
                inspect.unwrap(api.post)(api, CheckEmailUniquePayload.model_validate(request.get_json() or {}))
