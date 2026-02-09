"""Tests for the distributed lock mechanism in ToolManager OAuth token refresh.

These tests verify the non-blocking Redis lock + double-check pattern that
prevents concurrent OAuth token refresh race conditions (e.g., QuickBooks
refresh token rotation causing invalid_grant errors).
"""

import json
import time
from unittest.mock import MagicMock, patch

import pytest

from core.tools.plugin_tool.provider import PluginToolProviderController


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_builtin_provider(*, expires_at: int = -1):
    provider = MagicMock()
    provider.id = "bp-001"
    provider.provider = "test-plugin/test-provider"
    provider.tenant_id = "tenant-1"
    provider.user_id = "user-1"
    provider.credential_type = "oauth2"
    provider.expires_at = expires_at
    provider.encrypted_credentials = json.dumps(
        {"access_token": "old_at", "refresh_token": "old_rt"}
    )
    provider.credentials = {"access_token": "old_at", "refresh_token": "old_rt"}
    return provider


def _make_encrypter_and_cache(decrypted: dict | None = None):
    enc = MagicMock()
    enc.decrypt.return_value = decrypted or {"access_token": "old_at", "refresh_token": "old_rt"}
    enc.encrypt.return_value = {"access_token": "enc_new_at", "refresh_token": "enc_new_rt"}
    cache = MagicMock()
    return enc, cache


def _make_refreshed_response(expires_at: int | None = None):
    resp = MagicMock()
    resp.credentials = {"access_token": "new_at", "refresh_token": "new_rt"}
    resp.expires_at = expires_at or int(time.time()) + 3600
    return resp


def _make_provider_controller():
    ctrl = MagicMock(spec=PluginToolProviderController)
    ctrl.need_credentials = True
    ctrl.get_tool.return_value = MagicMock()
    ctrl.get_credentials_schema_by_type.return_value = []
    return ctrl


def _setup_common(mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
                  bp, enc, cache, lock_acquired=True):
    mock_db.session.scalar.return_value = bp
    mock_create_encrypter.return_value = (enc, cache)
    mock_lock = MagicMock()
    mock_lock.acquire.return_value = lock_acquired
    mock_redis.lock.return_value = mock_lock
    mock_get_provider.return_value = _make_provider_controller()
    return mock_lock


def _call_get_tool_runtime():
    from core.tools.entities.tool_entities import ToolProviderType
    from core.tools.tool_manager import ToolManager
    return ToolManager.get_tool_runtime(
        provider_type=ToolProviderType.BUILT_IN,
        provider_id="test-plugin/test-provider",
        tool_name="test-tool",
        tenant_id="tenant-1",
        credential_id="bp-001",
    )


def _pid_mock():
    pid = MagicMock()
    pid.provider_name = "test-provider"
    pid.plugin_id = "test-plugin"
    return pid


# ---------------------------------------------------------------------------
# Test: Lock acquired, credentials expired → refresh
# ---------------------------------------------------------------------------

class TestOAuthRefreshLockAcquired:
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_lock_acquired_refreshes_credentials(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, _,
    ):
        expired_at = int(time.time()) - 100
        new_expires_at = int(time.time()) + 3600
        bp = _make_builtin_provider(expires_at=expired_at)
        enc, cache = _make_encrypter_and_cache()
        mock_db.session.refresh.side_effect = lambda obj: None
        mock_lock = _setup_common(mock_db, mock_redis, mock_create_encrypter,
                                  mock_get_provider, bp, enc, cache, lock_acquired=True)
        refreshed = _make_refreshed_response(expires_at=new_expires_at)

        with (
            patch("core.plugin.impl.oauth.OAuthHandler") as mock_oauth_cls,
            patch("services.tools.builtin_tools_manage_service.BuiltinToolManageService") as mock_svc,
            patch("core.tools.tool_manager.ToolProviderID", return_value=_pid_mock()),
            patch("core.tools.tool_manager.dify_config", CONSOLE_API_URL="https://app.dify.ai"),
        ):
            mock_svc.get_oauth_client.return_value = {"client_id": "cid"}
            mock_oauth = MagicMock()
            mock_oauth.refresh_credentials.return_value = refreshed
            mock_oauth_cls.return_value = mock_oauth
            _call_get_tool_runtime()

        mock_lock.acquire.assert_called_once_with(blocking=False)
        mock_lock.release.assert_called_once()
        mock_oauth.refresh_credentials.assert_called_once()
        mock_db.session.commit.assert_called_once()
        assert bp.expires_at == new_expires_at
        cache.delete.assert_called_once()


# ---------------------------------------------------------------------------
# Test: Lock acquired, but another thread already refreshed (double-check)
# ---------------------------------------------------------------------------

class TestOAuthRefreshDoubleCheck:
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_double_check_skips_refresh(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, _,
    ):
        expired_at = int(time.time()) - 100
        fresh_at = int(time.time()) + 3600
        bp = _make_builtin_provider(expires_at=expired_at)
        enc, cache = _make_encrypter_and_cache()
        mock_db.session.refresh.side_effect = lambda obj: setattr(obj, 'expires_at', fresh_at)
        mock_lock = _setup_common(mock_db, mock_redis, mock_create_encrypter,
                                  mock_get_provider, bp, enc, cache, lock_acquired=True)

        with (
            patch("core.tools.tool_manager.ToolProviderID", return_value=_pid_mock()),
            patch("core.tools.tool_manager.dify_config", CONSOLE_API_URL="https://app.dify.ai"),
        ):
            _call_get_tool_runtime()

        mock_lock.acquire.assert_called_once_with(blocking=False)
        mock_lock.release.assert_called_once()
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Lock NOT acquired → poll DB with exponential backoff
# ---------------------------------------------------------------------------

class TestOAuthRefreshLockNotAcquired:
    @patch("core.tools.tool_manager.time")
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_lock_not_acquired_polls_db_until_fresh(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, _, mock_time,
    ):
        """Poll DB with backoff; break early when credentials become fresh."""
        now = int(time.time())
        bp = _make_builtin_provider(expires_at=now - 100)
        enc, cache = _make_encrypter_and_cache()
        mock_time.time.return_value = now
        mock_time.sleep = MagicMock()

        mock_lock = _setup_common(mock_db, mock_redis, mock_create_encrypter,
                                  mock_get_provider, bp, enc, cache, lock_acquired=False)

        # Simulate: 2nd db.session.refresh makes credentials fresh
        refresh_count = 0
        def _fake_refresh(obj):
            nonlocal refresh_count
            refresh_count += 1
            if refresh_count >= 2:
                obj.expires_at = now + 3600

        mock_db.session.refresh.side_effect = _fake_refresh

        with (
            patch("core.tools.tool_manager.ToolProviderID", return_value=_pid_mock()),
            patch("core.tools.tool_manager.dify_config", CONSOLE_API_URL="https://app.dify.ai"),
        ):
            _call_get_tool_runtime()

        mock_lock.acquire.assert_called_once_with(blocking=False)
        mock_lock.release.assert_not_called()
        assert mock_time.sleep.call_count >= 1
        assert mock_db.session.refresh.call_count >= 2
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Lock released even on exception
# ---------------------------------------------------------------------------

class TestOAuthRefreshLockRelease:
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_lock_released_on_exception(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, _,
    ):
        bp = _make_builtin_provider(expires_at=int(time.time()) - 100)
        enc, cache = _make_encrypter_and_cache()
        mock_db.session.refresh.side_effect = lambda obj: None
        mock_lock = _setup_common(mock_db, mock_redis, mock_create_encrypter,
                                  mock_get_provider, bp, enc, cache, lock_acquired=True)

        with (
            patch("core.plugin.impl.oauth.OAuthHandler") as mock_oauth_cls,
            patch("services.tools.builtin_tools_manage_service.BuiltinToolManageService") as mock_svc,
            patch("core.tools.tool_manager.ToolProviderID", return_value=_pid_mock()),
            patch("core.tools.tool_manager.dify_config", CONSOLE_API_URL="https://app.dify.ai"),
        ):
            mock_svc.get_oauth_client.return_value = {}
            mock_oauth = MagicMock()
            mock_oauth.refresh_credentials.side_effect = RuntimeError("OAuth unreachable")
            mock_oauth_cls.return_value = mock_oauth
            with pytest.raises(RuntimeError, match="OAuth unreachable"):
                _call_get_tool_runtime()

        mock_lock.release.assert_called_once()
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Non-expired → no lock at all
# ---------------------------------------------------------------------------

class TestOAuthRefreshNotExpired:
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_non_expired_skips_lock(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, _,
    ):
        bp = _make_builtin_provider(expires_at=int(time.time()) + 3600)
        enc, cache = _make_encrypter_and_cache()
        _setup_common(mock_db, mock_redis, mock_create_encrypter,
                      mock_get_provider, bp, enc, cache)
        with (
            patch("core.tools.tool_manager.ToolProviderID", return_value=_pid_mock()),
            patch("core.tools.tool_manager.dify_config", CONSOLE_API_URL="https://app.dify.ai"),
        ):
            _call_get_tool_runtime()
        mock_redis.lock.assert_not_called()


# ---------------------------------------------------------------------------
# Test: expires_at == -1 → never expires, no lock
# ---------------------------------------------------------------------------

class TestOAuthRefreshNeverExpires:
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_never_expires_skips_lock(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, _,
    ):
        bp = _make_builtin_provider(expires_at=-1)
        enc, cache = _make_encrypter_and_cache()
        _setup_common(mock_db, mock_redis, mock_create_encrypter,
                      mock_get_provider, bp, enc, cache)
        with (
            patch("core.tools.tool_manager.ToolProviderID", return_value=_pid_mock()),
            patch("core.tools.tool_manager.dify_config", CONSOLE_API_URL="https://app.dify.ai"),
        ):
            _call_get_tool_runtime()
        mock_redis.lock.assert_not_called()
