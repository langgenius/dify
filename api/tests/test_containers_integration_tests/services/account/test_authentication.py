"""Account authentication against PostgreSQL and real Redis session indexes."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from libs.passport import PassportService
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from services.account.login_adapters import RedisAccountSessionGateway
from services.account_errors import (
    AccountLoginError,
    AccountNotFoundError,
    AccountPasswordError,
    InvalidRefreshTokenError,
)
from services.account_password_hasher import DefaultAccountPasswordHasher
from services.entities.account_entities import AccountSessionTokens

PASSWORD = "ValidPassword123!"


@pytest.fixture
def account(db_session_with_containers: Session) -> Account:
    credentials = DefaultAccountPasswordHasher().hash(PASSWORD)
    account = Account(
        name="Session owner",
        email=f"session-{uuid4()}@example.com",
        status=AccountStatus.ACTIVE,
        password=credentials.password_hash,
        password_salt=credentials.password_salt,
    )
    workspace = Tenant(name="Session workspace")
    db_session_with_containers.add_all(
        [
            account,
            workspace,
            TenantAccountJoin(
                account_id=account.id, tenant_id=workspace.id, role=TenantAccountRole.OWNER, current=True
            ),
        ]
    )
    db_session_with_containers.commit()
    return account


def test_authenticate_returns_persisted_account(account: Account, db_session_with_containers: Session) -> None:
    authenticated = application_services().accounts.lifecycle.authenticate(account.email, PASSWORD)
    assert (authenticated.id, authenticated.email, authenticated.name, authenticated.status) == (
        account.id,
        account.email,
        account.name,
        "active",
    )
    db_session_with_containers.refresh(account)
    assert account.password is not None
    assert account.password_salt is not None


@pytest.mark.parametrize(
    ("case", "error", "message"),
    [
        ("missing", AccountNotFoundError, ""),
        ("banned", AccountLoginError, "Account is banned."),
        ("wrong-password", AccountPasswordError, "Invalid email or password."),
        ("no-password", AccountPasswordError, "Invalid email or password."),
    ],
)
def test_authenticate_rejects_invalid_credentials(
    account: Account, db_session_with_containers: Session, case: str, error: type[Exception], message: str
) -> None:
    if case == "banned":
        account.status = AccountStatus.BANNED
    elif case == "no-password":
        account.password = None
        account.password_salt = None
    db_session_with_containers.commit()
    email = f"missing-{uuid4()}@example.com" if case == "missing" else account.email
    password = "WrongPassword123!" if case == "wrong-password" else PASSWORD

    with pytest.raises(error) as raised:
        application_services().accounts.lifecycle.authenticate(email, password)
    if message:
        assert str(raised.value) == message


@pytest.mark.parametrize("exists", [True, False])
def test_email_lookup_uses_account_repository(account: Account, exists: bool) -> None:
    email = account.email if exists else f"missing-{uuid4()}@example.com"
    found = application_services().accounts.lifecycle.get_account_by_email_with_case_fallback(email)
    if exists:
        assert found is not None
        assert (found.id, found.email, found.name, found.status) == (
            account.id,
            account.email,
            account.name,
            "active",
        )
    else:
        assert found is None


def test_refresh_rotates_both_redis_indexes_and_rejects_reuse(account: Account) -> None:
    services = application_services().accounts
    initial = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    account_key = f"account_refresh_token:{account.id}"
    old_key = f"refresh_token:{initial.refresh_token}"
    assert redis_client.get(account_key) == initial.refresh_token.encode()
    assert redis_client.get(old_key) == account.id.encode()

    refreshed = services.authentication.refresh(initial.refresh_token)

    new_key = f"refresh_token:{refreshed.refresh_token}"
    assert refreshed.refresh_token != initial.refresh_token
    assert PassportService().verify(refreshed.access_token)["user_id"] == account.id
    assert refreshed.csrf_token
    assert redis_client.get(old_key) is None
    assert redis_client.get(account_key) == refreshed.refresh_token.encode()
    assert redis_client.get(new_key) == account.id.encode()
    for key in (account_key, new_key):
        assert 0 < redis_client.ttl(key) <= dify_config.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    with pytest.raises(InvalidRefreshTokenError, match="Invalid refresh token"):
        services.authentication.refresh(initial.refresh_token)
    assert redis_client.get(new_key) == account.id.encode()


def test_logout_revokes_real_redis_session_and_is_idempotent(account: Account) -> None:
    services = application_services().accounts
    tokens = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    account_key = f"account_refresh_token:{account.id}"
    refresh_key = f"refresh_token:{tokens.refresh_token}"
    assert redis_client.exists(account_key)
    assert redis_client.exists(refresh_key)

    services.authentication.logout(account.id)

    assert redis_client.get(account_key) is None
    assert redis_client.get(refresh_key) is None
    with pytest.raises(InvalidRefreshTokenError):
        services.authentication.refresh(tokens.refresh_token)
    services.authentication.logout(account.id)
    assert redis_client.get(account_key) is None


@pytest.mark.parametrize("reason", ["unknown", "expired", "deleted-account", "banned-account"])
def test_refresh_rejects_invalid_persisted_sessions(
    account: Account, db_session_with_containers: Session, reason: str
) -> None:
    services = application_services().accounts
    tokens = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    refresh_token = tokens.refresh_token
    if reason == "unknown":
        refresh_token = f"unknown-{uuid4()}"
    elif reason == "expired":
        redis_client.pexpire(f"refresh_token:{refresh_token}", 0)
    elif reason == "deleted-account":
        db_session_with_containers.delete(account)
        db_session_with_containers.commit()
    else:
        account.status = AccountStatus.BANNED
        db_session_with_containers.commit()

    with pytest.raises(InvalidRefreshTokenError):
        services.authentication.refresh(refresh_token)


def test_new_login_supersedes_old_lookup_and_login_after_logout_still_works(account: Account) -> None:
    services = application_services().accounts
    old = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    current = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    assert redis_client.get(f"refresh_token:{old.refresh_token}") == account.id.encode()

    with pytest.raises(InvalidRefreshTokenError):
        services.authentication.refresh(old.refresh_token)
    assert redis_client.get(f"account_refresh_token:{account.id}") == current.refresh_token.encode()

    services.authentication.logout(account.id)
    for token in (old.refresh_token, current.refresh_token):
        with pytest.raises(InvalidRefreshTokenError):
            services.authentication.refresh(token)
    new = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    assert services.authentication.refresh(new.refresh_token).refresh_token != new.refresh_token


def test_parallel_refresh_allows_only_one_rotation(account: Account) -> None:
    account_id = account.id
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account_id)
    ready = Barrier(8)

    def rotate(_index: int) -> AccountSessionTokens | None:
        assert gateway.resolve_refresh_token(initial.refresh_token) == account_id
        ready.wait(timeout=10)
        try:
            return gateway.rotate(refresh_token=initial.refresh_token, account_id=account_id)
        except InvalidRefreshTokenError:
            return None

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(rotate, range(8)))
    successful = [tokens for tokens in results if tokens is not None]
    assert len(successful) == 1
    assert gateway.resolve_refresh_token(initial.refresh_token) is None
    assert gateway.resolve_refresh_token(successful[0].refresh_token) == account_id
    gateway.revoke(account_id)
    assert gateway.resolve_refresh_token(successful[0].refresh_token) is None


def test_logout_between_refresh_resolution_and_rotation_prevents_resurrection(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    assert gateway.resolve_refresh_token(initial.refresh_token) == account.id

    gateway.revoke(account.id)
    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id)

    assert redis_client.get(f"account_refresh_token:{account.id}") is None
    assert gateway.resolve_refresh_token(initial.refresh_token) is None


def test_logout_lookup_cleanup_preserves_concurrent_new_login(
    account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    cleanup = gateway._delete_refresh_token
    new_sessions: list[AccountSessionTokens] = []

    def login_before_cleanup(refresh_token: str) -> None:
        new_sessions.append(gateway.issue(account.id))
        cleanup(refresh_token)

    monkeypatch.setattr(gateway, "_delete_refresh_token", login_before_cleanup)
    gateway.revoke(account.id)

    assert gateway.resolve_refresh_token(initial.refresh_token) is None
    assert gateway.resolve_refresh_token(new_sessions[0].refresh_token) == account.id


def test_retried_rotation_command_preserves_the_new_session(account: Account, monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    register_script = redis_client.register_script

    def replay_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def execute_twice(*, keys: list[str], args: list[object]) -> object:
            execute(keys=keys, args=args)
            return execute(keys=keys, args=args)

        return execute_twice

    monkeypatch.setattr(redis_client, "register_script", replay_registration)
    rotated = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id)

    assert gateway.resolve_refresh_token(rotated.refresh_token) == account.id
    assert gateway.resolve_refresh_token(initial.refresh_token) is None
    assert redis_client.get(f"refresh_token:{rotated.refresh_token}") == account.id.encode()
