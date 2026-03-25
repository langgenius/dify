"""Tests for the distributed lock mechanism in DatasourceProviderService OAuth token refresh.

These tests verify the non-blocking Redis lock + double-check pattern that
prevents concurrent OAuth token refresh race conditions.

The lock uses ``with redis_client.lock(key, timeout=30, blocking_timeout=0):``
context manager; when the lock cannot be acquired, ``LockError`` is raised and
the fallback polling path runs.
"""

import time
from unittest.mock import MagicMock, patch

import pytest
from redis.exceptions import LockError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_datasource_provider(
    *,
    provider_id: str = "dp-001",
    tenant_id: str = "tenant-1",
    provider: str = "test-provider",
    plugin_id: str = "test-plugin",
    auth_type: str = "oauth2",
    expires_at: int = -1,
    encrypted_credentials: dict | None = None,
):
    """Create a mock DatasourceProvider with the given attributes."""
    dp = MagicMock()
    dp.id = provider_id
    dp.tenant_id = tenant_id
    dp.provider = provider
    dp.plugin_id = plugin_id
    dp.auth_type = auth_type
    dp.expires_at = expires_at
    dp.encrypted_credentials = encrypted_credentials or {
        "access_token": "encrypted_old_at",
        "refresh_token": "encrypted_old_rt",
    }
    return dp


def _make_refreshed_credentials(
    access_token: str = "new_at",
    refresh_token: str = "new_rt",
    expires_at: int | None = None,
):
    """Create a mock PluginOAuthCredentialsResponse."""
    resp = MagicMock()
    resp.credentials = {"access_token": access_token, "refresh_token": refresh_token}
    resp.expires_at = expires_at or int(time.time()) + 3600
    return resp


def _make_mock_session(datasource_provider):
    """Create a mock Session that returns the given datasource_provider on query."""
    mock_session = MagicMock()
    mock_query = MagicMock()
    mock_query.filter_by.return_value = mock_query
    mock_query.order_by.return_value = mock_query
    mock_query.first.return_value = datasource_provider
    mock_session.query.return_value = mock_query
    mock_session.refresh = MagicMock()
    mock_session.commit = MagicMock()
    return mock_session


def _make_redis_lock(*, acquired=True):
    """Create a mock redis lock that works as a context manager.

    When acquired=True, the context manager enters normally.
    When acquired=False, __enter__ raises LockError (simulating blocking_timeout=0).
    """
    mock_lock = MagicMock()
    if acquired:
        mock_lock.__enter__ = MagicMock(return_value=mock_lock)
        mock_lock.__exit__ = MagicMock(return_value=False)
    else:
        mock_lock.__enter__ = MagicMock(
            side_effect=LockError("Failed to acquire lock"),
        )
        mock_lock.__exit__ = MagicMock(return_value=False)
    return mock_lock


# ---------------------------------------------------------------------------
# Test: Lock acquired → credentials refreshed
# ---------------------------------------------------------------------------


class TestDatasourceProviderOAuthRefreshLockAcquired:
    """When the lock is successfully acquired, credentials should be refreshed."""

    @patch("services.datasource_provider_service.redis_client")
    @patch("services.datasource_provider_service.db")
    @patch("services.datasource_provider_service.OAuthHandler")
    @patch("services.datasource_provider_service.get_current_user")
    def test_lock_acquired_refreshes_credentials(
        self,
        mock_get_user,
        mock_oauth_cls,
        mock_db,
        mock_redis,
    ):
        """When lock is acquired and token is expired, credentials should be refreshed."""
        from services.datasource_provider_service import DatasourceProviderService

        # Arrange
        expired_at = int(time.time()) - 100
        new_expires_at = int(time.time()) + 3600

        dp = _make_datasource_provider(expires_at=expired_at)
        mock_session = _make_mock_session(dp)

        # Session context manager
        mock_db.engine = MagicMock()
        mock_session_cls = MagicMock()
        mock_session_cls.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.__exit__ = MagicMock(return_value=False)

        # db.session.refresh keeps expired (double-check passes)
        mock_session.refresh.side_effect = lambda obj: None

        # Lock as context manager (acquired)
        mock_lock = _make_redis_lock(acquired=True)
        mock_redis.lock.return_value = mock_lock

        # OAuth refresh
        refreshed = _make_refreshed_credentials(expires_at=new_expires_at)
        mock_oauth = MagicMock()
        mock_oauth.refresh_credentials.return_value = refreshed
        mock_oauth_cls.return_value = mock_oauth

        # Current user
        mock_user = MagicMock()
        mock_user.id = "user-1"
        mock_get_user.return_value = mock_user

        svc = DatasourceProviderService()

        with (
            patch.object(
                svc,
                "decrypt_datasource_provider_credentials",
                return_value={"access_token": "old_at", "refresh_token": "old_rt"},
            ),
            patch.object(
                svc,
                "encrypt_datasource_provider_credentials",
                return_value={"access_token": "encrypted_new_at", "refresh_token": "encrypted_new_rt"},
            ),
            patch.object(svc, "get_oauth_client", return_value={"client_id": "cid"}),
            patch.object(svc, "extract_secret_variables", return_value=[]),
            patch("services.datasource_provider_service.Session", return_value=mock_session_cls),
            patch("services.datasource_provider_service.DatasourceProviderID") as mock_dp_id_cls,
            patch("services.datasource_provider_service.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_dp_id = MagicMock()
            mock_dp_id.provider_name = "test-provider"
            mock_dp_id.plugin_id = "test-plugin"
            mock_dp_id_cls.return_value = mock_dp_id

            # Act
            svc.get_datasource_credentials(
                tenant_id="tenant-1",
                provider="test-provider",
                plugin_id="test-plugin",
                credential_id="dp-001",
            )

        # Assert
        mock_redis.lock.assert_called_once()
        mock_lock.__enter__.assert_called_once()
        mock_lock.__exit__.assert_called_once()
        mock_oauth.refresh_credentials.assert_called_once()
        mock_session.commit.assert_called_once()
        assert dp.expires_at == new_expires_at
        # Signal key should be set in Redis after successful refresh
        mock_redis.set.assert_called_once()
        signal_call_args = mock_redis.set.call_args
        assert signal_call_args[0][0].startswith("oauth_refresh_done:")
        assert signal_call_args[1]["ex"] == 60


# ---------------------------------------------------------------------------
# Test: Lock acquired but double-check shows already refreshed
# ---------------------------------------------------------------------------


class TestDatasourceProviderOAuthRefreshDoubleCheck:
    """When lock is acquired but double-check shows already refreshed, skip refresh."""

    @patch("services.datasource_provider_service.redis_client")
    @patch("services.datasource_provider_service.db")
    def test_lock_acquired_but_already_refreshed(
        self,
        mock_db,
        mock_redis,
    ):
        """Lock acquired, but double-check shows token was already refreshed."""
        from services.datasource_provider_service import DatasourceProviderService

        # Arrange
        expired_at = int(time.time()) - 100
        fresh_expires_at = int(time.time()) + 3600

        dp = _make_datasource_provider(expires_at=expired_at)
        mock_session = _make_mock_session(dp)

        mock_db.engine = MagicMock()
        mock_session_cls = MagicMock()
        mock_session_cls.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.__exit__ = MagicMock(return_value=False)

        # After session.refresh(), expires_at becomes fresh
        def _fake_refresh(obj):
            obj.expires_at = fresh_expires_at

        mock_session.refresh.side_effect = _fake_refresh

        # Lock as context manager (acquired)
        mock_lock = _make_redis_lock(acquired=True)
        mock_redis.lock.return_value = mock_lock

        svc = DatasourceProviderService()

        with (
            patch.object(
                svc,
                "decrypt_datasource_provider_credentials",
                return_value={"access_token": "refreshed_at", "refresh_token": "refreshed_rt"},
            ),
            patch.object(svc, "extract_secret_variables", return_value=[]),
            patch("services.datasource_provider_service.Session", return_value=mock_session_cls),
        ):
            # Act
            svc.get_datasource_credentials(
                tenant_id="tenant-1",
                provider="test-provider",
                plugin_id="test-plugin",
                credential_id="dp-001",
            )

        # Assert
        mock_lock.__enter__.assert_called_once()
        mock_lock.__exit__.assert_called_once()
        mock_session.refresh.assert_called_with(dp)
        # No commit since double-check found fresh credentials
        mock_session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Lock NOT acquired → poll DB with exponential backoff
# ---------------------------------------------------------------------------


class TestDatasourceProviderOAuthRefreshLockNotAcquired:
    """When the lock is not acquired (LockError), poll Redis signal then read DB once."""

    @patch("services.datasource_provider_service.time")
    @patch("services.datasource_provider_service.redis_client")
    @patch("services.datasource_provider_service.db")
    def test_lock_not_acquired_polls_redis_signal(
        self,
        mock_db,
        mock_redis,
        mock_time,
    ):
        """When lock not acquired, poll Redis signal key then do one final DB read."""
        from services.datasource_provider_service import DatasourceProviderService

        # Arrange
        now = int(time.time())
        expired_at = now - 100

        dp = _make_datasource_provider(expires_at=expired_at)
        mock_session = _make_mock_session(dp)

        mock_db.engine = MagicMock()
        mock_session_cls = MagicMock()
        mock_session_cls.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.__exit__ = MagicMock(return_value=False)

        # time.time() returns current time; time.sleep() is a no-op in unit test
        mock_time.time.return_value = now
        mock_time.sleep = MagicMock()

        # Lock NOT acquired (context manager raises LockError)
        mock_lock = _make_redis_lock(acquired=False)
        mock_redis.lock.return_value = mock_lock

        # redis_client.exists returns False first, then True (signal set)
        mock_redis.exists.side_effect = [False, True]

        svc = DatasourceProviderService()

        with (
            patch.object(
                svc,
                "decrypt_datasource_provider_credentials",
                return_value={"access_token": "refreshed_by_other", "refresh_token": "refreshed_rt"},
            ),
            patch.object(svc, "extract_secret_variables", return_value=[]),
            patch("services.datasource_provider_service.Session", return_value=mock_session_cls),
        ):
            # Act
            svc.get_datasource_credentials(
                tenant_id="tenant-1",
                provider="test-provider",
                plugin_id="test-plugin",
                credential_id="dp-001",
            )

        # Assert: polls Redis signal, not DB
        assert mock_time.sleep.call_count >= 1
        assert mock_redis.exists.call_count >= 1
        # One final session.refresh to get latest credentials from DB
        mock_session.refresh.assert_called()
        mock_session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Lock release on exception
# ---------------------------------------------------------------------------


class TestDatasourceProviderOAuthRefreshLockRelease:
    """Lock should always be released (via context manager __exit__) on exception."""

    @patch("services.datasource_provider_service.redis_client")
    @patch("services.datasource_provider_service.db")
    @patch("services.datasource_provider_service.OAuthHandler")
    @patch("services.datasource_provider_service.get_current_user")
    def test_lock_released_on_refresh_exception(
        self,
        mock_get_user,
        mock_oauth_cls,
        mock_db,
        mock_redis,
    ):
        """Lock must be released via context manager even if refresh raises."""
        from services.datasource_provider_service import DatasourceProviderService

        # Arrange
        expired_at = int(time.time()) - 100
        dp = _make_datasource_provider(expires_at=expired_at)
        mock_session = _make_mock_session(dp)

        mock_db.engine = MagicMock()
        mock_session_cls = MagicMock()
        mock_session_cls.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.__exit__ = MagicMock(return_value=False)

        mock_session.refresh.side_effect = lambda obj: None

        mock_lock = _make_redis_lock(acquired=True)
        mock_redis.lock.return_value = mock_lock

        mock_user = MagicMock()
        mock_user.id = "user-1"
        mock_get_user.return_value = mock_user

        mock_oauth = MagicMock()
        mock_oauth.refresh_credentials.side_effect = RuntimeError("OAuth unreachable")
        mock_oauth_cls.return_value = mock_oauth

        svc = DatasourceProviderService()

        with (
            patch.object(
                svc,
                "decrypt_datasource_provider_credentials",
                return_value={"access_token": "old_at", "refresh_token": "old_rt"},
            ),
            patch.object(svc, "get_oauth_client", return_value={"client_id": "cid"}),
            patch.object(svc, "extract_secret_variables", return_value=[]),
            patch("services.datasource_provider_service.Session", return_value=mock_session_cls),
            patch("services.datasource_provider_service.DatasourceProviderID") as mock_dp_id_cls,
            patch("services.datasource_provider_service.dify_config") as mock_config,
        ):
            mock_config.CONSOLE_API_URL = "https://app.dify.ai"
            mock_dp_id = MagicMock()
            mock_dp_id.provider_name = "test-provider"
            mock_dp_id.plugin_id = "test-plugin"
            mock_dp_id_cls.return_value = mock_dp_id

            # Act & Assert
            with pytest.raises(RuntimeError, match="OAuth unreachable"):
                svc.get_datasource_credentials(
                    tenant_id="tenant-1",
                    provider="test-provider",
                    plugin_id="test-plugin",
                    credential_id="dp-001",
                )

        # Context manager ensures __exit__ is called even on exception
        mock_lock.__exit__.assert_called_once()
        mock_session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Non-expired token → no lock needed
# ---------------------------------------------------------------------------


class TestDatasourceProviderOAuthRefreshNotExpired:
    """When credentials are not expired, no lock or refresh should happen."""

    @patch("services.datasource_provider_service.redis_client")
    @patch("services.datasource_provider_service.db")
    def test_non_expired_credentials_skip_lock(
        self,
        mock_db,
        mock_redis,
    ):
        """Non-expired credentials should bypass the lock entirely."""
        from services.datasource_provider_service import DatasourceProviderService

        # Arrange
        future_expires_at = int(time.time()) + 3600
        dp = _make_datasource_provider(expires_at=future_expires_at)
        mock_session = _make_mock_session(dp)

        mock_db.engine = MagicMock()
        mock_session_cls = MagicMock()
        mock_session_cls.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.__exit__ = MagicMock(return_value=False)

        svc = DatasourceProviderService()

        with (
            patch.object(
                svc,
                "decrypt_datasource_provider_credentials",
                return_value={"access_token": "valid_at", "refresh_token": "valid_rt"},
            ),
            patch.object(svc, "extract_secret_variables", return_value=[]),
            patch("services.datasource_provider_service.Session", return_value=mock_session_cls),
        ):
            # Act
            svc.get_datasource_credentials(
                tenant_id="tenant-1",
                provider="test-provider",
                plugin_id="test-plugin",
                credential_id="dp-001",
            )

        # Assert: no lock interaction at all
        mock_redis.lock.assert_not_called()


# ---------------------------------------------------------------------------
# Test: expires_at == -1 → never expires, no lock
# ---------------------------------------------------------------------------


class TestDatasourceProviderOAuthRefreshNeverExpires:
    """When expires_at is -1, credentials never expire; no lock needed."""

    @patch("services.datasource_provider_service.redis_client")
    @patch("services.datasource_provider_service.db")
    def test_never_expires_skips_lock(
        self,
        mock_db,
        mock_redis,
    ):
        """expires_at == -1 means no expiration; should not attempt lock."""
        from services.datasource_provider_service import DatasourceProviderService

        # Arrange
        dp = _make_datasource_provider(expires_at=-1)
        mock_session = _make_mock_session(dp)

        mock_db.engine = MagicMock()
        mock_session_cls = MagicMock()
        mock_session_cls.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.__exit__ = MagicMock(return_value=False)

        svc = DatasourceProviderService()

        with (
            patch.object(
                svc,
                "decrypt_datasource_provider_credentials",
                return_value={"access_token": "valid_at", "refresh_token": "valid_rt"},
            ),
            patch.object(svc, "extract_secret_variables", return_value=[]),
            patch("services.datasource_provider_service.Session", return_value=mock_session_cls),
        ):
            # Act
            svc.get_datasource_credentials(
                tenant_id="tenant-1",
                provider="test-provider",
                plugin_id="test-plugin",
                credential_id="dp-001",
            )

        # Assert
        mock_redis.lock.assert_not_called()
