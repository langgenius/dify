from unittest.mock import MagicMock, patch

import pytest


def test_cleanup_plugin_credentials_task_uses_plugin_queue() -> None:
    from tasks.plugin_credential_cleanup_task import cleanup_plugin_credentials_task

    assert cleanup_plugin_credentials_task.queue == "plugin"
    assert cleanup_plugin_credentials_task.max_retries == 5


def test_cleanup_plugin_credentials_task_calls_shared_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.plugin_credential_cleanup_task as task_module
    from tasks.plugin_credential_cleanup_task import cleanup_plugin_credentials_task

    cleanup = MagicMock()
    monkeypatch.setattr(task_module.PluginService, "_cleanup_plugin_credentials", cleanup)

    cleanup_plugin_credentials_task.run("tenant-1", "org/myplugin")

    cleanup.assert_called_once_with("tenant-1", "org/myplugin")


def test_cleanup_plugin_credentials_task_retries_cleanup_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.plugin_credential_cleanup_task as task_module
    from tasks.plugin_credential_cleanup_task import cleanup_plugin_credentials_task

    error = RuntimeError("cleanup unavailable")
    monkeypatch.setattr(task_module.PluginService, "_cleanup_plugin_credentials", MagicMock(side_effect=error))
    retry = MagicMock(side_effect=RuntimeError("retry scheduled"))
    monkeypatch.setattr(cleanup_plugin_credentials_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry scheduled"):
        cleanup_plugin_credentials_task.run("tenant-1", "org/myplugin")

    retry.assert_called_once_with(exc=error, countdown=60)


def test_cleanup_plugin_credentials_task_does_not_uninstall_plugin(monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.plugin_credential_cleanup_task as task_module
    from tasks.plugin_credential_cleanup_task import cleanup_plugin_credentials_task

    monkeypatch.setattr(task_module.PluginService, "_cleanup_plugin_credentials", MagicMock())

    with patch("core.plugin.plugin_service.PluginInstaller") as installer:
        cleanup_plugin_credentials_task.run("tenant-1", "org/myplugin")

    installer.assert_not_called()
