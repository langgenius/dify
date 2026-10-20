import logging
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import MagicMock, call, patch

import pytest
from celery.exceptions import Retry

from core.plugin.entities.plugin_daemon import PluginInstallTaskStartResponse
from tests.unit_tests.config_override import apply_config_overrides


class _TaskWithQueue(Protocol):
    queue: str


def test_install_default_plugins_task_uses_plugin_queue() -> None:
    from tasks.install_default_plugins_task import install_default_plugins_task

    assert cast(_TaskWithQueue, install_default_plugins_task).queue == "plugin"


def test_configure_default_models_task_uses_plugin_queue() -> None:
    from tasks.install_default_plugins_task import configure_default_models_task

    assert cast(_TaskWithQueue, configure_default_models_task).queue == "plugin"


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

    with patch.object(task_module.configure_default_models_task, "delay") as configure:
        install_default_plugins_task.run("tenant-1", plugin_ids)

    fetch.assert_called_once_with(plugin_ids)
    install.assert_called_once_with("tenant-1", plugin_identifiers)
    configure.assert_called_once_with("tenant-1", None)


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

    with (
        caplog.at_level(logging.WARNING, logger=task_module.logger.name),
        patch.object(task_module.configure_default_models_task, "delay"),
    ):
        install_default_plugins_task.run("tenant-1", ["langgenius/openai", "missing/plugin"])

    install.assert_called_once_with("tenant-1", ["langgenius/openai:1.0.0@aaa"])
    assert "Default plugins not found in marketplace: missing/plugin" in caplog.text


@pytest.mark.parametrize("configured_models", ["", "llm:provider:model"])
@pytest.mark.parametrize("all_installed", [False, True])
def test_install_default_plugins_task_queues_model_configuration_after_daemon_install(
    monkeypatch: pytest.MonkeyPatch,
    configured_models: str,
    all_installed: bool,
) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import install_default_plugins_task

    plugin_id = "langgenius/openai"
    plugin_identifier = "langgenius/openai:1.0.0@aaa"
    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_MODELS=configured_models)
    monkeypatch.setattr(
        task_module.marketplace,
        "batch_fetch_plugin_manifests",
        MagicMock(return_value=[SimpleNamespace(plugin_id=plugin_id, latest_package_identifier=plugin_identifier)]),
    )
    with (
        patch.object(
            task_module.PluginService,
            "install_from_marketplace_pkg",
            return_value=PluginInstallTaskStartResponse(all_installed=all_installed, task_id="install-task-1"),
        ),
        patch.object(task_module.configure_default_models_task, "delay") as delay,
    ):
        install_default_plugins_task.run("tenant-1", [plugin_id])

    delay.assert_called_once_with("tenant-1", None if all_installed else "install-task-1")


@pytest.mark.parametrize("configured_models", ["", "llm:provider:model"])
def test_configure_default_models_task_retries_while_plugins_are_installing(
    monkeypatch: pytest.MonkeyPatch,
    configured_models: str,
) -> None:
    import tasks.install_default_plugins_task as task_module
    from tasks.install_default_plugins_task import configure_default_models_task

    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_MODELS=configured_models)
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

    apply_config_overrides(
        monkeypatch,
        NEW_USER_DEFAULT_MODELS=(
            "llm:langgenius/openai/openai:gpt-4o-mini,text-embedding:langgenius/openai/openai:text-embedding-3-small"
        ),
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
    model_provider_service.initialize_default_llm.assert_not_called()


@pytest.mark.parametrize("configured_models", ["", "text-embedding:provider:embedding-model"])
def test_configure_default_models_task_initializes_llm_without_an_explicit_llm(
    monkeypatch: pytest.MonkeyPatch, configured_models: str
) -> None:
    import tasks.install_default_plugins_task as task_module

    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_MODELS=configured_models)
    with (
        patch.object(task_module.ModelProviderService, "initialize_default_llm") as initialize,
        patch.object(task_module.ModelProviderService, "update_default_model_of_model_type") as update,
    ):
        task_module.configure_default_models_task.run("tenant-1", None)

    initialize.assert_called_once_with("tenant-1")
    if configured_models:
        update.assert_called_once_with(
            tenant_id="tenant-1", model_type="text-embedding", provider="provider", model="embedding-model"
        )
    else:
        update.assert_not_called()


def test_configure_default_models_task_reports_initialization_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.install_default_plugins_task as task_module

    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_MODELS="")
    with patch.object(
        task_module.ModelProviderService, "initialize_default_llm", side_effect=RuntimeError("unavailable")
    ):
        with pytest.raises(RuntimeError, match="Failed to initialize defaults for tenant tenant-1; model types: llm"):
            task_module.configure_default_models_task.run("tenant-1", None)
