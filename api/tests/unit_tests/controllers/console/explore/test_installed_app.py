"""SQLite-backed tests for the installed-app console controller."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import controllers.console.explore.installed_app as module
from models.base import TypeBase
from models.model import App, AppMode, AppModelConfig, InstalledApp, RecommendedApp
from models.workflow import Workflow, WorkflowKind, WorkflowType

type Payload = dict[str, object]
type PayloadPatch = Callable[[Payload], AbstractContextManager[object]]


@pytest.fixture
def database(sqlite_engine: Engine) -> Iterator[scoped_session[Session]]:
    tables = [model.__table__ for model in (App, AppModelConfig, Workflow, InstalledApp, RecommendedApp)]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    try:
        yield session
    finally:
        session.remove()


@pytest.fixture
def tenant_id() -> str:
    return "tenant-1"


@pytest.fixture
def current_user(tenant_id: str) -> MagicMock:
    user = MagicMock()
    user.id = "user-1"
    user.current_tenant = MagicMock(id=tenant_id)
    return user


@pytest.fixture
def payload_patch() -> PayloadPatch:
    def _patch(payload: Payload) -> AbstractContextManager[object]:
        return patch.object(type(module.console_ns), "payload", new_callable=PropertyMock, return_value=payload)

    return _patch


def _app(
    session: scoped_session[Session],
    *,
    app_id: str = "app-1",
    tenant_id: str = "owner-tenant",
    mode: AppMode = AppMode.CHAT,
    public: bool = True,
    published: bool = True,
) -> App:
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name=f"App {app_id}",
        description="description",
        mode=mode,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=True,
        enable_api=True,
        is_public=public,
        max_active_requests=None,
    )
    session.add(app)
    session.flush()
    if published and mode in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
        workflow = Workflow(
            id=f"workflow-{app_id}",
            tenant_id=tenant_id,
            app_id=app_id,
            type=WorkflowType.WORKFLOW,
            kind=WorkflowKind.STANDARD,
            version="1",
            graph='{"nodes":[],"edges":[]}',
            features="{}",
            created_by="user-1",
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        session.add(workflow)
        app.workflow_id = workflow.id
    elif published:
        model_config = AppModelConfig(app_id=app_id)
        session.add(model_config)
        session.flush()
        app.app_model_config_id = model_config.id
    session.commit()
    return app


def _installed(
    session: scoped_session[Session],
    app: App,
    *,
    tenant_id: str = "tenant-1",
    pinned: bool = False,
) -> InstalledApp:
    installed = InstalledApp(
        app_id=app.id,
        tenant_id=tenant_id,
        app_owner_tenant_id=app.tenant_id,
        is_pinned=pinned,
        last_used_at=datetime(2024, 1, 1),
    )
    session.add(installed)
    session.commit()
    return installed


@contextmanager
def _controller_context(
    database: scoped_session[Session], *, role: str = "owner", auth_enabled: bool = False
) -> Iterator[None]:
    with (
        patch.object(module.db, "session", database),
        patch.object(module.TenantService, "get_user_role", return_value=role),
        patch.object(
            module.FeatureService,
            "get_system_features",
            return_value=MagicMock(webapp_auth=MagicMock(enabled=auth_enabled)),
        ),
    ):
        yield


def test_published_app_filter_compiles_expected_targets() -> None:
    compiled = str(module._published_app_filter().compile(compile_kwargs={"literal_binds": True}))
    assert "workflows" in compiled
    assert "app_model_configs" in compiled
    assert "workflow_id" in compiled
    assert "app_model_config_id" in compiled
    assert "apps.mode != 'agent'" in compiled


def test_get_installed_apps_filters_tenant_publication_mode_and_app_id(
    app: Flask,
    current_user: MagicMock,
    tenant_id: str,
    database: scoped_session[Session],
) -> None:
    chat = _app(database, app_id="chat")
    workflow = _app(database, app_id="workflow", mode=AppMode.WORKFLOW)
    unpublished = _app(database, app_id="unpublished", published=False)
    agent = _app(database, app_id="agent", mode=AppMode.AGENT)
    foreign = _app(database, app_id="foreign")
    for model, installed_tenant in (
        (chat, tenant_id),
        (workflow, tenant_id),
        (unpublished, tenant_id),
        (agent, tenant_id),
        (foreign, "tenant-2"),
    ):
        _installed(database, model, tenant_id=installed_tenant)
    api = module.InstalledAppsListApi()
    method = unwrap(api.get)
    with app.test_request_context("/"), _controller_context(database):
        result = method(api, tenant_id, current_user)
    assert {item["app"]["id"] for item in result["installed_apps"]} == {"chat", "workflow"}
    assert all(item["editable"] is True for item in result["installed_apps"])
    assert all(item["uninstallable"] is False for item in result["installed_apps"])

    with app.test_request_context("/?app_id=workflow"), _controller_context(database, role="member"):
        filtered = method(api, tenant_id, current_user)
    assert [item["app"]["id"] for item in filtered["installed_apps"]] == ["workflow"]
    assert filtered["installed_apps"][0]["editable"] is False


def test_get_installed_apps_applies_web_auth_permission_state(
    app: Flask,
    current_user: MagicMock,
    tenant_id: str,
    database: scoped_session[Session],
) -> None:
    allowed = _app(database, app_id="allowed")
    denied = _app(database, app_id="denied")
    sso = _app(database, app_id="sso")
    for model in (allowed, denied, sso):
        _installed(database, model)
    settings = {
        "allowed": SimpleNamespace(access_mode="restricted"),
        "denied": SimpleNamespace(access_mode="restricted"),
        "sso": SimpleNamespace(access_mode="sso_verified"),
    }
    api = module.InstalledAppsListApi()
    method = unwrap(api.get)
    with (
        app.test_request_context("/"),
        _controller_context(database, auth_enabled=True),
        patch.object(module.EnterpriseService.WebAppAuth, "batch_get_app_access_mode_by_id", return_value=settings),
        patch.object(
            module.EnterpriseService.WebAppAuth,
            "batch_is_user_allowed_to_access_webapps",
            return_value={"allowed": True, "denied": False},
        ),
    ):
        result = method(api, tenant_id, current_user)
    assert [item["app"]["id"] for item in result["installed_apps"]] == ["allowed"]


def test_get_installed_apps_requires_current_tenant(
    app: Flask, tenant_id: str, database: scoped_session[Session]
) -> None:
    current_user = MagicMock(current_tenant=None)
    api = module.InstalledAppsListApi()
    with app.test_request_context("/"), patch.object(module.db, "session", database):
        with pytest.raises(ValueError, match="current_user.current_tenant must not be None"):
            unwrap(api.get)(api, tenant_id, current_user)


def test_post_installs_public_recommended_app_and_is_idempotent(
    app: Flask,
    tenant_id: str,
    payload_patch: PayloadPatch,
    database: scoped_session[Session],
) -> None:
    app_model = _app(database, app_id="app-1", public=True)
    recommended = RecommendedApp(
        app_id=app_model.id,
        description={"en-US": "recommended"},
        copyright="copyright",
        privacy_policy="https://example.com/privacy",
        category="productivity",
    )
    database.add(recommended)
    database.commit()
    api = module.InstalledAppsListApi()
    method = unwrap(api.post)
    for _ in range(2):
        with (
            app.test_request_context("/", json={"app_id": app_model.id}),
            payload_patch({"app_id": app_model.id}),
            patch.object(module.db, "session", database),
        ):
            assert method(api, tenant_id) == {"message": "App installed successfully"}
    database.expire_all()
    installed = database.scalars(select(InstalledApp)).all()
    assert len(installed) == 1
    assert installed[0].tenant_id == tenant_id
    assert installed[0].app_owner_tenant_id == app_model.tenant_id
    assert database.get(RecommendedApp, recommended.id).install_count == 1


def test_post_enforces_recommendation_and_public_state(
    app: Flask,
    tenant_id: str,
    payload_patch: PayloadPatch,
    database: scoped_session[Session],
) -> None:
    api = module.InstalledAppsListApi()
    method = unwrap(api.post)
    with (
        app.test_request_context("/", json={"app_id": "missing"}),
        payload_patch({"app_id": "missing"}),
        patch.object(module.db, "session", database),
        pytest.raises(NotFound),
    ):
        method(api, tenant_id)

    private_app = _app(database, app_id="private", public=False)
    database.add(
        RecommendedApp(
            app_id=private_app.id,
            description={},
            copyright="copyright",
            privacy_policy="privacy",
            category="category",
        )
    )
    database.commit()
    with (
        app.test_request_context("/", json={"app_id": private_app.id}),
        payload_patch({"app_id": private_app.id}),
        patch.object(module.db, "session", database),
        pytest.raises(Forbidden),
    ):
        method(api, tenant_id)


def test_delete_removes_foreign_installed_app_and_rejects_owned_app(
    tenant_id: str, database: scoped_session[Session]
) -> None:
    foreign_app = _app(database, app_id="foreign", tenant_id="owner-tenant")
    installed = _installed(database, foreign_app, tenant_id=tenant_id)
    installed_id = installed.id
    api = module.InstalledAppApi()
    with patch.object(module.db, "session", database):
        response, status = unwrap(api.delete)(api, tenant_id, installed)
    assert (response, status) == ("", 204)
    assert database.get(InstalledApp, installed_id) is None

    owned_app = _app(database, app_id="owned", tenant_id=tenant_id)
    owned_install = _installed(database, owned_app, tenant_id=tenant_id)
    with pytest.raises(BadRequest):
        unwrap(api.delete)(api, tenant_id, owned_install)
    assert database.get(InstalledApp, owned_install.id) is not None


def test_patch_persists_pin_and_noop_payload(
    app: Flask, payload_patch: PayloadPatch, database: scoped_session[Session]
) -> None:
    app_model = _app(database)
    installed = _installed(database, app_model)
    api = module.InstalledAppApi()
    with (
        app.test_request_context("/", json={"is_pinned": True}),
        payload_patch({"is_pinned": True}),
        patch.object(module.db, "session", database),
    ):
        assert unwrap(api.patch)(installed)["result"] == "success"
    database.expire_all()
    assert database.get(InstalledApp, installed.id).is_pinned is True

    with (
        app.test_request_context("/", json={}),
        payload_patch({}),
        patch.object(module.db, "session", database),
    ):
        assert unwrap(api.patch)(installed)["result"] == "success"
