from __future__ import annotations

from types import SimpleNamespace

import pytest
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.web.error import WebAppAuthRequiredError
from controllers.web.passport import (
    PassportService,
    decode_enterprise_webapp_user_id,
    exchange_token_for_existing_web_user,
    generate_session_id,
)
from services.webapp_auth_service import WebAppAuthType


def test_decode_enterprise_webapp_user_id_none() -> None:
    assert decode_enterprise_webapp_user_id(None) is None


def test_decode_enterprise_webapp_user_id_invalid_source(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PassportService, "verify", lambda *_args, **_kwargs: {"token_source": "bad"})
    with pytest.raises(Unauthorized):
        decode_enterprise_webapp_user_id("token")


def test_decode_enterprise_webapp_user_id_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    decoded = {"token_source": "webapp_login_token", "user_id": "u1"}
    monkeypatch.setattr(PassportService, "verify", lambda *_args, **_kwargs: decoded)
    assert decode_enterprise_webapp_user_id("token") == decoded


def test_exchange_token_public_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    site = SimpleNamespace(id="s1", app_id="a1", code="code", status="normal")
    app_model = SimpleNamespace(id="a1", status="normal", enable_site=True)

    def _scalar_side_effect(*_args, **_kwargs):
        if not hasattr(_scalar_side_effect, "calls"):
            _scalar_side_effect.calls = 0
        _scalar_side_effect.calls += 1
        return site if _scalar_side_effect.calls == 1 else app_model

    db_session = SimpleNamespace(scalar=_scalar_side_effect)
    monkeypatch.setattr("controllers.web.passport.db", SimpleNamespace(session=db_session))
    monkeypatch.setattr("controllers.web.passport._exchange_for_public_app_token", lambda *_args, **_kwargs: "resp")

    decoded = {"auth_type": "public"}
    result = exchange_token_for_existing_web_user("code", decoded, WebAppAuthType.PUBLIC)
    assert result == "resp"


def test_exchange_token_requires_external(monkeypatch: pytest.MonkeyPatch) -> None:
    site = SimpleNamespace(id="s1", app_id="a1", code="code", status="normal")
    app_model = SimpleNamespace(id="a1", status="normal", enable_site=True)

    def _scalar_side_effect(*_args, **_kwargs):
        if not hasattr(_scalar_side_effect, "calls"):
            _scalar_side_effect.calls = 0
        _scalar_side_effect.calls += 1
        return site if _scalar_side_effect.calls == 1 else app_model

    db_session = SimpleNamespace(scalar=_scalar_side_effect)
    monkeypatch.setattr("controllers.web.passport.db", SimpleNamespace(session=db_session))

    decoded = {"auth_type": "internal"}
    with pytest.raises(WebAppAuthRequiredError):
        exchange_token_for_existing_web_user("code", decoded, WebAppAuthType.EXTERNAL)


def test_exchange_token_missing_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    site = SimpleNamespace(id="s1", app_id="a1", code="code", status="normal")
    app_model = SimpleNamespace(id="a1", status="normal", enable_site=True, tenant_id="t1")

    def _scalar_side_effect(*_args, **_kwargs):
        if not hasattr(_scalar_side_effect, "calls"):
            _scalar_side_effect.calls = 0
        _scalar_side_effect.calls += 1
        if _scalar_side_effect.calls == 1:
            return site
        if _scalar_side_effect.calls == 2:
            return app_model
        return None

    db_session = SimpleNamespace(scalar=_scalar_side_effect, add=lambda *_a, **_k: None, commit=lambda: None)
    monkeypatch.setattr("controllers.web.passport.db", SimpleNamespace(session=db_session))

    decoded = {"auth_type": "internal"}
    with pytest.raises(NotFound):
        exchange_token_for_existing_web_user("code", decoded, WebAppAuthType.INTERNAL)


def test_generate_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    counts = [1, 0]

    def _scalar(*_args, **_kwargs):
        return counts.pop(0)

    db_session = SimpleNamespace(scalar=_scalar)
    monkeypatch.setattr("controllers.web.passport.db", SimpleNamespace(session=db_session))

    session_id = generate_session_id()
    assert session_id
