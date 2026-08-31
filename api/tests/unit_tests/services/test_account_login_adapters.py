from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import cast, override
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from services import account_errors
from services import account_login_adapters as adapters
from services.email_code_login_challenge import (
    EmailCodeLoginChallengeResult,
    EmailCodeLoginChallengeStatus,
    EmailCodeLoginChallengeUnavailableError,
)
from services.entities.account_login_entities import AuthTokenPair, EmailCodeChallengeStatus, RefreshAccountStatus
from services.turnstile_service import TurnstileChallengeRejectedError, TurnstileUpstreamError


class FakeRateLimiter(RateLimiter):
    def __init__(self, *, limited: bool = False, time_window: int = 300) -> None:
        self.limited = limited
        self.time_window = time_window
        self.recorded: list[str] = []

    @override
    def is_rate_limited(self, email: str) -> bool:
        return self.limited

    @override
    def increment_rate_limit(self, email: str) -> None:
        self.recorded.append(email)


@dataclass
class FakeTask:
    calls: list[dict[str, object]] = field(default_factory=list)

    def delay(self, **kwargs: object) -> None:
        self.calls.append(kwargs)


def _persist_account(session: Session) -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "account-1"
    session.add(account)
    session.commit()
    return account


def test_security_gateway_owns_login_failure_state() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [b"6", b"2"]
    gateway = adapters.RedisConsoleAuthSecurityGateway(redis=cast(RedisClientWrapper, redis))

    assert gateway.is_login_limited("user@example.com") is True
    gateway.record_login_failure("user@example.com")
    gateway.reset_login_failures("user@example.com")

    redis.setex.assert_called_once_with(
        "login_error_rate_limit:user@example.com",
        adapters.dify_config.LOGIN_LOCKOUT_DURATION,
        3,
    )
    redis.delete.assert_called_once_with("login_error_rate_limit:user@example.com")


def test_security_gateway_owns_email_send_ip_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [None, b"2", None]
    redis.set.return_value = True
    monkeypatch.setattr(adapters.dify_config, "EMAIL_SEND_IP_LIMIT_PER_MINUTE", 1)
    gateway = adapters.RedisConsoleAuthSecurityGateway(redis=cast(RedisClientWrapper, redis))

    assert gateway.is_email_send_ip_limited("127.0.0.1") is True
    redis.set.assert_called_once_with("email_send_ip_limit_hour:127.0.0.1", 1, ex=600, nx=True)


def test_session_gateway_owns_refresh_token_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    issued_payloads: list[dict[str, object]] = []

    class FakePassportService:
        def issue(self, payload: dict[str, object]) -> str:
            issued_payloads.append(payload)
            return "access"

    monkeypatch.setattr(adapters, "PassportService", FakePassportService)
    monkeypatch.setattr(adapters.secrets, "token_hex", lambda _length: "refresh")
    monkeypatch.setattr(adapters, "generate_csrf_token", lambda _account_id: "csrf")
    gateway = adapters.RedisAccountSessionGateway(redis=cast(RedisClientWrapper, redis))

    result = gateway.issue("account-1")

    assert result == AuthTokenPair(access_token="access", refresh_token="refresh", csrf_token="csrf")
    assert issued_payloads[0]["user_id"] == "account-1"
    assert redis.setex.call_args_list[0].args[0] == "refresh_token:refresh"
    assert redis.setex.call_args_list[1].args[0] == "account_refresh_token:account-1"


def test_session_gateway_resolves_rotates_and_revokes_refresh_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.side_effect = [b"account-1", b"stored-refresh"]
    gateway = adapters.RedisAccountSessionGateway(redis=cast(RedisClientWrapper, redis))
    monkeypatch.setattr(
        gateway,
        "_issue",
        lambda _account_id: AuthTokenPair(access_token="new-access", refresh_token="new-refresh", csrf_token="csrf"),
    )

    assert gateway.resolve_refresh_token("refresh") == "account-1"
    assert gateway.rotate(refresh_token="refresh", account_id="account-1").refresh_token == "new-refresh"
    gateway.revoke("account-1")

    deleted_keys = [call.args[0] for call in redis.delete.call_args_list]
    assert deleted_keys == [
        "refresh_token:refresh",
        "account_refresh_token:account-1",
        "refresh_token:stored-refresh",
        "account_refresh_token:account-1",
    ]


def test_session_gateway_returns_none_for_unknown_refresh_token() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.return_value = None

    assert (
        adapters.RedisAccountSessionGateway(redis=cast(RedisClientWrapper, redis)).resolve_refresh_token("bad-token")
        is None
    )


def test_workspace_provisioning_gateway_persists_owner_workspace(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist_account(sqlite_session)
    gateway = adapters.SQLAlchemyConsoleAuthProvisioningGateway(session_factory=sqlite_session_factory)
    monkeypatch.setattr(adapters, "generate_key_pair", lambda _tenant_id: "public-key")
    monkeypatch.setattr(gateway, "_after_workspace_created", lambda _tenant, _account_id: None)

    gateway.create_owner_workspace("account-1")

    with sqlite_session_factory() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == "account-1"))
        assert membership is not None
        assert membership.role == TenantAccountRole.OWNER
        assert session.get(Tenant, membership.tenant_id) is not None


def test_workspace_provisioning_gateway_rejects_missing_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway = adapters.SQLAlchemyConsoleAuthProvisioningGateway(session_factory=sqlite_session_factory)

    with pytest.raises(account_errors.AccountNotFoundError):
        gateway.create_owner_workspace("missing-account")


@pytest.mark.parametrize(
    ("status", "with_workspace", "expected_status"),
    [
        (AccountStatus.ACTIVE, True, RefreshAccountStatus.READY),
        (AccountStatus.ACTIVE, False, RefreshAccountStatus.NOT_FOUND),
        (AccountStatus.BANNED, False, RefreshAccountStatus.BANNED),
    ],
)
def test_refresh_preparation_gateway_owns_account_state_query(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    status: AccountStatus,
    with_workspace: bool,
    expected_status: RefreshAccountStatus,
) -> None:
    account = _persist_account(sqlite_session)
    account.status = status
    if with_workspace:
        tenant = Tenant(name="Workspace")
        sqlite_session.add(tenant)
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
                current=True,
            )
        )
    sqlite_session.commit()
    gateway = adapters.SQLAlchemyAccountRefreshPreparationGateway(session_factory=sqlite_session_factory)

    assert gateway.prepare("account-1") == expected_status


@pytest.mark.parametrize(
    ("provider_error", "application_error", "level", "message", "has_exception_info"),
    [
        (
            TurnstileChallengeRejectedError(),
            account_errors.HumanVerificationRejectedError,
            logging.INFO,
            "Turnstile rejected an email-code verification challenge",
            False,
        ),
        (
            TurnstileUpstreamError(),
            account_errors.HumanVerificationUnavailableError,
            logging.WARNING,
            "Turnstile verification is unavailable",
            True,
        ),
    ],
)
def test_turnstile_gateway_maps_provider_failures(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provider_error: Exception,
    application_error: type[Exception],
    level: int,
    message: str,
    has_exception_info: bool,
) -> None:
    def verify(**_kwargs: object) -> None:
        raise provider_error

    monkeypatch.setattr(adapters.TurnstileService, "verify", verify)

    with caplog.at_level(level, logger=adapters.__name__):
        with pytest.raises(application_error):
            adapters.TurnstileHumanVerificationGateway().verify(
                token="challenge",
                remote_ip="127.0.0.1",
                action="signin_code_verify",
            )

    record = caplog.records[-1]
    assert record.getMessage() == message
    assert (record.exc_info is not None) is has_exception_info


def test_provisioning_gateway_persists_account_and_workspace_atomically(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = adapters.SQLAlchemyConsoleAuthProvisioningGateway(session_factory=sqlite_session_factory)
    monkeypatch.setattr(adapters, "generate_key_pair", lambda _tenant_id: "public-key")
    monkeypatch.setattr(gateway, "_after_workspace_created", lambda _tenant, _account_id: None)

    account_id = gateway.create_with_owner_workspace(
        email="user@example.com",
        name="User",
        interface_language="en-US",
        timezone="UTC",
        ip_address="127.0.0.1",
    )

    with sqlite_session_factory() as session:
        account = session.get(Account, account_id)
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == account_id))
        assert account is not None
        assert account.normalized_email == "user@example.com"
        assert account.timezone == "UTC"
        assert membership is not None


def test_provisioning_gateway_rejects_equivalent_normalized_email(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(
        Account(
            name="Existing User",
            email="u.ser+existing@gmail.com",
            normalized_email="user@gmail.com",
        )
    )
    sqlite_session.commit()
    gateway = adapters.SQLAlchemyConsoleAuthProvisioningGateway(session_factory=sqlite_session_factory)

    with pytest.raises(account_errors.AccountNormalizedEmailAlreadyInUseError):
        gateway.create_with_owner_workspace(
            email="user@googlemail.com",
            name="New User",
            interface_language="en-US",
            timezone="UTC",
            ip_address="127.0.0.1",
        )


def test_email_code_gateway_sends_and_maps_shared_challenge_status(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = FakeRateLimiter()
    task = FakeTask()
    created: list[tuple[str | None, str, str]] = []
    verified: list[tuple[str, str, str]] = []

    def create(*, account_id: str | None, email: str, code: str) -> str:
        created.append((account_id, email, code))
        return "challenge-token"

    def verify(*, email: str, code: str, token: str) -> EmailCodeLoginChallengeResult:
        verified.append((email, code, token))
        return EmailCodeLoginChallengeResult(status=EmailCodeLoginChallengeStatus.EMAIL_MISMATCH)

    monkeypatch.setattr(adapters.EmailCodeLoginChallengeStore, "create", create)
    monkeypatch.setattr(adapters.EmailCodeLoginChallengeStore, "verify", verify)
    monkeypatch.setattr(adapters, "send_email_code_login_mail_task", task)
    gateway = adapters.RedisEmailCodeGateway(rate_limiter=limiter)

    token = gateway.send(
        account_id="account-1",
        normalized_email="User@Example.COM",
        recipient_email="Historical@Example.COM",
        language="en-US",
    )

    assert token == "challenge-token"
    assert created[0][1] == "user@example.com"
    assert len(created[0][2]) == 6
    assert task.calls[0]["to"] == "Historical@Example.COM"
    assert limiter.recorded == ["user@example.com"]
    assert (
        gateway.verify(normalized_email="User@Example.COM", code="123456", token="challenge-token")
        == EmailCodeChallengeStatus.EMAIL_MISMATCH
    )
    assert verified == [("user@example.com", "123456", "challenge-token")]


def test_email_code_gateway_maps_challenge_store_outage(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def create(**_kwargs: object) -> str:
        raise EmailCodeLoginChallengeUnavailableError

    monkeypatch.setattr(adapters.EmailCodeLoginChallengeStore, "create", create)
    gateway = adapters.RedisEmailCodeGateway(rate_limiter=FakeRateLimiter())

    with caplog.at_level(logging.WARNING, logger=adapters.__name__):
        with pytest.raises(account_errors.EmailCodeLoginUnavailableError):
            gateway.send(
                account_id=None,
                normalized_email="user@example.com",
                recipient_email="user@example.com",
                language="en-US",
            )

    record = caplog.records[-1]
    assert record.getMessage() == "Email-code challenge creation is unavailable"
    assert record.exc_info is not None


def test_email_code_gateway_logs_challenge_verification_outage(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def verify(**_kwargs: object) -> EmailCodeLoginChallengeResult:
        raise EmailCodeLoginChallengeUnavailableError

    monkeypatch.setattr(adapters.EmailCodeLoginChallengeStore, "verify", verify)
    gateway = adapters.RedisEmailCodeGateway(rate_limiter=FakeRateLimiter())

    with caplog.at_level(logging.WARNING, logger=adapters.__name__):
        with pytest.raises(account_errors.EmailCodeLoginUnavailableError):
            gateway.verify(normalized_email="user@example.com", code="123456", token="challenge-token")

    record = caplog.records[-1]
    assert record.getMessage() == "Email-code challenge verification is unavailable"
    assert record.exc_info is not None


def test_reset_password_gateway_uses_neutral_identity_values(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = FakeRateLimiter(time_window=60)
    existing_task = FakeTask()
    missing_task = FakeTask()
    token_calls: list[dict[str, object]] = []

    def generate_token(**kwargs: object) -> str:
        token_calls.append(kwargs)
        return "reset-token"

    monkeypatch.setattr(adapters.TokenManager, "generate_token", generate_token)
    monkeypatch.setattr(adapters, "send_reset_password_mail_task", existing_task)
    monkeypatch.setattr(adapters, "send_reset_password_mail_task_when_account_not_exist", missing_task)
    gateway = adapters.RedisResetPasswordEmailGateway(rate_limiter=limiter)

    result = gateway.send(
        account_id="account-1",
        email="user@example.com",
        language="en-US",
        registration_allowed=True,
    )

    assert result == "reset-token"
    assert token_calls[0]["account_id"] == "account-1"
    assert existing_task.calls[0]["to"] == "user@example.com"
    assert missing_task.calls == []
    assert limiter.recorded == ["user@example.com"]


def test_email_gateways_raise_framework_neutral_rate_limit_errors() -> None:
    with pytest.raises(account_errors.EmailCodeSendRateLimitError) as email_code_error:
        adapters.RedisEmailCodeGateway(rate_limiter=FakeRateLimiter(limited=True)).send(
            account_id=None,
            normalized_email="user@example.com",
            recipient_email="user@example.com",
            language="en-US",
        )
    with pytest.raises(account_errors.ResetPasswordEmailRateLimitError) as reset_error:
        adapters.RedisResetPasswordEmailGateway(rate_limiter=FakeRateLimiter(limited=True, time_window=60)).send(
            account_id=None,
            email="user@example.com",
            language="en-US",
            registration_allowed=True,
        )

    assert email_code_error.value.retry_after_minutes == 5
    assert reset_error.value.retry_after_minutes == 1
