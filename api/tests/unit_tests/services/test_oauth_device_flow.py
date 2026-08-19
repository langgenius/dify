from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from libs.oauth_bearer import TOKEN_CACHE_KEY_FMT, AuthContext, SubjectType, TokenType
from models.oauth import OAuthAccessToken
from services.oauth_device_flow import (
    list_active_sessions,
    revoke_oauth_token,
    subject_match_clauses,
    token_belongs_to_subject,
)

ACCOUNT_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_ACCOUNT_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
TOKEN_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
OTHER_TOKEN_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _token(
    *,
    token_id: uuid.UUID = TOKEN_ID,
    account_id: uuid.UUID | None = ACCOUNT_ID,
    subject_email: str = "user@example.com",
    subject_issuer: str = "dify:account",
    token_hash: str | None = "live-hash",
    expires_at: datetime | None = None,
    revoked_at: datetime | None = None,
    created_at: datetime | None = None,
) -> OAuthAccessToken:
    token = OAuthAccessToken(
        subject_email=subject_email,
        subject_issuer=subject_issuer,
        account_id=str(account_id) if account_id is not None else None,
        client_id="difyctl",
        device_label="test-device",
        prefix="dfoa_" if account_id is not None else "dfoe_",
        token_hash=token_hash,
        expires_at=expires_at or datetime.now(UTC) + timedelta(days=1),
        revoked_at=revoked_at,
    )
    token.id = str(token_id)
    if created_at is not None:
        token.created_at = created_at
    return token


def _account_ctx(*, account_id: uuid.UUID = ACCOUNT_ID) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=account_id,
        client_id="difyctl",
        scopes=frozenset({"full"}),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
        token_hash="h1",
        verified_tenants={},
    )


def _sso_ctx() -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.EXTERNAL_SSO,
        subject_email="sso@partner.com",
        subject_issuer="https://idp.partner.com",
        account_id=None,
        client_id="difyctl",
        scopes=frozenset({"apps:run"}),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        expires_at=None,
        token_hash="h1",
        verified_tenants={},
    )


# ---------------------------------------------------------------------------
# subject_match_clauses
# ---------------------------------------------------------------------------


def test_subject_match_clauses_account_matches_only_account_id():
    clauses = subject_match_clauses(_account_ctx())
    assert len(clauses) == 1
    assert "account_id" in str(clauses[0])


def test_subject_match_clauses_external_sso_requires_null_account_id():
    """External SSO must additionally require ``account_id IS NULL`` so a
    same-email account-flow row from a federated tenant cannot be
    enumerated/revoked through an SSO bearer.
    """
    clauses = subject_match_clauses(_sso_ctx())
    assert len(clauses) == 3
    rendered = " ".join(str(c) for c in clauses)
    assert "subject_email" in rendered
    assert "subject_issuer" in rendered
    assert "account_id IS NULL" in rendered


# ---------------------------------------------------------------------------
# revoke_oauth_token
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_revoke_oauth_token_invalidates_redis_cache_when_live_hash_seen(sqlite_session: Session):
    """Happy path: snapshot finds a live ``token_hash`` → UPDATE runs +
    Redis cache entry is DEL'd so the next bearer probe re-reads the now
    revoked row from DB.
    """
    sqlite_session.add(_token())
    sqlite_session.commit()

    redis = MagicMock()

    revoke_oauth_token(redis, str(TOKEN_ID), session=sqlite_session)

    assert not sqlite_session.in_transaction()
    persisted = sqlite_session.get(OAuthAccessToken, str(TOKEN_ID))
    assert persisted is not None
    assert persisted.token_hash is None
    assert persisted.revoked_at is not None
    redis.delete.assert_called_once_with(TOKEN_CACHE_KEY_FMT.format(hash="live-hash"))


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_revoke_oauth_token_is_idempotent_when_already_revoked(sqlite_session: Session):
    """Second call (or race-loser): no live hash → UPDATE still runs (it
    is itself idempotent thanks to ``WHERE revoked_at IS NULL``) but the
    Redis invalidation is skipped because there's no cache entry to
    drop.
    """
    revoked_at = datetime.now(UTC) - timedelta(minutes=1)
    sqlite_session.add(_token(token_hash=None, revoked_at=revoked_at))
    sqlite_session.commit()

    redis = MagicMock()

    revoke_oauth_token(redis, str(TOKEN_ID), session=sqlite_session)

    assert not sqlite_session.in_transaction()
    persisted = sqlite_session.get(OAuthAccessToken, str(TOKEN_ID))
    assert persisted is not None
    assert persisted.token_hash is None
    assert persisted.revoked_at is not None
    redis.delete.assert_not_called()


# ---------------------------------------------------------------------------
# list_active_sessions / token_belongs_to_subject
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_list_active_sessions_returns_only_live_subject_tokens(sqlite_session: Session):
    """Only live, hashed rows for the authenticated subject are returned newest-first."""

    now = datetime.now(UTC)
    active_new = _token(token_id=TOKEN_ID, created_at=now - timedelta(minutes=1))
    active_old = _token(token_id=OTHER_TOKEN_ID, created_at=now - timedelta(minutes=2))
    expired = _token(
        token_id=uuid.UUID(int=5),
        expires_at=now - timedelta(seconds=1),
        created_at=now - timedelta(minutes=3),
    )
    revoked = _token(
        token_id=uuid.UUID(int=6),
        token_hash=None,
        revoked_at=now - timedelta(seconds=1),
        created_at=now - timedelta(minutes=4),
    )
    hashless = _token(
        token_id=uuid.UUID(int=7),
        token_hash=None,
        created_at=now - timedelta(minutes=5),
    )
    other_account = _token(
        token_id=uuid.UUID(int=8),
        account_id=OTHER_ACCOUNT_ID,
        created_at=now - timedelta(minutes=6),
    )
    external_sso = _token(
        token_id=uuid.UUID(int=9),
        account_id=None,
        subject_email="user@example.com",
        subject_issuer="https://idp.example.com",
        created_at=now - timedelta(minutes=7),
    )
    sqlite_session.add_all([active_new, active_old, expired, revoked, hashless, other_account, external_sso])
    sqlite_session.commit()

    out = list_active_sessions(_account_ctx(), now, session=sqlite_session)

    assert [token.id for token in out] == [str(TOKEN_ID), str(OTHER_TOKEN_ID)]


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_token_belongs_to_subject_true_when_row_present(sqlite_session: Session):
    sqlite_session.add(_token())
    sqlite_session.commit()

    assert token_belongs_to_subject(str(TOKEN_ID), _account_ctx(), session=sqlite_session) is True


@pytest.mark.parametrize("sqlite_session", [(OAuthAccessToken,)], indirect=True)
def test_token_belongs_to_subject_false_for_other_account(sqlite_session: Session):
    sqlite_session.add(_token(account_id=OTHER_ACCOUNT_ID))
    sqlite_session.commit()

    assert token_belongs_to_subject(str(TOKEN_ID), _account_ctx(), session=sqlite_session) is False
