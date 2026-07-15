import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def test_install_default_plugins_task_uses_plugin_queue() -> None:
    from tasks.install_default_plugins_task import install_default_plugins_task

    assert install_default_plugins_task.queue == "plugin"


def test_install_default_plugins_task_installs_latest_identifiers(monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import install_default_plugins_task

    plugin_ids = ["langgenius/openai", "langgenius/gemini"]
    plugin_identifiers = ["langgenius/openai:1.0.0@aaa", "langgenius/gemini:0.9.1@bbb"]
    fetch = MagicMock(
        return_value=[
            SimpleNamespace(plugin_id=plugin_ids[1], latest_package_identifier=plugin_identifiers[1]),
            SimpleNamespace(plugin_id=plugin_ids[0], latest_package_identifier=plugin_identifiers[0]),
        ]
    )
    install = MagicMock()
    monkeypatch.setattr(task_module.marketplace, "batch_fetch_plugin_manifests", fetch)
    monkeypatch.setattr(task_module.PluginService, "install_from_marketplace_pkg", install)

    install_default_plugins_task.run("tenant-1", plugin_ids)

    fetch.assert_called_once_with(plugin_ids)
    install.assert_called_once_with("tenant-1", plugin_identifiers)


def test_install_default_plugins_task_skips_missing_plugins(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import install_default_plugins_task

    fetch = MagicMock(
        return_value=[
            SimpleNamespace(plugin_id="langgenius/openai", latest_package_identifier="langgenius/openai:1.0.0@aaa")
        ]
    )
    install = MagicMock()
    monkeypatch.setattr(task_module.marketplace, "batch_fetch_plugin_manifests", fetch)
    monkeypatch.setattr(task_module.PluginService, "install_from_marketplace_pkg", install)

    with caplog.at_level(logging.WARNING, logger=task_module.logger.name):
        install_default_plugins_task.run("tenant-1", ["langgenius/openai", "missing/plugin"])

    install.assert_called_once_with("tenant-1", ["langgenius/openai:1.0.0@aaa"])
    assert "Default plugins not found in marketplace: missing/plugin" in caplog.text
