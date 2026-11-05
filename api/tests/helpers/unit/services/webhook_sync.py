"""Let the draft-synced webhook listener run against SQLite."""

import pytest
from sqlalchemy import Engine

from extensions.ext_database import db


def route_webhook_sync(monkeypatch: pytest.MonkeyPatch, engine: Engine) -> None:
    """Point the webhook listener's database at `engine`; the unit suite's Redis double has nothing cached."""
    monkeypatch.setattr(type(db), "engine", property(lambda _: engine))
