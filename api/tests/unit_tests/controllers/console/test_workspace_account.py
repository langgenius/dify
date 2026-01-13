from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, g

from controllers.console.workspace.account import (
    AccountDeleteUpdateFeedbackApi,
    ChangeEmailCheckApi,
    ChangeEmailResetApi,
    ChangeEmailSendEmailApi,
    CheckEmailUnique,
)
from models import Account
from services.account_service import AccountService


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_MASK_HEADER"] = "X-Fields"
    app.login_manager = SimpleNamespace(_load_user=lambda: None)
    return app


def _mock_wraps_db(mock_db):
    mock_db.session.query.return_value.first.return_value = MagicMock()


def _build_account(email: str, account_id: str = "acc", tenant: object | None = None) -> Account:
    tenant_obj = tenant if tenant is not None else SimpleNamespace(id="tenant-id")
    account = Account(name=account_id, email=email)
    account.email = email
    account.id = account_id
    account.status = "active"
    account._current_tenant = tenant_obj
    return account


def _set_logged_in_user(account: Account):
    g._login_user = account
    g._current_tenant = account.current_tenant


class TestChangeEmailSend:
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.current_account_with_tenant")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.send_change_email_email")
    @patch("controllers.console.workspace.account.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.workspace.account.extract_remote_ip", return_value="127.0.0.1")
    @patch("libs.login.check_csrf_token", return_value=None)
    @patch("controllers.console.wraps.FeatureService.get_system_features")
    def test_should_normalize_new_email_phase(
        self,
        mock_features,
        mock_csrf,
        mock_extract_ip,
        mock_is_ip_limit,
        mock_send_email,
        mock_get_change_data,
        mock_current_account,
        mock_db,
        app,
    ):
        _mock_wraps_db(mock_db)
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_account = _build_account("current@example.com", "acc1")
        mock_current_account.return_value = (mock_account, None)
        mock_get_change_data.return_value = {"email": "current@example.com"}
        mock_send_email.return_value = "token-abc"

        with app.test_request_context(
            "/account/change-email",
            method="POST",
            json={"email": "New@Example.com", "language": "en-US", "phase": "new_email", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            response = ChangeEmailSendEmailApi().post()

        assert response == {"result": "success", "data": "token-abc"}
        mock_send_email.assert_called_once_with(
            account=None,
            email="new@example.com",
            old_email="current@example.com",
            language="en-US",
            phase="new_email",
        )
        mock_extract_ip.assert_called_once()
        mock_is_ip_limit.assert_called_once_with("127.0.0.1")
        mock_csrf.assert_called_once()


class TestChangeEmailValidity:
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.current_account_with_tenant")
    @patch("controllers.console.workspace.account.AccountService.reset_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.generate_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.add_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.is_change_email_error_rate_limit")
    @patch("libs.login.check_csrf_token", return_value=None)
    @patch("controllers.console.wraps.FeatureService.get_system_features")
    def test_should_validate_with_normalized_email(
        self,
        mock_features,
        mock_csrf,
        mock_is_rate_limit,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        mock_current_account,
        mock_db,
        app,
    ):
        _mock_wraps_db(mock_db)
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_account = _build_account("user@example.com", "acc2")
        mock_current_account.return_value = (mock_account, None)
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "user@example.com", "code": "1234", "old_email": "old@example.com"}
        mock_generate_token.return_value = (None, "new-token")

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "User@Example.com", "code": "1234", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            response = ChangeEmailCheckApi().post()

        assert response == {"is_valid": True, "email": "user@example.com", "token": "new-token"}
        mock_is_rate_limit.assert_called_once_with("user@example.com")
        mock_add_rate.assert_not_called()
        mock_revoke_token.assert_called_once_with("token-123")
        mock_generate_token.assert_called_once_with(
            "user@example.com", code="1234", old_email="old@example.com", additional_data={}
        )
        mock_reset_rate.assert_called_once_with("user@example.com")
        mock_csrf.assert_called_once()


class TestChangeEmailReset:
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.current_account_with_tenant")
    @patch("controllers.console.workspace.account.AccountService.send_change_email_completed_notify_email")
    @patch("controllers.console.workspace.account.AccountService.update_account_email")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.check_email_unique")
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    @patch("libs.login.check_csrf_token", return_value=None)
    @patch("controllers.console.wraps.FeatureService.get_system_features")
    def test_should_normalize_new_email_before_update(
        self,
        mock_features,
        mock_csrf,
        mock_is_freeze,
        mock_check_unique,
        mock_get_data,
        mock_revoke_token,
        mock_update_account,
        mock_send_notify,
        mock_current_account,
        mock_db,
        app,
    ):
        _mock_wraps_db(mock_db)
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        current_user = _build_account("old@example.com", "acc3")
        mock_current_account.return_value = (current_user, None)
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        mock_get_data.return_value = {"old_email": "OLD@example.com"}
        mock_account_after_update = _build_account("new@example.com", "acc3-updated")
        mock_update_account.return_value = mock_account_after_update

        with app.test_request_context(
            "/account/change-email/reset",
            method="POST",
            json={"new_email": "New@Example.com", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            ChangeEmailResetApi().post()

            mock_is_freeze.assert_called_once_with("new@example.com")
            mock_check_unique.assert_called_once_with("new@example.com")
            mock_revoke_token.assert_called_once_with("token-123")
            mock_update_account.assert_called_once_with(current_user, email="new@example.com")
            mock_send_notify.assert_called_once_with(email="new@example.com")
            mock_csrf.assert_called_once()


class TestAccountDeletionFeedback:
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.BillingService.update_account_deletion_feedback")
    def test_should_normalize_feedback_email(self, mock_update, mock_db, app):
        _mock_wraps_db(mock_db)
        with app.test_request_context(
            "/account/delete/feedback",
            method="POST",
            json={"email": "User@Example.com", "feedback": "test"},
        ):
            response = AccountDeleteUpdateFeedbackApi().post()

        assert response == {"result": "success"}
        mock_update.assert_called_once_with("User@Example.com", "test")


class TestCheckEmailUnique:
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.AccountService.check_email_unique")
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    def test_should_normalize_email(self, mock_is_freeze, mock_check_unique, mock_db, app):
        _mock_wraps_db(mock_db)
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True

        with app.test_request_context(
            "/account/change-email/check-email-unique",
            method="POST",
            json={"email": "Case@Test.com"},
        ):
            response = CheckEmailUnique().post()

        assert response == {"result": "success"}
        mock_is_freeze.assert_called_once_with("case@test.com")
        mock_check_unique.assert_called_once_with("case@test.com")


def test_get_account_by_email_with_case_fallback_uses_lowercase_lookup():
    session = MagicMock()
    first = MagicMock()
    first.scalar_one_or_none.return_value = None
    second = MagicMock()
    expected_account = MagicMock()
    second.scalar_one_or_none.return_value = expected_account
    session.execute.side_effect = [first, second]

    result = AccountService.get_account_by_email_with_case_fallback("Mixed@Test.com", session=session)

    assert result is expected_account
    assert session.execute.call_count == 2
