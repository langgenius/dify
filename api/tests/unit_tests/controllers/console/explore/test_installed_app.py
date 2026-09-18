from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import controllers.console.explore.installed_app as module
import services.installed_app_service as service_module
from models import Account, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.model import App, AppMode, AppModelConfig, IconType, InstalledApp, RecommendedApp
from models.workflow import Workflow, WorkflowKind, WorkflowType


@pytest.fixture
def tenant_id() -> str:
    return "tenant-1"


@pytest.fixture
def database_session(sqlite_engine: Engine) -> Generator[scoped_session[Session]]:
    session_registry = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    try:
        yield session_registry
    finally:
        session_registry.remove()


@pytest.fixture
def current_user(database_session: scoped_session[Session], tenant_id: str) -> Account:
    tenant = Tenant(name="Current tenant")
    tenant.id = tenant_id
    account = Account(name="Current user", email="user@example.com", status=AccountStatus.ACTIVE)
    account.id = "user-1"
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    database_session.add_all([tenant, account, membership])
    database_session.commit()
    account._current_tenant = tenant
    account.role = TenantAccountRole.OWNER
    return account


def _persist_app(
    session: Session | scoped_session[Session],
    *,
    app_id: str,
    tenant_id: str = "owner-tenant",
    name: str | None = None,
    mode: AppMode = AppMode.CHAT,
    public: bool = True,
    published: bool = True,
) -> App:
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name=name or f"App {app_id}",
        description="Description",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
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


def _persist_installed_app(
    session: Session | scoped_session[Session],
    app: App,
    *,
    tenant_id: str,
    installed_app_id: str,
    pinned: bool = False,
    last_used_at: datetime | None = datetime(2024, 1, 1),
) -> InstalledApp:
    installed_app = InstalledApp(
        app_id=app.id,
        tenant_id=tenant_id,
        app_owner_tenant_id=app.tenant_id,
        is_pinned=pinned,
        last_used_at=last_used_at,
    )
    installed_app.id = installed_app_id
    session.add(installed_app)
    session.commit()
    return installed_app


@contextmanager
def _controller_context(
    database_session: scoped_session[Session],
    *,
    role: TenantAccountRole = TenantAccountRole.OWNER,
    auth_enabled: bool = False,
) -> Generator[None]:
    with (
        patch.object(module.db, "session", database_session),
        patch.object(module.TenantService, "get_user_role", return_value=role),
        patch.object(
            service_module.SystemFeatureService,
            "is_webapp_auth_enabled",
            return_value=auth_enabled,
        ),
    ):
        yield


class TestInstalledAppsListApi:
    def test_list_query_defaults_to_20(self) -> None:
        assert module.InstalledAppsListQuery().limit == 20

    def test_response_schema_preserves_installed_app_domain_types(self) -> None:
        app_schema = module.InstalledAppInfoResponse.model_json_schema(mode="serialization")
        list_schema = module.InstalledAppListResponse.model_json_schema(mode="serialization")

        assert {
            "id",
            "name",
            "description",
            "mode",
            "icon_type",
            "icon",
            "icon_background",
            "use_icon_as_answer_icon",
            "icon_url",
        } <= set(app_schema["required"])
        assert set(app_schema["$defs"]["AppMode"]["enum"]) == {mode.value for mode in AppMode}
        assert set(app_schema["$defs"]["IconType"]["enum"]) == {icon_type.value for icon_type in IconType}
        assert "next_cursor" in list_schema["required"]

    def test_published_app_filter_checks_publish_targets(self) -> None:
        compiled_filter = str(service_module._published_app_filter().compile(compile_kwargs={"literal_binds": True}))

        assert "workflows" in compiled_filter
        assert "app_model_configs" in compiled_filter
        assert "workflow_id" in compiled_filter
        assert "app_model_config_id" in compiled_filter
        assert "apps.mode != 'agent'" in compiled_filter

    def test_get_filters_tenant_publication_mode_and_app_id(
        self,
        app: Flask,
        current_user: Account,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        chat = _persist_app(database_session, app_id="chat")
        workflow = _persist_app(database_session, app_id="workflow", mode=AppMode.WORKFLOW)
        unpublished = _persist_app(database_session, app_id="unpublished", published=False)
        agent = _persist_app(database_session, app_id="agent", mode=AppMode.AGENT)
        foreign = _persist_app(database_session, app_id="foreign")
        for index, (app_model, installed_tenant) in enumerate(
            (
                (chat, tenant_id),
                (workflow, tenant_id),
                (unpublished, tenant_id),
                (agent, tenant_id),
                (foreign, "other-tenant"),
            )
        ):
            _persist_installed_app(
                database_session,
                app_model,
                tenant_id=installed_tenant,
                installed_app_id=f"installed-{index}",
            )

        api = module.InstalledAppsListApi()
        method = unwrap(api.get)
        with app.test_request_context("/"), _controller_context(database_session):
            result = method(api, tenant_id, current_user)

        assert {item["app"]["id"] for item in result["installed_apps"]} == {"chat", "workflow"}
        assert all(item["editable"] is True for item in result["installed_apps"])
        assert all(item["uninstallable"] is False for item in result["installed_apps"])
        assert result["has_more"] is False
        assert result["next_cursor"] is None

        with (
            app.test_request_context("/?app_id=workflow"),
            _controller_context(database_session, role=TenantAccountRole.NORMAL),
        ):
            filtered = method(api, tenant_id, current_user)
        assert [item["app"]["id"] for item in filtered["installed_apps"]] == ["workflow"]
        assert filtered["installed_apps"][0]["editable"] is False

    def test_get_name_search_escapes_like_wildcards(
        self,
        app: Flask,
        current_user: Account,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        exact = _persist_app(database_session, app_id="exact", name="Sales%_Q3")
        wildcard_decoy = _persist_app(database_session, app_id="decoy", name="SalesZZQ3")
        for index, app_model in enumerate((exact, wildcard_decoy)):
            _persist_installed_app(
                database_session,
                app_model,
                tenant_id=tenant_id,
                installed_app_id=f"installed-{index}",
            )

        with app.test_request_context("/?name=Sales%25_Q3"), _controller_context(database_session):
            result = unwrap(module.InstalledAppsListApi().get)(module.InstalledAppsListApi(), tenant_id, current_user)

        assert [item["app"]["id"] for item in result["installed_apps"]] == ["exact"]

    def test_get_orders_and_paginates_with_cursor(
        self,
        app: Flask,
        current_user: Account,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        app_models = [_persist_app(database_session, app_id=f"app-{index}") for index in range(4)]
        rows = (
            (app_models[0], "installed-0", True, datetime(2024, 1, 1)),
            (app_models[1], "installed-1", False, datetime(2024, 1, 3)),
            (app_models[2], "installed-2", False, datetime(2024, 1, 2)),
            (app_models[3], "installed-3", False, None),
        )
        for app_model, installed_id, pinned, last_used_at in rows:
            _persist_installed_app(
                database_session,
                app_model,
                tenant_id=tenant_id,
                installed_app_id=installed_id,
                pinned=pinned,
                last_used_at=last_used_at,
            )

        api = module.InstalledAppsListApi()
        method = unwrap(api.get)
        with app.test_request_context("/?limit=2"), _controller_context(database_session):
            first_page = method(api, tenant_id, current_user)

        assert [item["id"] for item in first_page["installed_apps"]] == ["installed-0", "installed-1"]
        assert first_page["has_more"] is True
        cursor = module._decode_installed_app_cursor(first_page["next_cursor"])
        assert cursor is not None
        assert cursor.installed_app_id == "installed-1"

        with (
            app.test_request_context(f"/?limit=2&cursor={first_page['next_cursor']}"),
            _controller_context(database_session),
        ):
            second_page = method(api, tenant_id, current_user)
        assert [item["id"] for item in second_page["installed_apps"]] == ["installed-2", "installed-3"]
        assert second_page["has_more"] is False

    def test_get_scans_past_denied_candidate_batch(
        self,
        app: Flask,
        current_user: Account,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        allowed_first = _persist_app(database_session, app_id="allowed-first")
        denied = _persist_app(database_session, app_id="denied")
        allowed_later = _persist_app(database_session, app_id="allowed-later")
        _persist_installed_app(
            database_session,
            allowed_first,
            tenant_id=tenant_id,
            installed_app_id="installed-allowed-first",
            last_used_at=datetime(2024, 1, 3),
        )
        _persist_installed_app(
            database_session,
            denied,
            tenant_id=tenant_id,
            installed_app_id="installed-denied",
            last_used_at=datetime(2024, 1, 2),
        )
        _persist_installed_app(
            database_session,
            allowed_later,
            tenant_id=tenant_id,
            installed_app_id="installed-allowed-later",
            last_used_at=datetime(2024, 1, 1),
        )
        settings = {
            app_id: SimpleNamespace(access_mode="restricted") for app_id in ("allowed-first", "denied", "allowed-later")
        }

        def permission_state(*, user_id: str, app_ids: list[str]) -> dict[str, bool]:
            assert user_id == current_user.id
            return {app_id: app_id != "denied" for app_id in app_ids}

        with (
            app.test_request_context("/?limit=1"),
            _controller_context(database_session, role=TenantAccountRole.NORMAL, auth_enabled=True),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                side_effect=lambda app_ids: {app_id: settings[app_id] for app_id in app_ids},
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_is_user_allowed_to_access_webapps",
                side_effect=permission_state,
            ),
        ):
            result = unwrap(module.InstalledAppsListApi().get)(module.InstalledAppsListApi(), tenant_id, current_user)

        assert [item["id"] for item in result["installed_apps"]] == ["installed-allowed-first"]
        assert result["has_more"] is True
        cursor = module._decode_installed_app_cursor(result["next_cursor"])
        assert cursor is not None
        assert cursor.installed_app_id == "installed-denied"

    def test_get_applies_web_auth_permission_and_sso_state(
        self,
        app: Flask,
        current_user: Account,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        apps = {app_id: _persist_app(database_session, app_id=app_id) for app_id in ("allowed", "denied", "sso")}
        for index, app_model in enumerate(apps.values()):
            _persist_installed_app(
                database_session,
                app_model,
                tenant_id=tenant_id,
                installed_app_id=f"installed-{index}",
            )
        settings = {
            "allowed": SimpleNamespace(access_mode="restricted"),
            "denied": SimpleNamespace(access_mode="restricted"),
            "sso": SimpleNamespace(access_mode="sso_verified"),
        }

        with (
            app.test_request_context("/"),
            _controller_context(database_session, auth_enabled=True),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value=settings,
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_is_user_allowed_to_access_webapps",
                return_value={"allowed": True, "denied": False},
            ),
        ):
            result = unwrap(module.InstalledAppsListApi().get)(module.InstalledAppsListApi(), tenant_id, current_user)

        assert [item["app"]["id"] for item in result["installed_apps"]] == ["allowed"]

    def test_get_rejects_invalid_cursor(self, app: Flask, current_user: Account, tenant_id: str) -> None:
        with app.test_request_context("/?cursor=not-a-cursor"), pytest.raises(BadRequest, match="Invalid cursor"):
            unwrap(module.InstalledAppsListApi().get)(module.InstalledAppsListApi(), tenant_id, current_user)

    def test_get_rejects_user_without_current_tenant(self, app: Flask, tenant_id: str) -> None:
        current_user = Account(name="No tenant", email="no-tenant@example.com", status=AccountStatus.ACTIVE)
        current_user.id = "user-without-tenant"

        with (
            app.test_request_context("/"),
            pytest.raises(ValueError, match="current_user.current_tenant must not be None"),
        ):
            unwrap(module.InstalledAppsListApi().get)(module.InstalledAppsListApi(), tenant_id, current_user)


class TestInstalledAppsCreateApi:
    def test_post_installs_public_recommended_app_once(
        self,
        app: Flask,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        app_model = _persist_app(database_session, app_id="recommended", public=True)
        recommended = RecommendedApp(
            app_id=app_model.id,
            description={"en-US": "recommended"},
            copyright="copyright",
            privacy_policy="https://example.com/privacy",
            category="productivity",
        )
        database_session.add(recommended)
        database_session.commit()
        recommended_id = recommended.id
        bind = database_session.bind
        request_data = module.InstalledAppCreatePayload(app_id=app_model.id)

        for _ in range(2):
            with (
                app.test_request_context("/", json={"app_id": app_model.id}),
                patch.object(module.db, "session", database_session),
            ):
                assert unwrap(module.InstalledAppsListApi().post)(
                    module.InstalledAppsListApi(), request_data, tenant_id
                ) == {"message": "App installed successfully"}

        database_session.remove()
        with Session(bind) as observer:
            installed = observer.scalars(select(InstalledApp)).all()
            assert len(installed) == 1
            assert installed[0].tenant_id == tenant_id
            assert installed[0].app_owner_tenant_id == app_model.tenant_id
            persisted_recommendation = observer.get(RecommendedApp, recommended_id)
            assert persisted_recommendation is not None
            assert persisted_recommendation.install_count == 1

    def test_post_enforces_recommendation_and_public_state(
        self,
        app: Flask,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        api = module.InstalledAppsListApi()
        with (
            app.test_request_context("/", json={"app_id": "missing"}),
            patch.object(module.db, "session", database_session),
            pytest.raises(NotFound, match="Recommended app not found"),
        ):
            unwrap(api.post)(api, module.InstalledAppCreatePayload(app_id="missing"), tenant_id)

        private_app = _persist_app(database_session, app_id="private", public=False)
        database_session.add(
            RecommendedApp(
                app_id=private_app.id,
                description={},
                copyright="copyright",
                privacy_policy="privacy",
                category="category",
            )
        )
        database_session.commit()
        with (
            app.test_request_context("/", json={"app_id": private_app.id}),
            patch.object(module.db, "session", database_session),
            pytest.raises(Forbidden, match="non-public app"),
        ):
            unwrap(api.post)(api, module.InstalledAppCreatePayload(app_id=private_app.id), tenant_id)


class TestInstalledAppApi:
    def test_get_returns_published_app_and_rejects_unpublished_app(
        self,
        app: Flask,
        current_user: Account,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        published = _persist_app(database_session, app_id="published")
        installed = _persist_installed_app(
            database_session,
            published,
            tenant_id=tenant_id,
            installed_app_id="installed-published",
        )
        api = module.InstalledAppApi()
        with app.test_request_context("/"), _controller_context(database_session):
            result = unwrap(api.get)(api, tenant_id, current_user, installed)

        assert result["id"] == installed.id
        assert result["app"]["id"] == published.id
        assert result["app"]["mode"] == AppMode.CHAT
        assert result["app"]["icon_type"] == IconType.EMOJI
        assert result["editable"] is True

        unpublished = _persist_app(database_session, app_id="unpublished", published=False)
        unpublished_install = _persist_installed_app(
            database_session,
            unpublished,
            tenant_id=tenant_id,
            installed_app_id="installed-unpublished",
        )
        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", database_session),
            pytest.raises(NotFound, match="Installed app not found"),
        ):
            unwrap(api.get)(api, tenant_id, current_user, unpublished_install)

    def test_delete_removes_foreign_app_and_rejects_owned_app(
        self,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        foreign_app = _persist_app(database_session, app_id="foreign")
        installed = _persist_installed_app(
            database_session,
            foreign_app,
            tenant_id=tenant_id,
            installed_app_id="installed-foreign",
        )
        api = module.InstalledAppApi()
        with patch.object(module.db, "session", database_session):
            response, status = unwrap(api.delete)(api, tenant_id, installed)
        assert (response, status) == ("", 204)
        database_session.expire_all()
        assert database_session.get(InstalledApp, installed.id) is None

        owned_app = _persist_app(database_session, app_id="owned", tenant_id=tenant_id)
        owned_install = _persist_installed_app(
            database_session,
            owned_app,
            tenant_id=tenant_id,
            installed_app_id="installed-owned",
        )
        with pytest.raises(BadRequest, match="owned by the current tenant"):
            unwrap(api.delete)(api, tenant_id, owned_install)
        assert database_session.get(InstalledApp, owned_install.id) is not None

    def test_patch_persists_pin_and_accepts_noop_payload(
        self,
        app: Flask,
        tenant_id: str,
        database_session: scoped_session[Session],
    ) -> None:
        app_model = _persist_app(database_session, app_id="pin")
        installed = _persist_installed_app(
            database_session,
            app_model,
            tenant_id=tenant_id,
            installed_app_id="installed-pin",
        )
        api = module.InstalledAppApi()
        with (
            app.test_request_context("/", json={"is_pinned": True}),
            patch.object(module.db, "session", database_session),
        ):
            result = unwrap(api.patch)(api, module.InstalledAppUpdatePayload(is_pinned=True), installed)
        assert result["result"] == "success"
        database_session.expire_all()
        persisted = database_session.get(InstalledApp, installed.id)
        assert persisted is not None
        assert persisted.is_pinned is True

        with app.test_request_context("/", json={}), patch.object(module.db, "session", database_session):
            result = unwrap(api.patch)(api, module.InstalledAppUpdatePayload(), installed)
        assert result["result"] == "success"
