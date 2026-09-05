import logging
from unittest.mock import MagicMock

import pytest

from events.event_handlers import queue_tokener_bootstrap_when_tenant_created as handler_module
from models.account import Tenant
from tests.unit_tests.config_override import apply_config_overrides


def _tenant() -> Tenant:
    tenant = Tenant(name="Tokener tenant")
    tenant.id = "tenant-1"
    return tenant


def test_handle_skips_when_tokener_bootstrap_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False)
    monkeypatch.setattr(handler_module.bootstrap_tokener_tenant_task, "delay", delay)

    handler_module.handle(_tenant())

    delay.assert_not_called()


def test_handle_queues_tokener_bootstrap(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    monkeypatch.setattr(handler_module.bootstrap_tokener_tenant_task, "delay", delay)

    handler_module.handle(_tenant())

    delay.assert_called_once_with("tenant-1")


def test_handle_keeps_registration_successful_when_broker_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    monkeypatch.setattr(
        handler_module.bootstrap_tokener_tenant_task,
        "delay",
        MagicMock(side_effect=ConnectionError("broker unavailable")),
    )

    with caplog.at_level(logging.ERROR, logger=handler_module.logger.name):
        handler_module.handle(_tenant())

    assert "Failed to queue Tokener bootstrap for tenant tenant-1" in caplog.text
    assert "broker unavailable" not in caplog.text
