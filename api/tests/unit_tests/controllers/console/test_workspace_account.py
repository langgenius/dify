import inspect
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.console.workspace.account import (
    AccountDeleteUpdateFeedbackApi,
    ChangeEmailCheckApi,
    ChangeEmailResetApi,
    ChangeEmailSendEmailApi,
    CheckEmailUnique,
)
from models import Account, AccountIntegrate, AccountStatus, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from services.account_service import AccountService
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
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


@contextmanager
def _bind_database_session(session: Session):
    database_session = scoped_session(sessionmaker(bind=session.get_bind(), expire_on_commit=False))
    try:
        with patch("extensions.ext_database.db.session", database_session):
            yield database_session
    finally:
        database_session.remove()


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
    if phase == AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED:
        return ChangeEmailOldEmailVerifiedToken(**token_kwargs)
    if phase == AccountService.CHANGE_EMAIL_PHASE_NEW:
        return ChangeEmailNewEmailToken(**token_kwargs)
    if phase == AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED:
        return ChangeEmailNewEmailVerifiedToken(**token_kwargs)
    raise AssertionError(f"Unsupported phase for test helper: {phase}")


class TestChangeEmailSend:
    @patch("controllers.console.workspace.account.AccountService.send_change_email_email")
    @patch("controllers.console.workspace.account.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.workspace.account.extract_remote_ip", return_value="127.0.0.1")
    def test_should_reject_old_email_phase_when_request_email_does_not_match_current_user(
        self,
        mock_extract_ip,
        mock_is_ip_limit,
        mock_send_email,
        app: Flask,
    ):
        from controllers.console.auth.error import InvalidEmailError

        current_user = _build_account("current@example.com", "acc1")

        with app.test_request_context(
            "/account/change-email",
            method="POST",
            json={"email": "other@example.com", "language": "en-US", "phase": "old_email"},
        ):
            method = inspect.unwrap(ChangeEmailSendEmailApi().post)
            with pytest.raises(InvalidEmailError):
                method(ChangeEmailSendEmailApi(), current_user)

        mock_send_email.assert_not_called()

    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.send_change_email_email")
    @patch("controllers.console.workspace.account.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.workspace.account.extract_remote_ip", return_value="127.0.0.1")
    def test_should_normalize_new_email_phase(
        self,
        mock_extract_ip: MagicMock,
        mock_is_ip_limit: MagicMock,
        mock_send_email: MagicMock,
        mock_get_change_data: MagicMock,
        app: Flask,
    ):
        mock_account = _build_account("current@example.com", "acc1")
        mock_get_change_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED,
            account_id="acc1",
            email="current@example.com",
            old_email="current@example.com",
        )
        mock_send_email.return_value = "token-abc"

        with app.test_request_context(
            "/account/change-email",
            method="POST",
            json={"email": "New@Example.com", "language": "en-US", "phase": "new_email", "token": "token-123"},
        ):
            api = ChangeEmailSendEmailApi()
            method = inspect.unwrap(api.post)
            response = method(api, mock_account)

        assert response == {"result": "success", "data": "token-abc"}
        mock_send_email.assert_called_once_with(
            account=mock_account,
            email="new@example.com",
            old_email="current@example.com",
            language="en-US",
            phase=AccountService.CHANGE_EMAIL_PHASE_NEW,
        )
        mock_extract_ip.assert_called_once()
        mock_is_ip_limit.assert_called_once_with("127.0.0.1")

    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.send_change_email_email")
    @patch("controllers.console.workspace.account.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.workspace.account.extract_remote_ip", return_value="127.0.0.1")
    def test_should_reject_new_email_phase_when_token_phase_is_not_old_verified(
        self,
        mock_extract_ip: MagicMock,
        mock_is_ip_limit: MagicMock,
        mock_send_email: MagicMock,
        mock_get_change_data: MagicMock,
        app: Flask,
    ):
        """GHSA-4q3w-q5mc-45rq: a phase-1 token must not unlock the new-email send step."""
        from controllers.console.auth.error import InvalidTokenError

        mock_account = _build_account("current@example.com", "acc1")
        mock_get_change_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_OLD,
            account_id="acc1",
            email="current@example.com",
            old_email="current@example.com",
        )

        with app.test_request_context(
            "/account/change-email",
            method="POST",
            json={"email": "New@Example.com", "language": "en-US", "phase": "new_email", "token": "token-123"},
        ):
            api = ChangeEmailSendEmailApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, mock_account)

        mock_send_email.assert_not_called()

    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.send_change_email_email")
    @patch("controllers.console.workspace.account.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.workspace.account.extract_remote_ip", return_value="127.0.0.1")
    def test_should_reject_new_email_phase_when_token_account_id_does_not_match_current_user(
        self,
        mock_extract_ip: MagicMock,
        mock_is_ip_limit: MagicMock,
        mock_send_email: MagicMock,
        mock_get_change_data: MagicMock,
        app: Flask,
    ):
        from controllers.console.auth.error import InvalidTokenError

        mock_account = _build_account("current@example.com", "acc1")
        mock_get_change_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED,
            account_id="other-account",
            email="current@example.com",
            old_email="current@example.com",
        )

        with app.test_request_context(
            "/account/change-email",
            method="POST",
            json={"email": "new@example.com", "language": "en-US", "phase": "new_email", "token": "token-123"},
        ):
            api = ChangeEmailSendEmailApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, mock_account)

        mock_send_email.assert_not_called()


class TestChangeEmailValidity:
    @patch("controllers.console.workspace.account.AccountService.reset_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.generate_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.add_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.is_change_email_error_rate_limit")
    def test_should_validate_with_normalized_email(
        self,
        mock_is_rate_limit,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app: Flask,
    ):
        mock_account = _build_account("user@example.com", "acc2")
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_OLD,
            account_id="acc2",
            email="user@example.com",
            old_email="user@example.com",
        )
        mock_generate_token.return_value = "new-token"

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "User@Example.com", "code": "1234", "token": "token-123"},
        ):
            api = ChangeEmailCheckApi()
            method = inspect.unwrap(api.post)
            response = method(api, mock_account)

        assert response == {"is_valid": True, "email": "user@example.com", "token": "new-token"}
        mock_is_rate_limit.assert_called_once_with("user@example.com")
        mock_add_rate.assert_not_called()
        mock_revoke_token.assert_called_once_with("token-123")
        mock_generate_token.assert_called_once_with(
            _build_change_email_token(
                AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED,
                account_id="acc2",
                email="user@example.com",
                old_email="user@example.com",
            ),
            mock_account,
        )
        mock_reset_rate.assert_called_once_with("user@example.com")

    @patch("controllers.console.workspace.account.AccountService.reset_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.generate_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.add_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.is_change_email_error_rate_limit")
    def test_should_upgrade_new_phase_token_to_new_verified(
        self,
        mock_is_rate_limit,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app: Flask,
    ):
        current_user = _build_account("old@example.com", "acc")
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_NEW,
            account_id="acc",
            email="new@example.com",
            old_email="old@example.com",
        )
        mock_generate_token.return_value = "new-verified-token"

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "new@example.com", "code": "1234", "token": "token-123"},
        ):
            api = ChangeEmailCheckApi()
            method = inspect.unwrap(api.post)
            response = method(api, current_user)

        assert response == {"is_valid": True, "email": "new@example.com", "token": "new-verified-token"}
        mock_generate_token.assert_called_once_with(
            _build_change_email_token(
                AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
                account_id="acc",
                email="new@example.com",
                old_email="old@example.com",
            ),
            current_user,
        )

    @patch("controllers.console.workspace.account.AccountService.reset_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.generate_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.add_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.is_change_email_error_rate_limit")
    def test_should_reject_validity_when_token_is_already_verified(
        self,
        mock_is_rate_limit,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app: Flask,
    ):
        from controllers.console.auth.error import InvalidTokenError

        current_user = _build_account("old@example.com", "acc")
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_OLD_VERIFIED,
            account_id="acc",
            email="old@example.com",
            old_email="old@example.com",
        )

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "old@example.com", "code": "1234", "token": "token-123"},
        ):
            api = ChangeEmailCheckApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, current_user)

        mock_revoke_token.assert_not_called()
        mock_generate_token.assert_not_called()

    @patch("controllers.console.workspace.account.AccountService.reset_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.generate_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.add_change_email_error_rate_limit")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.is_change_email_error_rate_limit")
    def test_should_reject_validity_when_token_account_id_does_not_match_current_user(
        self,
        mock_is_rate_limit,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app: Flask,
    ):
        from controllers.console.auth.error import InvalidTokenError

        current_user = _build_account("old@example.com", "acc")
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_NEW,
            account_id="other-account",
            email="new@example.com",
            old_email="old@example.com",
        )

        with app.test_request_context(
            "/account/change-email/validity",
            method="POST",
            json={"email": "new@example.com", "code": "1234", "token": "token-123"},
        ):
            api = ChangeEmailCheckApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, current_user)

        mock_revoke_token.assert_not_called()
        mock_generate_token.assert_not_called()


class TestChangeEmailReset:
    @patch("controllers.console.workspace.account.AccountService.send_change_email_completed_notify_email")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin, AccountIntegrate)],
        indirect=True,
    )
    def test_should_normalize_new_email_before_update(
        self,
        mock_is_freeze: MagicMock,
        mock_get_data: MagicMock,
        mock_revoke_token: MagicMock,
        mock_send_notify: MagicMock,
        app: Flask,
        sqlite_session: Session,
    ):
        mock_is_freeze.return_value = False

        with _bind_database_session(sqlite_session) as database_session:
            current_user, _ = _persist_account_with_tenant(
                database_session(),
                "old@example.com",
                "email-reset-account",
            )
            account_integration = AccountIntegrate(
                account_id=current_user.id,
                provider="google",
                open_id="google-user",
                encrypted_token="encrypted-token",
            )
            database_session.add(account_integration)
            database_session.commit()
            mock_get_data.return_value = _build_change_email_token(
                AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
                account_id=current_user.id,
                email="new@example.com",
                old_email="OLD@example.com",
            )

            with app.test_request_context(
                "/account/change-email/reset",
                method="POST",
                json={"new_email": "New@Example.com", "token": "token-123"},
            ):
                api = ChangeEmailResetApi()
                method = inspect.unwrap(api.post)
                response = method(api, current_user)

        sqlite_session.expire_all()
        persisted_account = sqlite_session.get(Account, current_user.id)
        assert response["email"] == "new@example.com"
        assert persisted_account is not None
        assert persisted_account.email == "new@example.com"
        assert sqlite_session.get(AccountIntegrate, account_integration.id) is None
        mock_is_freeze.assert_called_once_with("new@example.com")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_send_notify.assert_called_once_with(email="new@example.com")

    @patch("controllers.console.workspace.account.AccountService.send_change_email_completed_notify_email")
    @patch("controllers.console.workspace.account.AccountService.update_account_email")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.check_email_unique")
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    def test_should_reject_reset_when_token_phase_is_not_new_verified(
        self,
        mock_is_freeze: MagicMock,
        mock_check_unique: MagicMock,
        mock_get_data: MagicMock,
        mock_revoke_token: MagicMock,
        mock_update_account: MagicMock,
        mock_send_notify: MagicMock,
        app: Flask,
    ):
        """GHSA-4q3w-q5mc-45rq PoC: phase-1 token must not be usable against /reset."""
        from controllers.console.auth.error import InvalidTokenError

        current_user = _build_account("old@example.com", "acc3")
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_OLD,
            account_id="acc3",
            email="old@example.com",
            old_email="old@example.com",
        )

        with app.test_request_context(
            "/account/change-email/reset",
            method="POST",
            json={"new_email": "attacker@example.com", "token": "token-from-step1"},
        ):
            api = ChangeEmailResetApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, current_user)

        mock_revoke_token.assert_not_called()
        mock_update_account.assert_not_called()
        mock_send_notify.assert_not_called()

    @patch("controllers.console.workspace.account.AccountService.send_change_email_completed_notify_email")
    @patch("controllers.console.workspace.account.AccountService.update_account_email")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.check_email_unique")
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    def test_should_reject_reset_when_token_email_differs_from_payload_new_email(
        self,
        mock_is_freeze: MagicMock,
        mock_check_unique: MagicMock,
        mock_get_data: MagicMock,
        mock_revoke_token: MagicMock,
        mock_update_account: MagicMock,
        mock_send_notify: MagicMock,
        app: Flask,
    ):
        """A verified token for address A must not be replayed to change to address B."""
        from controllers.console.auth.error import InvalidTokenError

        current_user = _build_account("old@example.com", "acc3")
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
            account_id="acc3",
            email="verified@example.com",
            old_email="old@example.com",
        )

        with app.test_request_context(
            "/account/change-email/reset",
            method="POST",
            json={"new_email": "attacker@example.com", "token": "token-verified"},
        ):
            api = ChangeEmailResetApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, current_user)

        mock_revoke_token.assert_not_called()
        mock_update_account.assert_not_called()
        mock_send_notify.assert_not_called()

    @patch("controllers.console.workspace.account.AccountService.send_change_email_completed_notify_email")
    @patch("controllers.console.workspace.account.AccountService.update_account_email")
    @patch("controllers.console.workspace.account.AccountService.revoke_change_email_token")
    @patch("controllers.console.workspace.account.AccountService.get_change_email_data")
    @patch("controllers.console.workspace.account.AccountService.check_email_unique")
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    def test_should_reject_reset_when_token_account_id_does_not_match_current_user(
        self,
        mock_is_freeze: MagicMock,
        mock_check_unique: MagicMock,
        mock_get_data: MagicMock,
        mock_revoke_token: MagicMock,
        mock_update_account: MagicMock,
        mock_send_notify: MagicMock,
        app: Flask,
    ):
        from controllers.console.auth.error import InvalidTokenError

        current_user = _build_account("old@example.com", "acc3")
        mock_is_freeze.return_value = False
        mock_check_unique.return_value = True
        mock_get_data.return_value = _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
            account_id="other-account",
            email="new@example.com",
            old_email="old@example.com",
        )

        with app.test_request_context(
            "/account/change-email/reset",
            method="POST",
            json={"new_email": "new@example.com", "token": "token-verified"},
        ):
            api = ChangeEmailResetApi()
            method = inspect.unwrap(api.post)
            with pytest.raises(InvalidTokenError):
                method(api, current_user)

        mock_revoke_token.assert_not_called()
        mock_update_account.assert_not_called()
        mock_send_notify.assert_not_called()


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
            "email_change_phase": AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
        }

        token_data = AccountService.get_change_email_data("token-123")

        assert token_data == _build_change_email_token(
            AccountService.CHANGE_EMAIL_PHASE_NEW_VERIFIED,
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
    @patch("controllers.console.workspace.account.BillingService.update_account_deletion_feedback")
    def test_should_normalize_feedback_email(self, mock_update, app: Flask):
        with app.test_request_context(
            "/account/delete/feedback",
            method="POST",
            json={"email": "User@Example.com", "feedback": "test"},
        ):
            api = AccountDeleteUpdateFeedbackApi()
            method = inspect.unwrap(api.post)
            response = method(api)

        assert response == {"result": "success"}
        mock_update.assert_called_once_with("User@Example.com", "test")


class TestCheckEmailUnique:
    @patch("controllers.console.workspace.account.AccountService.is_account_in_freeze")
    @pytest.mark.parametrize(
        "sqlite_session",
        [(Account, Tenant, TenantAccountJoin)],
        indirect=True,
    )
    def test_should_normalize_email(
        self,
        mock_is_freeze: MagicMock,
        app: Flask,
        sqlite_session: Session,
    ):
        mock_is_freeze.return_value = False

        with _bind_database_session(sqlite_session) as database_session:
            _persist_account_with_tenant(database_session(), "different@test.com", "uniqueness-account")
            with app.test_request_context(
                "/account/change-email/check-email-unique",
                method="POST",
                json={"email": "Case@Test.com"},
            ):
                api = CheckEmailUnique()
                method = inspect.unwrap(api.post)
                response = method(api)

        assert response == {"result": "success"}
        mock_is_freeze.assert_called_once_with("case@test.com")


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
