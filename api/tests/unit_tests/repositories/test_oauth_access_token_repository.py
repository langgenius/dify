from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.oauth import OAuthAccessToken
from repositories.oauth_access_token_repository import SQLAlchemyOAuthAccessTokenRepository

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
) -> OAuthAccessToken:
    token = OAuthAccessToken(
        subject_email="user@example.com",
        subject_issuer="dify:account" if account_id is not None else "https://idp.example.com",
        account_id=account_id,
        client_id="difyctl",
        device_label="test-device",
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
def test_list_active_is_account_scoped_and_database_paginated(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add_all(
        [
            _token(token_id=TOKEN_ID, created_at=NOW - timedelta(minutes=1)),
            _token(token_id=OTHER_TOKEN_ID, created_at=NOW - timedelta(minutes=2)),
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
    assert result.token_hash == "live-hash"
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
    assert result.token_hash is None


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
    assert result.token_hash is None
    sqlite_session.expire_all()
    persisted = sqlite_session.get(OAuthAccessToken, TOKEN_ID)
    assert persisted is not None
    assert persisted.token_hash == "live-hash"
