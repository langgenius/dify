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


@pytest.mark.parametrize(
    ("token_hash", "revoked_at", "expires_at"),
    [
        pytest.param("retained-hash", NOW - timedelta(seconds=1), NOW + timedelta(days=1), id="revoked-with-hash"),
        pytest.param(None, None, NOW + timedelta(days=1), id="unhashed-not-revoked"),
        pytest.param("expired-hash", None, NOW, id="exact-expiry"),
    ],
)
def test_list_active_excludes_each_inactive_state_independently(
    sqlite_session_factory: sessionmaker[Session],
    token_hash: str | None,
    revoked_at: datetime | None,
    expires_at: datetime,
) -> None:
    """Each inactive condition must exclude a committed token while preserving a just-unexpired control."""
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _token(token_id=TOKEN_ID, expires_at=NOW + timedelta(microseconds=1)),
                _token(token_id=OTHER_TOKEN_ID, token_hash=token_hash, revoked_at=revoked_at, expires_at=expires_at),
            ]
        )

    total, rows = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory).list_active(
        account_id=ACCOUNT_ID, active_at=NOW, offset=0, limit=20
    )

    assert total == 1
    assert [row.id for row in rows] == [TOKEN_ID]


def test_list_active_pages_tied_timestamps_without_duplicates_or_omissions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """With tied creation times and a foreign-account decoy, paging returns every owned session once."""
    token_ids = [
        "55555555-5555-4555-8555-555555555555",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([_token(token_id=token_id, created_at=NOW) for token_id in token_ids])
        session.add(
            _token(token_id="66666666-6666-4666-8666-666666666666", account_id=OTHER_ACCOUNT_ID, created_at=NOW)
        )
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)

    pages = [
        repository.list_active(account_id=ACCOUNT_ID, active_at=NOW, offset=offset, limit=1) for offset in range(4)
    ]

    assert [total for total, _rows in pages] == [3, 3, 3, 3]
    assert [[row.id for row in rows] for _total, rows in pages] == [
        ["55555555-5555-4555-8555-555555555555"],
        ["44444444-4444-4444-8444-444444444444"],
        ["33333333-3333-4333-8333-333333333333"],
        [],
    ]


def test_revocation_disappears_from_listing_and_replay_preserves_audit_time(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Revoking twice removes only the target from listing and retains its first revocation timestamp."""
    with sqlite_session_factory.begin() as session:
        session.add_all([_token(), _token(token_id=OTHER_TOKEN_ID)])
    repository = SQLAlchemyOAuthAccessTokenRepository(session_factory=sqlite_session_factory)
    before_total, before = repository.list_active(account_id=ACCOUNT_ID, active_at=NOW, offset=0, limit=20)
    assert before_total == 2
    assert {row.id for row in before} == {TOKEN_ID, OTHER_TOKEN_ID}

    revoked = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW)
    replay = repository.revoke(account_id=ACCOUNT_ID, token_id=TOKEN_ID, revoked_at=NOW + timedelta(minutes=1))
    after_total, after = repository.list_active(account_id=ACCOUNT_ID, active_at=NOW, offset=0, limit=20)

    assert (revoked.owned, revoked.token_hash) == (True, "live-hash")
    assert (replay.owned, replay.token_hash) == (True, None)
    assert after_total == 1
    assert [row.id for row in after] == [OTHER_TOKEN_ID]
    with sqlite_session_factory() as session:
        record = session.get(OAuthAccessToken, TOKEN_ID)
        sibling = session.get(OAuthAccessToken, OTHER_TOKEN_ID)
        assert record is not None
        assert sibling is not None
        assert record.revoked_at is not None
        assert record.revoked_at.replace(tzinfo=UTC) == NOW
        assert record.token_hash is None
        assert (sibling.revoked_at, sibling.token_hash) == (None, "live-hash")
