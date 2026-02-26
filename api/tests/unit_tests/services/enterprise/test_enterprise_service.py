from datetime import datetime
from unittest.mock import patch

import pytest

from services.enterprise.enterprise_service import EnterpriseService, WebAppSettings, WorkspacePermission

MODULE = "services.enterprise.enterprise_service"


class TestEnterpriseServiceInfo:
    def test_get_info_delegates(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"version": "1.0"}
            result = EnterpriseService.get_info()

        req.send_request.assert_called_once_with("GET", "/info")
        assert result == {"version": "1.0"}

    def test_get_workspace_info_delegates(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"name": "ws"}
            result = EnterpriseService.get_workspace_info("tenant-1")

        req.send_request.assert_called_once_with("GET", "/workspace/tenant-1/info")
        assert result == {"name": "ws"}


class TestSsoSettingsLastUpdateTime:
    def test_app_sso_parses_valid_timestamp(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = "2025-01-15T10:30:00+00:00"
            result = EnterpriseService.get_app_sso_settings_last_update_time()

        assert isinstance(result, datetime)
        assert result.year == 2025

    def test_app_sso_raises_on_empty(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = ""
            with pytest.raises(ValueError, match="No data found"):
                EnterpriseService.get_app_sso_settings_last_update_time()

    def test_app_sso_raises_on_invalid_format(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = "not-a-date"
            with pytest.raises(ValueError, match="Invalid date format"):
                EnterpriseService.get_app_sso_settings_last_update_time()

    def test_workspace_sso_parses_valid_timestamp(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = "2025-06-01T00:00:00+00:00"
            result = EnterpriseService.get_workspace_sso_settings_last_update_time()

        assert isinstance(result, datetime)

    def test_workspace_sso_raises_on_empty(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = None
            with pytest.raises(ValueError, match="No data found"):
                EnterpriseService.get_workspace_sso_settings_last_update_time()


class TestWorkspacePermissionService:
    def test_raises_on_empty_workspace_id(self):
        with pytest.raises(ValueError, match="workspace_id must be provided"):
            EnterpriseService.WorkspacePermissionService.get_permission("")

    def test_raises_on_missing_data(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = None
            with pytest.raises(ValueError, match="No data found"):
                EnterpriseService.WorkspacePermissionService.get_permission("ws-1")

    def test_raises_on_missing_permission_key(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"other": "data"}
            with pytest.raises(ValueError, match="No data found"):
                EnterpriseService.WorkspacePermissionService.get_permission("ws-1")

    def test_returns_parsed_permission(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {
                "permission": {
                    "workspaceId": "ws-1",
                    "allowMemberInvite": True,
                    "allowOwnerTransfer": False,
                }
            }
            result = EnterpriseService.WorkspacePermissionService.get_permission("ws-1")

        assert isinstance(result, WorkspacePermission)
        assert result.workspace_id == "ws-1"
        assert result.allow_member_invite is True
        assert result.allow_owner_transfer is False


class TestWebAppAuth:
    def test_is_user_allowed_returns_result_field(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"result": True}
            assert EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp("u1", "a1") is True

    def test_is_user_allowed_defaults_false(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {}
            assert EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp("u1", "a1") is False

    def test_batch_is_user_allowed_returns_empty_for_no_apps(self):
        assert EnterpriseService.WebAppAuth.batch_is_user_allowed_to_access_webapps("u1", []) == {}

    def test_batch_is_user_allowed_raises_on_empty_response(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = None
            with pytest.raises(ValueError, match="No data found"):
                EnterpriseService.WebAppAuth.batch_is_user_allowed_to_access_webapps("u1", ["a1"])

    def test_get_app_access_mode_raises_on_empty_app_id(self):
        with pytest.raises(ValueError, match="app_id must be provided"):
            EnterpriseService.WebAppAuth.get_app_access_mode_by_id("")

    def test_get_app_access_mode_returns_settings(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"accessMode": "public"}
            result = EnterpriseService.WebAppAuth.get_app_access_mode_by_id("a1")

        assert isinstance(result, WebAppSettings)
        assert result.access_mode == "public"

    def test_batch_get_returns_empty_for_no_apps(self):
        assert EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id([]) == {}

    def test_batch_get_maps_access_modes(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"accessModes": {"a1": "public", "a2": "private"}}
            result = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(["a1", "a2"])

        assert result["a1"].access_mode == "public"
        assert result["a2"].access_mode == "private"

    def test_batch_get_raises_on_invalid_format(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"accessModes": "not-a-dict"}
            with pytest.raises(ValueError, match="Invalid data format"):
                EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(["a1"])

    def test_update_access_mode_raises_on_empty_app_id(self):
        with pytest.raises(ValueError, match="app_id must be provided"):
            EnterpriseService.WebAppAuth.update_app_access_mode("", "public")

    def test_update_access_mode_raises_on_invalid_mode(self):
        with pytest.raises(ValueError, match="access_mode must be"):
            EnterpriseService.WebAppAuth.update_app_access_mode("a1", "invalid")

    def test_update_access_mode_delegates_and_returns(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            req.send_request.return_value = {"result": True}
            result = EnterpriseService.WebAppAuth.update_app_access_mode("a1", "public")

        assert result is True
        req.send_request.assert_called_once_with(
            "POST", "/webapp/access-mode", json={"appId": "a1", "accessMode": "public"}
        )

    def test_cleanup_webapp_raises_on_empty_app_id(self):
        with pytest.raises(ValueError, match="app_id must be provided"):
            EnterpriseService.WebAppAuth.cleanup_webapp("")

    def test_cleanup_webapp_delegates(self):
        with patch(f"{MODULE}.EnterpriseRequest") as req:
            EnterpriseService.WebAppAuth.cleanup_webapp("a1")

        req.send_request.assert_called_once_with("DELETE", "/webapp/clean", params={"appId": "a1"})
