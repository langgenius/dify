from __future__ import annotations

import logging
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import override
from unittest.mock import MagicMock, call

import pytest
from redis.crc import key_slot
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services import account_errors
from services.account import login_adapters as adapters
from services.account.adapters import (
    BillingAccountActivationEligibility,
    BillingWorkspaceMembershipCache,
    DeploymentWorkspaceInvitePolicy,
    RBACWorkspaceMemberAccessSync,
    RedisInvitationTokenStore,
)
from services.account.console_tokens import verify_console_access_token
from services.account_activation_service import AccountActivationService
from services.email_code_login_challenge import (
    EmailCodeLoginChallengeResult,
    EmailCodeLoginChallengeStatus,
    EmailCodeLoginChallengeUnavailableError,
)
from services.entities.account_activation_entities import InvitationToken
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import (
    EmailCodeChallengeStatus,
    PasswordLoginCommand,
    RefreshAccountStatus,
)
from services.turnstile_service import TurnstileChallengeRejectedError, TurnstileUpstreamError
from tests.unit_tests.account_domain import AccountDomain
from tests.unit_tests.services.account.test_login_service import Dependencies


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

    @override
    @contextmanager
    def reserve(self, email: str) -> Generator[bool]:
        yield not self.limited
        if not self.limited:
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


def test_invitation_gateway_restores_editor_membership_without_revoking_token(
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = (
        b'{"account_id":"account-1","email":"user@example.com","workspace_id":"workspace-1",'
        b'"role":"editor","requires_setup":false}'
    )
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="user@example.com", status=AccountStatus.ACTIVE)
        account.id = "account-1"
        tenant = Tenant(name="Workspace")
        tenant.id = "workspace-1"
        session.add_all([account, tenant])
    tokens = RedisInvitationTokenStore(redis=redis)
    accounts = SQLAlchemyAccountActivationRepository(sqlite_session_factory)
    activation = AccountActivationService(
        tokens=tokens,
        accounts=accounts,
        workspace_policy=DeploymentWorkspaceInvitePolicy(),
        eligibility=BillingAccountActivationEligibility(enabled=False),
        membership_cache=BillingWorkspaceMembershipCache(enabled=False),
        member_access_sync=RBACWorkspaceMemberAccessSync(enabled=False),
    )
    gateway = adapters.AccountActivationConsoleAuthInvitationGateway(
        tokens=tokens,
        accounts=accounts,
        activation=activation,
    )

    commands.side_effect = lambda command, *_args, **_kwargs: (
        3600 if command == "PTTL" else b"OK" if command == "SET" else commands.return_value
    )
    assert gateway.ensure_membership(account_id="different-account", email="user@example.com", token="token-1") is False
    with sqlite_session_factory() as session:
        assert session.scalar(select(TenantAccountJoin)) is None
    assert gateway.ensure_membership(account_id="account-1", email="user@example.com", token="token-1") is True

    with sqlite_session_factory() as session:
        persisted = session.get(Account, "account-1")
        membership = session.scalar(select(TenantAccountJoin))
        assert persisted is not None
        assert persisted.id == "account-1"
        assert persisted.status == AccountStatus.ACTIVE
        assert persisted.name == "User"
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR
        assert membership.current is True
    assert not any(command.args and command.args[0] == "DEL" for command in commands.call_args_list)


def test_login_restores_membership_when_invitation_is_stored_under_prefixed_key(
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    config_overrides: Callable[..., None],
) -> None:
    redis, commands = redis_transport
    config_overrides(REDIS_KEY_PREFIX="enterprise-a")
    stored: dict[str, object] = {}

    def execute(command: object, *args: object, **_kwargs: object) -> object:
        operation, key = str(command).upper(), str(args[0])
        if operation == "SETEX":
            stored[key] = args[2]
            return True
        if operation == "GET":
            return stored.get(key)
        if operation == "PTTL":
            return 3600 if key in stored else -2
        if operation == "SET" and "NX" in args and key not in stored:
            stored[key] = b"1"
            return True
        return None

    commands.side_effect = execute
    with sqlite_session_factory.begin() as session:
        account = Account(
            name="User",
            email="user@example.com",
            status=AccountStatus.ACTIVE,
            password="hash",
            password_salt="salt",
        )
        account.id = "account-1"
        workspace = Tenant(name="Workspace")
        workspace.id = "workspace-1"
        session.add_all([account, workspace])
    tokens = RedisInvitationTokenStore(redis=redis)
    token = tokens.create(
        InvitationToken(
            account_id="account-1",
            email="user@example.com",
            workspace_id="workspace-1",
            role="editor",
            requires_setup=False,
        )
    )
    activation_accounts = SQLAlchemyAccountActivationRepository(sqlite_session_factory)
    gateway = adapters.AccountActivationConsoleAuthInvitationGateway(
        tokens=tokens,
        accounts=activation_accounts,
        activation=AccountActivationService(
            tokens=tokens,
            accounts=activation_accounts,
            workspace_policy=DeploymentWorkspaceInvitePolicy(),
            eligibility=BillingAccountActivationEligibility(enabled=False),
            membership_cache=BillingWorkspaceMembershipCache(enabled=False),
            member_access_sync=RBACWorkspaceMemberAccessSync(enabled=False),
        ),
    )
    dependencies = Dependencies()
    dependencies.accounts = SQLAlchemyAccountRepository(sqlite_session_factory)  # type: ignore[assignment]
    dependencies.workspaces = WorkspaceRepository(sqlite_session_factory)  # type: ignore[assignment]
    dependencies.invitations = gateway  # type: ignore[assignment]
    result = dependencies.service().login_with_password(
        PasswordLoginCommand(email="user@example.com", password="password", invite_token=token, ip_address="127.0.0.1")
    )

    assert f"enterprise-a:member_invite:token:{token}" in stored
    assert result.workspace_found is True
    assert result.tokens == AccountSessionTokens(access_token="access", refresh_token="refresh", csrf_token="csrf")
    with sqlite_session_factory() as session:
        membership = session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR


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


SESSION_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def session_gateway(
    redis_transport: tuple[RedisClientWrapper, MagicMock], config_overrides: Callable[..., None]
) -> adapters.RedisAccountSessionGateway:
    config_overrides(SECRET_KEY="session-test-signing-key-at-least-32-bytes")
    return adapters.RedisAccountSessionGateway(redis=redis_transport[0])


def test_session_gateway_issues_independent_credentials_with_only_hashes_in_storage(
    session_gateway: adapters.RedisAccountSessionGateway,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    _, commands = redis_transport
    commands.return_value = 1
    first = session_gateway.issue(SESSION_ACCOUNT_ID)
    second = session_gateway.issue(SESSION_ACCOUNT_ID)

    assert first.refresh_token != second.refresh_token
    assert first.refresh_token.split(".")[2] != second.refresh_token.split(".")[2]
    assert verify_console_access_token(first.access_token) == SESSION_ACCOUNT_ID
    assert verify_console_access_token(second.access_token) == SESSION_ACCOUNT_ID
    assert first.refresh_token not in repr(commands.call_args_list)
    assert second.refresh_token not in repr(commands.call_args_list)
    assert session_gateway._digest(first.refresh_token) in repr(commands.call_args_list)


@pytest.mark.parametrize("token", ["", "legacy-token", "a" * 128, "v2.{injected}.sid.secret", "v2." + "a" * 4096])
def test_session_gateway_rejects_malformed_and_legacy_credentials_without_redis(
    session_gateway: adapters.RedisAccountSessionGateway,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    token: str,
) -> None:
    _, commands = redis_transport
    assert session_gateway.resolve_refresh_token(token) is None
    session_gateway.revoke(token)
    with pytest.raises(account_errors.InvalidRefreshTokenError):
        session_gateway.rotate(refresh_token=token, account_id=SESSION_ACCOUNT_ID)
    commands.assert_not_called()


def test_session_gateway_binds_rotation_to_the_resolved_account(
    session_gateway: adapters.RedisAccountSessionGateway,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    _, commands = redis_transport
    token = f"v2.{SESSION_ACCOUNT_ID}.{'a' * 32}.{'b' * 64}"
    with pytest.raises(account_errors.InvalidRefreshTokenError):
        session_gateway.rotate(refresh_token=token, account_id="22222222-2222-4222-8222-222222222222")
    commands.assert_not_called()


def test_session_gateway_encrypts_and_reads_rotation_responses(
    session_gateway: adapters.RedisAccountSessionGateway,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    _, commands = redis_transport

    def accept_rotation(*args: object) -> bytes:
        encrypted = args[-1]
        assert isinstance(encrypted, str)
        return encrypted.encode()

    commands.side_effect = accept_rotation
    token = f"v2.{SESSION_ACCOUNT_ID}.{'a' * 32}.{'b' * 64}"
    rotated = session_gateway.rotate(refresh_token=token, account_id=SESSION_ACCOUNT_ID, request_id="retry-id")

    assert rotated.refresh_token != token
    assert rotated.refresh_token.split(".")[:3] == token.split(".")[:3]
    assert verify_console_access_token(rotated.access_token) == SESSION_ACCOUNT_ID
    assert token not in repr(commands.call_args_list)
    assert rotated.refresh_token not in repr(commands.call_args_list)


@pytest.mark.parametrize("reply", [None, b"corrupt-encrypted-response"])
def test_session_gateway_fails_closed_when_rotation_is_rejected_or_reply_is_invalid(
    session_gateway: adapters.RedisAccountSessionGateway,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    reply: bytes | None,
) -> None:
    _, commands = redis_transport
    commands.return_value = reply
    token = f"v2.{SESSION_ACCOUNT_ID}.{'a' * 32}.{'b' * 64}"
    with pytest.raises(account_errors.InvalidRefreshTokenError):
        session_gateway.rotate(refresh_token=token, account_id=SESSION_ACCOUNT_ID)


def test_session_gateway_keeps_script_keys_in_one_namespaced_cluster_slot(
    session_gateway: adapters.RedisAccountSessionGateway,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    config_overrides: Callable[..., None],
) -> None:
    _, commands = redis_transport
    config_overrides(REDIS_KEY_PREFIX="test-prefix:")
    commands.return_value = 1
    token = f"v2.{SESSION_ACCOUNT_ID}.{'a' * 32}.{'b' * 64}"
    assert session_gateway.resolve_refresh_token(token) == SESSION_ACCOUNT_ID
    args = commands.call_args.args
    keys = args[3:6]
    assert len(keys) == 3
    assert all(key.startswith("test-prefix:") for key in keys)
    assert len({key_slot(key.encode()) for key in keys}) == 1


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


def test_provisioning_persists_account_and_workspace_atomically(
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


@pytest.mark.parametrize("account_id", [None, "account-1"])
@pytest.mark.parametrize("registration_allowed", [False, True])
def test_email_code_gateway_sends_and_maps_shared_challenge_status(
    monkeypatch: pytest.MonkeyPatch, account_id: str | None, registration_allowed: bool
) -> None:
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
        account_id=account_id,
        normalized_email="User@Example.COM",
        recipient_email="Historical@Example.COM",
        language="en-US",
        registration_allowed=registration_allowed,
    )

    assert token == "challenge-token"
    assert created[0][1] == "user@example.com"
    assert len(created[0][2]) == 6
    if account_id is not None or registration_allowed:
        assert task.calls[0]["to"] == "Historical@Example.COM"
    else:
        assert task.calls == []
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
                registration_allowed=False,
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
            registration_allowed=False,
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


@pytest.mark.parametrize("account_id", [None, "account-1"])
@pytest.mark.parametrize("failure_stage", ["token", "notification"])
def test_reset_password_gateway_releases_reservation_after_failure(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
    account_id: str | None,
    failure_stage: str,
) -> None:
    redis, commands = redis_transport
    commands.return_value = 1
    limiter = RateLimiter(prefix="reset", max_attempts=1, time_window=60, redis_client=redis)
    gateway = adapters.RedisResetPasswordEmailGateway(rate_limiter=limiter)

    def generate_token(**_kwargs: object) -> str:
        if failure_stage == "token":
            raise RuntimeError("temporary failure")
        return "token"

    def queue_mail(**_kwargs: object) -> None:
        raise RuntimeError("temporary failure")

    monkeypatch.setattr(adapters.TokenManager, "generate_token", generate_token)
    monkeypatch.setattr(adapters.send_reset_password_mail_task, "delay", queue_mail)
    monkeypatch.setattr(adapters.send_reset_password_mail_task_when_account_not_exist, "delay", queue_mail)

    with pytest.raises(RuntimeError, match="temporary failure"):
        gateway.send(account_id=account_id, email="user@example.com", language="en-US", registration_allowed=True)

    assert commands.call_args_list[0].args[0] == "EVALSHA"
    assert commands.call_args_list[-1].args[:2] == ("ZREM", "reset:user@example.com")
