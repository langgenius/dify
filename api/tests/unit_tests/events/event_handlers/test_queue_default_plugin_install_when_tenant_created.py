import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from events.event_handlers import queue_default_plugin_install_when_tenant_created as handler_module


def test_handle_skips_when_no_default_plugins_are_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    monkeypatch.setattr(handler_module.dify_config, "NEW_USER_DEFAULT_PLUGIN_IDS", "")
    monkeypatch.setattr(handler_module.install_default_plugins_task, "delay", delay)

    handler_module.handle(SimpleNamespace(id="tenant-1"))

    delay.assert_not_called()


def test_handle_queues_configured_plugins(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    plugins = [
        "langgenius/openai",
        "langgenius/gemini",
    ]
    monkeypatch.setattr(handler_module.dify_config, "NEW_USER_DEFAULT_PLUGIN_IDS", ",".join(plugins))
    monkeypatch.setattr(handler_module.install_default_plugins_task, "delay", delay)

    handler_module.handle(SimpleNamespace(id="tenant-1"))

    delay.assert_called_once_with("tenant-1", plugins)


def test_handle_does_not_fail_tenant_creation_when_queue_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        handler_module.dify_config,
        "NEW_USER_DEFAULT_PLUGIN_IDS",
        "langgenius/openai",
    )
    monkeypatch.setattr(
        handler_module.install_default_plugins_task,
        "delay",
        MagicMock(side_effect=ConnectionError("broker unavailable")),
    )

    with caplog.at_level(logging.ERROR, logger=handler_module.logger.name):
        handler_module.handle(SimpleNamespace(id="tenant-1"))

    assert "Failed to queue default plugin installation for tenant tenant-1" in caplog.text
