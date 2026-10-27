from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from models.oauth import OpenAPIOAuthRefreshToken
from repositories.oauth_refresh_token_repository import (
    RefreshTokenRecord,
    SQLAlchemyOAuthRefreshTokenRepository,
    spend_refresh_token,
)
from services.oauth_device_contracts import (
    GrantKey,
    PresentedRefreshToken,
    RefreshTokenRejectedError,
    RefreshTokenReusedError,
)
from tests.helpers.unit.repositories.oauth_refresh_tokens import seed_refresh_token

ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"
WORKSPACE_ID = "00000000-0000-0000-0000-000000000002"
LIFETIME = timedelta(days=30)


GRANT = GrantKey(
    subject_email="ada@example.com",
    subject_issuer="dify:account",
    client_id="client-1",
    device_label="laptop",
)


def _repository(factory: sessionmaker[Session]) -> SQLAlchemyOAuthRefreshTokenRepository:
    return SQLAlchemyOAuthRefreshTokenRepository(session_factory=factory)


def _issue(factory: sessionmaker[Session], *, lifetime: timedelta = LIFETIME) -> str:
    return seed_refresh_token(
        factory,
        grant=GRANT,
        account_id=ACCOUNT_ID,
        workspace_id=WORKSPACE_ID,
        lifetime=lifetime,
    )


def test_insert_stores_only_the_hash_and_find_returns_the_record(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    before = datetime.now(UTC)

    token = _issue(sqlite_session_factory)

    with sqlite_session_factory() as session:
        row = session.scalars(select(OpenAPIOAuthRefreshToken)).one()
    assert row.token_hash == sha256_hex(token)
    assert token not in (row.token_hash, row.family_id)

    record = repo.find(token)
    assert record is not None
    assert record.grant_key == GRANT
    assert (record.account_id, record.workspace_id, record.rotated_at) == (ACCOUNT_ID, WORKSPACE_ID, None)
    assert record.expires_at.replace(tzinfo=UTC) >= before + LIFETIME
    assert repo.find("dfor_unknown") is None


def _spend(factory: sessionmaker[Session], record: RefreshTokenRecord) -> None:
    presented = PresentedRefreshToken(id=record.id, family_id=record.family_id, reuse_grace=timedelta(minutes=30))
    with factory() as session, session.begin():
        spend_refresh_token(session, presented, now=datetime.now(UTC))


def _found(repo: SQLAlchemyOAuthRefreshTokenRepository, token: str) -> RefreshTokenRecord:
    record = repo.find(token)
    assert record is not None
    return record


def test_spend_rotates_a_fresh_token_replays_it_in_the_grace_and_calls_later_use_reuse(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(sqlite_session_factory)
    token = _issue(sqlite_session_factory)
    record = _found(repo, token)

    _spend(sqlite_session_factory, record)
    rotated_at = _found(repo, token).rotated_at
    _spend(sqlite_session_factory, record)

    assert rotated_at is not None
    assert _found(repo, token).rotated_at == rotated_at
    with sqlite_session_factory() as session, session.begin():
        session.execute(update(OpenAPIOAuthRefreshToken).values(rotated_at=datetime.now(UTC) - timedelta(minutes=31)))
    with pytest.raises(RefreshTokenReusedError):
        _spend(sqlite_session_factory, record)


def test_spend_rejects_an_expired_or_deleted_token(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    expired = _found(repo, _issue(sqlite_session_factory, lifetime=timedelta(seconds=-1)))
    deleted = _found(repo, _issue(sqlite_session_factory))
    with sqlite_session_factory() as session, session.begin():
        session.execute(delete(OpenAPIOAuthRefreshToken).where(OpenAPIOAuthRefreshToken.id == deleted.id))

    for record in (expired, deleted):
        with pytest.raises(RefreshTokenRejectedError) as caught:
            _spend(sqlite_session_factory, record)
        assert not isinstance(caught.value, RefreshTokenReusedError)
