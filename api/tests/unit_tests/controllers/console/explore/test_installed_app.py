from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import controllers.console.explore.installed_app as module

type Payload = dict[str, object]
type PayloadPatch = Callable[[Payload], AbstractContextManager[object]]


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


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
    app.app = MagicMock(id="a1")
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
    def test_published_app_filter_checks_publish_targets(self) -> None:
        compiled_filter = str(module._published_app_filter().compile(compile_kwargs={"literal_binds": True}))

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
                module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert "installed_apps" in result
        assert result["installed_apps"][0]["editable"] is True
        assert result["installed_apps"][0]["uninstallable"] is False

    def test_get_installed_apps_with_app_id_filter(self, app: Flask, current_user: MagicMock, tenant_id: str) -> None:
        api = module.InstalledAppsListApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.execute.return_value.all.return_value = []

        with (
            app.test_request_context("/?app_id=a1"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="member"),
            patch.object(
                module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=False)),
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert result == {"installed_apps": []}

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
                module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value={"a1": mock_webapp_setting},
            ),
            patch.object(
                module.EnterpriseService.WebAppAuth,
                "batch_is_user_allowed_to_access_webapps",
                return_value={"a1": True},
            ),
        ):
            result = method(api, tenant_id, current_user)

        assert len(result["installed_apps"]) == 1

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
                module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                module.EnterpriseService.WebAppAuth,
                "batch_get_app_access_mode_by_id",
                return_value={"a1": mock_webapp_setting},
            ),
            patch.object(
                module.EnterpriseService.WebAppAuth,
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
                module.FeatureService,
                "get_system_features",
                return_value=MagicMock(webapp_auth=MagicMock(enabled=True)),
            ),
            patch.object(
                module.EnterpriseService.WebAppAuth,
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
        session.execute.return_value.all.return_value = []

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                module.FeatureService,
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
        session.execute.return_value.all.return_value = []

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                module.FeatureService,
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
        session.execute.return_value.all.return_value = []

        with (
            app.test_request_context("/"),
            patch.object(module.db, "session", session),
            patch.object(module.TenantService, "get_user_role", return_value="owner"),
            patch.object(
                module.FeatureService,
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
            result = method(api, tenant_id)

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
                method(api, tenant_id)

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
                method(api, tenant_id)


class TestInstalledAppApi:
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
            result = method(installed_app)

        assert installed_app.is_pinned is True
        assert result["result"] == "success"

    def test_patch_no_change(self, app: Flask, payload_patch: PayloadPatch, installed_app: MagicMock) -> None:
        api = module.InstalledAppApi()
        method = unwrap(api.patch)

        with app.test_request_context("/", json={}), payload_patch({}), patch.object(module.db, "session"):
            result = method(installed_app)

        assert result["result"] == "success"
