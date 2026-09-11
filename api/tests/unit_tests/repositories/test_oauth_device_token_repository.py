from dataclasses import dataclass, field
from datetime import UTC, datetime

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
    kwargs = {
        "account": _account(),
        "workspace_id": "workspace-1",
        "client_id": "difyctl",
        "device_label": "Laptop",
    }

    first = issuer.issue_account_token(**kwargs)
    second = issuer.issue_account_token(**kwargs)

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken).order_by(OAuthAccessToken.created_at)).all())
    assert len(records) == 2
    assert sum(record.revoked_at is None for record in records) == 1
    assert records[-1].id == second.token_id
    assert redis.deleted == [TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(first.token))]


def test_rollback_rotation_removes_new_token_and_restores_previous_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    issuer, _repository_, redis, _ttl_policy = _repository(sqlite_session_factory)
    kwargs = {
        "account": _account(),
        "workspace_id": "workspace-1",
        "client_id": "difyctl",
        "device_label": "Laptop",
    }
    first = issuer.issue_account_token(**kwargs)
    second = issuer.issue_account_token(**kwargs)

    assert issuer.rollback_token(second) is True

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
    issuer, _repository_, _redis, _ttl_policy = _repository(sqlite_session_factory)
    kwargs = {
        "account": _account(),
        "workspace_id": "workspace-1",
        "client_id": "difyctl",
        "device_label": "Laptop",
    }
    first = issuer.issue_account_token(**kwargs)
    second = issuer.issue_account_token(**kwargs)
    third = issuer.issue_account_token(**kwargs)

    assert issuer.rollback_token(second) is False

    sqlite_session.expire_all()
    records = list(sqlite_session.scalars(select(OAuthAccessToken)).all())
    assert [record.id for record in records if record.revoked_at is None] == [third.token_id]
    first_record = sqlite_session.get(OAuthAccessToken, first.token_id)
    assert first_record is not None
    assert first_record.revoked_at is not None


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
