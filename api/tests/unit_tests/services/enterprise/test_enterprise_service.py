"""Unit tests for enterprise service integrations.

Covers:
- Default workspace auto-join behavior
- License status caching (get_cached_license_status)
"""

from datetime import datetime
from unittest.mock import patch

import pytest

from services.enterprise.enterprise_service import (
    INVALID_LICENSE_CACHE_TTL,
    LICENSE_STATUS_CACHE_KEY,
    VALID_LICENSE_CACHE_TTL,
    DefaultWorkspaceJoinResult,
    EnterpriseService,
    WebAppSettings,
    WorkspacePermission,
    try_join_default_workspace,
)

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


class TestJoinDefaultWorkspace:
    def test_join_default_workspace_success(self):
        account_id = "11111111-1111-1111-1111-111111111111"
        response = {"workspace_id": "22222222-2222-2222-2222-222222222222", "joined": True, "message": "ok"}

        with patch("services.enterprise.enterprise_service.EnterpriseRequest.send_request") as mock_send_request:
            mock_send_request.return_value = response

            result = EnterpriseService.join_default_workspace(account_id=account_id)

            assert isinstance(result, DefaultWorkspaceJoinResult)
            assert result.workspace_id == response["workspace_id"]
            assert result.joined is True
            assert result.message == "ok"

            mock_send_request.assert_called_once_with(
                "POST",
                "/default-workspace/members",
                json={"account_id": account_id},
                timeout=1.0,
            )

    def test_join_default_workspace_invalid_response_format_raises(self):
        account_id = "11111111-1111-1111-1111-111111111111"

        with patch("services.enterprise.enterprise_service.EnterpriseRequest.send_request") as mock_send_request:
            mock_send_request.return_value = "not-a-dict"

            with pytest.raises(ValueError, match="Invalid response format"):
                EnterpriseService.join_default_workspace(account_id=account_id)

    def test_join_default_workspace_invalid_account_id_raises(self):
        with pytest.raises(ValueError):
            EnterpriseService.join_default_workspace(account_id="not-a-uuid")

    def test_join_default_workspace_missing_required_fields_raises(self):
        account_id = "11111111-1111-1111-1111-111111111111"
        response = {"workspace_id": "", "message": "ok"}  # missing "joined"

        with patch("services.enterprise.enterprise_service.EnterpriseRequest.send_request") as mock_send_request:
            mock_send_request.return_value = response

            with pytest.raises(ValueError, match="Invalid response payload"):
                EnterpriseService.join_default_workspace(account_id=account_id)

    def test_join_default_workspace_joined_without_workspace_id_raises(self):
        with pytest.raises(ValueError, match="workspace_id must be non-empty when joined is True"):
            DefaultWorkspaceJoinResult(workspace_id="", joined=True, message="ok")


class TestTryJoinDefaultWorkspace:
    def test_try_join_default_workspace_enterprise_disabled_noop(self):
        with (
            patch("services.enterprise.enterprise_service.dify_config") as mock_config,
            patch("services.enterprise.enterprise_service.EnterpriseService.join_default_workspace") as mock_join,
        ):
            mock_config.ENTERPRISE_ENABLED = False

            try_join_default_workspace("11111111-1111-1111-1111-111111111111")

            mock_join.assert_not_called()

    def test_try_join_default_workspace_successful_join_does_not_raise(self):
        account_id = "11111111-1111-1111-1111-111111111111"

        with (
            patch("services.enterprise.enterprise_service.dify_config") as mock_config,
            patch("services.enterprise.enterprise_service.EnterpriseService.join_default_workspace") as mock_join,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_join.return_value = DefaultWorkspaceJoinResult(
                workspace_id="22222222-2222-2222-2222-222222222222",
                joined=True,
                message="ok",
            )

            # Should not raise
            try_join_default_workspace(account_id)

            mock_join.assert_called_once_with(account_id=account_id)

    def test_try_join_default_workspace_skipped_join_does_not_raise(self):
        account_id = "11111111-1111-1111-1111-111111111111"

        with (
            patch("services.enterprise.enterprise_service.dify_config") as mock_config,
            patch("services.enterprise.enterprise_service.EnterpriseService.join_default_workspace") as mock_join,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_join.return_value = DefaultWorkspaceJoinResult(
                workspace_id="",
                joined=False,
                message="no default workspace configured",
            )

            # Should not raise
            try_join_default_workspace(account_id)

            mock_join.assert_called_once_with(account_id=account_id)

    def test_try_join_default_workspace_api_failure_soft_fails(self):
        account_id = "11111111-1111-1111-1111-111111111111"

        with (
            patch("services.enterprise.enterprise_service.dify_config") as mock_config,
            patch("services.enterprise.enterprise_service.EnterpriseService.join_default_workspace") as mock_join,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_join.side_effect = Exception("network failure")

            # Should not raise
            try_join_default_workspace(account_id)

            mock_join.assert_called_once_with(account_id=account_id)

    def test_try_join_default_workspace_invalid_account_id_soft_fails(self):
        with patch("services.enterprise.enterprise_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True

            # Should not raise even though UUID parsing fails inside join_default_workspace
            try_join_default_workspace("not-a-uuid")


# ---------------------------------------------------------------------------
# get_cached_license_status
# ---------------------------------------------------------------------------

_EE_SVC = "services.enterprise.enterprise_service"


class TestGetCachedLicenseStatus:
    """Tests for EnterpriseService.get_cached_license_status."""

    def test_returns_none_when_enterprise_disabled(self):
        with patch(f"{_EE_SVC}.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False

            assert EnterpriseService.get_cached_license_status() is None

    def test_cache_hit_returns_license_status_enum(self):
        from services.feature_service import LicenseStatus

        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.return_value = b"active"

            result = EnterpriseService.get_cached_license_status()

            assert result == LicenseStatus.ACTIVE
            assert isinstance(result, LicenseStatus)
            mock_get_info.assert_not_called()

    def test_cache_miss_fetches_api_and_caches_valid_status(self):
        from services.feature_service import LicenseStatus

        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.return_value = None
            mock_get_info.return_value = {"License": {"status": "active"}}

            result = EnterpriseService.get_cached_license_status()

            assert result == LicenseStatus.ACTIVE
            mock_redis.setex.assert_called_once_with(
                LICENSE_STATUS_CACHE_KEY, VALID_LICENSE_CACHE_TTL, LicenseStatus.ACTIVE
            )

    def test_cache_miss_fetches_api_and_caches_invalid_status_with_short_ttl(self):
        from services.feature_service import LicenseStatus

        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.return_value = None
            mock_get_info.return_value = {"License": {"status": "expired"}}

            result = EnterpriseService.get_cached_license_status()

            assert result == LicenseStatus.EXPIRED
            mock_redis.setex.assert_called_once_with(
                LICENSE_STATUS_CACHE_KEY, INVALID_LICENSE_CACHE_TTL, LicenseStatus.EXPIRED
            )

    def test_redis_read_failure_falls_through_to_api(self):
        from services.feature_service import LicenseStatus

        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.side_effect = ConnectionError("redis down")
            mock_get_info.return_value = {"License": {"status": "active"}}

            result = EnterpriseService.get_cached_license_status()

            assert result == LicenseStatus.ACTIVE
            mock_get_info.assert_called_once()

    def test_redis_write_failure_still_returns_status(self):
        from services.feature_service import LicenseStatus

        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.return_value = None
            mock_redis.setex.side_effect = ConnectionError("redis down")
            mock_get_info.return_value = {"License": {"status": "expiring"}}

            result = EnterpriseService.get_cached_license_status()

            assert result == LicenseStatus.EXPIRING

    def test_api_failure_returns_none(self):
        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.return_value = None
            mock_get_info.side_effect = Exception("network failure")

            assert EnterpriseService.get_cached_license_status() is None

    def test_api_returns_no_license_info(self):
        with (
            patch(f"{_EE_SVC}.dify_config") as mock_config,
            patch(f"{_EE_SVC}.redis_client") as mock_redis,
            patch.object(EnterpriseService, "get_info") as mock_get_info,
        ):
            mock_config.ENTERPRISE_ENABLED = True
            mock_redis.get.return_value = None
            mock_get_info.return_value = {}  # no "License" key

            assert EnterpriseService.get_cached_license_status() is None
            mock_redis.setex.assert_not_called()
