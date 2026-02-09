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

def _make_builtin_provider(
    *,
    expires_at: int = -1,
    encrypted_credentials: str | None = None,
):
    """Create a mock BuiltinToolProvider."""
    provider = MagicMock()
    provider.id = "bp-001"
    provider.provider = "test-plugin/test-provider"
    provider.tenant_id = "tenant-1"
    provider.user_id = "user-1"
    provider.credential_type = "oauth2"
    provider.expires_at = expires_at
    provider.encrypted_credentials = encrypted_credentials or json.dumps(
        {"access_token": "old_at", "refresh_token": "old_rt"}
    )
    provider.credentials = json.loads(provider.encrypted_credentials)
    return provider


def _make_encrypter_and_cache(decrypted: dict | None = None):
    """Create mock encrypter and cache objects."""
    enc = MagicMock()
    enc.decrypt.return_value = decrypted or {"access_token": "old_at", "refresh_token": "old_rt"}
    enc.encrypt.return_value = {"access_token": "enc_new_at", "refresh_token": "enc_new_rt"}
    cache = MagicMock()
    return enc, cache


def _make_refreshed_response(expires_at: int | None = None):
    """Create a mock refreshed credentials response."""
    resp = MagicMock()
    resp.credentials = {"access_token": "new_at", "refresh_token": "new_rt"}
    resp.expires_at = expires_at or int(time.time()) + 3600
    return resp


def _make_provider_controller():
    """Create a mock PluginToolProviderController that passes isinstance check."""
    ctrl = MagicMock(spec=PluginToolProviderController)
    ctrl.need_credentials = True
    ctrl.get_tool.return_value = MagicMock()
    ctrl.get_credentials_schema_by_type.return_value = []
    return ctrl


def _setup_common_patches(
    mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
    builtin_provider, encrypter, cache, lock_acquired=True,
):
    """Set up common mock configurations."""
    mock_db.session.scalar.return_value = builtin_provider
    mock_create_encrypter.return_value = (encrypter, cache)

    mock_lock = MagicMock()
    mock_lock.acquire.return_value = lock_acquired
    mock_redis.lock.return_value = mock_lock

    mock_get_provider.return_value = _make_provider_controller()

    return mock_lock


# Common decorator stack for all tests
_COMMON_PATCHES = [
    patch("core.helper.credential_utils.check_credential_policy_compliance"),
    patch("core.tools.tool_manager.is_valid_uuid", return_value=True),
    patch("core.tools.tool_manager.create_provider_encrypter"),
    patch("core.tools.tool_manager.redis_client"),
    patch("core.tools.tool_manager.db"),
    patch("core.tools.tool_manager.ToolManager.get_builtin_provider"),
]


def _call_get_tool_runtime():
    """Call ToolManager.get_tool_runtime with standard test arguments."""
    from core.tools.entities.tool_entities import ToolProviderType
    from core.tools.tool_manager import ToolManager

    return ToolManager.get_tool_runtime(
        provider_type=ToolProviderType.BUILT_IN,
        provider_id="test-plugin/test-provider",
        tool_name="test-tool",
        tenant_id="tenant-1",
        credential_id="bp-001",
    )


# ---------------------------------------------------------------------------
# Test: Lock acquired → credentials refreshed
# ---------------------------------------------------------------------------

class TestOAuthRefreshLockAcquired:
    """When the lock is successfully acquired, credentials should be refreshed."""

    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_lock_acquired_refreshes_credentials(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, mock_check_policy,
    ):
        """When lock is acquired and token is expired, credentials should be refreshed."""
        expired_at = int(time.time()) - 100
        new_expires_at = int(time.time()) + 3600

        bp = _make_builtin_provider(expires_at=expired_at)
        enc, cache = _make_encrypter_and_cache()
        mock_db.session.refresh.side_effect = lambda obj: None  # Keep expired
        mock_lock = _setup_common_patches(
            mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
            bp, enc, cache, lock_acquired=True,
        )

        refreshed = _make_refreshed_response(expires_at=new_expires_at)

        with (
            patch("core.plugin.impl.oauth.OAuthHandler") as mock_oauth_cls,
            patch("services.tools.builtin_tools_manage_service.BuiltinToolManageService") as mock_manage_svc,
            patch("core.tools.tool_manager.ToolProviderID") as mock_pid_cls,
            patch("core.tools.tool_manager.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_pid = MagicMock()
            mock_pid.provider_name = "test-provider"
            mock_pid.plugin_id = "test-plugin"
            mock_pid_cls.return_value = mock_pid
            mock_manage_svc.get_oauth_client.return_value = {"client_id": "cid"}
            mock_oauth = MagicMock()
            mock_oauth.refresh_credentials.return_value = refreshed
            mock_oauth_cls.return_value = mock_oauth

            _call_get_tool_runtime()

        # Lock was acquired and released
        mock_redis.lock.assert_called_once()
        mock_lock.acquire.assert_called_once_with(blocking=False)
        mock_lock.release.assert_called_once()
        # OAuth refresh was called
        mock_oauth.refresh_credentials.assert_called_once()
        # DB was committed
        mock_db.session.commit.assert_called_once()
        assert bp.expires_at == new_expires_at
        # Cache was invalidated
        cache.delete.assert_called_once()


# ---------------------------------------------------------------------------
# Test: Lock acquired but double-check shows already refreshed
# ---------------------------------------------------------------------------

class TestOAuthRefreshDoubleCheck:
    """When lock is acquired but another request already refreshed, skip refresh."""

    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_double_check_skips_refresh(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, mock_check_policy,
    ):
        """Lock acquired, but double-check shows token was already refreshed."""
        expired_at = int(time.time()) - 100
        fresh_at = int(time.time()) + 3600

        bp = _make_builtin_provider(expires_at=expired_at)
        enc, cache = _make_encrypter_and_cache()

        # After db.session.refresh(), expires_at becomes fresh
        def _fake_refresh(obj):
            obj.expires_at = fresh_at

        mock_db.session.refresh.side_effect = _fake_refresh
        mock_lock = _setup_common_patches(
            mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
            bp, enc, cache, lock_acquired=True,
        )

        with (
            patch("core.tools.tool_manager.ToolProviderID") as mock_pid_cls,
            patch("core.tools.tool_manager.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_pid = MagicMock()
            mock_pid.provider_name = "test-provider"
            mock_pid.plugin_id = "test-plugin"
            mock_pid_cls.return_value = mock_pid

            _call_get_tool_runtime()

        mock_lock.acquire.assert_called_once_with(blocking=False)
        mock_lock.release.assert_called_once()
        mock_db.session.refresh.assert_called_with(bp)
        # No commit since double-check found fresh credentials
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Lock NOT acquired → read from DB
# ---------------------------------------------------------------------------

class TestOAuthRefreshLockNotAcquired:
    """When the lock is not acquired, retry polling DB until credentials are fresh."""

    @patch("core.tools.tool_manager.time")
    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_lock_not_acquired_retries_then_reads_fresh(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, mock_check_policy, mock_time,
    ):
        """When lock not acquired, should retry polling DB until credentials become fresh."""
        now = int(time.time())
        expired_at = now - 100
        fresh_at = now + 3600

        bp = _make_builtin_provider(expires_at=expired_at)
        refreshed_creds = {"access_token": "refreshed_by_other", "refresh_token": "refreshed_rt"}
        enc, cache = _make_encrypter_and_cache(decrypted=refreshed_creds)

        mock_lock = _setup_common_patches(
            mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
            bp, enc, cache, lock_acquired=False,
        )

        # time.time() returns current time; time.sleep() is a no-op in unit test
        mock_time.time.return_value = now
        mock_time.sleep = MagicMock()

        # Simulate: first db.session.refresh still expired, second one is fresh
        call_count = 0
        def _fake_refresh(obj):
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                obj.expires_at = fresh_at

        mock_db.session.refresh.side_effect = _fake_refresh

        with (
            patch("core.tools.tool_manager.ToolProviderID") as mock_pid_cls,
            patch("core.tools.tool_manager.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_pid = MagicMock()
            mock_pid.provider_name = "test-provider"
            mock_pid.plugin_id = "test-plugin"
            mock_pid_cls.return_value = mock_pid

            _call_get_tool_runtime()

        mock_lock.acquire.assert_called_once_with(blocking=False)
        mock_lock.release.assert_not_called()
        # time.sleep was called for backoff
        assert mock_time.sleep.call_count >= 1
        # DB was polled multiple times
        assert mock_db.session.refresh.call_count >= 2
        enc.decrypt.assert_called()
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Lock release on exception
# ---------------------------------------------------------------------------

class TestOAuthRefreshLockRelease:
    """Lock should always be released, even when refresh raises an exception."""

    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_lock_released_on_exception(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, mock_check_policy,
    ):
        """Lock must be released in finally block even if refresh raises."""
        expired_at = int(time.time()) - 100
        bp = _make_builtin_provider(expires_at=expired_at)
        enc, cache = _make_encrypter_and_cache()
        mock_db.session.refresh.side_effect = lambda obj: None

        mock_lock = _setup_common_patches(
            mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
            bp, enc, cache, lock_acquired=True,
        )

        with (
            patch("core.plugin.impl.oauth.OAuthHandler") as mock_oauth_cls,
            patch("services.tools.builtin_tools_manage_service.BuiltinToolManageService") as mock_manage_svc,
            patch("core.tools.tool_manager.ToolProviderID") as mock_pid_cls,
            patch("core.tools.tool_manager.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_pid = MagicMock()
            mock_pid.provider_name = "test-provider"
            mock_pid.plugin_id = "test-plugin"
            mock_pid_cls.return_value = mock_pid
            mock_manage_svc.get_oauth_client.return_value = {}
            mock_oauth = MagicMock()
            mock_oauth.refresh_credentials.side_effect = RuntimeError("OAuth unreachable")
            mock_oauth_cls.return_value = mock_oauth

            with pytest.raises(RuntimeError, match="OAuth unreachable"):
                _call_get_tool_runtime()

        mock_lock.release.assert_called_once()
        mock_db.session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Non-expired token → no lock needed
# ---------------------------------------------------------------------------

class TestOAuthRefreshNotExpired:
    """When credentials are not expired, no lock or refresh should happen."""

    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_non_expired_skips_lock(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, mock_check_policy,
    ):
        """Non-expired credentials should bypass the lock entirely."""
        future_at = int(time.time()) + 3600
        bp = _make_builtin_provider(expires_at=future_at)
        enc, cache = _make_encrypter_and_cache()
        _setup_common_patches(
            mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
            bp, enc, cache,
        )

        with (
            patch("core.tools.tool_manager.ToolProviderID") as mock_pid_cls,
            patch("core.tools.tool_manager.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_pid = MagicMock()
            mock_pid.provider_name = "test-provider"
            mock_pid.plugin_id = "test-plugin"
            mock_pid_cls.return_value = mock_pid

            _call_get_tool_runtime()

        mock_redis.lock.assert_not_called()


# ---------------------------------------------------------------------------
# Test: expires_at == -1 → never expires, no lock
# ---------------------------------------------------------------------------

class TestOAuthRefreshNeverExpires:
    """When expires_at is -1, no lock needed."""

    @patch("core.helper.credential_utils.check_credential_policy_compliance")
    @patch("core.tools.tool_manager.is_valid_uuid", return_value=True)
    @patch("core.tools.tool_manager.create_provider_encrypter")
    @patch("core.tools.tool_manager.redis_client")
    @patch("core.tools.tool_manager.db")
    @patch("core.tools.tool_manager.ToolManager.get_builtin_provider")
    def test_never_expires_skips_lock(
        self, mock_get_provider, mock_db, mock_redis,
        mock_create_encrypter, mock_is_uuid, mock_check_policy,
    ):
        """expires_at == -1 means no expiration; should not attempt lock."""
        bp = _make_builtin_provider(expires_at=-1)
        enc, cache = _make_encrypter_and_cache()
        _setup_common_patches(
            mock_db, mock_redis, mock_create_encrypter, mock_get_provider,
            bp, enc, cache,
        )

        with (
            patch("core.tools.tool_manager.ToolProviderID") as mock_pid_cls,
            patch("core.tools.tool_manager.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_pid = MagicMock()
            mock_pid.provider_name = "test-provider"
            mock_pid.plugin_id = "test-plugin"
            mock_pid_cls.return_value = mock_pid

            _call_get_tool_runtime()

        mock_redis.lock.assert_not_called()
