from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import controllers.console.explore.installed_app as module
import services.installed_app_service as service_module
from models.model import App, AppMode, AppModelConfig, IconType, InstalledApp, RecommendedApp
from models.workflow import Workflow, WorkflowKind, WorkflowType

type Payload = dict[str, object]
type PayloadPatch = Callable[[Payload], AbstractContextManager[object]]


def make_app_model(app_id: str) -> MagicMock:
    app_model = MagicMock()
    app_model.id = app_id
    app_model.name = f"App {app_id}"
    app_model.description = "Description"
    app_model.mode = AppMode.CHAT
    app_model.icon_type = IconType.EMOJI
    app_model.icon = "robot"
    app_model.icon_background = "#FFFFFF"
    app_model.use_icon_as_answer_icon = False
    return app_model


@pytest.fixture
def tenant_id() -> str:
    return "t1"


@pytest.fixture
def current_user(tenant_id: str) -> MagicMock:
    user = MagicMock()
    user.id = "u1"
    user.current_tenant = MagicMock(id=tenant_id)
    return user


@pytest.fixture
def installed_app() -> MagicMock:
    app = MagicMock()
    app.id = "ia1"
    app.app = make_app_model("a1")
    app.app_owner_tenant_id = "t2"
    app.is_pinned = False
    app.last_used_at = datetime(2024, 1, 1)
    return app


@pytest.fixture
def payload_patch() -> PayloadPatch:
    def _patch(payload: Payload) -> AbstractContextManager[object]:
        return patch.object(
            type(module.console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value=payload,
        )

    return _patch


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

    def test_get_installed_apps(
        self, app: Flask, current_user: MagicMock, tenant_id: str, installed_app: MagicMock
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = [(installed_app, installed_app.app)]

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert "installed_apps" in result
        assert result["installed_apps"][0]["editable"] is True
        assert result["installed_apps"][0]["uninstallable"] is False
        assert result["has_more"] is False
        assert result["next_cursor"] is None
        executed_stmt = session.execute.call_args.args[0]
        assert 21 in executed_stmt.compile().params.values()

    def test_get_installed_apps_with_app_id_filter(self, app: Flask, current_user: MagicMock, tenant_id: str) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = list[tuple[InstalledApp, App]]()

        with (
            app.test_request_context("/?app_id=a1"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="member"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert result == {"installed_apps": [], "has_more": False, "next_cursor": None}

    def test_get_installed_apps_escapes_name_search(self, app: Flask, current_user: MagicMock, tenant_id: str) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)
        session = MagicMock()
        session.execute.return_value.all.return_value = list[tuple[InstalledApp, App]]()

        with (
            app.test_request_context("/?name=Sales%25_Q3"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            method(api, tenant_id, current_user)

        executed_stmt = session.execute.call_args.args[0]
        assert r"%Sales\%\_Q3%" in executed_stmt.compile().params.values()

    def test_get_installed_apps_returns_cursor_when_more_apps_exist(
        self, app: Flask, current_user: MagicMock, tenant_id: str
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)
        rows = []
        for index in range(3):
            installed_app = MagicMock(
                id=f"ia{index}",
                app_owner_tenant_id="t2",
                is_pinned=index == 0,
                last_used_at=datetime(2024, 1, 3 - index),
            )
            app_model = make_app_model(f"a{index}")
            rows.append((installed_app, app_model))

        session = MagicMock()
        session.execute.return_value.all.return_value = rows

        with (
            app.test_request_context("/?limit=2"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert [item["id"] for item in result["installed_apps"]] == ["ia0", "ia1"]
        assert result["has_more"] is True
        assert result["next_cursor"]
        decoded_cursor = module._decode_installed_app_cursor(result["next_cursor"])
        assert decoded_cursor is not None
        assert decoded_cursor.installed_app_id == "ia1"

    def test_get_installed_apps_filters_permissions_before_filling_page(
        self, app: Flask, current_user: MagicMock, tenant_id: str
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)
        rows = []
        for index in range(3):
            installed_app = MagicMock(
                id=f"ia{index}",
                app_owner_tenant_id="t2",
                is_pinned=False,
                last_used_at=datetime(2024, 1, 3 - index),
            )
            app_model = make_app_model(f"a{index}")
            rows.append((installed_app, app_model))

        session = MagicMock()
        session.execute.return_value.all.return_value = rows
        restricted = MagicMock(access_mode="restricted")

        with (
            app.test_request_context("/?limit=1"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="member"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value={"a0": restricted, "a1": restricted, "a2": restricted},
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_is_user_allowed_to_access_webapps",
                return_value={"a0": False, "a1": True, "a2": True},
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert [item["id"] for item in result["installed_apps"]] == ["ia1"]
        assert result["has_more"] is True

    def test_get_installed_apps_scans_past_denied_candidate_batch(
        self, app: Flask, current_user: MagicMock, tenant_id: str
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)
        allowed_rows = [
            (
                MagicMock(
                    id=f"allowed-{index}",
                    app_owner_tenant_id="t2",
                    is_pinned=False,
                    last_used_at=datetime(2024, 1, 2) if index == 0 else datetime(2023, 12, 31),
                ),
                make_app_model(f"allowed-app-{index}"),
            )
            for index in range(2)
        ]
        denied_rows = [
            (
                MagicMock(
                    id=f"denied-{index:03}",
                    app_owner_tenant_id="t2",
                    is_pinned=False,
                    last_used_at=datetime(2024, 1, 1),
                ),
                make_app_model(f"denied-app-{index:03}"),
            )
            for index in range(1)
        ]
        first_batch = [allowed_rows[0], *denied_rows]
        first_result = MagicMock()
        first_result.all.return_value = first_batch
        second_result = MagicMock()
        second_result.all.return_value = [allowed_rows[1]]
        session = MagicMock()
        session.execute.side_effect = [first_result, second_result]

        with (
            app.test_request_context("/?limit=1"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="member"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                service_module,
                "_filter_rows_by_webapp_auth",
                side_effect=[[allowed_rows[0]], [allowed_rows[1]]],
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert [item["id"] for item in result["installed_apps"]] == ["allowed-0"]
        assert result["has_more"] is True
        assert session.execute.call_count == 2
        second_stmt = session.execute.call_args_list[1].args[0]
        assert "denied-000" in second_stmt.compile().params.values()
        next_cursor = module._decode_installed_app_cursor(result["next_cursor"])
        assert next_cursor is not None
        assert next_cursor.installed_app_id == "denied-000"

    def test_get_installed_apps_rejects_invalid_cursor(
        self, app: Flask, current_user: MagicMock, tenant_id: str
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        with app.test_request_context("/?cursor=not-a-cursor"):
            with pytest.raises(BadRequest, match="Invalid cursor"):
                method(api, tenant_id, current_user)

    def test_get_installed_apps_with_webapp_auth_enabled(
        self, app: Flask, current_user: MagicMock, tenant_id: str, installed_app: MagicMock
    ) -> None:
        """Test filtering when webapp_auth is enabled."""
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = [(installed_app, installed_app.app)]

        mock_webapp_setting = MagicMock()
        mock_webapp_setting.access_mode = "restricted"

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value={"a1": mock_webapp_setting},
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_is_user_allowed_to_access_webapps",
                return_value={"a1": True},
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert len(result["installed_apps"]) == 1
        executed_stmt = session.execute.call_args.args[0]
        assert 40 in executed_stmt.compile().params.values()

    def test_get_installed_apps_with_webapp_auth_user_denied(
        self, app: Flask, current_user: MagicMock, tenant_id: str, installed_app: MagicMock
    ) -> None:
        """Test filtering when user doesn't have access."""
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = [(installed_app, installed_app.app)]

        mock_webapp_setting = MagicMock()
        mock_webapp_setting.access_mode = "restricted"

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="member"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value={"a1": mock_webapp_setting},
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_is_user_allowed_to_access_webapps",
                return_value={"a1": False},
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert result["installed_apps"] == []

    def test_get_installed_apps_with_sso_verified_access(
        self, app: Flask, current_user: MagicMock, tenant_id: str, installed_app: MagicMock
    ) -> None:
        """Test that sso_verified access mode apps are skipped in filtering."""
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = [(installed_app, installed_app.app)]

        mock_webapp_setting = MagicMock()
        mock_webapp_setting.access_mode = "sso_verified"

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                service_module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value={"a1": mock_webapp_setting},
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert len(result["installed_apps"]) == 0

    def test_get_installed_apps_filters_null_apps(self, app: Flask, current_user: MagicMock, tenant_id: str) -> None:
        """Test that installed apps with null app are filtered out."""
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = list[tuple[InstalledApp, App]]()

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert result["installed_apps"] == []

    def test_get_installed_apps_filters_unpublished_chat_apps(
        self, app: Flask, current_user: MagicMock, tenant_id: str
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = list[tuple[InstalledApp, App]]()

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert result["installed_apps"] == []

    def test_get_installed_apps_filters_unpublished_workflow_apps(
        self, app: Flask, current_user: MagicMock, tenant_id: str
    ) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = list[tuple[InstalledApp, App]]()

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                service_module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert result["installed_apps"] == []

    def test_get_installed_apps_current_tenant_none(self, app: Flask, tenant_id: str, installed_app: MagicMock) -> None:
        """Test error when current_user.current_tenant is None."""
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        current_user = MagicMock()
        current_user.current_tenant = None

        session = MagicMock()
        session.execute.return_value.all.return_value = [(installed_app, installed_app.app)]

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
        ):
            with pytest.raises(ValueError, match="current_user.current_tenant must not be None"):
                method(api, tenant_id, current_user)


class TestInstalledAppsCreateApi:
    def test_post_success(self, app: Flask, tenant_id: str, payload_patch: PayloadPatch) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.post)

        recommended = MagicMock()
        recommended.install_count = 0

        app_entity = MagicMock()
        app_entity.id = "a1"
        app_entity.is_public = True
        app_entity.tenant_id = "t2"

        session = MagicMock()
        # scalar() is called for recommended_app and installed_app lookups
        session.scalar.side_effect = [recommended, None]
        # get() is called for app PK lookup
        session.get.return_value = app_entity

        with (
            app.test_request_context("/", json={"app_id": "a1"}),
            payload_patch({"app_id": "a1"}),
            patch.object(module.db, "session", session),
        ):
            result = method(api, module.InstalledAppCreatePayload.model_validate({"app_id": "a1"}), tenant_id)

        assert result == {"message": "App installed successfully"}
        assert recommended.install_count == 1

    def test_post_recommended_not_found(self, app: Flask, tenant_id: str, payload_patch: PayloadPatch) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.post)

        session = MagicMock()
        session.scalar.return_value = None

        with (
            app.test_request_context("/", json={"app_id": "a1"}),
            payload_patch({"app_id": "a1"}),
            patch.object(module.db, "session", session),
        ):
            with pytest.raises(NotFound):
                method(api, module.InstalledAppCreatePayload.model_validate({"app_id": "a1"}), tenant_id)

    def test_post_app_not_public(self, app: Flask, tenant_id: str, payload_patch: PayloadPatch) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.post)

        recommended = MagicMock()
        app_entity = MagicMock(is_public=False)

        session = MagicMock()
        # scalar() returns recommended_app
        session.scalar.return_value = recommended
        # get() returns the app entity
        session.get.return_value = app_entity

        with (
            app.test_request_context("/", json={"app_id": "a1"}),
            payload_patch({"app_id": "a1"}),
            patch.object(module.db, "session", session),
        ):
            with pytest.raises(Forbidden):
                method(api, module.InstalledAppCreatePayload.model_validate({"app_id": "a1"}), tenant_id)


class TestInstalledAppApi:
    def test_get_installed_app(
        self,
        app: Flask,
        current_user: MagicMock,
        tenant_id: str,
        installed_app: MagicMock,
    ) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.get)
        app_model = installed_app.app
        session = MagicMock()
        session.scalar.return_value = app_model

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
        ):
            result = method(api, tenant_id, current_user, installed_app)

        assert result["id"] == installed_app.id
        assert result["app"]["id"] == app_model.id
        assert result["app"]["mode"] == AppMode.CHAT
        assert result["app"]["icon_type"] == IconType.EMOJI
        assert result["app"]["use_icon_as_answer_icon"] is False
        assert result["editable"] is True

    def test_get_installed_app_rejects_unpublished_app(
        self,
        app: Flask,
        current_user: MagicMock,
        tenant_id: str,
        installed_app: MagicMock,
    ) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.get)
        session = MagicMock()
        session.scalar.return_value = None

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
        ):
            with pytest.raises(NotFound, match="Installed app not found"):
                method(api, tenant_id, current_user, installed_app)

    def test_delete_success(self, tenant_id: str, installed_app: MagicMock) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.delete)

        with patch.object(module.db, "session"):
            resp, status = method(api, tenant_id, installed_app)

        assert status == 204
        assert resp == ""

    def test_delete_owned_by_current_tenant(self, tenant_id: str) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.delete)

        installed_app = MagicMock(app_owner_tenant_id=tenant_id)

        with pytest.raises(BadRequest):
            method(api, tenant_id, installed_app)

    def test_patch_update_pin(self, app: Flask, payload_patch: PayloadPatch, installed_app: MagicMock) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/", json={"is_pinned": True}),
            payload_patch({"is_pinned": True}),
            patch.object(module.db, "session"),
        ):
            result = method(api, module.InstalledAppUpdatePayload.model_validate({"is_pinned": True}), installed_app)

        assert installed_app.is_pinned is True
        assert result["result"] == "success"

    def test_patch_no_change(self, app: Flask, payload_patch: PayloadPatch, installed_app: MagicMock) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.patch)

        with app.test_request_context("/", json={}), payload_patch({}), patch.object(module.db, "session"):
            result = method(api, module.InstalledAppUpdatePayload.model_validate({}), installed_app)

        assert result["result"] == "success"


def _persist_app(
    session: Session,
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


def _persist_installed_app(
    session: Session,
    app: App,
    *,
    tenant_id: str,
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
def _sqlite_controller_context(
    database: Session, *, role: str = "owner", auth_enabled: bool = False
) -> Generator[None]:
    session_proxy = MagicMock(wraps=database)
    session_proxy.return_value = database
    with (
        patch.object(module.db, "session", session_proxy),
        patch.object(module.TenantService, "get_user_role", return_value=role),
        patch.object(
            service_module.FeatureService,
            "get_system_features",
            return_value=MagicMock(webapp_auth=MagicMock(enabled=auth_enabled)),
        ),
    ):
        yield


def test_sqlite_get_installed_apps_filters_tenant_publication_mode_and_app_id(
    app: Flask,
    current_user: MagicMock,
    tenant_id: str,
    sqlite_session: Session,
) -> None:
    database = sqlite_session
    chat = _persist_app(database, app_id="chat")
    workflow = _persist_app(database, app_id="workflow", mode=AppMode.WORKFLOW)
    unpublished = _persist_app(database, app_id="unpublished", published=False)
    agent = _persist_app(database, app_id="agent", mode=AppMode.AGENT)
    foreign = _persist_app(database, app_id="foreign")
    for model, installed_tenant in (
        (chat, tenant_id),
        (workflow, tenant_id),
        (unpublished, tenant_id),
        (agent, tenant_id),
        (foreign, "other-tenant"),
    ):
        _persist_installed_app(database, model, tenant_id=installed_tenant)

    api = module.InstalledAppsListApi()
    method = unwrap(api.get)
    with app.test_request_context("/"), _sqlite_controller_context(database):
        result = method(api, tenant_id, current_user)

    assert {item["app"]["id"] for item in result["installed_apps"]} == {"chat", "workflow"}
    assert all(item["editable"] is True for item in result["installed_apps"])
    assert all(item["uninstallable"] is False for item in result["installed_apps"])

    with app.test_request_context("/?app_id=workflow"), _sqlite_controller_context(database, role="member"):
        filtered = method(api, tenant_id, current_user)
    assert [item["app"]["id"] for item in filtered["installed_apps"]] == ["workflow"]
    assert filtered["installed_apps"][0]["editable"] is False


def test_sqlite_get_installed_apps_applies_web_auth_permission_state(
    app: Flask,
    current_user: MagicMock,
    tenant_id: str,
    sqlite_session: Session,
) -> None:
    database = sqlite_session
    allowed = _persist_app(database, app_id="allowed")
    denied = _persist_app(database, app_id="denied")
    sso = _persist_app(database, app_id="sso")
    for model in (allowed, denied, sso):
        _persist_installed_app(database, model, tenant_id=tenant_id)
    settings = {
        "allowed": SimpleNamespace(access_mode="restricted"),
        "denied": SimpleNamespace(access_mode="restricted"),
        "sso": SimpleNamespace(access_mode="sso_verified"),
    }

    api = module.InstalledAppsListApi()
    method = unwrap(api.get)
    with (
        app.test_request_context("/"),
        _sqlite_controller_context(database, auth_enabled=True),
        patch.object(
            service_module.EnterpriseService.WebAppAuth, "batch_get_app_access_mode_by_id", return_value=settings
        ),
        patch.object(
            service_module.EnterpriseService.WebAppAuth,
            "batch_is_user_allowed_to_access_webapps",
            return_value={"allowed": True, "denied": False},
        ),
    ):
        result = method(api, tenant_id, current_user)

    assert [item["app"]["id"] for item in result["installed_apps"]] == ["allowed"]


def test_sqlite_post_installs_public_recommended_app_and_is_idempotent(
    app: Flask,
    tenant_id: str,
    payload_patch: PayloadPatch,
    sqlite_session: Session,
) -> None:
    database = sqlite_session
    app_model = _persist_app(database, public=True)
    recommended = RecommendedApp(
        app_id=app_model.id,
        description={"en-US": "recommended"},
        copyright="copyright",
        privacy_policy="https://example.com/privacy",
        category="productivity",
    )
    database.add(recommended)
    database.commit()
    recommended_id = recommended.id
    app_owner_tenant_id = app_model.tenant_id
    api = module.InstalledAppsListApi()
    method = unwrap(api.post)

    for _ in range(2):
        with (
            app.test_request_context("/", json={"app_id": app_model.id}),
            payload_patch({"app_id": app_model.id}),
            patch.object(module.db, "session", database),
        ):
            assert method(
                api, module.InstalledAppCreatePayload.model_validate({"app_id": app_model.id}), tenant_id
            ) == {"message": "App installed successfully"}

    # End the request-scoped session so this assertion only observes committed data.
    bind = database.get_bind()
    database.close()
    with Session(bind) as verification_session:
        installed = verification_session.scalars(select(InstalledApp)).all()
        assert len(installed) == 1
        assert installed[0].tenant_id == tenant_id
        assert installed[0].app_owner_tenant_id == app_owner_tenant_id
        persisted_recommendation = verification_session.get(RecommendedApp, recommended_id)
        assert persisted_recommendation is not None
        assert persisted_recommendation.install_count == 1


def test_sqlite_post_enforces_recommendation_and_public_state(
    app: Flask,
    tenant_id: str,
    payload_patch: PayloadPatch,
    sqlite_session: Session,
) -> None:
    database = sqlite_session
    api = module.InstalledAppsListApi()
    method = unwrap(api.post)
    with (
        app.test_request_context("/", json={"app_id": "missing"}),
        payload_patch({"app_id": "missing"}),
        patch.object(module.db, "session", database),
        pytest.raises(NotFound),
    ):
        method(api, module.InstalledAppCreatePayload.model_validate({"app_id": "missing"}), tenant_id)

    private_app = _persist_app(database, app_id="private", public=False)
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
        method(api, module.InstalledAppCreatePayload.model_validate({"app_id": private_app.id}), tenant_id)


def test_sqlite_delete_removes_foreign_installed_app_and_rejects_owned_app(
    tenant_id: str,
    sqlite_session: Session,
) -> None:
    database = sqlite_session
    foreign_app = _persist_app(database, app_id="foreign")
    installed = _persist_installed_app(database, foreign_app, tenant_id=tenant_id)
    installed_id = installed.id
    api = module.InstalledAppApi()
    with patch.object(module.db, "session", database):
        response, status = unwrap(api.delete)(api, tenant_id, installed)
    assert (response, status) == ("", 204)
    assert database.get(InstalledApp, installed_id) is None

    owned_app = _persist_app(database, app_id="owned", tenant_id=tenant_id)
    owned_install = _persist_installed_app(database, owned_app, tenant_id=tenant_id)
    with pytest.raises(BadRequest):
        unwrap(api.delete)(api, tenant_id, owned_install)
    assert database.get(InstalledApp, owned_install.id) is not None


def test_sqlite_patch_persists_pin_and_noop_payload(
    app: Flask,
    tenant_id: str,
    payload_patch: PayloadPatch,
    sqlite_session: Session,
) -> None:
    database = sqlite_session
    app_model = _persist_app(database)
    installed = _persist_installed_app(database, app_model, tenant_id=tenant_id)
    api = module.InstalledAppApi()
    with (
        app.test_request_context("/", json={"is_pinned": True}),
        payload_patch({"is_pinned": True}),
        patch.object(module.db, "session", database),
    ):
        assert (
            unwrap(api.patch)(api, module.InstalledAppUpdatePayload.model_validate({"is_pinned": True}), installed)[
                "result"
            ]
            == "success"
        )
    database.expire_all()
    persisted_installed_app = database.get(InstalledApp, installed.id)
    assert persisted_installed_app is not None
    assert persisted_installed_app.is_pinned is True

    with (
        app.test_request_context("/", json={}),
        payload_patch({}),
        patch.object(module.db, "session", database),
    ):
        assert (
            unwrap(api.patch)(api, module.InstalledAppUpdatePayload.model_validate({}), installed)["result"]
            == "success"
        )
