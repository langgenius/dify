"""Shared fixtures for controllers.web unit tests."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from flask import Flask


@pytest.fixture
def app() -> Flask:
    """Minimal Flask app for request contexts."""
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


class FakeSession:
    """Stand-in for db.session that returns pre-seeded objects by model class name."""

    def __init__(self, mapping: dict[str, Any] | None = None):
        self._mapping: dict[str, Any] = mapping or {}
        self._model_name: str | None = None

    def query(self, model: type) -> FakeSession:
        self._model_name = model.__name__
        return self

    def where(self, *_args: object, **_kwargs: object) -> FakeSession:
        return self

    def first(self) -> Any:
        assert self._model_name is not None
        return self._mapping.get(self._model_name)


class FakeDB:
    """Minimal db stub exposing engine and session."""

    def __init__(self, session: FakeSession | None = None):
        self.session = session or FakeSession()
        self.engine = object()


def make_app_model(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    mode: str = "chat",
    enable_site: bool = True,
    status: str = "normal",
) -> SimpleNamespace:
    """Build a fake App model with common defaults."""
    tenant = SimpleNamespace(
        id=tenant_id,
        status="normal",
        plan="basic",
        custom_config_dict={},
    )
    return SimpleNamespace(
        id=app_id,
        tenant_id=tenant_id,
        tenant=tenant,
        mode=mode,
        enable_site=enable_site,
        status=status,
        workflow=None,
        app_model_config=None,
    )


def make_end_user(
    *,
    user_id: str = "end-user-1",
    session_id: str = "session-1",
    external_user_id: str = "ext-user-1",
) -> SimpleNamespace:
    """Build a fake EndUser model with common defaults."""
    return SimpleNamespace(
        id=user_id,
        session_id=session_id,
        external_user_id=external_user_id,
    )
