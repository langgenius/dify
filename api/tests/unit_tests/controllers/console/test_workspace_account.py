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
from models import Account, AccountStatus
from services.account_service import AccountService


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_MASK_HEADER"] = "X-Fields"
    app.login_manager = SimpleNamespace(load_user_from_request_context=lambda: None)
    return app


def _build_account(email: str, account_id: str = "acc", tenant: object | None = None) -> Account:
    tenant_obj = tenant if tenant is not None else SimpleNamespace(id="tenant-id")
    account = Account(name=account_id, email=email)
    account.email = email
    account.id = account_id
    account.status = AccountStatus.ACTIVE
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
        app: Flask,
    ):
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_account = _build_account("current@example.com", "acc1")
        mock_current_account.return_value = (mock_account, None)
        mock_get_change_data.return_value = {
            "email": "current@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED,
        }
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
            phase=AccountService.CHANGE_EMAIL_PHASE_NEW,
        )
        mock_extract_ip.assert_called_once()
        mock_is_ip_limit.assert_called_once_with("127.0.0.1")
        mock_csrf.assert_called_once()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.current_account_with_tenant")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.send_change_email_email")
    @patch("controllers.console.workspace.account.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.workspace.account.extract_remote_ip", return_value="127.0.0.1")
    @patch("libs.login.check_csrf_token", return_value=None)
    @patch("controllers.console.wraps.FeatureService.get_system_features")
    def test_should_reject_new_email_phase_when_token_phase_is_not_old_verified(
        self,
        mock_features,
        mock_csrf,
        mock_extract_ip,
        mock_is_ip_limit,
        mock_send_email,
        mock_get_change_data,
        mock_current_account,
        mock_db,
        app: Flask,
    ):
        """GHSA-4q3w-q5mc-45rq: a phase-1 token must not unlock the new-email send step."""
        from controllers.console.auth.error import InvalidTokenError

        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_account = _build_account("current@example.com", "acc1")
        mock_current_account.return_value = (mock_account, None)
        mock_get_change_data.return_value = {
            "email": "current@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_OLD,
        }

        with app.test_request_context(
            "/account/change-email",
            method="POST",
            json={"email": "New@Example.com", "language": "en-US", "phase": "new_email", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            with pytest.raises(InvalidTokenError):
                ChangeEmailSendEmailApi().post()

        mock_send_email.assert_not_called()


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
        app: Flask,
    ):
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_account = _build_account("user@example.com", "acc2")
        mock_current_account.return_value = (mock_account, None)
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {
            "email": "user@example.com",
            "code": "1234",
            "old_email": "old@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_OLD,
        }
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
            "user@example.com",
            code="1234",
            old_email="old@example.com",
            additional_data={
                AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED,
            },
        )
        mock_reset_rate.assert_called_once_with("user@example.com")
        mock_csrf.assert_called_once()

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
    def test_should_upgrade_new_phase_token_to_new_verified(
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
        app: Flask,
    ):
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_current_account.return_value = (_build_account("old@example.com", "acc"), None)
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {
            "email": "new@example.com",
            "code": "1234",
            "old_email": "old@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_NEW,
        }
        mock_generate_token.return_value = (None, "new-verified-token")

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "new@example.com", "code": "1234", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            response = ChangeEmailCheckApi().post()

        assert response == {"is_valid": True, "email": "new@example.com", "token": "new-verified-token"}
        mock_generate_token.assert_called_once_with(
            "new@example.com",
            code="1234",
            old_email="old@example.com",
            additional_data={
                AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
            },
        )

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
    def test_should_reject_validity_when_token_phase_is_unknown(
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
        app: Flask,
    ):
        """A token whose phase marker is a string but not a known transition must be rejected."""
        from controllers.console.auth.error import InvalidTokenError

        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_current_account.return_value = (_build_account("old@example.com", "acc"), None)
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {
            "email": "user@example.com",
            "code": "1234",
            "old_email": "old@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: "something_else",
        }

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "user@example.com", "code": "1234", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            with pytest.raises(InvalidTokenError):
                ChangeEmailCheckApi().post()

        mock_revoke_token.assert_not_called()
        mock_generate_token.assert_not_called()

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
    def test_should_reject_validity_when_token_has_no_phase(
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
        app: Flask,
    ):
        """A token minted without a phase marker (e.g. a hand-crafted token) must not validate."""
        from controllers.console.auth.error import InvalidTokenError

        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        mock_current_account.return_value = (_build_account("old@example.com", "acc"), None)
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {
            "email": "user@example.com",
            "code": "1234",
            "old_email": "old@example.com",
        }

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "user@example.com", "code": "1234", "token": "token-123"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            with pytest.raises(InvalidTokenError):
                ChangeEmailCheckApi().post()

        mock_revoke_token.assert_not_called()
        mock_generate_token.assert_not_called()


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
        app: Flask,
    ):
        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        current_user = _build_account("old@example.com", "acc3")
        mock_current_account.return_value = (current_user, None)
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        mock_get_data.return_value = {
            "email": "new@example.com",
            "old_email": "OLD@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
        }
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
    def test_should_reject_reset_when_token_phase_is_not_new_verified(
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
        app: Flask,
    ):
        """GHSA-4q3w-q5mc-45rq PoC: phase-1 token must not be usable against /reset."""
        from controllers.console.auth.error import InvalidTokenError

        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        current_user = _build_account("old@example.com", "acc3")
        mock_current_account.return_value = (current_user, None)
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        # Simulate a token straight out of step #1 (phase=old_email) — exactly
        # the replay used in the advisory PoC.
        mock_get_data.return_value = {
            "email": "old@example.com",
            "old_email": "old@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_OLD,
        }

        with app.test_request_context(
            "/account/change-email/reset",
            method="POST",
            json={"new_email": "attacker@example.com", "token": "token-from-step1"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            with pytest.raises(InvalidTokenError):
                ChangeEmailResetApi().post()

        mock_revoke_token.assert_not_called()
        mock_update_account.assert_not_called()
        mock_send_notify.assert_not_called()

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
    def test_should_reject_reset_when_token_email_differs_from_payload_new_email(
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
        app: Flask,
    ):
        """A verified token for address A must not be replayed to change to address B."""
        from controllers.console.auth.error import InvalidTokenError

        mock_features.return_value = SimpleNamespace(enable_change_email=True)
        current_user = _build_account("old@example.com", "acc3")
        mock_current_account.return_value = (current_user, None)
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        mock_get_data.return_value = {
            "email": "verified@example.com",
            "old_email": "old@example.com",
            AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
        }

        with app.test_request_context(
            "/account/change-email/reset",
            method="POST",
            json={"new_email": "attacker@example.com", "token": "token-verified"},
        ):
            _set_logged_in_user(_build_account("tester@example.com", "tester"))
            with pytest.raises(InvalidTokenError):
                ChangeEmailResetApi().post()

        mock_revoke_token.assert_not_called()
        mock_update_account.assert_not_called()
        mock_send_notify.assert_not_called()


class TestAccountServiceSendChangeEmailEmail:
    """Service-level coverage for the phase-bound changes in `send_change_email_email`."""

    def test_should_raise_value_error_for_invalid_phase(self):
        with pytest.raises(ValueError, match="phase must be one of"):
            AccountService.send_change_email_email(
                email="user@example.com",
                old_email="user@example.com",
                phase="old_email_verified",
            )

    @patch("services.account_service.send_change_mail_task")
    @patch("services.account_service.AccountService.change_email_rate_limiter")
    @patch("services.account_service.AccountService.generate_change_email_token")
    def test_should_stamp_phase_into_generated_token(
        self,
        mock_generate_token,
        mock_rate_limiter,
        mock_mail_task,
    ):
        mock_rate_limiter.is_rate_limited.return_value = False
        mock_generate_token.return_value = ("123456", "the-token")

        returned = AccountService.send_change_email_email(
            email="user@example.com",
            old_email="user@example.com",
            language="en-US",
            phase=AccountService.CHANGE_EMAIL_PHASE_NEW,
        )

        assert returned == "the-token"
        mock_generate_token.assert_called_once_with(
            "user@example.com",
            None,
            old_email="user@example.com",
            additional_data={
                AccountService.CHANGE_EMAIL_TOKEN_PHASE_KEY: AccountService.CHANGE_EMAIL_PHASE_NEW,
            },
        )
        mock_mail_task.delay.assert_called_once()
        mock_rate_limiter.increment_rate_limit.assert_called_once_with("user@example.com")


class TestAccountDeletionFeedback:
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.workspace.account.BillingService.update_account_deletion_feedback")
    def test_should_normalize_feedback_email(self, mock_update, mock_db, app: Flask):
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
    def test_should_normalize_email(self, mock_is_freeze, mock_check_unique, mock_db, app: Flask):
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
    mock_session = MagicMock()
    first = MagicMock()
    first.scalar_one_or_none.return_value = None
    second = MagicMock()
    expected_account = MagicMock()
    second.scalar_one_or_none.return_value = expected_account
    mock_session.execute.side_effect = [first, second]

    mock_factory = MagicMock()
    mock_factory.create_session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_factory.create_session.return_value.__exit__ = MagicMock(return_value=False)

    with patch("services.account_service.session_factory", mock_factory):
        result = AccountService.get_account_by_email_with_case_fallback("Mixed@Test.com")

    assert result is expected_account
    assert mock_session.execute.call_count == 2
