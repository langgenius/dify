"""Unit tests for ``clean_oauth_access_tokens_task``.

The task prunes revoked / zombie device-flow tokens past the retention
window. Sessions are provided by the shared SQLite session factory, which
proves the task no longer depends on the global Flask-SQLAlchemy session.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.oauth import OAuthAccessToken
from schedule.clean_oauth_access_tokens_task import clean_oauth_access_tokens_task

RETENTION_DAYS = 30


def _make_token(
    *,
    expires_at: datetime,
    revoked_at: datetime | None = None,
    device_label: str = "device",
) -> OAuthAccessToken:
    return OAuthAccessToken(
        subject_email="user@example.com",
        client_id="dify-cli",
        device_label=device_label,
        prefix="dfoa_",
        expires_at=expires_at,
        revoked_at=revoked_at,
    )


@pytest.fixture
def seeded_tokens(
    sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> dict[str, str]:
    """Seed one token per retention category and return their ids by label."""
    config_overrides(OAUTH_ACCESS_TOKEN_RETENTION_DAYS=RETENTION_DAYS)

    now = datetime.now(UTC)
    past_cutoff = now - timedelta(days=RETENTION_DAYS + 1)
    tokens = {
        # Revoked long ago: past retention, must be deleted.
        "old_revoked": _make_token(expires_at=now, revoked_at=past_cutoff),
        # Expired but never presented (revoked_at stays NULL): zombie, must be deleted.
        "zombie": _make_token(expires_at=past_cutoff),
        # Recently revoked: still within retention, must be kept.
        "fresh_revoked": _make_token(expires_at=now, revoked_at=now - timedelta(days=1)),
        # Valid and unexpired: must be kept.
        "valid": _make_token(expires_at=now + timedelta(days=RETENTION_DAYS)),
    }
    with sqlite_session_factory() as session:
        for token in tokens.values():
            session.add(token)
        session.commit()
    return {label: token.id for label, token in tokens.items()}


def test_prunes_only_tokens_past_retention(
    seeded_tokens: dict[str, str], sqlite_session_factory: sessionmaker[Session]
) -> None:
    clean_oauth_access_tokens_task()

    with sqlite_session_factory() as session:
        remaining = set(session.scalars(select(OAuthAccessToken.id)).all())

    assert remaining == {seeded_tokens["fresh_revoked"], seeded_tokens["valid"]}


def test_is_idempotent_when_nothing_matches(
    seeded_tokens: dict[str, str], sqlite_session_factory: sessionmaker[Session]
) -> None:
    clean_oauth_access_tokens_task()
    clean_oauth_access_tokens_task()

    with sqlite_session_factory() as session:
        remaining = set(session.scalars(select(OAuthAccessToken.id)).all())

    assert remaining == {seeded_tokens["fresh_revoked"], seeded_tokens["valid"]}
