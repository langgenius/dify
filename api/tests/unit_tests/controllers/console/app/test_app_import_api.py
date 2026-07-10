"""Unit tests for console app import endpoints."""

from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from controllers.console.app import app_import as app_import_module
from models.base import TypeBase
from models.model import App, AppMode
from services.app_dsl_service import ImportStatus


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


class _Result:
    def __init__(
        self,
        status: ImportStatus,
        app_id: str | None = "app-1",
        permission_keys: list[str] | None = None,
    ):
        self.status = status
        self.app_id = app_id
        self.permission_keys = permission_keys or []

    def model_dump(self, mode: str = "json"):
        return {"status": self.status, "app_id": self.app_id, "permission_keys": self.permission_keys}


def _install_features(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    features = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=enabled))
    monkeypatch.setattr(app_import_module.FeatureService, "get_system_features", lambda: features)


@pytest.fixture
def sqlite_app_engine(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Engine:
    TypeBase.metadata.create_all(sqlite_engine, tables=[TypeBase.metadata.tables[App.__tablename__]])
    monkeypatch.setattr(app_import_module, "db", SimpleNamespace(engine=sqlite_engine))
    return sqlite_engine


def _install_transactional_service_result(
    monkeypatch: pytest.MonkeyPatch,
    *,
    method_name: str,
    result: _Result,
    transaction_events: list[str],
) -> str:
    app_id = result.app_id or "rolled-back-app"

    def _return_result(import_service, *_args, **_kwargs):
        session: Session = import_service._session
        event.listen(session, "after_commit", lambda _session: transaction_events.append("commit"))
        event.listen(session, "after_rollback", lambda _session: transaction_events.append("rollback"))
        session.add(
            App(
                id=app_id,
                tenant_id="tenant-1",
                name="Imported App",
                mode=AppMode.WORKFLOW,
                enable_site=True,
                enable_api=True,
            )
        )
        return result

    monkeypatch.setattr(app_import_module.AppDslService, method_name, _return_result)
    return app_id


def _assert_app_persistence(sqlite_engine: Engine, app_id: str, *, persisted: bool) -> None:
    with Session(sqlite_engine) as session:
        assert (session.get(App, app_id) is not None) is persisted


class TestAppImportApi:
    @pytest.fixture
    def api(self):
        return app_import_module.AppImportApi()

    def test_import_post_returns_failed_status_and_rolls_back(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        transaction_events: list[str] = []
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.FAILED, app_id=None),
            transaction_events=transaction_events,
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, SimpleNamespace(id="u1"))

        assert transaction_events == ["rollback"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=False)
        assert status == 400
        assert response["status"] == ImportStatus.FAILED

    def test_import_post_returns_pending_status_and_commits(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        transaction_events: list[str] = []
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.PENDING),
            transaction_events=transaction_events,
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, SimpleNamespace(id="u1"))

        assert transaction_events == ["commit"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 202
        assert response["status"] == ImportStatus.PENDING

    def test_import_post_updates_webapp_auth_when_enabled(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=True)
        transaction_events: list[str] = []
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.COMPLETED, app_id="app-123"),
            transaction_events=transaction_events,
        )
        update_access = MagicMock()
        monkeypatch.setattr(app_import_module.EnterpriseService.WebAppAuth, "update_app_access_mode", update_access)

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, SimpleNamespace(id="u1"))

        assert transaction_events == ["commit"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        update_access.assert_called_once_with("app-123", "private")
        assert status == 200
        assert response["status"] == ImportStatus.COMPLETED

    def test_import_post_attaches_permission_keys_when_creating_new_app_and_rbac_enabled(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = _unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        transaction_events: list[str] = []
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "tenant-1"),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.COMPLETED, app_id="app-123"),
            transaction_events=transaction_events,
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method()

        assert transaction_events == ["commit"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]

    def test_import_post_does_not_attach_permission_keys_when_overwriting_existing_app(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = _unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        transaction_events: list[str] = []
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "tenant-1"),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.COMPLETED, app_id="app-123"),
            transaction_events=transaction_events,
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda *_args, **_kwargs: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context(
            "/console/api/apps/imports",
            method="POST",
            json={"mode": "yaml-content", "app_id": "existing-app"},
        ):
            response, status = method()

        assert transaction_events == ["commit"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == []


class TestAppImportConfirmApi:
    @pytest.fixture
    def api(self):
        return app_import_module.AppImportConfirmApi()

    def test_import_confirm_returns_failed_status_and_rolls_back(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = unwrap(api.post)

        transaction_events: list[str] = []
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="confirm_import",
            result=_Result(ImportStatus.FAILED),
            transaction_events=transaction_events,
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(api, SimpleNamespace(id="u1"), import_id="import-1")

        assert transaction_events == ["rollback"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=False)
        assert status == 400
        assert response["status"] == ImportStatus.FAILED

    def test_import_confirm_attaches_permission_keys_when_creating_new_app_and_rbac_enabled(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = _unwrap(api.post)

        transaction_events: list[str] = []
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "tenant-1"),
        )
        monkeypatch.setattr(
            app_import_module.redis_client,
            "get",
            lambda *_args, **_kwargs: (
                b'{"import_mode":"yaml-content","yaml_content":"app: {}","app_id":null,'
                b'"name":null,"description":null,"icon_type":null,"icon":null,"icon_background":null}'
            ),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="confirm_import",
            result=_Result(ImportStatus.COMPLETED, app_id="app-456"),
            transaction_events=transaction_events,
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(import_id="import-1")

        assert transaction_events == ["commit"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]

    def test_import_confirm_does_not_attach_permission_keys_when_overwriting_existing_app(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
    ) -> None:
        method = _unwrap(api.post)

        transaction_events: list[str] = []
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "tenant-1"),
        )
        monkeypatch.setattr(
            app_import_module.redis_client,
            "get",
            lambda *_args, **_kwargs: (
                b'{"import_mode":"yaml-content","yaml_content":"app: {}","app_id":"existing-app",'
                b'"name":null,"description":null,"icon_type":null,"icon":null,"icon_background":null}'
            ),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        app_id = _install_transactional_service_result(
            monkeypatch,
            method_name="confirm_import",
            result=_Result(ImportStatus.COMPLETED, app_id="app-456"),
            transaction_events=transaction_events,
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda *_args, **_kwargs: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(import_id="import-1")

        assert transaction_events == ["commit"]
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == []
