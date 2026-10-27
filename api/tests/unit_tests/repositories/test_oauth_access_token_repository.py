from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.oauth import OAuthAccessToken, OAuthRefreshToken
from repositories.oauth_access_token_repository import SQLAlchemyOAuthAccessTokenRepository
from tests.helpers.unit.repositories.oauth_lock_order import record_locks

ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ACCOUNT_ID = "22222222-2222-2222-2222-222222222222"
TOKEN_ID = "33333333-3333-3333-3333-333333333333"
OTHER_TOKEN_ID = "44444444-4444-4444-4444-444444444444"
NOW = datetime(2026, 8, 25, 12, tzinfo=UTC)


def _token(
    *,
    token_id: str = TOKEN_ID,
    account_id: str | None = ACCOUNT_ID,
    token_hash: str | None = "live-hash",
    expires_at: datetime | None = None,
    revoked_at: datetime | None = None,
    created_at: datetime | None = None,
    device_label: str = "test-device",
) -> OAuthAccessToken:
    token = OAuthAccessToken(
        subject_email="user@example.com",
        subject_issuer="dify:account" if account_id is not None else "https://idp.example.com",
        account_id=account_id,
        client_id="difyctl",
        device_label=device_label,
        prefix="dfoa_" if account_id is not None else "dfoe_",
        token_hash=token_hash,
        expires_at=expires_at or NOW + timedelta(days=1),
        revoked_at=revoked_at,
    )
    token.id = token_id
    if created_at is not None:
        token.created_at = created_at
    return token


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_list_active_is_account_scoped_and_paginated(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add_all(
        [
            _token(token_id=TOKEN_ID, created_at=NOW - timedelta(minutes=1)),
            _token(token_id=OTHER_TOKEN_ID, created_at=NOW - timedelta(minutes=2), device_label="other-device"),
            _token(
                token_id="55555555-5555-5555-5555-555555555555",
                expires_at=NOW - timedelta(seconds=1),
            ),
            _token(
                token_id="66666666-6666-6666-6666-666666666666",
                token_hash=None,
                revoked_at=NOW - timedelta(seconds=1),
            ),
            _token(token_id="77777777-7777-7777-7777-777777777777", account_id=OTHER_ACCOUNT_ID),
            _token(token_id="88888888-8888-8888-8888-888888888888", account_id=None),
        ]
    )
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    total, rows = repository.list_active(account_id=ACCOUNT_ID, active_at=NOW, offset=1, limit=1)

    assert total == 2
    assert [row.id for row in rows] == [OTHER_TOKEN_ID]


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_revoke_returns_hash_and_persists_revocation(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(_token())
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)

    assert result.owned is True
    assert result.token_hashes == ("live-hash",)
    sqlite_session.expire_all()
    persisted = sqlite_session.get(OAuthAccessToken, TOKEN_ID)
    assert persisted is not None
    assert persisted.token_hash is None
    assert persisted.revoked_at is not None


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_revoke_is_idempotent_for_an_owned_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(_token(token_hash=None, revoked_at=NOW - timedelta(minutes=1)))
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)

    assert result.owned is True
    assert result.token_hashes == ()


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_revoke_does_not_disclose_another_accounts_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(_token(account_id=OTHER_ACCOUNT_ID))
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)

    assert result.owned is False
    assert result.token_hashes == ()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(OAuthAccessToken, TOKEN_ID)
    assert persisted is not None
    assert persisted.token_hash == "live-hash"


def _refresh(*, device_label: str = "test-device", account_id: str = ACCOUNT_ID) -> OAuthRefreshToken:
    return OAuthRefreshToken(
        family_id="99999999-9999-9999-9999-999999999999",
        token_hash=f"refresh-{device_label}",
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=account_id,
        client_id="difyctl",
        device_label=device_label,
        expires_at=NOW + timedelta(days=30),
    )


def _refresh_labels(session: Session) -> set[str]:
    session.expire_all()
    return set(session.scalars(select(OAuthRefreshToken.device_label)).all())


def test_revoke_deletes_the_grants_refresh_tokens_only(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add_all(
        [
            _token(),
            _token(token_id=OTHER_TOKEN_ID, token_hash="kept-hash", device_label="other-device"),
            _refresh(),
            _refresh(device_label="other-device"),
        ]
    )
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)

    assert result.token_hashes == ("live-hash",)
    assert _refresh_labels(sqlite_session) == {"other-device"}
    kept = sqlite_session.get(OAuthAccessToken, OTHER_TOKEN_ID)
    assert kept is not None
    assert kept.revoked_at is None


def test_revoke_by_refresh_token_id_revokes_the_grant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    refresh = _refresh()
    sqlite_session.add(refresh)
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=refresh.id, revoked_at=NOW)

    assert result.owned is True
    assert _refresh_labels(sqlite_session) == set()


def test_revoke_does_not_disclose_another_accounts_refresh_token(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    refresh = _refresh(account_id=OTHER_ACCOUNT_ID)
    sqlite_session.add(refresh)
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=refresh.id, revoked_at=NOW)

    assert result.owned is False
    assert _refresh_labels(sqlite_session) == {"test-device"}


def test_external_sso_session_is_not_an_account_session(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(_token(account_id=None))
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)

    assert result.owned is False
    sqlite_session.expire_all()
    persisted = sqlite_session.get(OAuthAccessToken, TOKEN_ID)
    assert persisted is not None
    assert persisted.revoked_at is None
    assert persisted.token_hash == "live-hash"


@pytest.mark.parametrize("by", ["access", "refresh"])
def test_revoke_locks_the_account_row_first(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    by: str,
) -> None:
    refresh = _refresh()
    sqlite_session.add_all([_token(), refresh])
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    with record_locks(sqlite_session_factory) as log:
        repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID if by == "access" else refresh.id, revoked_at=NOW)

    assert log.tables[0] == "accounts"
    assert log.tables.count("accounts") == 1
    assert "oauth_refresh_tokens" in log.tables
    assert log.follows_lock_order()


def test_revoke_of_a_row_without_an_issuer_revokes_only_that_row(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    legacy = _token()
    legacy.subject_issuer = None
    sqlite_session.add_all([legacy, _refresh()])
    sqlite_session.commit()
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    result = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)

    assert result.token_hashes == ("live-hash",)
    assert _refresh_labels(sqlite_session) == {"test-device"}
    persisted = sqlite_session.get(OAuthAccessToken, TOKEN_ID)
    assert persisted is not None
    assert persisted.revoked_at is not None
