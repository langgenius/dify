from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from libs.oauth_bearer import TOKEN_CACHE_KEY_FMT, AuthContext, SubjectType, TokenType
from services.oauth_device_flow import (
    list_active_sessions,
    revoke_oauth_token,
    subject_match_clauses,
    token_belongs_to_subject,
)


def _account_ctx() -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
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


def test_revoke_oauth_token_invalidates_redis_cache_when_live_hash_seen():
    """Happy path: snapshot finds a live ``token_hash`` → UPDATE runs +
    Redis cache entry is DEL'd so the next bearer probe re-reads the now
    revoked row from DB.
    """
    session = MagicMock()
    session.query.return_value.filter.return_value.one_or_none.return_value = ("live-hash",)

    redis = MagicMock()

    revoke_oauth_token(session, redis, "token-id")

    assert session.execute.called  # UPDATE ... WHERE revoked_at IS NULL
    assert session.commit.called
    redis.delete.assert_called_once_with(TOKEN_CACHE_KEY_FMT.format(hash="live-hash"))


def test_revoke_oauth_token_is_idempotent_when_already_revoked():
    """Second call (or race-loser): no live hash → UPDATE still runs (it
    is itself idempotent thanks to ``WHERE revoked_at IS NULL``) but the
    Redis invalidation is skipped because there's no cache entry to
    drop.
    """
    session = MagicMock()
    session.query.return_value.filter.return_value.one_or_none.return_value = None

    redis = MagicMock()

    revoke_oauth_token(session, redis, "token-id")

    assert session.execute.called
    assert session.commit.called
    redis.delete.assert_not_called()


# ---------------------------------------------------------------------------
# list_active_sessions / token_belongs_to_subject
# ---------------------------------------------------------------------------


def test_list_active_sessions_returns_session_execute_rows():
    """Thin delegation: the helper materialises whatever
    ``session.execute(...).scalars().all()`` returns into a list. The
    ``.scalars()`` step unwraps each one-element ``Row`` so callers see
    bare ``OAuthAccessToken`` entities (matches the declared return
    type).
    """
    from datetime import UTC, datetime

    session = MagicMock()
    fake_rows = [MagicMock(), MagicMock()]
    session.execute.return_value.scalars.return_value.all.return_value = fake_rows

    out = list_active_sessions(session, _account_ctx(), datetime.now(UTC))

    assert out == fake_rows
    assert session.execute.called


def test_token_belongs_to_subject_true_when_row_present():
    session = MagicMock()
    session.execute.return_value.first.return_value = ("some-id",)

    assert token_belongs_to_subject(session, "token-id", _account_ctx()) is True


def test_token_belongs_to_subject_false_when_no_row():
    session = MagicMock()
    session.execute.return_value.first.return_value = None

    assert token_belongs_to_subject(session, "token-id", _account_ctx()) is False
