"""Unit tests for Web authentication infrastructure adapters."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from unittest.mock import MagicMock, call, patch

import pytest

from services.entities.auth_audit_entities import LoginFailureReason
from services.entities.authentication_entities import WebAppSessionRecord
from services.web_authentication_adapters import (
    AccountServiceWebAuthenticationSecurityGateway,
    LoggingWebAuthenticationAuditGateway,
    PassportWebAppSessionGateway,
    TokenManagerWebAuthenticationGateway,
)
from services.web_authentication_service import WebEmailDeliveryRateLimitError


def token_gateway(*, limited: bool = False) -> tuple[TokenManagerWebAuthenticationGateway, MagicMock]:
    limiter = MagicMock()
    limiter.is_rate_limited.return_value = limited
    limiter.time_window = 600
    return (
        TokenManagerWebAuthenticationGateway(
            reset_password_rate_limiter=limiter,
            access_token_expire_minutes=10,
        ),
        limiter,
    )


def test_issue_access_token_builds_web_login_claims() -> None:
    gateway, _ = token_gateway()
    issued_at = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)

    with (
        patch("services.web_authentication_adapters.datetime") as clock,
        patch("services.web_authentication_adapters.PassportService") as passport_service,
    ):
        clock.now.return_value = issued_at
        passport_service.return_value.issue.return_value = "access-token"

        result = gateway.issue_access_token(account_id="account-1", email="User@Example.com")

    assert result == "access-token"
    claims = passport_service.return_value.issue.call_args.args[0]
    assert claims == {
        "sub": "Web API Passport",
        "user_id": "account-1",
        "session_id": "User@Example.com",
        "token_source": "webapp_login_token",
        "auth_type": "internal",
        "exp": claims["exp"],
    }
    assert claims["exp"] == int(issued_at.timestamp()) + 600


def test_verify_access_token_rejects_missing_token_without_decoding() -> None:
    gateway, _ = token_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        assert gateway.verify_access_token(None) is False

    passport_service.assert_not_called()


def test_verify_access_token_accepts_valid_passport() -> None:
    gateway, _ = token_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        assert gateway.verify_access_token("signed-token") is True

    passport_service.return_value.verify.assert_called_once_with(token="signed-token")


def test_verify_access_token_rejects_invalid_passport() -> None:
    gateway, _ = token_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        passport_service.return_value.verify.side_effect = ValueError("bad signature")

        assert gateway.verify_access_token("signed-token") is False


def test_send_email_login_code_persists_challenge_and_queues_mail() -> None:
    gateway, _ = token_gateway()

    with (
        patch.object(gateway, "_generate_code", return_value="123456"),
        patch("services.web_authentication_adapters.TokenManager.generate_token", return_value="challenge") as generate,
        patch("services.web_authentication_adapters.send_email_code_login_mail_task.delay") as send_mail,
    ):
        result = gateway.send_email_login_code(
            account_id="account-1",
            email="user@example.com",
            language="en-US",
        )

    assert result == "challenge"
    generate.assert_called_once_with(
        account_id="account-1",
        email="user@example.com",
        token_type="email_code_login",
        additional_data={"code": "123456"},
    )
    send_mail.assert_called_once_with(language="en-US", to="user@example.com", code="123456")


def test_send_reset_password_code_rejects_rate_limited_email() -> None:
    gateway, limiter = token_gateway(limited=True)

    with (
        patch("services.web_authentication_adapters.TokenManager.generate_token") as generate,
        patch("services.web_authentication_adapters.send_reset_password_mail_task.delay") as send_mail,
        pytest.raises(WebEmailDeliveryRateLimitError) as exc_info,
    ):
        gateway.send_reset_password_code(account_id="account-1", email="user@example.com", language="en-US")

    assert exc_info.value.flow == "reset_password"
    assert exc_info.value.retry_after_minutes == 10
    generate.assert_not_called()
    send_mail.assert_not_called()
    limiter.increment_rate_limit.assert_not_called()


def test_send_reset_password_code_persists_challenge_queues_mail_and_increments_limit() -> None:
    gateway, limiter = token_gateway()

    with (
        patch.object(gateway, "_generate_code", return_value="654321"),
        patch("services.web_authentication_adapters.TokenManager.generate_token", return_value="challenge") as generate,
        patch("services.web_authentication_adapters.send_reset_password_mail_task.delay") as send_mail,
    ):
        result = gateway.send_reset_password_code(
            account_id="account-1",
            email="user@example.com",
            language="zh-Hans",
        )

    assert result == "challenge"
    generate.assert_called_once_with(
        account_id="account-1",
        email="user@example.com",
        token_type="reset_password",
        additional_data={"code": "654321"},
    )
    send_mail.assert_called_once_with(language="zh-Hans", to="user@example.com", code="654321")
    limiter.increment_rate_limit.assert_called_once_with("user@example.com")


def test_token_lookup_returns_none_when_token_manager_has_no_data() -> None:
    gateway, _ = token_gateway()

    with patch("services.web_authentication_adapters.TokenManager.get_token_data", return_value=None) as get_data:
        assert gateway.get_email_login_token("missing") is None

    get_data.assert_called_once_with("missing", "email_code_login")


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        pytest.param(
            {"email": "user@example.com", "code": "123456", "phase": "reset"},
            ("user@example.com", "123456", "reset"),
            id="string-fields",
        ),
        pytest.param(
            {"email": 1, "code": object(), "phase": False},
            (None, None, None),
            id="invalid-field-types",
        ),
    ],
)
def test_reset_token_lookup_filters_untrusted_field_types(
    data: dict[str, object],
    expected: tuple[str | None, str | None, str | None],
) -> None:
    gateway, _ = token_gateway()

    with patch("services.web_authentication_adapters.TokenManager.get_token_data", return_value=data):
        result = gateway.get_reset_password_token("challenge")

    assert result is not None
    assert (result.email, result.code, result.phase) == expected


def test_replace_and_revoke_tokens_use_their_expected_token_types() -> None:
    gateway, _ = token_gateway()

    with (
        patch(
            "services.web_authentication_adapters.TokenManager.generate_token",
            return_value="replacement",
        ) as generate,
        patch("services.web_authentication_adapters.TokenManager.revoke_token") as revoke,
    ):
        result = gateway.replace_reset_password_token(email="user@example.com", code="123456")
        gateway.revoke_email_login_token("email-token")
        gateway.revoke_reset_password_token("reset-token")

    assert result == "replacement"
    generate.assert_called_once_with(
        email="user@example.com",
        token_type="reset_password",
        additional_data={"code": "123456", "phase": "reset"},
    )
    assert revoke.call_args_list == [
        call("email-token", "email_code_login"),
        call("reset-token", "reset_password"),
    ]


def test_generate_code_uses_six_random_digits() -> None:
    with patch("services.web_authentication_adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6]) as randbelow:
        assert TokenManagerWebAuthenticationGateway._generate_code() == "123456"

    assert randbelow.call_count == 6
    randbelow.assert_called_with(10)


def test_security_gateway_delegates_rate_limits_to_account_service() -> None:
    account_service = MagicMock()
    account_service.is_email_send_ip_limit.return_value = 1
    account_service.is_forgot_password_error_rate_limit.return_value = 0
    gateway = AccountServiceWebAuthenticationSecurityGateway(account_service=account_service)

    assert gateway.is_email_send_ip_limited("203.0.113.1") is True
    assert gateway.is_password_reset_verification_limited("user@example.com") is False
    gateway.record_password_reset_verification_failure("user@example.com")
    gateway.reset_password_reset_verification_failures("user@example.com")
    gateway.reset_login_failures("user@example.com")

    account_service.is_email_send_ip_limit.assert_called_once_with("203.0.113.1")
    account_service.is_forgot_password_error_rate_limit.assert_called_once_with("user@example.com")
    account_service.add_forgot_password_error_rate_limit.assert_called_once_with("user@example.com")
    account_service.reset_forgot_password_error_rate_limit.assert_called_once_with("user@example.com")
    account_service.reset_login_error_rate_limit.assert_called_once_with("user@example.com")


@dataclass
class SessionQueryFake:
    session: WebAppSessionRecord | None = WebAppSessionRecord(end_user_session_id="session-1")
    calls: list[tuple[str, str, str]] = field(default_factory=list)

    def find_active_session(self, *, app_id: str, app_code: str, end_user_id: str) -> WebAppSessionRecord | None:
        self.calls.append((app_id, app_code, end_user_id))
        return self.session


@dataclass
class AppAccessFake:
    authentication_required: bool = False
    permission_required: bool = False
    user_allowed: bool = True
    checked_users: list[tuple[str, str]] = field(default_factory=list)

    def requires_authentication(self, app_id: str) -> bool:
        assert app_id == "app-1"
        return self.authentication_required

    def requires_permission_check(self, app_id: str) -> bool:
        assert app_id == "app-1"
        return self.permission_required

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        self.checked_users.append((user_id, app_id))
        return self.user_allowed

    def find_app_id_by_code(self, app_code: str) -> str | None:
        raise AssertionError(f"unused in session adapter: {app_code}")


_DEFAULT_SESSION = WebAppSessionRecord(end_user_session_id="session-1")


def passport_session_gateway(
    *,
    session: WebAppSessionRecord | None = _DEFAULT_SESSION,
    authentication_required: bool = False,
    permission_required: bool = False,
    user_allowed: bool = True,
) -> tuple[PassportWebAppSessionGateway, SessionQueryFake, AppAccessFake]:
    sessions = SessionQueryFake(session=session)
    access = AppAccessFake(
        authentication_required=authentication_required,
        permission_required=permission_required,
        user_allowed=user_allowed,
    )
    return PassportWebAppSessionGateway(sessions=sessions, app_access=access), sessions, access


def valid_session_claims(**overrides: object) -> dict[str, object]:
    claims: dict[str, object] = {
        "app_code": "site-code",
        "app_id": "app-1",
        "end_user_id": "end-user-1",
        "token_source": "api",
    }
    claims.update(overrides)
    return claims


def test_session_verification_rejects_missing_token_without_decoding() -> None:
    gateway, _, _ = passport_session_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        assert gateway.verify(token=None, app_code="site-code", user_id=None) is False

    passport_service.assert_not_called()


def test_session_verification_queries_active_session_and_accepts_public_app() -> None:
    gateway, sessions, _ = passport_session_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        passport_service.return_value.verify.return_value = valid_session_claims()

        result = gateway.verify(token="passport", app_code="site-code", user_id="session-1")

    assert result is True
    assert sessions.calls == [("app-1", "site-code", "end-user-1")]


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param(valid_session_claims(app_code=1), id="app-code"),
        pytest.param(valid_session_claims(app_id=1), id="app-id"),
        pytest.param(valid_session_claims(end_user_id=1), id="end-user-id"),
    ],
)
def test_session_verification_rejects_malformed_identity_claims(claims: dict[str, object]) -> None:
    gateway, sessions, _ = passport_session_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        passport_service.return_value.verify.return_value = claims

        assert gateway.verify(token="passport", app_code="site-code", user_id=None) is False

    assert sessions.calls == []


@pytest.mark.parametrize(
    ("session", "user_id"),
    [
        pytest.param(None, None, id="no-active-session"),
        pytest.param(WebAppSessionRecord(end_user_session_id="session-1"), "other-session", id="user-mismatch"),
    ],
)
def test_session_verification_rejects_missing_or_mismatched_session(
    session: WebAppSessionRecord | None,
    user_id: str | None,
) -> None:
    gateway, _, _ = passport_session_gateway(session=session)

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        passport_service.return_value.verify.return_value = valid_session_claims()

        assert gateway.verify(token="passport", app_code="site-code", user_id=user_id) is False


def test_session_verification_treats_decoder_errors_as_invalid() -> None:
    gateway, _, _ = passport_session_gateway()

    with patch("services.web_authentication_adapters.PassportService") as passport_service:
        passport_service.return_value.verify.side_effect = ValueError("bad signature")

        assert gateway.verify(token="passport", app_code="site-code", user_id=None) is False


@pytest.mark.parametrize(
    ("claims", "permission_required", "user_allowed"),
    [
        pytest.param({"token_source": "api"}, False, True, id="wrong-source"),
        pytest.param({"token_source": "webapp", "user_id": 1}, False, True, id="invalid-user-id"),
        pytest.param(
            {"token_source": "webapp", "user_id": "user-1"},
            True,
            False,
            id="permission-denied",
        ),
        pytest.param(
            {"token_source": "webapp", "user_id": "user-1", "granted_at": "yesterday"},
            False,
            True,
            id="invalid-granted-at",
        ),
        pytest.param(
            {"token_source": "webapp", "user_id": "user-1", "granted_at": 100, "auth_type": "unknown"},
            False,
            True,
            id="unknown-auth-type",
        ),
    ],
)
def test_private_app_claims_reject_invalid_authorization(
    claims: dict[str, object],
    permission_required: bool,
    user_allowed: bool,
) -> None:
    gateway, _, access = passport_session_gateway(
        authentication_required=True,
        permission_required=permission_required,
        user_allowed=user_allowed,
    )

    assert gateway._verify_webapp_auth_claims(claims, "app-1") is False
    if permission_required and isinstance(claims.get("user_id"), str):
        assert access.checked_users == [("user-1", "app-1")]


@pytest.mark.parametrize(
    ("auth_type", "settings_method"),
    [
        pytest.param("external", "get_app_sso_settings_last_update_time", id="external"),
        pytest.param("internal", "get_workspace_sso_settings_last_update_time", id="internal"),
    ],
)
@pytest.mark.parametrize("granted_at", [99.0, 100.0], ids=["stale", "current"])
def test_private_app_claims_compare_grant_with_sso_settings_update(
    auth_type: str,
    settings_method: str,
    granted_at: float,
) -> None:
    gateway, _, _ = passport_session_gateway(authentication_required=True)
    claims = {
        "token_source": "webapp",
        "user_id": "user-1",
        "granted_at": granted_at,
        "auth_type": auth_type,
    }

    with patch(
        f"services.web_authentication_adapters.EnterpriseService.{settings_method}",
        return_value=datetime.fromtimestamp(100, tz=UTC),
    ):
        result = gateway._verify_webapp_auth_claims(claims, "app-1")

    assert result is (granted_at >= 100)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        pytest.param("api", True, id="ordinary-session"),
        pytest.param("webapp", False, id="stale-private-session"),
    ],
)
def test_public_app_claims_reject_private_webapp_session(source: str, expected: bool) -> None:
    gateway, _, _ = passport_session_gateway(authentication_required=False)

    assert gateway._verify_webapp_auth_claims({"token_source": source}, "app-1") is expected


def test_login_failure_audit_writes_structured_warning() -> None:
    logger = MagicMock()
    gateway = LoggingWebAuthenticationAuditGateway(logger=logger)

    gateway.login_failed(
        email="user@example.com",
        reason=LoginFailureReason.INVALID_CREDENTIALS,
        ip_address="203.0.113.1",
    )

    logger.warning.assert_called_once_with(
        "Web login failed: email=%s reason=%s ip_address=%s",
        "user@example.com",
        LoginFailureReason.INVALID_CREDENTIALS,
        "203.0.113.1",
    )
