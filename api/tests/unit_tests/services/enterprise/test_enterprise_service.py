"""Unit tests for enterprise service integrations.

Covers:
- Default workspace auto-join behavior
- License status caching (get_cached_license_status)
"""

from unittest.mock import patch

import pytest

from services.enterprise.enterprise_service import (
    INVALID_LICENSE_CACHE_TTL,
    LICENSE_STATUS_CACHE_KEY,
    VALID_LICENSE_CACHE_TTL,
    DefaultWorkspaceJoinResult,
    EnterpriseService,
    try_join_default_workspace,
)


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
