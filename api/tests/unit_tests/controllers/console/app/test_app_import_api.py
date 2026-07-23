"""Unit tests for console app import endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from inspect import unwrap
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from controllers.console.app import app_import as app_import_module
from models.account import Account
from models.base import TypeBase
from models.engine import db
from models.model import App, AppMode
from services.app_dsl_service import ImportStatus
from services.entities.dsl_entities import CheckDependenciesResult
from services.feature_service import DeploymentEdition, SystemFeatureModel, WebAppAuthModel


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
    features = SystemFeatureModel(
        deployment_edition=DeploymentEdition.COMMUNITY,
        webapp_auth=WebAppAuthModel(enabled=enabled),
    )
    monkeypatch.setattr(app_import_module.FeatureService, "get_system_features", lambda: features)


def _make_account(account_id: str = "u1") -> Account:
    account = Account(name="Test User", email="test@example.com")
    account.id = account_id
    return account


@pytest.fixture
def app() -> Iterator[Flask]:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)

    with app.app_context():
        yield app


@pytest.fixture
def sqlite_app_engine(app: Flask) -> Engine:
    engine = db.engine
    TypeBase.metadata.create_all(engine, tables=[TypeBase.metadata.tables[App.__tablename__]])
    return engine


@dataclass
class TransactionEvents:
    commits: int = 0
    rollbacks: int = 0


@pytest.fixture
def transaction_events() -> TransactionEvents:
    """Observe transaction decisions while keeping the controller on a real SQLAlchemy session."""

    observed = TransactionEvents()

    def record_commit(_session: Session) -> None:
        observed.commits += 1

    def record_rollback(_session: Session) -> None:
        observed.rollbacks += 1

    event.listen(Session, "after_commit", record_commit)
    event.listen(Session, "after_rollback", record_rollback)
    try:
        yield observed
    finally:
        event.remove(Session, "after_commit", record_commit)
        event.remove(Session, "after_rollback", record_rollback)


def _install_persisting_service_result(
    monkeypatch: pytest.MonkeyPatch,
    *,
    method_name: str,
    result: _Result,
) -> str:
    app_id = result.app_id or "rolled-back-app"

    def _return_result(import_service: app_import_module.AppDslService, *_args, **_kwargs):
        import_service._session.add(
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


def _assert_app_persistence(sqlite_app_engine: Engine, app_id: str, *, persisted: bool) -> None:
    with Session(sqlite_app_engine) as session:
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
        transaction_events: TransactionEvents,
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.FAILED, app_id=None),
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, _make_account())

        assert transaction_events.rollbacks == 1
        assert transaction_events.commits == 0
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=False)
        assert status == 400
        assert response["status"] == ImportStatus.FAILED

    def test_import_post_returns_pending_status_and_commits(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
        transaction_events: TransactionEvents,
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.PENDING),
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, _make_account())

        assert transaction_events.commits == 1
        assert transaction_events.rollbacks == 0
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 202
        assert response["status"] == ImportStatus.PENDING

    def test_import_post_updates_webapp_auth_when_enabled(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
        transaction_events: TransactionEvents,
    ) -> None:
        method = unwrap(api.post)

        _install_features(monkeypatch, enabled=True)
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.COMPLETED, app_id="app-123"),
        )
        update_access = MagicMock()
        monkeypatch.setattr(app_import_module.EnterpriseService.WebAppAuth, "update_app_access_mode", update_access)

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method(api, _make_account())

        assert transaction_events.commits == 1
        assert transaction_events.rollbacks == 0
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
        transaction_events: TransactionEvents,
    ) -> None:
        method = _unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (_make_account(), "tenant-1"),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.COMPLETED, app_id="app-123"),
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports", method="POST", json={"mode": "yaml-content"}):
            response, status = method()

        assert transaction_events.commits == 1
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]

    def test_import_post_does_not_attach_permission_keys_when_overwriting_existing_app(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
        transaction_events: TransactionEvents,
    ) -> None:
        method = _unwrap(api.post)

        _install_features(monkeypatch, enabled=False)
        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (_make_account(), "tenant-1"),
        )
        monkeypatch.setattr(app_import_module.dify_config, "RBAC_ENABLED", True)
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="import_app",
            result=_Result(ImportStatus.COMPLETED, app_id="app-123"),
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

        assert transaction_events.commits == 1
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
        transaction_events: TransactionEvents,
    ) -> None:
        method = unwrap(api.post)

        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="confirm_import",
            result=_Result(ImportStatus.FAILED),
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(api, _make_account(), import_id="import-1")

        assert transaction_events.rollbacks == 1
        assert transaction_events.commits == 0
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=False)
        assert status == 400
        assert response["status"] == ImportStatus.FAILED

    def test_import_confirm_attaches_permission_keys_when_creating_new_app_and_rbac_enabled(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
        transaction_events: TransactionEvents,
    ) -> None:
        method = _unwrap(api.post)

        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (_make_account(), "tenant-1"),
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
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="confirm_import",
            result=_Result(ImportStatus.COMPLETED, app_id="app-456"),
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda tenant_id, account_id, app_id: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(import_id="import-1")

        assert transaction_events.commits == 1
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]

    def test_import_confirm_does_not_attach_permission_keys_when_overwriting_existing_app(
        self,
        api,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_app_engine: Engine,
        transaction_events: TransactionEvents,
    ) -> None:
        method = _unwrap(api.post)

        monkeypatch.setattr(
            app_import_module,
            "current_account_with_tenant",
            lambda: (_make_account(), "tenant-1"),
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
        app_id = _install_persisting_service_result(
            monkeypatch,
            method_name="confirm_import",
            result=_Result(ImportStatus.COMPLETED, app_id="app-456"),
        )
        monkeypatch.setattr(
            app_import_module,
            "get_app_permission_keys",
            lambda *_args, **_kwargs: ["app.acl.view_layout", "app.acl.edit"],
        )

        with app.test_request_context("/console/api/apps/imports/import-1/confirm", method="POST"):
            response, status = method(import_id="import-1")

        assert transaction_events.commits == 1
        _assert_app_persistence(sqlite_app_engine, app_id, persisted=True)
        assert status == 200
        assert response["permission_keys"] == []


class TestAppImportCheckDependenciesApi:
    def test_import_check_dependencies_returns_result(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        api = app_import_module.AppImportCheckDependenciesApi()
        method = unwrap(api.get)
        monkeypatch.setattr(
            app_import_module.AppDslService,
            "check_dependencies",
            lambda *_args, **_kwargs: CheckDependenciesResult(leaked_dependencies=[]),
        )

        with app.test_request_context("/console/api/apps/imports/app-1/check-dependencies", method="GET"):
            response, status = method(api, app_model=App(id="app-1"))

        assert status == 200
        assert response["leaked_dependencies"] == []
