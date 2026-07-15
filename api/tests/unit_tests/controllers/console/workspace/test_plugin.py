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
from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.entities.plugin import PluginDeclaration, PluginEntity, PluginInstallation
from core.plugin.entities.plugin_daemon import PluginInstallTask
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.plugin.plugin_service import PluginService
from models.account import (
    Account,
    TenantAccountRole,
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategySetting,
    TenantPluginDebugPermission,
    TenantPluginInstallPermission,
)


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


def _plugin_declaration_payload() -> dict[str, Any]:
    return {
        "version": "1.2.3",
        "author": "langgenius",
        "name": "demo_plugin",
        "description": {"en_US": "Demo plugin"},
        "icon": "icon.svg",
        "icon_dark": None,
        "label": {"en_US": "Demo Plugin"},
        "created_at": "2024-01-02T03:04:05",
        "resource": {"memory": 268435456, "permission": None},
        "plugins": {"tools": ["provider/demo.yaml"]},
        "tags": ["search", "demo"],
        "repo": "https://github.com/langgenius/demo",
        "verified": True,
        "meta": {"minimum_dify_version": "0.15.0", "version": "1.2.3"},
    }


def _expected_i18n(en_us: str) -> dict[str, str]:
    return {"en_US": en_us, "zh_Hans": en_us, "pt_BR": en_us, "ja_JP": en_us}


def _expected_plugin_declaration_dump() -> dict[str, Any]:
    return {
        "version": "1.2.3",
        "author": "langgenius",
        "name": "demo_plugin",
        "description": _expected_i18n("Demo plugin"),
        "icon": "icon.svg",
        "icon_dark": None,
        "label": _expected_i18n("Demo Plugin"),
        "category": "extension",
        "created_at": "2024-01-02T03:04:05",
        "resource": {"memory": 268435456, "permission": None},
        "plugins": {
            "tools": ["provider/demo.yaml"],
            "models": [],
            "endpoints": [],
            "datasources": [],
            "triggers": [],
        },
        "tags": ["search", "demo"],
        "repo": "https://github.com/langgenius/demo",
        "verified": True,
        "tool": None,
        "model": None,
        "endpoint": None,
        "agent_strategy": None,
        "datasource": None,
        "trigger": None,
        "meta": {"minimum_dify_version": "0.15.0", "version": "1.2.3"},
    }


def _plugin_installation_payload() -> dict[str, Any]:
    return {
        "id": "installation-row-1",
        "created_at": "2024-01-02T03:04:05",
        "updated_at": "2024-01-03T04:05:06",
        "tenant_id": "tenant-1",
        "endpoints_setups": 2,
        "endpoints_active": 1,
        "runtime_type": "remote",
        "source": "marketplace",
        "meta": {"from": "marketplace"},
        "plugin_id": "langgenius/demo_plugin",
        "plugin_unique_identifier": "langgenius/demo_plugin:1.2.3@sha256:abc",
        "version": "1.2.3",
        "checksum": "sha256:abc",
        "declaration": _plugin_declaration_payload(),
    }


def _plugin_entity_payload() -> dict[str, Any]:
    return {
        **_plugin_installation_payload(),
        "name": "demo_plugin",
        "installation_id": "installation-row-1",
    }


def _plugin_declaration() -> PluginDeclaration:
    return PluginDeclaration.model_validate(_plugin_declaration_payload())


def _plugin_installation() -> PluginInstallation:
    return PluginInstallation.model_validate(_plugin_installation_payload())


def _plugin_entity() -> PluginEntity:
    return PluginEntity.model_validate(_plugin_entity_payload())


def _expected_plugin_installation_dump() -> dict[str, Any]:
    return {
        "id": "installation-row-1",
        "created_at": "2024-01-02T03:04:05",
        "updated_at": "2024-01-03T04:05:06",
        "tenant_id": "tenant-1",
        "endpoints_setups": 2,
        "endpoints_active": 1,
        "runtime_type": "remote",
        "source": "marketplace",
        "meta": {"from": "marketplace"},
        "plugin_id": "langgenius/demo_plugin",
        "plugin_unique_identifier": "langgenius/demo_plugin:1.2.3@sha256:abc",
        "version": "1.2.3",
        "checksum": "sha256:abc",
        "declaration": _expected_plugin_declaration_dump(),
    }


def _expected_plugin_entity_dump() -> dict[str, Any]:
    return {
        **_expected_plugin_installation_dump(),
        "name": "demo_plugin",
        "installation_id": "installation-row-1",
    }


def _plugin_task_payload() -> dict[str, Any]:
    return {
        "id": "task-1",
        "created_at": "2024-02-03T04:05:06",
        "updated_at": "2024-02-03T04:06:07",
        "status": "running",
        "total_plugins": 2,
        "completed_plugins": 1,
        "plugins": [
            {
                "plugin_unique_identifier": "langgenius/demo_plugin:1.2.3@sha256:abc",
                "plugin_id": "langgenius/demo_plugin",
                "status": "success",
                "message": "installed",
                "icon": "icon.svg",
                "labels": {"en_US": "Demo Plugin"},
                "source": "marketplace",
            }
        ],
    }


def _plugin_task() -> PluginInstallTask:
    return PluginInstallTask.model_validate(_plugin_task_payload())


def _expected_plugin_task_dump() -> dict[str, Any]:
    return {
        "id": "task-1",
        "created_at": "2024-02-03T04:05:06",
        "updated_at": "2024-02-03T04:06:07",
        "status": "running",
        "total_plugins": 2,
        "completed_plugins": 1,
        "plugins": [
            {
                "plugin_unique_identifier": "langgenius/demo_plugin:1.2.3@sha256:abc",
                "plugin_id": "langgenius/demo_plugin",
                "status": "success",
                "message": "installed",
                "icon": "icon.svg",
                "labels": _expected_i18n("Demo Plugin"),
                "source": "marketplace",
            }
        ],
    }


def _latest_plugin_cache() -> PluginService.LatestPluginCache:
    return PluginService.LatestPluginCache(
        plugin_id="langgenius/demo_plugin",
        version="1.3.0",
        unique_identifier="langgenius/demo_plugin:1.3.0@sha256:def",
        status="active",
        deprecated_reason="",
        alternative_plugin_id="",
    )


def _expected_latest_plugin_cache_dump() -> dict[str, str]:
    return {
        "plugin_id": "langgenius/demo_plugin",
        "version": "1.3.0",
        "unique_identifier": "langgenius/demo_plugin:1.3.0@sha256:def",
        "status": "active",
        "deprecated_reason": "",
        "alternative_plugin_id": "",
    }


def _dynamic_option() -> PluginParameterOption:
    return PluginParameterOption.model_validate(
        {
            "value": 101,
            "label": {"en_US": "Dataset 101"},
            "icon": None,
        }
    )


def _expected_dynamic_option_dump() -> dict[str, Any]:
    return {
        "value": "101",
        "label": _expected_i18n("Dataset 101"),
        "icon": None,
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

        payload = {"plugin_ids": ["langgenius/demo_plugin", "langgenius/missing_plugin"]}
        versions = {
            "langgenius/demo_plugin": _latest_plugin_cache(),
            "langgenius/missing_plugin": None,
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginService.list_latest_versions", return_value=versions),
        ):
            result = method(api)

        assert result == {
            "versions": {
                "langgenius/demo_plugin": _expected_latest_plugin_cache_dump(),
                "langgenius/missing_plugin": None,
            }
        }

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

        plugins_with_total = MagicMock(list=[_plugin_entity()], total=1)

        with (
            app.test_request_context("/?page=1&page_size=10"),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_with_total",
                return_value=plugins_with_total,
            ) as mock_list_with_total,
        ):
            result = method(api, "t1", "u1")

        assert result == {"plugins": [_expected_plugin_entity_dump()], "total": 1}
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
            "install_permission": TenantPluginInstallPermission.EVERYONE,
            "debug_permission": TenantPluginDebugPermission.EVERYONE,
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
            "install_permission": TenantPluginInstallPermission.EVERYONE,
            "debug_permission": TenantPluginDebugPermission.EVERYONE,
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
                return_value=[_dynamic_option()],
            ),
        ):
            result = method(api, "t1", user)

        assert result == {"options": [_expected_dynamic_option_dump()]}


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

        payload = {"plugin_ids": ["langgenius/demo_plugin"]}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.plugin.PluginService.list_installations_from_ids",
                return_value=[_plugin_installation()],
            ),
        ):
            result = method(api, "t1")

        assert result == {"plugins": [_expected_plugin_installation_dump()]}

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
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_marketplace_pkg",
                return_value=_plugin_declaration(),
            ),
        ):
            result = method(api, "t1")

        assert result == {"manifest": _expected_plugin_declaration_dump()}

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

        manifest = _plugin_declaration()

        with (
            app.test_request_context("/?plugin_unique_identifier=p"),
            patch("controllers.console.workspace.plugin.PluginService.fetch_plugin_manifest", return_value=manifest),
        ):
            result = method(api, "t1")

        assert result == {"manifest": _expected_plugin_declaration_dump()}

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
            patch(
                "controllers.console.workspace.plugin.PluginService.fetch_install_tasks",
                return_value=[_plugin_task()],
            ),
        ):
            result = method(api, "t1")

        assert result == {"tasks": [_expected_plugin_task_dump()]}

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
            patch("controllers.console.workspace.plugin.PluginService.fetch_install_task", return_value=_plugin_task()),
        ):
            result = method(api, "t1", "x")

        assert result == {"task": _expected_plugin_task_dump()}

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
                return_value=[_dynamic_option()],
            ),
        ):
            result = method(api, "t1", user)

        assert result == {"options": [_expected_dynamic_option_dump()]}

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
            "category": TenantPluginAutoUpgradeCategory.TOOL.value,
            "auto_upgrade": {
                "strategy_setting": TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                "upgrade_time_of_day": 0,
                "upgrade_mode": TenantPluginAutoUpgradeMode.EXCLUDE,
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
            "category": TenantPluginAutoUpgradeCategory.MODEL.value,
            "auto_upgrade": {
                "strategy_setting": TenantPluginAutoUpgradeStrategySetting.LATEST,
                "upgrade_time_of_day": 3600,
                "upgrade_mode": TenantPluginAutoUpgradeMode.ALL,
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
        assert change.call_args.kwargs["category"] == TenantPluginAutoUpgradeCategory.MODEL

    def test_auto_upgrade_fail(self, app: Flask):
        api = PluginChangeAutoUpgradeApi()
        method = unwrap(api.post)

        user = MagicMock(is_admin_or_owner=True)

        payload = {
            "category": TenantPluginAutoUpgradeCategory.TOOL.value,
            "auto_upgrade": {
                "strategy_setting": TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
                "upgrade_time_of_day": 0,
                "upgrade_mode": TenantPluginAutoUpgradeMode.EXCLUDE,
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
            category=TenantPluginAutoUpgradeCategory.TOOL,
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
            upgrade_time_of_day=1,
            upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
            exclude_plugins=[],
            include_plugins=[],
        )

        with (
            app.test_request_context(f"/?category={TenantPluginAutoUpgradeCategory.TOOL.value}"),
            patch(
                "controllers.console.workspace.plugin.PluginAutoUpgradeService.get_strategy",
                return_value=auto_upgrade,
            ),
        ):
            result = method(api, "t1")

        assert result["category"] == TenantPluginAutoUpgradeCategory.TOOL
        assert result["auto_upgrade"]["upgrade_time_of_day"] == 1


class TestPluginAutoUpgradeExcludePluginApi:
    def test_success(self, app: Flask):
        api = PluginAutoUpgradeExcludePluginApi()
        method = unwrap(api.post)

        payload = {"plugin_id": "p", "category": TenantPluginAutoUpgradeCategory.TOOL.value}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.exclude_plugin", return_value=True),
        ):
            result = method(api, "t1")

        assert result["success"] is True

    def test_fail(self, app: Flask):
        api = PluginAutoUpgradeExcludePluginApi()
        method = unwrap(api.post)

        payload = {"plugin_id": "p", "category": TenantPluginAutoUpgradeCategory.TOOL.value}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.plugin.PluginAutoUpgradeService.exclude_plugin", return_value=False),
        ):
            result = method(api, "t1")

        assert result["success"] is False
