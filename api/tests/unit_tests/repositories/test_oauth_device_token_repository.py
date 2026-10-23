from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import partial

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import sha256_hex
from models.oauth import OAuthAccessToken
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_contracts import ACCOUNT_ISSUER_SENTINEL, OAuthDeviceTokenWrite


@dataclass
class _RawRedis:
    deleted: list[str | bytes] = field(default_factory=list)
    # Runs once, on the next delete, before the keys are recorded.
    before_next_delete: Callable[[], None] | None = None

    def delete(self, *names: str | bytes) -> None:
        hook, self.before_next_delete = self.before_next_delete, None
        if hook is not None:
            hook()
        self.deleted.extend(names)


class _CacheDeleteError(Exception):
    pass


def _fail_cache_delete() -> None:
    raise _CacheDeleteError


@dataclass
class _TTLPolicy:
    days: int = 14
    workspace_ids: list[str | None] = field(default_factory=list)

    def ttl_days(self, workspace_id: str | None) -> int:
        self.workspace_ids.append(workspace_id)
        return self.days


def _account(account_id: str = "account-1", email: str = "ada@example.com") -> AccountSnapshot:
    now = datetime.now(UTC)
    return AccountSnapshot(
        id=account_id,
        name="Ada",
        email=email,
        avatar=None,
        is_password_set=True,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=now,
        last_login_ip="127.0.0.1",
        status="active",
        initialized_at=now,
        created_at=now,
    )


def _write(token_hash: str) -> OAuthDeviceTokenWrite:
    return OAuthDeviceTokenWrite(
        subject_email="ada@example.com",
        subject_issuer=ACCOUNT_ISSUER_SENTINEL,
        account_id="account-1",
        client_id="difyctl",
        device_label="Laptop",
        prefix="dfoa_",
        token_hash=token_hash,
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )


def _repository(
    sqlite_session_factory: sessionmaker[Session],
) -> tuple[
    OAuthDeviceTokenIssuanceGateway,
    SQLAlchemyOAuthDeviceTokenRepository,
    _RawRedis,
    _TTLPolicy,
]:
    raw_redis = _RawRedis()
    redis = RedisClientWrapper()
    redis.initialize(raw_redis)  # type: ignore[arg-type]
    ttl_policy = _TTLPolicy()
    repository = SQLAlchemyOAuthDeviceTokenRepository(session_factory=sqlite_session_factory, redis=redis)
    return (
        OAuthDeviceTokenIssuanceGateway(tokens=repository, ttl_policy=ttl_policy),
        repository,
        raw_redis,
        ttl_policy,
    )


def test_issue_account_token_persists_with_short_lived_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, ttl_policy = _repository(sqlite_session_factory)

    issued = issuer.issue_account_token(
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
    )

    assert issued.token.startswith("dfoa_")
    assert ttl_policy.workspace_ids == ["workspace-1"]
    sqlite_session.expire_all()
    record = sqlite_session.get(OAuthAccessToken, issued.token_id)
    assert record is not None
    assert record.account_id == "account-1"
    assert record.subject_issuer == "dify:account"
    assert record.token_hash == sha256_hex(issued.token)


def test_issue_rotates_matching_live_token_and_invalidates_old_cache(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, redis, _ttl_policy = _repository(sqlite_session_factory)
    issue_token = partial(
        issuer.issue_account_token,
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
    )

    first = issue_token()
    second = issue_token()

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [(record.id, record.revoked_at) for record in records] == [(first.token_id, None)]
    assert records[0].token_hash == sha256_hex(second.token)
    assert redis.deleted == [TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(first.token))]


def test_rollback_rotation_removes_new_token_and_restores_previous_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _issuer, repository, redis, _ttl_policy = _repository(sqlite_session_factory)
    first = repository.rotate_token(_write("hash-1"))
    redis.before_next_delete = _fail_cache_delete

    with pytest.raises(_CacheDeleteError):
        repository.rotate_token(_write("hash-2"))

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [(record.id, record.token_hash, record.revoked_at) for record in records] == [
        (first.token_id, "hash-1", None)
    ]
    assert redis.deleted == [
        TOKEN_CACHE_KEY_FMT.format(hash="hash-2"),
        TOKEN_CACHE_KEY_FMT.format(hash="hash-1"),
    ]


def test_rollback_does_not_restore_predecessor_after_later_rotation(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _issuer, repository, redis, _ttl_policy = _repository(sqlite_session_factory)
    repository.rotate_token(_write("hash-1"))

    def rotate_again_then_fail() -> None:
        repository.rotate_token(_write("hash-3"))
        raise _CacheDeleteError

    redis.before_next_delete = rotate_again_then_fail

    with pytest.raises(_CacheDeleteError):
        repository.rotate_token(_write("hash-2"))

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [(record.token_hash, record.revoked_at) for record in records] == [("hash-3", None)]


def test_relogin_on_the_same_label_reuses_the_live_row(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _issuer, repository, redis, _ttl_policy = _repository(sqlite_session_factory)

    first = repository.rotate_token(_write("hash-1"))
    second = repository.rotate_token(_write("hash-2"))

    assert second.token_id == first.token_id
    assert second.replaced_token_id == first.token_id
    assert second.replaced_token_hash == "hash-1"
    sqlite_session.expire_all()
    assert sqlite_session.scalar(select(OAuthAccessToken).where(OAuthAccessToken.token_hash == "hash-1")) is None
    live = list(sqlite_session.scalars(select(OAuthAccessToken).where(OAuthAccessToken.revoked_at.is_(None))))
    assert [record.id for record in live] == [first.token_id]
    assert redis.deleted == [TOKEN_CACHE_KEY_FMT.format(hash="hash-1")]


def test_login_after_logout_on_the_same_device_succeeds(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, repository, _redis, _ttl_policy = _repository(sqlite_session_factory)
    issue_token = partial(
        issuer.issue_account_token,
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
    )
    first = issue_token()
    assert repository.revoke_account_session(account_id="account-1", token_id=first.token_id) is True

    second = issue_token()

    assert second.token_id == first.token_id
    assert second.rotation.replaced_token_id is None
    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [(record.id, record.revoked_at) for record in records] == [(first.token_id, None)]
    assert records[0].token_hash == sha256_hex(second.token)


def test_list_account_sessions_pages_only_live_owned_tokens(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, repository, _redis, _ttl_policy = _repository(sqlite_session_factory)
    account = _account()
    for device_label in ("Laptop", "Desktop"):
        issuer.issue_account_token(
            account=account,
            workspace_id="workspace-1",
            client_id="difyctl",
            device_label=device_label,
        )
    issuer.issue_account_token(
        account=_account("account-2", "grace@example.com"),
        workspace_id="workspace-2",
        client_id="difyctl",
        device_label="Other",
    )

    page = repository.list_account_sessions(account_id="account-1", page=1, limit=1)

    assert page.total == 2
    assert len(page.items) == 1
    assert page.items[0].device_label in {"Laptop", "Desktop"}


def test_revoke_account_session_scopes_update_and_invalidates_cache(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, repository, redis, _ttl_policy = _repository(sqlite_session_factory)
    issued = issuer.issue_account_token(
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
    )

    assert repository.revoke_account_session(account_id="account-2", token_id=issued.token_id) is False
    assert repository.revoke_account_session(account_id="account-1", token_id=issued.token_id) is True

    sqlite_session.expire_all()
    record = sqlite_session.get(OAuthAccessToken, issued.token_id)
    assert record is not None
    assert record.revoked_at is not None
    assert record.token_hash is None
    assert redis.deleted == [TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(issued.token))]


def test_issue_external_token_rejects_empty_issuer(sqlite_session_factory: sessionmaker[Session]) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory)

    with pytest.raises(ValueError, match="non-empty subject_issuer"):
        issuer.issue_external_token(
            subject_email="external@example.com",
            subject_issuer=" ",
            client_id="difyctl",
            device_label="CLI",
        )
