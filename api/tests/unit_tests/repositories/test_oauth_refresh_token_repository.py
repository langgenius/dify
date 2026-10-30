from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
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
    presented = PresentedRefreshToken(id=record.id, family_id=record.family_id)
    with factory() as session, session.begin():
        spend_refresh_token(session, presented, now=datetime.now(UTC))


def _found(repo: SQLAlchemyOAuthRefreshTokenRepository, token: str) -> RefreshTokenRecord:
    record = repo.find(token)
    assert record is not None
    return record


def _successor(factory: sessionmaker[Session], record: RefreshTokenRecord) -> RefreshTokenRecord:
    token = seed_refresh_token(
        factory,
        grant=GRANT,
        account_id=ACCOUNT_ID,
        workspace_id=WORKSPACE_ID,
        lifetime=LIFETIME,
        family_id=record.family_id,
    )
    return _found(_repository(factory), token)


def _ids(factory: sessionmaker[Session]) -> set[str]:
    with factory() as session:
        return set(session.scalars(select(OpenAPIOAuthRefreshToken.id)))


def test_a_rotated_token_works_until_its_successor_is_used_and_a_family_keeps_three_rows(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first = _found(_repository(sqlite_session_factory), _issue(sqlite_session_factory))
    _spend(sqlite_session_factory, first)
    unused = _successor(sqlite_session_factory, first)

    _spend(sqlite_session_factory, first)

    assert _ids(sqlite_session_factory) == {first.id}
    second = _successor(sqlite_session_factory, first)
    _spend(sqlite_session_factory, second)
    third = _successor(sqlite_session_factory, second)
    assert unused.id not in _ids(sqlite_session_factory)
    with pytest.raises(RefreshTokenReusedError):
        _spend(sqlite_session_factory, first)

    _spend(sqlite_session_factory, third)

    assert _ids(sqlite_session_factory) == {second.id, third.id}


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
