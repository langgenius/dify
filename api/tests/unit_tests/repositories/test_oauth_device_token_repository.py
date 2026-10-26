from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import partial

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from configs.feature import DEFAULT_OAUTH_MAX_TOKENS_PER_ACCOUNT
from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import sha256_hex
from models.oauth import OAuthAccessToken
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_contracts import IssuedOAuthToken


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
    *,
    max_sessions_per_account: int = DEFAULT_OAUTH_MAX_TOKENS_PER_ACCOUNT,
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
    repository = SQLAlchemyOAuthDeviceTokenRepository(
        session_factory=sqlite_session_factory,
        redis=redis,
        max_sessions_per_account=max_sessions_per_account,
    )
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
    assert [(record.id, record.revoked_at) for record in records] == [(second.token_id, None)]
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


def test_relogin_reuses_the_row_under_a_new_token_id(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _issuer, repository, _redis, _ttl_policy = _repository(sqlite_session_factory)

    first = repository.rotate_token(_write("hash-1"))
    second = repository.rotate_token(_write("hash-2"))

    assert second.token_id != first.token_id
    assert second.replaced_token_id == first.token_id
    sqlite_session.expire_all()
    assert sqlite_session.get(OAuthAccessToken, first.token_id) is None


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

    assert second.rotation.replaced_token_id is None
    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [(record.id, record.revoked_at) for record in records] == [(second.token_id, None)]
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


def _issue_sessions(issuer: OAuthDeviceTokenIssuanceGateway, device_labels: Sequence[str]) -> list[IssuedOAuthToken]:
    return [
        issuer.issue_account_token(
            account=_account(),
            workspace_id="workspace-1",
            client_id="difyctl",
            device_label=device_label,
        )
        for device_label in device_labels
    ]


def _set_usage(
    session: Session,
    token: IssuedOAuthToken,
    *,
    created_at: datetime,
    last_used_at: datetime | None = None,
) -> None:
    session.execute(
        update(OAuthAccessToken)
        .where(OAuthAccessToken.id == token.token_id)
        .values(created_at=created_at, last_used_at=last_used_at)
    )
    session.commit()


def _live_token_ids(session: Session) -> set[str]:
    session.expire_all()
    return set(session.scalars(select(OAuthAccessToken.id).where(OAuthAccessToken.revoked_at.is_(None))).all())


def _cache_key(token: IssuedOAuthToken) -> str:
    return TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(token.token))


def test_sixteenth_login_evicts_least_recently_used(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory)
    base = datetime.now(UTC) - timedelta(days=1)
    sessions = _issue_sessions(issuer, [f"device-{index}" for index in range(DEFAULT_OAUTH_MAX_TOKENS_PER_ACCOUNT)])
    for index, token in enumerate(sessions):
        _set_usage(sqlite_session, token, created_at=base, last_used_at=base + timedelta(minutes=index + 1))
    least_recently_used = sessions[5]
    _set_usage(sqlite_session, least_recently_used, created_at=base, last_used_at=base)

    newest = _issue_sessions(issuer, ["device-new"])[0]

    assert newest.rotation.evicted_token_ids == (least_recently_used.token_id,)
    assert newest.rotation.evicted_token_hashes == (sha256_hex(least_recently_used.token),)
    live = _live_token_ids(sqlite_session)
    assert len(live) == DEFAULT_OAUTH_MAX_TOKENS_PER_ACCOUNT
    assert least_recently_used.token_id not in live
    assert newest.token_id in live


def test_never_used_row_ranks_by_created_at(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=3)
    now = datetime.now(UTC)
    used_recently, never_used, used_long_ago_created_first = _issue_sessions(issuer, ["a", "b", "c"])
    _set_usage(
        sqlite_session, used_recently, created_at=now - timedelta(hours=3), last_used_at=now - timedelta(hours=1)
    )
    _set_usage(sqlite_session, never_used, created_at=now - timedelta(hours=2))
    _set_usage(
        sqlite_session,
        used_long_ago_created_first,
        created_at=now - timedelta(hours=4),
        last_used_at=now - timedelta(minutes=10),
    )

    newest = _issue_sessions(issuer, ["d"])[0]

    assert newest.rotation.evicted_token_ids == (never_used.token_id,)
    assert _live_token_ids(sqlite_session) == {
        used_recently.token_id,
        used_long_ago_created_first.token_id,
        newest.token_id,
    }


def test_same_key_rotation_does_not_count_twice(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=3)
    first, second, third = _issue_sessions(issuer, ["a", "b", "c"])

    relogin = _issue_sessions(issuer, ["b"])[0]

    assert relogin.rotation.replaced_token_id == second.token_id
    assert relogin.rotation.evicted_token_ids == ()
    assert _live_token_ids(sqlite_session) == {first.token_id, third.token_id, relogin.token_id}


def test_expired_rows_do_not_count(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=2)
    expired, live = _issue_sessions(issuer, ["a", "b"])
    sqlite_session.execute(
        update(OAuthAccessToken)
        .where(OAuthAccessToken.id == expired.token_id)
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    sqlite_session.commit()

    newest = _issue_sessions(issuer, ["c"])[0]

    assert newest.rotation.evicted_token_ids == ()
    assert _live_token_ids(sqlite_session) == {expired.token_id, live.token_id, newest.token_id}


def test_external_sso_rows_are_not_capped(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=1)

    issued = [
        issuer.issue_external_token(
            subject_email="ada@example.com",
            subject_issuer="https://idp.example",
            client_id="difyctl",
            device_label=device_label,
        )
        for device_label in ("a", "b", "c")
    ]

    assert all(token.rotation.evicted_token_ids == () for token in issued)
    assert _live_token_ids(sqlite_session) == {token.token_id for token in issued}


def test_lowered_cap_evicts_several(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=5)
    base = datetime.now(UTC) - timedelta(days=1)
    sessions = _issue_sessions(issuer, ["a", "b", "c", "d", "e"])
    for index, token in enumerate(sessions):
        _set_usage(sqlite_session, token, created_at=base + timedelta(minutes=index))
    lowered_issuer, _lowered_repository, _lowered_redis, _lowered_ttl = _repository(
        sqlite_session_factory, max_sessions_per_account=2
    )

    newest = _issue_sessions(lowered_issuer, ["f"])[0]

    assert newest.rotation.evicted_token_ids == tuple(token.token_id for token in sessions[:4])
    assert _live_token_ids(sqlite_session) == {sessions[4].token_id, newest.token_id}


def test_rollback_restores_evicted_rows(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=2)
    base = datetime.now(UTC) - timedelta(days=1)
    first, second = _issue_sessions(issuer, ["a", "b"])
    _set_usage(sqlite_session, first, created_at=base)
    _set_usage(sqlite_session, second, created_at=base + timedelta(minutes=1))
    newest = _issue_sessions(issuer, ["c"])[0]
    assert newest.rotation.evicted_token_ids == (first.token_id,)

    assert issuer.rollback_token(newest) is True

    assert _live_token_ids(sqlite_session) == {first.token_id, second.token_id}
    assert sqlite_session.get(OAuthAccessToken, newest.token_id) is None


def test_rollback_keeps_evicted_row_revoked_after_user_revoke(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, repository, _redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=1)
    first = _issue_sessions(issuer, ["a"])[0]
    newest = _issue_sessions(issuer, ["b"])[0]
    assert newest.rotation.evicted_token_ids == (first.token_id,)
    sqlite_session.execute(
        update(OAuthAccessToken).where(OAuthAccessToken.id == first.token_id).values(token_hash=None)
    )
    sqlite_session.commit()

    assert repository.rollback_rotation(newest.rotation) is True

    assert _live_token_ids(sqlite_session) == set()


def test_evicted_hashes_removed_from_cache(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, redis, _ttl_policy = _repository(sqlite_session_factory, max_sessions_per_account=3)
    base = datetime.now(UTC) - timedelta(days=1)
    sessions = _issue_sessions(issuer, ["a", "b", "c"])
    for index, token in enumerate(sessions):
        _set_usage(sqlite_session, token, created_at=base + timedelta(minutes=index))
    oldest, relogged, _newer = sessions
    lowered_issuer, _lowered_repository, lowered_redis, _lowered_ttl = _repository(
        sqlite_session_factory, max_sessions_per_account=2
    )

    newest = _issue_sessions(lowered_issuer, ["b"])[0]

    assert newest.rotation.replaced_token_id == relogged.token_id
    assert newest.rotation.evicted_token_ids == (oldest.token_id,)
    assert redis.deleted == []
    assert lowered_redis.deleted == [_cache_key(relogged), _cache_key(oldest)]
