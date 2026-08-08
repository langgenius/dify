"""Initialization validation tests with real setup-state persistence in SQLite."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.console import init_validate
from controllers.console.error import AlreadySetupError, InitValidateFailedError
from models.model import DifySetup


def test_get_init_status_finished(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate, "get_init_validate_status", lambda: True)
    result = init_validate.get_init_status()
    assert result.status == "finished"


def test_get_init_status_not_started(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate, "get_init_validate_status", lambda: False)
    result = init_validate.get_init_status()
    assert result.status == "not_started"


def test_validate_init_password_already_setup(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(init_validate.TenantService, "get_tenant_count", lambda *, session: 1)
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        with pytest.raises(AlreadySetupError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="pw"))


def test_validate_init_password_wrong_password(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(init_validate.TenantService, "get_tenant_count", lambda *, session: 0)
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        with pytest.raises(InitValidateFailedError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="wrong"))
        assert init_validate.session.get("is_init_validated") is False


def test_validate_init_password_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(init_validate.TenantService, "get_tenant_count", lambda *, session: 0)
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        result = init_validate.validate_init_password(init_validate.InitValidatePayload(password="expected"))
        assert result.result == "success"
        assert init_validate.session.get("is_init_validated") is True


def test_get_init_validate_status_not_self_hosted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "CLOUD")
    assert init_validate.get_init_validate_status() is True


def test_get_init_validate_status_validated_session(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        init_validate.session["is_init_validated"] = True
        assert init_validate.get_init_validate_status() is True


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_get_init_validate_status_setup_exists(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    monkeypatch.setattr(init_validate, "db", SimpleNamespace(engine=sqlite_session.get_bind()))
    sqlite_session.add(DifySetup(version="test-version"))
    sqlite_session.commit()
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        init_validate.session.pop("is_init_validated", None)
        assert init_validate.get_init_validate_status() is True


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_get_init_validate_status_not_validated(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    monkeypatch.setattr(init_validate, "db", SimpleNamespace(engine=sqlite_session.get_bind()))
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        init_validate.session.pop("is_init_validated", None)
        assert init_validate.get_init_validate_status() is False
