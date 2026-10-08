from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import override
from unittest.mock import MagicMock, call

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import ContactSubjectType, HumanInputContactIdentity
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.human_input_v2.contact import ContactError, ContactErrorCode
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from services import account_errors
from services.account import login_adapters as adapters
from services.email_code_login_challenge import (
    EmailCodeLoginChallengeResult,
    EmailCodeLoginChallengeStatus,
    EmailCodeLoginChallengeUnavailableError,
)
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import EmailCodeChallengeStatus, RefreshAccountStatus
from services.turnstile_service import TurnstileChallengeRejectedError, TurnstileUpstreamError
from services.workspace import gateways
from tests.unit_tests.account_domain import AccountDomain


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


def test_security_gateway_owns_login_failure_state(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport
    commands.side_effect = [b"6", b"2", True, 1]
    gateway = adapters.RedisConsoleAuthSecurityGateway(redis=redis)

    assert gateway.is_login_limited("user@example.com") is True
    gateway.record_login_failure("user@example.com")
    gateway.reset_login_failures("user@example.com")

    key = "login_error_rate_limit:user@example.com"
    assert commands.call_args_list == [
        call("GET", key, keys=[key]),
        call("GET", key, keys=[key]),
        call("SETEX", key, adapters.dify_config.LOGIN_LOCKOUT_DURATION, 3),
        call("DEL", key),
    ]


def test_security_gateway_owns_email_send_ip_limit(
    redis_transport: tuple[RedisClientWrapper, MagicMock], config_overrides: Callable[..., None]
) -> None:
    redis, commands = redis_transport
    commands.side_effect = [None, b"2", None, True]
    config_overrides(EMAIL_SEND_IP_LIMIT_PER_MINUTE=1)
    gateway = adapters.RedisConsoleAuthSecurityGateway(redis=redis)

    assert gateway.is_email_send_ip_limited("127.0.0.1") is True
    freeze_key = "email_send_ip_limit_freeze:127.0.0.1"
    minute_key = "email_send_ip_limit_minute:127.0.0.1"
    hour_key = "email_send_ip_limit_hour:127.0.0.1"
    assert commands.call_args_list == [
        call("GET", freeze_key, keys=[freeze_key]),
        call("GET", minute_key, keys=[minute_key]),
        call("GET", hour_key, keys=[hour_key]),
        call("SET", hour_key, 1, "NX", "EX", 600),
    ]


def test_session_gateway_owns_refresh_token_storage(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    redis, commands = redis_transport
    issued_payloads: list[dict[str, object]] = []

    class FakePassportService:
        def issue(self, payload: dict[str, object]) -> str:
            issued_payloads.append(payload)
            return "access"

    monkeypatch.setattr(adapters, "PassportService", FakePassportService)
    monkeypatch.setattr(adapters.secrets, "token_hex", lambda _length: "refresh")
    monkeypatch.setattr(adapters, "generate_csrf_token", lambda _account_id: "csrf")
    gateway = adapters.RedisAccountSessionGateway(redis=redis)

    result = gateway.issue("account-1")

    assert result == AccountSessionTokens(access_token="access", refresh_token="refresh", csrf_token="csrf")
    assert issued_payloads[0]["user_id"] == "account-1"
    expires_in = int(timedelta(days=adapters.dify_config.REFRESH_TOKEN_EXPIRE_DAYS).total_seconds())
    assert commands.call_args_list == [
        call("SETEX", "refresh_token:refresh", expires_in, "account-1"),
        call("SETEX", "account_refresh_token:account-1", expires_in, "refresh"),
    ]


def test_session_gateway_resolves_rotates_and_revokes_refresh_tokens(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    redis, commands = redis_transport
    commands.side_effect = [b"account-1", 1, 1, b"stored-refresh", 1, 1]
    gateway = adapters.RedisAccountSessionGateway(redis=redis)
    monkeypatch.setattr(
        gateway,
        "_issue",
        lambda _account_id: AccountSessionTokens(
            access_token="new-access", refresh_token="new-refresh", csrf_token="csrf"
        ),
    )

    assert gateway.resolve_refresh_token("refresh") == "account-1"
    assert gateway.rotate(refresh_token="refresh", account_id="account-1").refresh_token == "new-refresh"
    gateway.revoke("account-1")

    deleted_keys = [call.args[1] for call in commands.call_args_list if call.args[0] == "DEL"]
    assert deleted_keys == [
        "refresh_token:refresh",
        "account_refresh_token:account-1",
        "refresh_token:stored-refresh",
        "account_refresh_token:account-1",
    ]
    assert commands.call_count == 6


def test_session_gateway_returns_none_for_unknown_refresh_token(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = None

    assert adapters.RedisAccountSessionGateway(redis=redis).resolve_refresh_token("bad-token") is None


def test_workspace_provisioning_persists_owner_workspace(
    account_domain: AccountDomain,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_account(sqlite_session)
    gateway = account_domain.provisioning

    gateway.ensure_owner_workspace("account-1")

    with sqlite_session_factory() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == "account-1"))
        assert membership is not None
        assert membership.role == TenantAccountRole.OWNER
        assert session.get(Tenant, membership.tenant_id) is not None
        assert (
            session.scalar(
                select(HumanInputContactIdentity.id).where(HumanInputContactIdentity.account_id == "account-1")
            )
            is not None
        )


def test_workspace_provisioning_rejects_missing_account(
    account_domain: AccountDomain,
) -> None:
    gateway = account_domain.provisioning

    with pytest.raises(account_errors.AccountNotFoundError):
        gateway.ensure_owner_workspace("missing-account")


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
    gateway = adapters.SQLAlchemyAccountRefreshPreparationGateway(
        accounts=SQLAlchemyAccountRepository(sqlite_session_factory)
    )

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


def test_provisioning_persists_account_contact_and_workspace_atomically(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway = account_domain.provisioning

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
        contact = session.scalars(
            select(HumanInputContactIdentity).where(HumanInputContactIdentity.account_id == account_id)
        ).one()
        assert contact.subject_type == ContactSubjectType.ACCOUNT


def test_provisioning_rolls_back_when_contact_creation_fails(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = account_domain.provisioning
    monkeypatch.setattr(
        SQLAlchemyContactRepository,
        "provision_account_backed_contact",
        MagicMock(side_effect=ContactError(ContactErrorCode.CONFLICT, "Contact creation failed")),
    )

    with pytest.raises(ContactError, match="Contact creation failed"):
        gateway.create_with_owner_workspace(
            email="user@example.com",
            name="User",
            interface_language="en-US",
            timezone="UTC",
            ip_address="127.0.0.1",
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(Account)) is None
        assert session.scalar(select(HumanInputContactIdentity)) is None
        assert session.scalar(select(Tenant)) is None
        assert session.scalar(select(TenantAccountJoin)) is None


def test_provisioning_rolls_back_account_and_contact_when_workspace_creation_fails(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = account_domain.provisioning
    monkeypatch.setattr(gateways, "generate_key_pair", MagicMock(side_effect=ValueError("Key generation failed")))

    with pytest.raises(ValueError, match="Key generation failed"):
        gateway.create_with_owner_workspace(
            email="user@example.com",
            name="User",
            interface_language="en-US",
            timezone="UTC",
            ip_address="127.0.0.1",
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(Account)) is None
        assert session.scalar(select(HumanInputContactIdentity)) is None
        assert session.scalar(select(Tenant)) is None
        assert session.scalar(select(TenantAccountJoin)) is None


def test_provisioning_rejects_equivalent_normalized_email(
    account_domain: AccountDomain,
    sqlite_session: Session,
) -> None:
    sqlite_session.add(
        Account(
            name="Existing User",
            email="u.ser+existing@gmail.com",
            normalized_email="user@gmail.com",
        )
    )
    sqlite_session.commit()
    gateway = account_domain.provisioning

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
