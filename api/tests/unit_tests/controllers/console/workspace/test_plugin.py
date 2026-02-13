import io
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.plugin import (
    PluginAssetApi,
    PluginAutoUpgradeExcludePluginApi,
    PluginChangePermissionApi,
    PluginChangePreferencesApi,
    PluginDebuggingKeyApi,
    PluginDeleteAllInstallTaskItemsApi,
    PluginDeleteInstallTaskApi,
    PluginDeleteInstallTaskItemApi,
    PluginFetchDynamicSelectOptionsApi,
    PluginFetchDynamicSelectOptionsWithCredentialsApi,
    PluginFetchInstallTaskApi,
    PluginFetchInstallTasksApi,
    PluginFetchManifestApi,
    PluginFetchMarketplacePkgApi,
    PluginFetchPermissionApi,
    PluginFetchPreferencesApi,
    PluginIconApi,
    PluginInstallFromGithubApi,
    PluginInstallFromMarketplaceApi,
    PluginInstallFromPkgApi,
    PluginListApi,
    PluginListInstallationsFromIdsApi,
    PluginListLatestVersionsApi,
    PluginReadmeApi,
    PluginUninstallApi,
    PluginUpgradeFromGithubApi,
    PluginUpgradeFromMarketplaceApi,
    PluginUploadFromBundleApi,
    PluginUploadFromGithubApi,
    PluginUploadFromPkgApi,
)
from core.plugin.impl.exc import PluginDaemonClientSideError
from models.account import TenantPluginAutoUpgradeStrategy, TenantPluginPermission


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def user():
    u = MagicMock()
    u.id = "u1"
    u.is_admin_or_owner = True
    return u


@pytest.fixture
def tenant():
    return "t1"


class TestPluginListLatestVersionsApi:
    def test_success(self, app):
        api = PluginListLatestVersionsApi()
        method = unwrap(api.post)

        payload = {"plugin_ids": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_latest_versions", return_value={"p1": "1.0"}
            ),
        ):
            result = method(api)

        assert "versions" in result

    def test_daemon_error(self, app):
        api = PluginListLatestVersionsApi()
        method = unwrap(api.post)

        payload = {"plugin_ids": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_latest_versions",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginDebuggingKeyApi:
    def test_debugging_key_success(self, app):
        api = PluginDebuggingKeyApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.get_debugging_key", return_value="k"),
        ):
            result = method(api)

        assert result["key"] == "k"

    def test_debugging_key_error(self, app):
        api = PluginDebuggingKeyApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.get_debugging_key",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginListApi:
    def test_plugin_list(self, app):
        api = PluginListApi()
        method = unwrap(api.get)

        mock_list = MagicMock(list=[{"id": 1}], total=1)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.list_with_total", return_value=mock_list),
        ):
            result = method(api)

        assert result["total"] == 1


class TestPluginIconApi:
    def test_plugin_icon(self, app):
        api = PluginIconApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?tenant_id=t1&filename=a.png"),
            patch("controllers.console.workspace.plugin.PluginService.get_asset", return_value=(b"x", "image/png")),
        ):
            response = method(api)

        assert response.mimetype == "image/png"


class TestPluginAssetApi:
    def test_plugin_asset(self, app):
        api = PluginAssetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p&file_name=a.bin"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.extract_asset", return_value=b"x"),
        ):
            response = method(api)

        assert response.mimetype == "application/octet-stream"


class TestPluginUploadFromPkgApi:
    def test_upload_pkg_success(self, app):
        api = PluginUploadFromPkgApi()
        method = unwrap(api.post)

        data = {
            "pkg": (io.BytesIO(b"x"), "test.pkg"),
        }

        with (
            app.test_request_context("/", data=data, content_type="multipart/form-data"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.upload_pkg", return_value={"ok": True}),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_upload_pkg_too_large(self, app):
        api = PluginUploadFromPkgApi()
        method = unwrap(api.post)

        data = {
            "pkg": (io.BytesIO(b"x"), "test.pkg"),
        }

        with (
            app.test_request_context("/", data=data, content_type="multipart/form-data"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.dify_config.PLUGIN_MAX_PACKAGE_SIZE", 0),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginInstallFromPkgApi:
    def test_install_from_pkg(self, app):
        api = PluginInstallFromPkgApi()
        method = unwrap(api.post)

        payload = {"plugin_unique_identifiers": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_local_pkg", return_value={"ok": True}
            ),
        ):
            result = method(api)

        assert result["ok"] is True


class TestPluginUninstallApi:
    def test_uninstall(self, app):
        api = PluginUninstallApi()
        method = unwrap(api.post)

        payload = {"plugin_installation_id": "x"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.uninstall", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True


class TestPluginChangePermissionApi:
    def test_change_permission_forbidden(self, app):
        api = PluginChangePermissionApi()
        method = unwrap(api.post)

        user = MagicMock(is_admin_or_owner=False)

        payload = {
            "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
            "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
        ):
            with pytest.raises(Forbidden):
                method(api)

    def test_change_permission_success(self, app):
        api = PluginChangePermissionApi()
        method = unwrap(api.post)

        user = MagicMock(is_admin_or_owner=True)

        payload = {
            "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
            "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.plugin.PluginPermissionService.change_permission", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True


class TestPluginFetchPermissionApi:
    def test_fetch_permission_default(self, app):
        api = PluginFetchPermissionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginPermissionService.get_permission", return_value=None),
        ):
            result = method(api)

        assert result["install_permission"] is not None


class TestPluginFetchDynamicSelectOptionsApi:
    def test_fetch_dynamic_options(self, app, user):
        api = PluginFetchDynamicSelectOptionsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_id=p&provider=x&action=y&parameter=z&provider_type=tool"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginParameterService.get_dynamic_select_options",
                return_value=[1, 2],
            ),
        ):
            result = method(api)

        assert result["options"] == [1, 2]


class TestPluginReadmeApi:
    def test_fetch_readme(self, app):
        api = PluginReadmeApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.fetch_plugin_readme", return_value="readme"),
        ):
            result = method(api)

        assert result["readme"] == "readme"


class TestPluginListInstallationsFromIdsApi:
    def test_success(self, app):
        api = PluginListInstallationsFromIdsApi()
        method = unwrap(api.post)

        payload = {"plugin_ids": ["p1", "p2"]}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_installations_from_ids",
                return_value=[{"id": "p1"}],
            ),
        ):
            result = method(api)

        assert "plugins" in result

    def test_daemon_error(self, app):
        api = PluginListInstallationsFromIdsApi()
        method = unwrap(api.post)

        payload = {"plugin_ids": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_installations_from_ids",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginUploadFromGithubApi:
    def test_success(self, app):
        api = PluginUploadFromGithubApi()
        method = unwrap(api.post)

        payload = {"repo": "r", "version": "v", "package": "p"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.upload_pkg_from_github", return_value={"ok": True}
            ),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_daemon_error(self, app):
        api = PluginUploadFromGithubApi()
        method = unwrap(api.post)

        payload = {"repo": "r", "version": "v", "package": "p"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.upload_pkg_from_github",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginUploadFromBundleApi:
    def test_success(self, app):
        api = PluginUploadFromBundleApi()
        method = unwrap(api.post)

        file = FileStorage(
            stream=io.BytesIO(b"x"),
            filename="test.bundle",
            content_type="application/octet-stream",
        )

        with (
            app.test_request_context(
                "/",
                data={"bundle": file},
                content_type="multipart/form-data",
            ),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.upload_bundle", return_value={"ok": True}),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_too_large(self, app):
        api = PluginUploadFromBundleApi()
        method = unwrap(api.post)

        file = FileStorage(
            stream=io.BytesIO(b"x" * 10**9),
            filename="test.bundle",
            content_type="application/octet-stream",
        )

        with (
            app.test_request_context(
                "/",
                data={"bundle": file},
                content_type="multipart/form-data",
            ),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginInstallFromGithubApi:
    def test_success(self, app):
        api = PluginInstallFromGithubApi()
        method = unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "p",
            "repo": "r",
            "version": "v",
            "package": "pkg",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.install_from_github", return_value={"ok": True}),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_daemon_error(self, app):
        api = PluginInstallFromGithubApi()
        method = unwrap(api.post)

        payload = {
            "plugin_unique_identifier": "p",
            "repo": "r",
            "version": "v",
            "package": "pkg",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_github",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginInstallFromMarketplaceApi:
    def test_success(self, app):
        api = PluginInstallFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {"plugin_unique_identifiers": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_marketplace_pkg",
                return_value={"ok": True},
            ),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_daemon_error(self, app):
        api = PluginInstallFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {"plugin_unique_identifiers": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_marketplace_pkg",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginFetchMarketplacePkgApi:
    def test_success(self, app):
        api = PluginFetchMarketplacePkgApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.fetch_marketplace_pkg", return_value={"m": 1}),
        ):
            result = method(api)

        assert "manifest" in result

    def test_daemon_error(self, app):
        api = PluginFetchMarketplacePkgApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_marketplace_pkg",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginFetchManifestApi:
    def test_success(self, app):
        api = PluginFetchManifestApi()
        method = unwrap(api.get)

        manifest = MagicMock()
        manifest.model_dump.return_value = {"x": 1}

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.fetch_plugin_manifest", return_value=manifest),
        ):
            result = method(api)

        assert "manifest" in result

    def test_daemon_error(self, app):
        api = PluginFetchManifestApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_plugin_manifest",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginFetchInstallTasksApi:
    def test_success(self, app):
        api = PluginFetchInstallTasksApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.fetch_install_tasks", return_value=[{"id": 1}]),
        ):
            result = method(api)

        assert "tasks" in result

    def test_daemon_error(self, app):
        api = PluginFetchInstallTasksApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_install_tasks",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginFetchInstallTaskApi:
    def test_success(self, app):
        api = PluginFetchInstallTaskApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.fetch_install_task", return_value={"id": "x"}),
        ):
            result = method(api, "x")

        assert "task" in result

    def test_daemon_error(self, app):
        api = PluginFetchInstallTaskApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_install_task",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "t")


class TestPluginDeleteInstallTaskApi:
    def test_success(self, app):
        api = PluginDeleteInstallTaskApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.delete_install_task", return_value=True),
        ):
            result = method(api, "x")

        assert result["success"] is True

    def test_daemon_error(self, app):
        api = PluginDeleteInstallTaskApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_install_task",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "t")


class TestPluginDeleteAllInstallTaskItemsApi:
    def test_success(self, app):
        api = PluginDeleteAllInstallTaskItemsApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_all_install_task_items", return_value=True
            ),
        ):
            result = method(api)

        assert result["success"] is True

    def test_daemon_error(self, app):
        api = PluginDeleteAllInstallTaskItemsApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_all_install_task_items",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginDeleteInstallTaskItemApi:
    def test_success(self, app):
        api = PluginDeleteInstallTaskItemApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginService.delete_install_task_item", return_value=True),
        ):
            result = method(api, "task1", "item1")

        assert result["success"] is True

    def test_daemon_error(self, app):
        api = PluginDeleteInstallTaskItemApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_install_task_item",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "task1", "item1")


class TestPluginUpgradeFromMarketplaceApi:
    def test_success(self, app):
        api = PluginUpgradeFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {
            "original_plugin_unique_identifier": "p1",
            "new_plugin_unique_identifier": "p2",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_marketplace",
                return_value={"ok": True},
            ),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_daemon_error(self, app):
        api = PluginUpgradeFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {
            "original_plugin_unique_identifier": "p1",
            "new_plugin_unique_identifier": "p2",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_marketplace",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginUpgradeFromGithubApi:
    def test_success(self, app):
        api = PluginUpgradeFromGithubApi()
        method = unwrap(api.post)

        payload = {
            "original_plugin_unique_identifier": "p1",
            "new_plugin_unique_identifier": "p2",
            "repo": "r",
            "version": "v",
            "package": "pkg",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_github",
                return_value={"ok": True},
            ),
        ):
            result = method(api)

        assert result["ok"] is True

    def test_daemon_error(self, app):
        api = PluginUpgradeFromGithubApi()
        method = unwrap(api.post)

        payload = {
            "original_plugin_unique_identifier": "p1",
            "new_plugin_unique_identifier": "p2",
            "repo": "r",
            "version": "v",
            "package": "pkg",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_github",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginFetchDynamicSelectOptionsWithCredentialsApi:
    def test_success(self, app):
        api = PluginFetchDynamicSelectOptionsWithCredentialsApi()
        method = unwrap(api.post)

        user = MagicMock(id="u1", is_admin_or_owner=True)

        payload = {
            "plugin_id": "p",
            "provider": "x",
            "action": "y",
            "parameter": "z",
            "credential_id": "c",
            "credentials": {"k": "v"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginParameterService.get_dynamic_select_options_with_credentials",
                return_value=[1],
            ),
        ):
            result = method(api)

        assert result["options"] == [1]

    def test_daemon_error(self, app):
        api = PluginFetchDynamicSelectOptionsWithCredentialsApi()
        method = unwrap(api.post)

        user = MagicMock(id="u1", is_admin_or_owner=True)

        payload = {
            "plugin_id": "p",
            "provider": "x",
            "action": "y",
            "parameter": "z",
            "credential_id": "c",
            "credentials": {"k": "v"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginParameterService.get_dynamic_select_options_with_credentials",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestPluginChangePreferencesApi:
    def test_success(self, app):
        api = PluginChangePreferencesApi()
        method = unwrap(api.post)

        user = MagicMock(is_admin_or_owner=True)

        payload = {
            "permission": {
                "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
                "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
            },
            "auto_upgrade": {
                "strategy_setting": TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
                "upgrade_time_of_day": 0,
                "upgrade_mode": TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
                "exclude_plugins": [],
                "include_plugins": [],
            },
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.plugin.PluginPermissionService.change_permission", return_value=True),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.change_strategy", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_permission_fail(self, app):
        api = PluginChangePreferencesApi()
        method = unwrap(api.post)

        user = MagicMock(is_admin_or_owner=True)

        payload = {
            "permission": {
                "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
                "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
            },
            "auto_upgrade": {
                "strategy_setting": TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
                "upgrade_time_of_day": 0,
                "upgrade_mode": TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
                "exclude_plugins": [],
                "include_plugins": [],
            },
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.plugin.PluginPermissionService.change_permission", return_value=False),
        ):
            result = method(api)

        assert result["success"] is False


class TestPluginFetchPreferencesApi:
    def test_success(self, app):
        api = PluginFetchPreferencesApi()
        method = unwrap(api.get)

        permission = MagicMock(
            install_permission=TenantPluginPermission.InstallPermission.EVERYONE,
            debug_permission=TenantPluginPermission.DebugPermission.EVERYONE,
        )

        auto_upgrade = MagicMock(
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=1,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=[],
            include_plugins=[],
        )

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch(
                "controllers.console.workspace.plugin.PluginPermissionService.get_permission", return_value=permission
            ),
            patch(
                "controllers.console.workspace.plugin.PluginAutoUpgradeService.get_strategy", return_value=auto_upgrade
            ),
        ):
            result = method(api)

        assert "permission" in result
        assert "auto_upgrade" in result


class TestPluginAutoUpgradeExcludePluginApi:
    def test_success(self, app):
        api = PluginAutoUpgradeExcludePluginApi()
        method = unwrap(api.post)

        payload = {"plugin_id": "p"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.exclude_plugin", return_value=True),
        ):
            result = method(api)

        assert result["success"] is True

    def test_fail(self, app):
        api = PluginAutoUpgradeExcludePluginApi()
        method = unwrap(api.post)

        payload = {"plugin_id": "p"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.current_account_with_tenant", return_value=(None, "t1")),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.exclude_plugin", return_value=False),
        ):
            result = method(api)

        assert result["success"] is False
