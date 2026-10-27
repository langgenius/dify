from datetime import UTC, datetime, timedelta
from types import ModuleType

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.oauth import OpenAPIOAuthAccessToken, OpenAPIOAuthRefreshToken
from tests.helpers.unit.schedule.task_module_loader import load_schedule_module

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
RETENTION = timedelta(days=30)


@pytest.fixture
def cleanup_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return load_schedule_module(monkeypatch, "clean_oauth_access_tokens_task")


def _refresh(label: str, *, expires_at: datetime, rotated_at: datetime | None = None) -> OpenAPIOAuthRefreshToken:
    row = OpenAPIOAuthRefreshToken(
        family_id="99999999-9999-9999-9999-999999999999",
        token_hash=f"hash-{label}",
        subject_email="ada@example.com",
        subject_issuer="dify:account",
        account_id="11111111-1111-1111-1111-111111111111",
        client_id="difyctl",
        device_label=label,
        expires_at=expires_at,
    )
    row.rotated_at = rotated_at
    return row


def _access(label: str, *, expires_at: datetime, revoked_at: datetime | None = None) -> OpenAPIOAuthAccessToken:
    return OpenAPIOAuthAccessToken(
        subject_email="ada@example.com",
        subject_issuer="dify:account",
        account_id="11111111-1111-1111-1111-111111111111",
        client_id="difyctl",
        device_label=label,
        prefix="dfoa_",
        token_hash=f"hash-{label}",
        expires_at=expires_at,
        revoked_at=revoked_at,
    )


def _labels(session: Session) -> tuple[set[str], set[str]]:
    session.expire_all()
    access = set(session.scalars(select(OpenAPIOAuthAccessToken.device_label)).all())
    refresh = set(session.scalars(select(OpenAPIOAuthRefreshToken.device_label)).all())
    return access, refresh


def test_cleanup_deletes_only_unusable_rows(sqlite_session: Session, cleanup_module: ModuleType) -> None:
    sqlite_session.add_all(
        [
            _refresh("expired", expires_at=NOW - timedelta(seconds=1)),
            _refresh("live", expires_at=NOW + timedelta(days=30)),
            # Kept until it expires: presenting it after the grace still revokes the grant.
            _refresh("rotated-past-grace", expires_at=NOW + timedelta(days=29), rotated_at=NOW - timedelta(days=1)),
            _access("revoked-long-ago", expires_at=NOW, revoked_at=NOW - RETENTION - timedelta(days=1)),
            _access("zombie", expires_at=NOW - RETENTION - timedelta(days=1)),
            _access("revoked-recently", expires_at=NOW, revoked_at=NOW - timedelta(days=1)),
            _access("live", expires_at=NOW + timedelta(days=1)),
        ]
    )
    sqlite_session.commit()

    cleaned = cleanup_module.clean_oauth_tokens(sqlite_session, now=NOW, retention=RETENTION)

    assert (cleaned.access_tokens, cleaned.refresh_tokens) == (2, 1)
    assert _labels(sqlite_session) == ({"revoked-recently", "live"}, {"live", "rotated-past-grace"})
