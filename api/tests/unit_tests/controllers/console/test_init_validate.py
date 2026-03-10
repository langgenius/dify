from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from controllers.console import init_validate
from controllers.console.error import AlreadySetupError, InitValidateFailedError


class _SessionStub:
    def __init__(self, has_setup: bool):
        self._has_setup = has_setup

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *_args, **_kwargs):
        return SimpleNamespace(scalar_one_or_none=lambda: Mock() if self._has_setup else None)


def test_get_init_status_finished(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate, "get_init_validate_status", lambda: True)
    result = init_validate.get_init_status()
    assert result.status == "finished"


def test_get_init_status_not_started(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate, "get_init_validate_status", lambda: False)
    result = init_validate.get_init_status()
    assert result.status == "not_started"


def test_validate_init_password_already_setup(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(init_validate.TenantService, "get_tenant_count", lambda: 1)
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        with pytest.raises(AlreadySetupError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="pw"))


def test_validate_init_password_wrong_password(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(init_validate.TenantService, "get_tenant_count", lambda: 0)
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        with pytest.raises(InitValidateFailedError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="wrong"))
        assert init_validate.session.get("is_init_validated") is False


def test_validate_init_password_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(init_validate.TenantService, "get_tenant_count", lambda: 0)
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        result = init_validate.validate_init_password(init_validate.InitValidatePayload(password="expected"))
        assert result.result == "success"
        assert init_validate.session.get("is_init_validated") is True


def test_get_init_validate_status_not_self_hosted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "CLOUD")
    assert init_validate.get_init_validate_status() is True


def test_get_init_validate_status_validated_session(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        init_validate.session["is_init_validated"] = True
        assert init_validate.get_init_validate_status() is True


def test_get_init_validate_status_setup_exists(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    monkeypatch.setattr(init_validate, "Session", lambda *_args, **_kwargs: _SessionStub(True))
    monkeypatch.setattr(init_validate, "db", SimpleNamespace(engine=object()))
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        init_validate.session.pop("is_init_validated", None)
        assert init_validate.get_init_validate_status() is True


def test_get_init_validate_status_not_validated(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(init_validate.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setenv("INIT_PASSWORD", "expected")
    monkeypatch.setattr(init_validate, "Session", lambda *_args, **_kwargs: _SessionStub(False))
    monkeypatch.setattr(init_validate, "db", SimpleNamespace(engine=object()))
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        init_validate.session.pop("is_init_validated", None)
        assert init_validate.get_init_validate_status() is False
