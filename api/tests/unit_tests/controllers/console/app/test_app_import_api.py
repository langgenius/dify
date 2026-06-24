"""Unit tests for console app import endpoints."""

from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

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


def _mock_session(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    fake_session = MagicMock()
    fake_session.__enter__.return_value = fake_session
    fake_session.__exit__.return_value = None
    monkeypatch.setattr(app_import_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(app_import_module, "Session", lambda *_args, **_kwargs: fake_session)
    return fake_session


class TestAppImportApi:
    @pytest.fixture
    def api(self):
        return app_import_module.AppImportApi()

    def test_import_post_returns_failed_status_and_rolls_back(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        session = _mock_session(monkeypatch)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "import_app",
            lambda *_args, **_kwargs: _Result(ImportStatus.FAILED, app_id=None),
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, SimpleNamespace(id="u1"))

        session.rollback.assert_called_once_with()
        session.commit.assert_not_called()
        assert status == 400
        assert response["status"] == ImportStatus.FAILED

    def test_import_post_returns_pending_status_and_commits(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        session = _mock_session(monkeypatch)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "import_app",
            lambda *_args, **_kwargs: _Result(ImportStatus.PENDING),
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, SimpleNamespace(id="u1"))

        session.commit.assert_called_once_with()
        session.rollback.assert_not_called()
        assert status == 202
        assert response["status"] == ImportStatus.PENDING

    def test_import_post_updates_webapp_auth_when_enabled(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=True)
        session = _mock_session(monkeypatch)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "import_app",
            lambda *_args, **_kwargs: _Result(ImportStatus.COMPLETED, app_id="app-123"),
        )
        update_access = MagicMock()
        monkeypatch.setattr(app_import_module.EnterpriseService.WebAppAuth, "update_app_access_mode", update_access)

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, SimpleNamespace(id="u1"))

        session.commit.assert_called_once_with()
        session.rollback.assert_not_called()
        update_access.assert_called_once_with("app-123", "private")
        assert status == 200
        assert response["status"] == ImportStatus.COMPLETED

    def test_import_post_attaches_permission_keys_when_creating_new_app_and_rbac_enabled(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = _unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        session = _mock_session(monkeypatch)
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "tenant-1"),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "import_app",
            lambda *_args, **_kwargs: _Result(ImportStatus.COMPLETED, app_id="app-123"),
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method()

        session.commit.assert_called_once_with()
        assert status == 200
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]

    def test_import_post_does_not_attach_permission_keys_when_overwriting_existing_app(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = _unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        session = _mock_session(monkeypatch)
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "tenant-1"),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "import_app",
            lambda *_args, **_kwargs: _Result(ImportStatus.COMPLETED, app_id="app-123"),
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

        session.commit.assert_called_once_with()
        assert status == 200
        assert response["permission_keys"] == []


class TestAppImportConfirmApi:
    @pytest.fixture
    def api(self):
        return app_import_module.AppImportConfirmApi()

    def test_import_confirm_returns_failed_status_and_rolls_back(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = unwrap(api.post)

        session = _mock_session(monkeypatch)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "confirm_import",
            lambda *_args, **_kwargs: _Result(ImportStatus.FAILED),
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(api, SimpleNamespace(id="u1"), import_id="import-1")

        session.rollback.assert_called_once_with()
        session.commit.assert_not_called()
        assert status == 400
        assert response["status"] == ImportStatus.FAILED

    def test_import_confirm_attaches_permission_keys_when_creating_new_app_and_rbac_enabled(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = _unwrap(api.post)

        session = _mock_session(monkeypatch)
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
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "confirm_import",
            lambda *_args, **_kwargs: _Result(ImportStatus.COMPLETED, app_id="app-456"),
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(import_id="import-1")

        session.commit.assert_called_once_with()
        assert status == 200
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]

    def test_import_confirm_does_not_attach_permission_keys_when_overwriting_existing_app(
        self, api, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        method = _unwrap(api.post)

        session = _mock_session(monkeypatch)
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
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "confirm_import",
            lambda *_args, **_kwargs: _Result(ImportStatus.COMPLETED, app_id="app-456"),
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda *_args, **_kwargs: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(import_id="import-1")

        session.commit.assert_called_once_with()
        assert status == 200
        assert response["permission_keys"] == []
