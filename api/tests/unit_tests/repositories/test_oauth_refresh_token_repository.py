from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from models.oauth import OAuthRefreshToken
from repositories.oauth_refresh_token_repository import (
    REFRESH_TOKEN_PREFIX,
    SQLAlchemyOAuthRefreshTokenRepository,
)
from services.oauth_device_contracts import GrantKey

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
    repo: SQLAlchemyOAuthRefreshTokenRepository,
    *,
    grant: GrantKey | None = None,
    family_id: str | None = None,
    lifetime: timedelta = LIFETIME,
) -> str:
    return repo.issue(
        grant=grant or _grant(),
        account_id=ACCOUNT_ID,
        workspace_id=WORKSPACE_ID,
        family_id=family_id,
        lifetime=lifetime,
    )


def _count(factory: sessionmaker[Session]) -> int:
    with factory() as session:
        return session.scalar(select(func.count()).select_from(OAuthRefreshToken)) or 0


def test_issue_stores_only_the_hash_and_find_returns_the_record(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    before = datetime.now(UTC)

    token = _issue(repo)

    assert token.startswith(REFRESH_TOKEN_PREFIX)
    with sqlite_session_factory() as session:
        row = session.scalars(select(OAuthRefreshToken)).one()
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
    _issue(repo)

    assert repo.find("dfor_unknown") is None
    assert repo.find("") is None


def test_issue_without_family_starts_a_new_family_and_with_family_joins_it(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(sqlite_session_factory)
    first = repo.find(_issue(repo))
    other = repo.find(_issue(repo))
    assert first is not None
    assert other is not None
    assert first.family_id != other.family_id

    joined = repo.find(_issue(repo, family_id=first.family_id))
    assert joined is not None
    assert joined.family_id == first.family_id


def test_find_returns_expired_and_rotated_records_as_they_are(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    expired_token = _issue(repo, lifetime=timedelta(seconds=-1))
    rotated_token = _issue(repo)
    rotated = repo.find(rotated_token)
    assert rotated is not None
    assert repo.rotate(rotated) is True

    expired = repo.find(expired_token)
    assert expired is not None
    assert expired.expires_at.replace(tzinfo=UTC) < datetime.now(UTC)
    after = repo.find(rotated_token)
    assert after is not None
    assert after.rotated_at is not None


def test_rotate_succeeds_only_once(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    record = repo.find(_issue(repo))
    assert record is not None

    results = [repo.rotate(record), repo.rotate(record)]

    assert results.count(True) == 1
    assert results == [True, False]


def test_revoke_family_deletes_only_that_family(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    first_token = _issue(repo)
    first = repo.find(first_token)
    assert first is not None
    sibling_token = _issue(repo, family_id=first.family_id)
    other_token = _issue(repo)

    repo.revoke_family(first.family_id)

    assert repo.find(first_token) is None
    assert repo.find(sibling_token) is None
    assert repo.find(other_token) is not None


def test_revoke_grant_deletes_every_family_of_the_grant(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    _issue(repo)
    _issue(repo)
    kept = _issue(repo, grant=_grant("phone"))

    repo.revoke_grant(_grant())

    assert _count(sqlite_session_factory) == 1
    assert repo.find(kept) is not None


def test_live_grant_keys_skip_expired_and_rotated(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    _issue(repo, grant=_grant("expired"), lifetime=timedelta(seconds=-1))
    rotated = repo.find(_issue(repo, grant=_grant("rotated")))
    assert rotated is not None
    repo.rotate(rotated)
    _issue(repo, grant=_grant("live"))
    _issue(repo, grant=_grant("live"))

    assert repo.live_grant_keys(ACCOUNT_ID) == [_grant("live")]
    assert repo.live_grant_keys("00000000-0000-0000-0000-0000000000ff") == []


def test_live_grant_keys_keep_grant_with_rotated_and_fresh_token(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    old = repo.find(_issue(repo))
    assert old is not None
    repo.rotate(old)
    _issue(repo, family_id=old.family_id)

    assert repo.live_grant_keys(ACCOUNT_ID) == [_grant()]
