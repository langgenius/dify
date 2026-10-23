from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import partial
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import sha256_hex
from models.oauth import OAuthAccessToken
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_contracts import ACCOUNT_ISSUER_SENTINEL, OAuthDeviceTokenWrite, device_key_for


@dataclass
class _RawRedis:
    deleted: list[str | bytes] = field(default_factory=list)

    def delete(self, *names: str | bytes) -> None:
        self.deleted.extend(names)


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


def _write(*, device_label: str, device_key: str) -> OAuthDeviceTokenWrite:
    return OAuthDeviceTokenWrite(
        subject_email="ada@example.com",
        subject_issuer=ACCOUNT_ISSUER_SENTINEL,
        account_id="account-1",
        client_id="difyctl",
        device_label=device_label,
        device_key=device_key,
        prefix="dfoa_",
        token_hash=uuid4().hex,
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
        device_key="Laptop",
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
        device_key="Laptop",
    )

    first = issue_token()
    second = issue_token()

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert len(records) == 2
    assert [record.id for record in records if record.revoked_at is None] == [second.token_id]
    assert redis.deleted == [TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(first.token))]


def test_rollback_rotation_removes_new_token_and_restores_previous_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, repository, redis, _ttl_policy = _repository(sqlite_session_factory)
    issue_token = partial(
        issuer.issue_account_token,
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
        device_key="Laptop",
    )
    first = issue_token()
    second = issue_token()

    assert repository.rollback_rotation(second.rotation) is True

    sqlite_session.expire_all()
    first_record = sqlite_session.get(OAuthAccessToken, first.token_id)
    assert first_record is not None
    assert first_record.revoked_at is None
    assert sqlite_session.get(OAuthAccessToken, second.token_id) is None
    assert redis.deleted == [
        TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(first.token)),
        TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(second.token)),
        TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(first.token)),
    ]


def test_rollback_does_not_restore_predecessor_after_later_rotation(
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
        device_key="Laptop",
    )
    first = issue_token()
    second = issue_token()
    third = issue_token()

    assert repository.rollback_rotation(second.rotation) is False

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [record.id for record in records if record.revoked_at is None] == [third.token_id]
    first_record = sqlite_session.get(OAuthAccessToken, first.token_id)
    assert first_record is not None
    assert first_record.revoked_at is not None


def test_second_live_token_for_the_same_device_is_rejected(sqlite_session: Session) -> None:
    def row(token_hash: str) -> OAuthAccessToken:
        return OAuthAccessToken(
            subject_email="ada@example.com",
            subject_issuer=ACCOUNT_ISSUER_SENTINEL,
            client_id="difyctl",
            device_label="Laptop",
            device_key="Laptop",
            prefix="dfoa_",
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )

    sqlite_session.add(row("a" * 64))
    sqlite_session.commit()
    sqlite_session.add(row("b" * 64))
    with pytest.raises(IntegrityError):
        sqlite_session.commit()


def test_rotation_keeps_revoked_history_under_the_unique_index(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory)
    issue_token = partial(
        issuer.issue_account_token,
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
        device_key="Laptop",
    )
    issue_token()
    issue_token()
    third = issue_token()

    sqlite_session.expire_all()
    guards = {record.id: record.active_guard for record in sqlite_session.scalars(select(OAuthAccessToken)).all()}
    assert len(guards) == 3
    assert guards.pop(third.token_id) == 1
    assert set(guards.values()) == {None}


def test_rotation_matches_device_key_not_label(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _issuer, repository, _redis, _ttl_policy = _repository(sqlite_session_factory)

    first = repository.rotate_token(_write(device_label="host", device_key="install:aaaa1111"))
    second = repository.rotate_token(_write(device_label="host", device_key="install:bbbb2222"))
    assert second.replaced_token_id is None
    third = repository.rotate_token(_write(device_label="renamed-host", device_key="install:aaaa1111"))

    assert third.replaced_token_id == first.token_id
    sqlite_session.expire_all()
    live = {
        record.id: (record.device_label, record.device_key)
        for record in sqlite_session.scalars(select(OAuthAccessToken).where(OAuthAccessToken.revoked_at.is_(None)))
    }
    assert live == {
        second.token_id: ("host", "install:bbbb2222"),
        third.token_id: ("renamed-host", "install:aaaa1111"),
    }


def test_legacy_key_equals_label_keeps_old_rotation(sqlite_session_factory: sessionmaker[Session]) -> None:
    _issuer, repository, _redis, _ttl_policy = _repository(sqlite_session_factory)

    first = repository.rotate_token(_write(device_label="host", device_key="host"))
    second = repository.rotate_token(_write(device_label="host", device_key="host"))

    assert second.replaced_token_id == first.token_id


@pytest.mark.parametrize(
    ("installation_id", "expected_key"),
    [("abcd1234", "install:abcd1234"), (None, "Laptop")],
    ids=["install", "legacy"],
)
def test_issuer_keys_rotation_on_the_install_id_or_the_legacy_device_label(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    installation_id: str | None,
    expected_key: str,
) -> None:
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory)

    issued = issuer.issue_account_token(
        account=_account(),
        workspace_id="workspace-1",
        client_id="difyctl",
        device_label="Laptop",
        device_key=device_key_for(installation_id=installation_id, device_label="Laptop"),
    )

    sqlite_session.expire_all()
    record = sqlite_session.get(OAuthAccessToken, issued.token_id)
    assert record is not None
    assert record.device_label == "Laptop"
    assert record.device_key == expected_key


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
        device_key="Laptop",
    )
    first = issue_token()
    assert repository.revoke_account_session(account_id="account-1", token_id=first.token_id) is True

    second = issue_token()

    assert second.token_id != first.token_id
    assert second.rotation.replaced_token_id is None
    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert len(records) == 2
    assert [record.id for record in records if record.revoked_at is None] == [second.token_id]


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
            device_key=device_label,
        )
    issuer.issue_account_token(
        account=_account("account-2", "grace@example.com"),
        workspace_id="workspace-2",
        client_id="difyctl",
        device_label="Other",
        device_key="Other",
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
        device_key="Laptop",
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
            device_key="CLI",
        )
