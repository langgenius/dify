import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest
from celery.exceptions import Retry


def test_install_default_plugins_task_uses_plugin_queue() -> None:
    from tasks.install_default_plugins_task import install_default_plugins_task

    assert install_default_plugins_task.queue == "plugin"


def test_configure_default_models_task_uses_plugin_queue() -> None:
    from tasks.install_default_plugins_task import configure_default_models_task

    assert configure_default_models_task.queue == "plugin"


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


def test_install_default_plugins_task_queues_model_configuration_after_daemon_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import install_default_plugins_task

    plugin_id = "langgenius/openai"
    plugin_identifier = "langgenius/openai:1.0.0@aaa"
    monkeypatch.setattr(task_module.dify_config, "NEW_USER_DEFAULT_MODELS", "llm:provider:model")
    monkeypatch.setattr(
        task_module.marketplace,
        "batch_fetch_plugin_manifests",
        MagicMock(return_value=[SimpleNamespace(plugin_id=plugin_id, latest_package_identifier=plugin_identifier)]),
    )
    monkeypatch.setattr(
        task_module.PluginService,
        "install_from_marketplace_pkg",
        MagicMock(return_value=SimpleNamespace(all_installed=False, task_id="install-task-1")),
    )
    delay = MagicMock()
    monkeypatch.setattr(task_module.configure_default_models_task, "delay", delay)

    install_default_plugins_task.run("tenant-1", [plugin_id])

    delay.assert_called_once_with("tenant-1", "install-task-1")


def test_configure_default_models_task_retries_while_plugins_are_installing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import configure_default_models_task

    monkeypatch.setattr(task_module.dify_config, "NEW_USER_DEFAULT_MODELS", "llm:provider:model")
    monkeypatch.setattr(
        task_module.PluginService,
        "fetch_install_task",
        MagicMock(return_value=SimpleNamespace(status=task_module.PluginInstallTaskStatus.Running)),
    )
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(configure_default_models_task, "retry", retry)

    with pytest.raises(Retry):
        configure_default_models_task.run("tenant-1", "install-task-1")

    retry.assert_called_once_with()


def test_configure_default_models_task_sets_each_explicit_model(monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import configure_default_models_task

    monkeypatch.setattr(
        task_module.dify_config,
        "NEW_USER_DEFAULT_MODELS",
        ("llm:langgenius/openai/openai:gpt-4o-mini,text-embedding:langgenius/openai/openai:text-embedding-3-small"),
    )
    fetch_install_task = MagicMock(
        return_value=SimpleNamespace(
            status=task_module.PluginInstallTaskStatus.Success,
            plugins=[],
        )
    )
    monkeypatch.setattr(task_module.PluginService, "fetch_install_task", fetch_install_task)
    model_provider_service = MagicMock()
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=model_provider_service))

    configure_default_models_task.run("tenant-1", "install-task-1")

    fetch_install_task.assert_called_once_with("tenant-1", "install-task-1")
    assert model_provider_service.update_default_model_of_model_type.call_args_list == [
        call(
            tenant_id="tenant-1",
            model_type="llm",
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
        ),
        call(
            tenant_id="tenant-1",
            model_type="text-embedding",
            provider="langgenius/openai/openai",
            model="text-embedding-3-small",
        ),
    ]
