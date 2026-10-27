from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from models.oauth import OpenAPIOAuthRefreshToken
from repositories.oauth_refresh_token_repository import (
    REFRESH_TOKEN_PREFIX,
    RefreshTokenRecord,
    SQLAlchemyOAuthRefreshTokenRepository,
    spend_refresh_token,
    within_replay_grace,
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


def _grant(device_label: str = "laptop") -> GrantKey:
    return GrantKey(
        subject_email="ada@example.com",
        subject_issuer="dify:account",
        client_id="client-1",
        device_label=device_label,
    )


def _repository(factory: sessionmaker[Session]) -> SQLAlchemyOAuthRefreshTokenRepository:
    return SQLAlchemyOAuthRefreshTokenRepository(session_factory=factory)


def _issue(
    factory: sessionmaker[Session],
    *,
    grant: GrantKey | None = None,
    family_id: str | None = None,
    lifetime: timedelta = LIFETIME,
) -> str:
    return seed_refresh_token(
        factory,
        grant=grant or _grant(),
        account_id=ACCOUNT_ID,
        workspace_id=WORKSPACE_ID,
        family_id=family_id,
        lifetime=lifetime,
    )


def test_insert_stores_only_the_hash_and_find_returns_the_record(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    before = datetime.now(UTC)

    token = _issue(sqlite_session_factory)

    assert token.startswith(REFRESH_TOKEN_PREFIX)
    with sqlite_session_factory() as session:
        row = session.scalars(select(OpenAPIOAuthRefreshToken)).one()
    assert row.token_hash == sha256_hex(token)
    assert token not in (row.token_hash, row.family_id)

    record = repo.find(token)
    assert record is not None
    assert record.grant_key == _grant()
    assert record.account_id == ACCOUNT_ID
    assert record.workspace_id == WORKSPACE_ID
    assert record.rotated_at is None
    assert record.expires_at.replace(tzinfo=UTC) >= before + LIFETIME


def test_find_unknown_token_returns_none(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    _issue(sqlite_session_factory)

    assert repo.find("dfor_unknown") is None
    assert repo.find("") is None


def test_find_returns_the_family_each_token_was_stored_with(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(sqlite_session_factory)
    first = repo.find(_issue(sqlite_session_factory))
    other = repo.find(_issue(sqlite_session_factory))
    assert first is not None
    assert other is not None
    assert first.family_id != other.family_id

    joined = repo.find(_issue(sqlite_session_factory, family_id=first.family_id))
    assert joined is not None
    assert joined.family_id == first.family_id


def _set_rotated_at(factory: sessionmaker[Session], token: str, rotated_at: datetime) -> None:
    with factory() as session, session.begin():
        session.execute(
            update(OpenAPIOAuthRefreshToken)
            .where(OpenAPIOAuthRefreshToken.token_hash == sha256_hex(token))
            .values(rotated_at=rotated_at)
        )


def test_find_returns_expired_and_rotated_records_as_they_are(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    expired_token = _issue(sqlite_session_factory, lifetime=timedelta(seconds=-1))
    rotated_token = _issue(sqlite_session_factory)
    _set_rotated_at(sqlite_session_factory, rotated_token, datetime.now(UTC))

    expired = repo.find(expired_token)
    assert expired is not None
    assert expired.expires_at.replace(tzinfo=UTC) < datetime.now(UTC)
    after = repo.find(rotated_token)
    assert after is not None
    assert after.rotated_at is not None


def _spend(
    factory: sessionmaker[Session], record: RefreshTokenRecord, *, grace: timedelta = timedelta(minutes=30)
) -> None:
    presented = PresentedRefreshToken(id=record.id, family_id=record.family_id, reuse_grace=grace)
    with factory() as session, session.begin():
        spend_refresh_token(session, presented, now=datetime.now(UTC))


def _found(repo: SQLAlchemyOAuthRefreshTokenRepository, token: str) -> RefreshTokenRecord:
    record = repo.find(token)
    assert record is not None
    return record


def test_spend_marks_a_fresh_token_rotated_and_lets_it_replay_in_the_grace(
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


@pytest.mark.parametrize(
    ("grace", "rotated_ago"),
    [
        pytest.param(timedelta(minutes=30), timedelta(minutes=31), id="past-the-grace"),
        pytest.param(timedelta(), timedelta(), id="zero-grace"),
    ],
)
def test_spend_past_the_grace_is_reuse(
    sqlite_session_factory: sessionmaker[Session], grace: timedelta, rotated_ago: timedelta
) -> None:
    repo = _repository(sqlite_session_factory)
    token = _issue(sqlite_session_factory)
    _set_rotated_at(sqlite_session_factory, token, datetime.now(UTC) - rotated_ago)

    with pytest.raises(RefreshTokenReusedError):
        _spend(sqlite_session_factory, _found(repo, token), grace=grace)


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


def test_replay_grace_accepts_naive_and_aware_times() -> None:
    grace = timedelta(minutes=30)
    now = datetime.now(UTC)

    assert within_replay_grace(rotated_at=(now - timedelta(minutes=5)).replace(tzinfo=None), now=now, grace=grace)
    assert within_replay_grace(rotated_at=now - timedelta(minutes=30), now=now, grace=grace)
    assert not within_replay_grace(rotated_at=now - timedelta(minutes=31), now=now, grace=grace)
    assert not within_replay_grace(rotated_at=now, now=now, grace=timedelta())
