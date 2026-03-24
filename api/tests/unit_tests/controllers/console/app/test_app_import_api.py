from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from controllers.console.app import app_import as app_import_module
from services.app_dsl_service import ImportStatus


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


class _Result:
    def __init__(self, status: ImportStatus, app_id: str | None = "app-1"):
        self.status = status
        self.app_id = app_id

    def model_dump(self, mode: str = "json"):
        return {"status": self.status, "app_id": self.app_id}


class _SessionContext:
    def __init__(self, session):
        self._session = session

    def __enter__(self):
        return self._session

    def __exit__(self, exc_type, exc, tb):
        return False


def _install_session(monkeypatch: pytest.MonkeyPatch, session: MagicMock) -> None:
    monkeypatch.setattr(app_import_module, "Session", lambda *_: _SessionContext(session))
    monkeypatch.setattr(app_import_module, "db", SimpleNamespace(engine=object()))


def _install_features(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    features = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=enabled))
    monkeypatch.setattr(app_import_module.FeatureService, "get_system_features", lambda: features)


def test_import_post_returns_failed_status(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = app_import_module.AppImportApi()
    method = _unwrap(api.post)

    session = MagicMock()
    _install_session(monkeypatch, session)
    _install_features(monkeypatch, enabled=False)
    monkeypatch.setattr(
        app_import_module.AppDslService,
        "import_app",
        lambda *_args, **_kwargs: _Result(ImportStatus.FAILED, app_id=None),
    )
    monkeypatch.setattr(app_import_module, "current_account_with_tenant", lambda: (SimpleNamespace(id="u1"), "t1"))

    with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
        response, status = method()

    session.commit.assert_called_once()
    assert status == 400
    assert response["status"] == ImportStatus.FAILED


def test_import_post_returns_pending_status(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = app_import_module.AppImportApi()
    method = _unwrap(api.post)

    session = MagicMock()
    _install_session(monkeypatch, session)
    _install_features(monkeypatch, enabled=False)
    monkeypatch.setattr(
        app_import_module.AppDslService,
        "import_app",
        lambda *_args, **_kwargs: _Result(ImportStatus.PENDING),
    )
    monkeypatch.setattr(app_import_module, "current_account_with_tenant", lambda: (SimpleNamespace(id="u1"), "t1"))

    with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
        response, status = method()

    session.commit.assert_called_once()
    assert status == 202
    assert response["status"] == ImportStatus.PENDING


def test_import_post_updates_webapp_auth_when_enabled(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = app_import_module.AppImportApi()
    method = _unwrap(api.post)

    session = MagicMock()
    _install_session(monkeypatch, session)
    _install_features(monkeypatch, enabled=True)
    monkeypatch.setattr(
        app_import_module.AppDslService,
        "import_app",
        lambda *_args, **_kwargs: _Result(ImportStatus.COMPLETED, app_id="app-123"),
    )
    update_access = MagicMock()
    monkeypatch.setattr(app_import_module.EnterpriseService.WebAppAuth, "update_app_access_mode", update_access)
    monkeypatch.setattr(app_import_module, "current_account_with_tenant", lambda: (SimpleNamespace(id="u1"), "t1"))

    with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
        response, status = method()

    session.commit.assert_called_once()
    update_access.assert_called_once_with("app-123", "private")
    assert status == 200
    assert response["status"] == ImportStatus.COMPLETED


def test_import_confirm_returns_failed_status(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = app_import_module.AppImportConfirmApi()
    method = _unwrap(api.post)

    session = MagicMock()
    _install_session(monkeypatch, session)
    monkeypatch.setattr(
        app_import_module.AppDslService,
        "confirm_import",
        lambda *_args, **_kwargs: _Result(ImportStatus.FAILED),
    )
    monkeypatch.setattr(app_import_module, "current_account_with_tenant", lambda: (SimpleNamespace(id="u1"), "t1"))

    with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
        response, status = method(import_id="import-1")

    session.commit.assert_called_once()
    assert status == 400
    assert response["status"] == ImportStatus.FAILED


def test_import_check_dependencies_returns_result(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = app_import_module.AppImportCheckDependenciesApi()
    method = _unwrap(api.get)

    session = MagicMock()
    _install_session(monkeypatch, session)
    monkeypatch.setattr(
        app_import_module.AppDslService,
        "check_dependencies",
        lambda *_args, **_kwargs: SimpleNamespace(model_dump=lambda mode="json": {"leaked_dependencies": []}),
    )

    with app.test_request_context("/console/api/apps/imports/app-1/check-dependencies", method="GET"):
        response, status = method(app_model=SimpleNamespace(id="app-1"))

    assert status == 200
    assert response["leaked_dependencies"] == []
