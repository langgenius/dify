"""Account authentication against PostgreSQL and real Redis session indexes."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import jwt
import pytest
from redis.crc import key_slot
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
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


def _session_key(account_id: str, refresh_token: str) -> str:
    return f"auth:{{{account_id}}}:session:{refresh_token.split('.')[2]}"


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


def test_login_and_refresh_keep_client_sessions_independent(account: Account) -> None:
    services = application_services().accounts
    first = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    second = services.lifecycle.login(account.id, ip_address="127.0.0.2")
    request_id = str(uuid4())

    refreshed_first = services.authentication.refresh(first.refresh_token, request_id=request_id)
    refreshed_second = services.authentication.refresh(second.refresh_token, request_id=request_id)

    first_claims, second_claims = (
        jwt.decode(
            tokens.access_token,
            dify_config.SECRET_KEY,
            algorithms=["HS256"],
            audience="dify-console",
            issuer=dify_config.DEPLOYMENT_EDITION.value,
        )
        for tokens in (refreshed_first, refreshed_second)
    )
    assert first_claims["user_id"] == second_claims["user_id"] == account.id
    assert first_claims["sid"] != second_claims["sid"]
    assert first_claims["sid"] == first.refresh_token.split(".")[2]
    assert refreshed_first.refresh_token != first.refresh_token
    assert refreshed_second.refresh_token != second.refresh_token
    assert refreshed_first.csrf_token
    assert refreshed_second.csrf_token
    assert services.authentication.refresh(refreshed_first.refresh_token).refresh_token != refreshed_first.refresh_token
    assert (
        services.authentication.refresh(refreshed_second.refresh_token).refresh_token != refreshed_second.refresh_token
    )


@pytest.mark.parametrize("use_consumed_token", [False, True])
def test_logout_revokes_only_its_session_and_is_idempotent(account: Account, use_consumed_token: bool) -> None:
    services = application_services().accounts
    initial = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    other = services.lifecycle.login(account.id, ip_address="127.0.0.2")
    current = services.authentication.refresh(initial.refresh_token) if use_consumed_token else initial

    services.authentication.logout(initial.refresh_token)
    services.authentication.logout(initial.refresh_token)

    for token in {initial.refresh_token, current.refresh_token}:
        with pytest.raises(InvalidRefreshTokenError):
            services.authentication.refresh(token)
    assert services.authentication.refresh(other.refresh_token).refresh_token != other.refresh_token
    new = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    assert services.authentication.refresh(new.refresh_token).refresh_token != new.refresh_token


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
        redis_client.expire(_session_key(account.id, refresh_token), 0)
    elif reason == "deleted-account":
        db_session_with_containers.delete(account)
        db_session_with_containers.commit()
    else:
        account.status = AccountStatus.BANNED
        db_session_with_containers.commit()

    with pytest.raises(InvalidRefreshTokenError):
        services.authentication.refresh(refresh_token)


@pytest.mark.parametrize("with_request_id", [False, True])
@pytest.mark.parametrize("rotations", [1, 2])
def test_consumed_token_replay_revokes_only_its_session(
    account: Account, with_request_id: bool, rotations: int
) -> None:
    services = application_services().accounts
    initial = services.lifecycle.login(account.id, ip_address="127.0.0.1")
    other = services.lifecycle.login(account.id, ip_address="127.0.0.2")
    rotated = services.authentication.refresh(
        initial.refresh_token, request_id=str(uuid4()) if with_request_id else None
    )
    if rotations == 2:
        rotated = services.authentication.refresh(rotated.refresh_token)

    with pytest.raises(InvalidRefreshTokenError):
        services.authentication.refresh(initial.refresh_token, request_id=str(uuid4()) if with_request_id else None)
    with pytest.raises(InvalidRefreshTokenError):
        services.authentication.refresh(rotated.refresh_token)
    assert services.authentication.refresh(other.refresh_token).refresh_token != other.refresh_token


@pytest.mark.parametrize("operation", ["refresh", "logout"])
def test_invalid_secret_cannot_revoke_a_known_session(account: Account, operation: str) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    request_id = str(uuid4())
    tokens = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)
    replacement = "0" if initial.refresh_token[-1] != "0" else "1"
    forged = initial.refresh_token[:-1] + replacement
    assert gateway.resolve_refresh_token(forged) is None

    if operation == "refresh":
        with pytest.raises(InvalidRefreshTokenError):
            gateway.rotate(refresh_token=forged, account_id=account.id, request_id=request_id)
    else:
        gateway.revoke(forged)

    assert gateway.resolve_refresh_token(tokens.refresh_token) == account.id
    assert (
        gateway.rotate(refresh_token=tokens.refresh_token, account_id=account.id).refresh_token != tokens.refresh_token
    )


def test_wrong_account_cannot_rotate_or_revoke_a_session(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)

    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=initial.refresh_token, account_id=str(uuid4()))

    assert gateway.resolve_refresh_token(initial.refresh_token) == account.id
    assert (
        gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id).refresh_token
        != initial.refresh_token
    )


def test_parallel_refresh_retries_return_one_identical_successor(account: Account) -> None:
    account_id = account.id
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account_id)
    ready = Barrier(8)
    request_id = str(uuid4())

    def rotate(_index: int) -> AccountSessionTokens:
        assert gateway.resolve_refresh_token(initial.refresh_token) == account_id
        ready.wait(timeout=10)
        return gateway.rotate(refresh_token=initial.refresh_token, account_id=account_id, request_id=request_id)

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(rotate, range(8)))

    assert all(result == results[0] for result in results)
    rotated = results[0]
    assert rotated.refresh_token != initial.refresh_token
    assert gateway.resolve_refresh_token(rotated.refresh_token) == account_id
    assert gateway.rotate(refresh_token=rotated.refresh_token, account_id=account_id, request_id=request_id) == rotated
    assert (
        gateway.rotate(
            refresh_token=rotated.refresh_token, account_id=account_id, request_id=str(uuid4())
        ).refresh_token
        != rotated.refresh_token
    )


def test_old_retry_id_cannot_return_a_successor_after_a_later_rotation(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    other = gateway.issue(account.id)
    request_id = str(uuid4())
    first = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)
    latest = gateway.rotate(refresh_token=first.refresh_token, account_id=account.id, request_id=str(uuid4()))

    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)

    assert gateway.resolve_refresh_token(latest.refresh_token) is None
    assert gateway.resolve_refresh_token(other.refresh_token) == account.id


def test_logout_between_refresh_resolution_and_rotation_prevents_resurrection(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    assert gateway.resolve_refresh_token(initial.refresh_token) == account.id

    gateway.revoke(initial.refresh_token)
    other = gateway.issue(account.id)
    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=str(uuid4()))

    assert gateway.resolve_refresh_token(initial.refresh_token) is None
    assert gateway.resolve_refresh_token(other.refresh_token) == account.id


@pytest.mark.parametrize("reason", ["logout", "all-sessions", "expired"])
def test_revocation_prevents_cached_refresh_retry_from_restoring_session(account: Account, reason: str) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    other = gateway.issue(account.id)
    request_id = str(uuid4())
    rotated = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)

    if reason == "all-sessions":
        gateway.revoke_all(account.id)
    elif reason == "expired":
        redis_client.expire(_session_key(account.id, initial.refresh_token), 0)
    else:
        gateway.revoke(initial.refresh_token)

    for refresh_token in (initial.refresh_token, rotated.refresh_token):
        with pytest.raises(InvalidRefreshTokenError):
            gateway.rotate(refresh_token=refresh_token, account_id=account.id, request_id=request_id)
        assert gateway.resolve_refresh_token(refresh_token) is None
    assert gateway.resolve_refresh_token(other.refresh_token) == (None if reason == "all-sessions" else account.id)
    new = gateway.issue(account.id)
    assert gateway.resolve_refresh_token(new.refresh_token) == account.id
    assert gateway.rotate(refresh_token=new.refresh_token, account_id=account.id).refresh_token != new.refresh_token


@pytest.mark.parametrize("with_request_id", [False, True])
def test_retried_rotation_command_returns_identical_response(
    account: Account, monkeypatch: pytest.MonkeyPatch, with_request_id: bool
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    register_script = redis_client.register_script

    def replay_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def execute_twice(*, keys: list[str], args: list[object]) -> object:
            assert {key_slot(key.encode()) for key in keys} == {key_slot(account.id.encode())}
            first = execute(keys=keys, args=args)
            second = execute(keys=keys, args=args)
            assert first == second
            return second

        return execute_twice

    monkeypatch.setattr(redis_client, "register_script", replay_registration)
    request_id = str(uuid4()) if with_request_id else None
    rotated = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)

    assert gateway.resolve_refresh_token(rotated.refresh_token) == account.id
    if with_request_id:
        assert (
            gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id) == rotated
        )


@pytest.mark.parametrize("existing_session", [False, True])
def test_retried_issue_preserves_epoch_and_absolute_expiry(
    account: Account, monkeypatch: pytest.MonkeyPatch, existing_session: bool
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    other = gateway.issue(account.id) if existing_session else None
    register_script = redis_client.register_script

    def replay_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def execute_twice(*, keys: list[str], args: list[object]) -> object:
            first = execute(keys=keys, args=args)
            if len(keys) != 2:
                return first
            epoch = redis_client.get(keys[1])
            assert epoch
            redis_client.expire(keys[0], 60)
            second = execute(keys=keys, args=args)
            assert first == second == 1
            assert redis_client.get(keys[1]) == epoch
            assert 0 < redis_client.ttl(keys[0]) <= 60
            return second

        return execute_twice

    monkeypatch.setattr(redis_client, "register_script", replay_registration)
    issued = gateway.issue(account.id)

    assert gateway.resolve_refresh_token(issued.refresh_token) == account.id
    if other is not None:
        assert gateway.resolve_refresh_token(other.refresh_token) == account.id


@pytest.mark.parametrize("after_revoke_all", [False, True])
def test_missing_epoch_fails_closed_and_new_login_cannot_revive_old_families(
    account: Account, after_revoke_all: bool
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    old = gateway.issue(account.id)
    if after_revoke_all:
        gateway.revoke_all(account.id)
        current = gateway.issue(account.id)
    else:
        current = old
    request_id = str(uuid4())
    rotated = gateway.rotate(refresh_token=current.refresh_token, account_id=account.id, request_id=request_id)
    epoch_key = f"auth:{{{account.id}}}:epoch"
    epoch = redis_client.get(epoch_key)
    assert epoch

    redis_client.delete(epoch_key)

    old_tokens = {old.refresh_token, current.refresh_token, rotated.refresh_token}
    for token in old_tokens:
        assert gateway.resolve_refresh_token(token) is None
        with pytest.raises(InvalidRefreshTokenError):
            gateway.rotate(refresh_token=token, account_id=account.id, request_id=request_id)
    new = gateway.issue(account.id)
    assert redis_client.get(epoch_key) != epoch
    assert gateway.resolve_refresh_token(new.refresh_token) == account.id
    for token in old_tokens:
        assert gateway.resolve_refresh_token(token) is None
        with pytest.raises(InvalidRefreshTokenError):
            gateway.rotate(refresh_token=token, account_id=account.id, request_id=request_id)


@pytest.mark.parametrize("evict_creator", [False, True])
def test_delayed_identical_issue_after_epoch_loss_cannot_revive_other_families(
    account: Account, monkeypatch: pytest.MonkeyPatch, evict_creator: bool
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    register_script = redis_client.register_script
    issued_commands: list[tuple[Callable[..., object], list[str], list[object]]] = []

    def capture_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def capture(*, keys: list[str], args: list[object]) -> object:
            if len(keys) == 2:
                issued_commands.append((execute, keys, args))
            return execute(keys=keys, args=args)

        return capture

    monkeypatch.setattr(redis_client, "register_script", capture_registration)
    creator = gateway.issue(account.id)
    other = gateway.issue(account.id)
    epoch_key = f"auth:{{{account.id}}}:epoch"
    epoch = redis_client.get(epoch_key)
    assert epoch
    redis_client.delete(epoch_key)
    if evict_creator:
        redis_client.delete(_session_key(account.id, creator.refresh_token))

    execute, keys, args = issued_commands[0]
    assert execute(keys=keys, args=args) == (1 if evict_creator else 0)

    if evict_creator:
        assert redis_client.get(epoch_key)
        assert redis_client.get(epoch_key) != epoch
    else:
        assert redis_client.get(epoch_key) is None
        assert gateway.resolve_refresh_token(creator.refresh_token) is None
    assert gateway.resolve_refresh_token(other.refresh_token) is None
    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=other.refresh_token, account_id=account.id)


def test_delayed_revoke_with_missing_original_epoch_cannot_restore_an_old_generation(
    account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    register_script = redis_client.register_script
    revoked_commands: list[tuple[Callable[..., object], list[str], list[object]]] = []
    epoch_key = f"auth:{{{account.id}}}:epoch"
    assert redis_client.get(epoch_key) is None

    def capture_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def capture(*, keys: list[str], args: list[object]) -> object:
            if keys == [epoch_key]:
                revoked_commands.append((execute, keys, args))
            return execute(keys=keys, args=args)

        return capture

    monkeypatch.setattr(redis_client, "register_script", capture_registration)
    gateway.revoke_all(account.id)
    old = gateway.issue(account.id)
    old_epoch = redis_client.get(epoch_key)
    assert old_epoch
    gateway.revoke_all(account.id)
    assert redis_client.get(epoch_key) != old_epoch
    redis_client.delete(epoch_key)

    execute, keys, args = revoked_commands[0]
    execute(keys=keys, args=args)

    assert redis_client.get(epoch_key)
    assert redis_client.get(epoch_key) != old_epoch
    assert gateway.resolve_refresh_token(old.refresh_token) is None
    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=old.refresh_token, account_id=account.id)


def test_rotation_keeps_absolute_expiry_and_stores_no_plaintext_credentials(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    session_key = _session_key(account.id, initial.refresh_token)
    assert 0 < redis_client.ttl(session_key) <= dify_config.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    redis_client.expire(session_key, 60)

    rotated = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=str(uuid4()))

    assert 0 < redis_client.ttl(session_key) <= 60
    stored = redis_client.hgetall(session_key)
    assert stored
    assert len(stored[b"current"]) == 64
    stored_contents = b"\0".join((*stored, *stored.values()))
    reply_key = f"auth:{{{account.id}}}:reply:{initial.refresh_token.split('.')[2]}"
    reply = redis_client.get(reply_key)
    assert reply
    assert 0 < redis_client.ttl(reply_key) <= 10
    for tokens in (initial, rotated):
        for credential in (
            tokens.refresh_token,
            tokens.refresh_token.split(".")[-1],
            tokens.access_token,
            tokens.csrf_token,
        ):
            assert credential.encode() not in stored_contents
            assert credential.encode() not in reply


def test_retry_after_idempotency_window_expires_revokes_the_session(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    request_id = str(uuid4())
    rotated = gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)
    redis_client.expire(f"auth:{{{account.id}}}:reply:{initial.refresh_token.split('.')[2]}", 0)

    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=initial.refresh_token, account_id=account.id, request_id=request_id)

    assert gateway.resolve_refresh_token(rotated.refresh_token) is None


@pytest.mark.parametrize("intervening_revocation", [False, True])
def test_retried_revoke_all_command_preserves_the_latest_session_generation(
    account: Account, monkeypatch: pytest.MonkeyPatch, intervening_revocation: bool
) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    initial = gateway.issue(account.id)
    other = gateway.issue(account.id)
    register_script = redis_client.register_script
    epoch_key = f"auth:{{{account.id}}}:epoch"
    new_sessions: list[AccountSessionTokens] = []
    retrying = False

    def replay_registration(script: str) -> Callable[..., object]:
        execute = register_script(script)

        def execute_twice(*, keys: list[str], args: list[object]) -> object:
            nonlocal retrying
            first = execute(keys=keys, args=args)
            if keys != [epoch_key] or retrying:
                return first
            retrying = True
            new_sessions.append(gateway.issue(account.id))
            if intervening_revocation:
                gateway.revoke_all(account.id)
                new_sessions.append(gateway.issue(account.id))
            retrying = False
            return execute(keys=keys, args=args)

        return execute_twice

    monkeypatch.setattr(redis_client, "register_script", replay_registration)
    gateway.revoke_all(account.id)

    assert gateway.resolve_refresh_token(initial.refresh_token) is None
    assert gateway.resolve_refresh_token(other.refresh_token) is None
    assert len(new_sessions) == (2 if intervening_revocation else 1)
    for session in new_sessions[:-1]:
        assert gateway.resolve_refresh_token(session.refresh_token) is None
    assert gateway.resolve_refresh_token(new_sessions[-1].refresh_token) == account.id
    assert redis_client.ttl(epoch_key) == -1


def test_legacy_refresh_tokens_are_rejected_even_with_old_redis_indexes(account: Account) -> None:
    gateway = RedisAccountSessionGateway(redis=redis_client)
    legacy_token = uuid4().hex * 4
    redis_client.setex(f"refresh_token:{legacy_token}", 60, account.id)
    redis_client.setex(f"account_refresh_token:{account.id}", 60, legacy_token)
    current = gateway.issue(account.id)

    assert gateway.resolve_refresh_token(legacy_token) is None
    with pytest.raises(InvalidRefreshTokenError):
        gateway.rotate(refresh_token=legacy_token, account_id=account.id)
    gateway.revoke(legacy_token)
    assert gateway.resolve_refresh_token(current.refresh_token) == account.id
