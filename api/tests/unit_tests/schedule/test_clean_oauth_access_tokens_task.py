import importlib.util
import sys
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.oauth import OpenAPIOAuthAccessToken, OpenAPIOAuthRefreshToken

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
RETENTION = timedelta(days=30)


class _CeleryStub:
    def task(self, *_args: object, **_kwargs: object) -> Callable[[Callable[..., object]], Callable[..., object]]:
        def decorator(func: Callable[..., object]) -> Callable[..., object]:
            return func

        return decorator


class _AppStub(ModuleType):
    celery = _CeleryStub()


@pytest.fixture
def cleanup_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    # Importing the task module for real runs ``import app``, which builds the Flask app
    # and installs its logging filters for the rest of the test session.
    path = Path(__file__).resolve().parents[3] / "schedule" / "clean_oauth_access_tokens_task.py"
    spec = importlib.util.spec_from_file_location("_test_clean_oauth_access_tokens_task", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    with monkeypatch.context() as patch:
        patch.setitem(sys.modules, "app", _AppStub("app"))
        # The module's dataclass resolves its annotations through sys.modules.
        patch.setitem(sys.modules, spec.name, module)
        spec.loader.exec_module(module)
    return module


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


def test_cleanup_deletes_expired_refresh_tokens_and_keeps_usable_ones(
    sqlite_session: Session, cleanup_module: ModuleType
) -> None:
    sqlite_session.add_all(
        [
            _refresh("expired", expires_at=NOW - timedelta(seconds=1)),
            _refresh("rotated-and-expired", expires_at=NOW - timedelta(days=1), rotated_at=NOW - timedelta(days=2)),
            _refresh("live", expires_at=NOW + timedelta(days=30)),
            _refresh("rotated-in-grace", expires_at=NOW + timedelta(days=30), rotated_at=NOW - timedelta(minutes=5)),
            # Kept until it expires: presenting it after the grace still revokes the grant.
            _refresh("rotated-past-grace", expires_at=NOW + timedelta(days=29), rotated_at=NOW - timedelta(days=1)),
        ]
    )
    sqlite_session.commit()

    cleaned = cleanup_module.clean_oauth_tokens(sqlite_session, now=NOW, retention=RETENTION)

    assert cleaned.refresh_tokens == 2
    assert _labels(sqlite_session)[1] == {"live", "rotated-in-grace", "rotated-past-grace"}


def test_cleanup_still_prunes_access_rows_past_retention(sqlite_session: Session, cleanup_module: ModuleType) -> None:
    sqlite_session.add_all(
        [
            _access("revoked-long-ago", expires_at=NOW, revoked_at=NOW - RETENTION - timedelta(days=1)),
            _access("zombie", expires_at=NOW - RETENTION - timedelta(days=1)),
            _access("revoked-recently", expires_at=NOW, revoked_at=NOW - timedelta(days=1)),
            _access("live", expires_at=NOW + timedelta(days=1)),
        ]
    )
    sqlite_session.commit()

    cleaned = cleanup_module.clean_oauth_tokens(sqlite_session, now=NOW, retention=RETENTION)

    assert cleaned.access_tokens == 2
    assert _labels(sqlite_session)[0] == {"revoked-recently", "live"}
