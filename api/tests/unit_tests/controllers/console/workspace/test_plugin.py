import io
from datetime import datetime
from inspect import unwrap
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.plugin import (
    PluginAssetApi,
    PluginAutoUpgradeExcludePluginApi,
    PluginCategoryListApi,
    PluginChangeAutoUpgradeApi,
    PluginChangePermissionApi,
    PluginDebuggingKeyApi,
    PluginDeleteAllInstallTaskItemsApi,
    PluginDeleteInstallTaskApi,
    PluginDeleteInstallTaskItemApi,
    PluginFetchAutoUpgradeApi,
    PluginFetchDynamicSelectOptionsApi,
    PluginFetchDynamicSelectOptionsWithCredentialsApi,
    PluginFetchInstallTaskApi,
    PluginFetchInstallTasksApi,
    PluginFetchManifestApi,
    PluginFetchMarketplacePkgApi,
    PluginFetchPermissionApi,
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
from core.plugin.entities.plugin import PluginInstallation
from core.plugin.impl.exc import PluginDaemonClientSideError
from models.account import Account, TenantAccountRole, TenantPluginAutoUpgradeStrategy, TenantPluginPermission


def _plugin_category_list_item(category: str = "tool") -> dict[str, Any]:
    now = datetime(2023, 1, 1, 0, 0, 0)
    return {
        "id": "entity-1",
        "created_at": now,
        "updated_at": now,
        "tenant_id": "t1",
        "endpoints_setups": 0,
        "endpoints_active": 0,
        "runtime_type": "remote",
        "source": "marketplace",
        "meta": {},
        "plugin_id": "test-author/test-plugin",
        "plugin_unique_identifier": "test-author/test-plugin:1.0.0@checksum",
        "version": "1.0.0",
        "checksum": "checksum",
        "name": "test-plugin",
        "installation_id": "entity-1",
        "declaration": {
            "version": "1.0.0",
            "author": "test-author",
            "name": "test-plugin",
            "description": {"en_US": "Test plugin"},
            "icon": "icon.svg",
            "label": {"en_US": "Test Plugin"},
            "category": category,
            "created_at": now,
            "resource": {"memory": 268435456, "permission": None},
            "plugins": {"tools": ["provider/test.yaml"]},
            "meta": {"version": "1.0.0"},
            "tool": {
                "identity": {
                    "author": "test-author",
                    "name": "test-plugin",
                    "description": {"en_US": "Test plugin"},
                    "icon": "icon.svg",
                    "label": {"en_US": "Test Plugin"},
                }
            },
        },
    }


def _builtin_tool_provider_item() -> dict[str, Any]:
    return {
        "id": "builtin",
        "author": "dify",
        "name": "builtin",
        "plugin_id": "",
        "plugin_unique_identifier": "",
        "description": {"en_US": "Builtin tool provider"},
        "icon": "icon.svg",
        "icon_dark": "",
        "label": {"en_US": "Builtin"},
        "type": "builtin",
        "team_credentials": {},
        "is_team_authorization": False,
        "allow_delete": True,
        "tools": [],
        "labels": [],
    }


def _account(role: TenantAccountRole = TenantAccountRole.OWNER) -> Account:
    account = Account(name="Test User", email="u1@example.com")
    account.id = "u1"
    account.role = role
    return account


@pytest.fixture
def user():
    return _account()


@pytest.fixture
def tenant():
    return "t1"


class TestPluginListLatestVersionsApi:
    def test_success(self, app: Flask):
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

    def test_daemon_error(self, app: Flask):
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
            result = method(api)
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginDebuggingKeyApi:
    def test_debugging_key_success(self, app: Flask):
        api = PluginDebuggingKeyApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.PluginService.get_debugging_key", return_value="k"),
        ):
            result = method(api, "t1")

        assert result["key"] == "k"

    def test_debugging_key_error(self, app: Flask):
        api = PluginDebuggingKeyApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.plugin.PluginService.get_debugging_key",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginListApi:
    def test_plugin_list(self, app: Flask):
        api = PluginListApi()
        method = unwrap(api.get)

        mock_list = MagicMock(list=[{"id": 1}], total=1)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_with_total",
                return_value=mock_list,
            ) as mock_list_with_total,
        ):
            result = method(api, "t1", "u1")

        assert result["total"] == 1
        mock_list_with_total.assert_called_once_with("t1", "u1", 1, 10)


class TestPluginCategoryListApi:
    def test_plugin_category_list(self, app: Flask):
        api = PluginCategoryListApi()
        method = unwrap(api.get)
        plugin_item = _plugin_category_list_item()
        builtin_item = _builtin_tool_provider_item()
        mock_list = MagicMock(list=[plugin_item], has_more=True)

        with (
            app.test_request_context("/?page=2&page_size=10"),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_by_category", return_value=mock_list
            ) as list_mock,
            patch(
                "controllers.console.workspace.plugin._list_hardcoded_builtin_tool_providers",
                return_value=[builtin_item],
            ) as builtin_mock,
        ):
            result = method(api, "t1", "tool")

        list_mock.assert_called_once()
        assert list_mock.call_args.args[0] == "t1"
        assert list_mock.call_args.args[1] == "tool"
        assert list_mock.call_args.args[2] == 2
        assert list_mock.call_args.args[3] == 10
        assert result["plugins"][0]["id"] == "entity-1"
        assert result["plugins"][0]["plugin_unique_identifier"] == "test-author/test-plugin:1.0.0@checksum"
        assert result["builtin_tools"][0]["id"] == "builtin"
        assert result["builtin_tools"][0]["type"] == "builtin"
        assert result["has_more"] is True
        assert "total" not in result
        builtin_mock.assert_called_once_with("t1")

    def test_non_tool_category_does_not_include_builtin_tools(self, app: Flask):
        api = PluginCategoryListApi()
        method = unwrap(api.get)
        mock_list = MagicMock(list=[_plugin_category_list_item(category="datasource")], has_more=False)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.plugin.PluginService.list_by_category", return_value=mock_list),
            patch("controllers.console.workspace.plugin._list_hardcoded_builtin_tool_providers") as builtin_mock,
        ):
            result = method(api, "t1", "datasource")

        assert result["plugins"][0]["id"] == "entity-1"
        assert result["builtin_tools"] == []
        assert result["has_more"] is False
        builtin_mock.assert_not_called()

    def test_invalid_category(self, app: Flask):
        api = PluginCategoryListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
        ):
            result = method(api, "t1", "unknown")

        assert result == ({"code": "invalid_param", "message": "invalid plugin category"}, 400)

    def test_daemon_error(self, app: Flask):
        api = PluginCategoryListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_by_category",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1", "tool")

        assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginIconApi:
    def test_plugin_icon(self, app: Flask):
        api = PluginIconApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?tenant_id=t1&filename=a.png"),
            patch("controllers.console.workspace.plugin.PluginService.get_asset", return_value=(b"x", "image/png")),
        ):
            response = method(api)

        assert response.mimetype == "image/png"


class TestPluginAssetApi:
    def test_plugin_asset(self, app: Flask):
        api = PluginAssetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p&file_name=a.bin"),
            patch("controllers.console.workspace.plugin.PluginService.extract_asset", return_value=b"x"),
        ):
            response = method(api, "t1")

        assert response.mimetype == "application/octet-stream"


class TestPluginUploadFromPkgApi:
    def test_upload_pkg_success(self, app: Flask):
        api = PluginUploadFromPkgApi()
        method = unwrap(api.post)

        data = {
            "pkg": (io.BytesIO(b"x"), "test.pkg"),
        }

        with (
            app.test_request_context("/", data=data, content_type="multipart/form-data"),
            patch("controllers.console.workspace.plugin.PluginService.upload_pkg", return_value={"ok": True}),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_upload_pkg_too_large(self, app: Flask):
        api = PluginUploadFromPkgApi()
        method = unwrap(api.post)

        data = {
            "pkg": (io.BytesIO(b"x"), "test.pkg"),
        }

        with (
            app.test_request_context("/", data=data, content_type="multipart/form-data"),
            patch("controllers.console.workspace.plugin.dify_config.PLUGIN_MAX_PACKAGE_SIZE", 0),
            patch("controllers.console.workspace.plugin.PluginService.upload_pkg") as upload_pkg_mock,
        ):
            with pytest.raises(ValueError) as exc_info:
                method(api, "t1")
            assert "File size exceeds the maximum allowed size" in str(exc_info.value)

        upload_pkg_mock.assert_not_called()


class TestPluginInstallFromPkgApi:
    def test_install_from_pkg(self, app: Flask):
        api = PluginInstallFromPkgApi()
        method = unwrap(api.post)

        payload = {"plugin_unique_identifiers": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_local_pkg", return_value={"ok": True}
            ),
        ):
            result = method(api, "t1")

        assert result["ok"] is True


class TestPluginUninstallApi:
    def test_uninstall(self, app: Flask):
        api = PluginUninstallApi()
        method = unwrap(api.post)

        payload = {"plugin_installation_id": "x"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginService.uninstall", return_value=True),
        ):
            result = method(api, "t1")

        assert result["success"] is True


class TestPluginChangePermissionApi:
    def test_change_permission_forbidden(self, app: Flask):
        api = PluginChangePermissionApi()
        method = unwrap(api.post)

        user = _account(TenantAccountRole.NORMAL)

        payload = {
            "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
            "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
        }

        with (
            app.test_request_context("/", json=payload),
        ):
            with pytest.raises(Forbidden):
                method(api, "t1", user)

    def test_change_permission_success(self, app: Flask):
        api = PluginChangePermissionApi()
        method = unwrap(api.post)

        user = _account()

        payload = {
            "install_permission": TenantPluginPermission.InstallPermission.EVERYONE,
            "debug_permission": TenantPluginPermission.DebugPermission.EVERYONE,
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginPermissionService.change_permission", return_value=True),
        ):
            result = method(api, "t1", user)

        assert result["success"] is True


class TestPluginFetchPermissionApi:
    def test_fetch_permission_default(self, app: Flask):
        api = PluginFetchPermissionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.PluginPermissionService.get_permission", return_value=None),
        ):
            result = method(api, "t1")

        assert result["install_permission"] is not None


class TestPluginFetchDynamicSelectOptionsApi:
    def test_fetch_dynamic_options(self, app: Flask, user):
        api = PluginFetchDynamicSelectOptionsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_id=p&provider=x&action=y&parameter=z&provider_type=tool"),
            patch(
                "controllers.console.workspace.plugin.PluginParameterService.get_dynamic_select_options",
                return_value=[1, 2],
            ),
        ):
            result = method(api, "t1", user)

        assert result["options"] == [1, 2]


class TestPluginReadmeApi:
    def test_fetch_readme(self, app: Flask):
        api = PluginReadmeApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.PluginService.fetch_plugin_readme", return_value="readme"),
        ):
            result = method(api, "t1")

        assert result["readme"] == "readme"


class TestPluginListInstallationsFromIdsApi:
    def test_success(self, app: Flask, user):
        api = PluginListInstallationsFromIdsApi()
        method = unwrap(api.post)

        payload = {"plugin_ids": ["p1", "p2"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_installations_from_ids",
                return_value=[PluginInstallation.model_validate(_plugin_category_list_item())],
            ),
        ):
            result = method(api, "t1")

        assert result["plugins"][0]["id"] == "entity-1"
        assert result["plugins"][0]["name"] == "test-plugin"
        assert result["plugins"][0]["installation_id"] == "entity-1"
        assert result["plugins"][0]["latest_version"] == "1.0.0"
        assert result["plugins"][0]["latest_unique_identifier"] == "test-author/test-plugin:1.0.0@checksum"
        assert result["plugins"][0]["status"] == "active"
        assert result["plugins"][0]["deprecated_reason"] == ""
        assert result["plugins"][0]["alternative_plugin_id"] == ""

    def test_daemon_error(self, app: Flask):
        api = PluginListInstallationsFromIdsApi()
        method = unwrap(api.post)

        payload = {"plugin_ids": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_installations_from_ids",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginUploadFromGithubApi:
    def test_success(self, app: Flask, user):
        api = PluginUploadFromGithubApi()
        method = unwrap(api.post)

        payload = {"repo": "r", "version": "v", "package": "p"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.upload_pkg_from_github", return_value={"ok": True}
            ),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_daemon_error(self, app: Flask):
        api = PluginUploadFromGithubApi()
        method = unwrap(api.post)

        payload = {"repo": "r", "version": "v", "package": "p"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.upload_pkg_from_github",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginUploadFromBundleApi:
    def test_success(self, app: Flask):
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
            patch("controllers.console.workspace.plugin.PluginService.upload_bundle", return_value={"ok": True}),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_too_large(self, app: Flask):
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
            patch("controllers.console.workspace.plugin.dify_config.PLUGIN_MAX_BUNDLE_SIZE", 0),
            patch("controllers.console.workspace.plugin.PluginService.upload_bundle") as upload_bundle_mock,
        ):
            with pytest.raises(ValueError) as exc_info:
                method(api, "t1")
            assert "File size exceeds the maximum allowed size" in str(exc_info.value)

        upload_bundle_mock.assert_not_called()


class TestPluginInstallFromGithubApi:
    def test_success(self, app: Flask):
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
            patch("controllers.console.workspace.plugin.PluginService.install_from_github", return_value={"ok": True}),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_daemon_error(self, app: Flask):
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
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_github",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginInstallFromMarketplaceApi:
    def test_success(self, app: Flask):
        api = PluginInstallFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {"plugin_unique_identifiers": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_marketplace_pkg",
                return_value={"ok": True},
            ),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_daemon_error(self, app: Flask):
        api = PluginInstallFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {"plugin_unique_identifiers": ["p1"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.install_from_marketplace_pkg",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginFetchMarketplacePkgApi:
    def test_success(self, app: Flask):
        api = PluginFetchMarketplacePkgApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.PluginService.fetch_marketplace_pkg", return_value={"m": 1}),
        ):
            result = method(api, "t1")

        assert "manifest" in result

    def test_daemon_error(self, app: Flask):
        api = PluginFetchMarketplacePkgApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_marketplace_pkg",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginFetchManifestApi:
    def test_success(self, app: Flask):
        api = PluginFetchManifestApi()
        method = unwrap(api.get)

        manifest = MagicMock()
        manifest.model_dump.return_value = {"x": 1}

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.PluginService.fetch_plugin_manifest", return_value=manifest),
        ):
            result = method(api, "t1")

        assert "manifest" in result

    def test_daemon_error(self, app: Flask):
        api = PluginFetchManifestApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_plugin_manifest",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginFetchInstallTasksApi:
    def test_success(self, app: Flask):
        api = PluginFetchInstallTasksApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch("controllers.console.workspace.plugin.PluginService.fetch_install_tasks", return_value=[{"id": 1}]),
        ):
            result = method(api, "t1")

        assert "tasks" in result

    def test_daemon_error(self, app: Flask):
        api = PluginFetchInstallTasksApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_install_tasks",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginFetchInstallTaskApi:
    def test_success(self, app: Flask):
        api = PluginFetchInstallTaskApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.PluginService.fetch_install_task", return_value={"id": "x"}),
        ):
            result = method(api, "t1", "x")

        assert "task" in result

    def test_daemon_error(self, app: Flask):
        api = PluginFetchInstallTaskApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_install_task",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1", "t")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginDeleteInstallTaskApi:
    def test_success(self, app: Flask):
        api = PluginDeleteInstallTaskApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.PluginService.delete_install_task", return_value=True),
        ):
            result = method(api, "t1", "x")

        assert result["success"] is True

    def test_daemon_error(self, app: Flask):
        api = PluginDeleteInstallTaskApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_install_task",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1", "t")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginDeleteAllInstallTaskItemsApi:
    def test_success(self, app: Flask):
        api = PluginDeleteAllInstallTaskItemsApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_all_install_task_items", return_value=True
            ),
        ):
            result = method(api, "t1")

        assert result["success"] is True

    def test_daemon_error(self, app: Flask):
        api = PluginDeleteAllInstallTaskItemsApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_all_install_task_items",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginDeleteInstallTaskItemApi:
    def test_success(self, app: Flask):
        api = PluginDeleteInstallTaskItemApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.plugin.PluginService.delete_install_task_item", return_value=True),
        ):
            result = method(api, "t1", "task1", "item1")

        assert result["success"] is True

    def test_daemon_error(self, app: Flask):
        api = PluginDeleteInstallTaskItemApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.plugin.PluginService.delete_install_task_item",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1", "task1", "item1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginUpgradeFromMarketplaceApi:
    def test_success(self, app: Flask, user):
        api = PluginUpgradeFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {
            "original_plugin_unique_identifier": "p1",
            "new_plugin_unique_identifier": "p2",
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_marketplace",
                return_value={"ok": True},
            ),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_daemon_error(self, app: Flask):
        api = PluginUpgradeFromMarketplaceApi()
        method = unwrap(api.post)

        payload = {
            "original_plugin_unique_identifier": "p1",
            "new_plugin_unique_identifier": "p2",
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_marketplace",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginUpgradeFromGithubApi:
    def test_success(self, app: Flask):
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
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_github",
                return_value={"ok": True},
            ),
        ):
            result = method(api, "t1")

        assert result["ok"] is True

    def test_daemon_error(self, app: Flask):
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
            patch(
                "controllers.console.workspace.plugin.PluginService.upgrade_plugin_with_github",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1")
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginFetchDynamicSelectOptionsWithCredentialsApi:
    def test_success(self, app: Flask, user):
        api = PluginFetchDynamicSelectOptionsWithCredentialsApi()
        method = unwrap(api.post)

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
            patch(
                "controllers.console.workspace.plugin.PluginParameterService.get_dynamic_select_options_with_credentials",
                return_value=[1],
            ),
        ):
            result = method(api, "t1", user)

        assert result["options"] == [1]

    def test_daemon_error(self, app: Flask, user):
        api = PluginFetchDynamicSelectOptionsWithCredentialsApi()
        method = unwrap(api.post)

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
            patch(
                "controllers.console.workspace.plugin.PluginParameterService.get_dynamic_select_options_with_credentials",
                side_effect=PluginDaemonClientSideError("error"),
            ),
        ):
            result = method(api, "t1", user)
            assert result == ({"code": "plugin_error", "message": "error"}, 400)


class TestPluginChangeAutoUpgradeApi:
    def test_success(self, app: Flask):
        api = PluginChangeAutoUpgradeApi()
        method = unwrap(api.post)

        user = _account()

        payload = {
            "category": TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL.value,
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
            patch(
                "controllers.console.workspace.plugin.PluginAutoUpgradeService.change_strategy", return_value=True
            ) as change,
        ):
            result = method(api, "t1", user)

        assert result["success"] is True
        change.assert_called_once()

    def test_success_with_model_category_auto_upgrade(self, app: Flask):
        api = PluginChangeAutoUpgradeApi()
        method = unwrap(api.post)

        user = _account()

        payload = {
            "category": TenantPluginAutoUpgradeStrategy.PluginCategory.MODEL.value,
            "auto_upgrade": {
                "strategy_setting": TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
                "upgrade_time_of_day": 3600,
                "upgrade_mode": TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
                "exclude_plugins": [],
                "include_plugins": [],
            },
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginAutoUpgradeService.change_strategy", return_value=True
            ) as change,
        ):
            result = method(api, "t1", user)

        assert result["success"] is True
        change.assert_called_once()
        assert change.call_args.kwargs["category"] == TenantPluginAutoUpgradeStrategy.PluginCategory.MODEL

    def test_auto_upgrade_fail(self, app: Flask):
        api = PluginChangeAutoUpgradeApi()
        method = unwrap(api.post)

        user = MagicMock(is_admin_or_owner=True)

        payload = {
            "category": TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL.value,
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
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.change_strategy", return_value=False),
        ):
            result = method(api, "t1", user)

        assert result["success"] is False


class TestPluginFetchAutoUpgradeApi:
    def test_success(self, app: Flask):
        api = PluginFetchAutoUpgradeApi()
        method = unwrap(api.get)

        auto_upgrade = MagicMock(
            category=TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_time_of_day=1,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=[],
            include_plugins=[],
        )

        with (
            app.test_request_context(f"/?category={TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL.value}"),
            patch(
                "controllers.console.workspace.plugin.PluginAutoUpgradeService.get_strategy",
                return_value=auto_upgrade,
            ),
        ):
            result = method(api, "t1")

        assert result["category"] == TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL
        assert result["auto_upgrade"]["upgrade_time_of_day"] == 1


class TestPluginAutoUpgradeExcludePluginApi:
    def test_success(self, app: Flask):
        api = PluginAutoUpgradeExcludePluginApi()
        method = unwrap(api.post)

        payload = {"plugin_id": "p", "category": TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL.value}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.exclude_plugin", return_value=True),
        ):
            result = method(api, "t1")

        assert result["success"] is True

    def test_fail(self, app: Flask):
        api = PluginAutoUpgradeExcludePluginApi()
        method = unwrap(api.post)

        payload = {"plugin_id": "p", "category": TenantPluginAutoUpgradeStrategy.PluginCategory.TOOL.value}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.exclude_plugin", return_value=False),
        ):
            result = method(api, "t1")

        assert result["success"] is False
