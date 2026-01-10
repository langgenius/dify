"""
Unit tests for sync_github_latest_release_plugins_on_login_task.

Covers:
- Task is a no-op when disabled
- Task is de-duplicated via Redis lock (skip when already running)
- Task releases the lock on early exit
"""

from unittest.mock import MagicMock, patch

from configs import dify_config
from tasks.sync_github_latest_release_plugins_on_login_task import sync_github_latest_release_plugins_on_login_task


class TestSyncGithubLatestReleasePluginsOnLoginTask:
    def test_disabled_does_not_try_to_lock_or_sync(self):
        with patch.object(dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_ENABLED", False):
            with patch("tasks.sync_github_latest_release_plugins_on_login_task.redis_client.lock") as mock_lock:
                with patch(
                    "tasks.sync_github_latest_release_plugins_on_login_task.PluginService.sync_latest_release_plugins_for_tenant"
                ) as mock_sync:
                    sync_github_latest_release_plugins_on_login_task(tenant_id="t1", account_id="a1")
                    mock_lock.assert_not_called()
                    mock_sync.assert_not_called()

    def test_lock_not_acquired_skips_sync(self):
        lock = MagicMock()
        lock.acquire.return_value = False

        with patch.object(dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_ENABLED", True):
            with patch.object(dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_REPOS", ["AceDataCloud/Dify"]):
                with patch(
                    "tasks.sync_github_latest_release_plugins_on_login_task.redis_client.lock", return_value=lock
                ):
                    with patch(
                        "tasks.sync_github_latest_release_plugins_on_login_task.PluginService.sync_latest_release_plugins_for_tenant"
                    ) as mock_sync:
                        sync_github_latest_release_plugins_on_login_task(tenant_id="t1", account_id="a1")
                        mock_sync.assert_not_called()
                        lock.release.assert_not_called()

    def test_no_repos_releases_lock_and_exits(self):
        lock = MagicMock()
        lock.acquire.return_value = True

        with patch.object(dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_ENABLED", True):
            with patch.object(dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_REPOS", []):
                with patch.object(dify_config, "DEFAULT_TENANT_GITHUB_RELEASE_REPOS", []):
                    with patch(
                        "tasks.sync_github_latest_release_plugins_on_login_task.redis_client.lock", return_value=lock
                    ):
                        with patch(
                            "tasks.sync_github_latest_release_plugins_on_login_task.PluginService.sync_latest_release_plugins_for_tenant"
                        ) as mock_sync:
                            sync_github_latest_release_plugins_on_login_task(tenant_id="t1", account_id="a1")
                            mock_sync.assert_not_called()
                            lock.release.assert_called_once()

    def test_acquired_lock_runs_sync_and_releases_lock(self):
        lock = MagicMock()
        lock.acquire.return_value = True

        with patch.object(dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_ENABLED", True):
            with patch.object(
                dify_config, "PLUGIN_SYNC_GITHUB_LATEST_RELEASE_ON_LOGIN_REPOS", ["AceDataCloud/Dify", "x/y"]
            ):
                with patch.object(dify_config, "ACEDATACLOUD_AUTO_PROVISION_PLUGIN_CREDENTIALS", False):
                    with patch(
                        "tasks.sync_github_latest_release_plugins_on_login_task.redis_client.lock", return_value=lock
                    ):
                        with patch(
                            "tasks.sync_github_latest_release_plugins_on_login_task.PluginService.sync_latest_release_plugins_for_tenant"
                        ) as mock_sync:
                            mock_sync.side_effect = [1, 0]
                            sync_github_latest_release_plugins_on_login_task(tenant_id="t1", account_id="a1")

                            assert mock_sync.call_count == 2
                            mock_sync.assert_any_call(tenant_id="t1", repo="AceDataCloud/Dify")
                            mock_sync.assert_any_call(tenant_id="t1", repo="x/y")
                            lock.release.assert_called_once()
