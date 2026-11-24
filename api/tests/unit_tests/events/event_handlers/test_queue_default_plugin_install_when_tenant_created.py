import logging
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from configs.feature import TokenerSignupBillingCandidate
from events.event_handlers import queue_default_plugin_install_when_tenant_created as handler_module
from models.account import Account, Tenant
from models.tokener import AccountTokenerSignupIntent
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_tenant


def _tenant() -> Tenant:
    return make_tenant(name="Test tenant")


def test_handle_skips_when_no_default_plugins_are_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_PLUGIN_IDS="")
    monkeypatch.setattr(handler_module.install_default_plugins_task, "delay", delay)

    handler_module.handle(_tenant())

    delay.assert_not_called()


def test_handle_queues_configured_plugins(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    plugins = [
        "langgenius/openai",
        "langgenius/gemini",
    ]
    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_PLUGIN_IDS=",".join(plugins))
    monkeypatch.setattr(handler_module.install_default_plugins_task, "delay", delay)

    handler_module.handle(_tenant())

    delay.assert_called_once_with("tenant-1", plugins)


@pytest.mark.parametrize(
    "billing_base", [TokenerSignupBillingCandidate.SHARED_STAGING.value, "https://invalid.example"]
)
def test_handle_queues_openai_only_for_a_trusted_staging_signup(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, billing_base: str
) -> None:
    tenant = Tenant(name="Shared staging tenant")
    owner = Account(name="Shared staging signup", email="default-stage-plugin@example.invalid")
    sqlite_session.add_all([tenant, owner])
    sqlite_session.flush()
    uid = "langgenius/tokener-staging:0.4.5-dev2026112203@" + "a" * 64
    sqlite_session.add(
        AccountTokenerSignupIntent(
            account_id=owner.id,
            consumed_tenant_id=tenant.id,
            consumed_at=datetime(2026, 11, 24),
            plugin_unique_identifier=uid,
        )
    )
    sqlite_session.commit()
    apply_config_overrides(
        monkeypatch,
        NEW_USER_DEFAULT_PLUGIN_IDS="",
        TOKENER_BILLING_API_URL=billing_base,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=TokenerSignupBillingCandidate.SHARED_STAGING,
        TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER=uid,
    )
    queued: list[tuple[str, list[str]]] = []

    def record_queued_plugins(tenant_id: str, plugins: list[str]) -> None:
        queued.append((tenant_id, plugins))

    monkeypatch.setattr(handler_module.install_default_plugins_task, "delay", record_queued_plugins)
    handler_module.handle(tenant)

    trusted_route = billing_base == TokenerSignupBillingCandidate.SHARED_STAGING.value
    assert queued == ([(tenant.id, ["langgenius/openai"])] if trusted_route else [])


def test_handle_does_not_fail_tenant_creation_when_queue_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    apply_config_overrides(monkeypatch, NEW_USER_DEFAULT_PLUGIN_IDS="langgenius/openai")
    monkeypatch.setattr(
        handler_module.install_default_plugins_task,
        "delay",
        MagicMock(side_effect=ConnectionError("broker unavailable")),
    )

    with caplog.at_level(logging.ERROR, logger=handler_module.logger.name):
        handler_module.handle(_tenant())

    assert "Failed to queue default plugin installation for tenant tenant-1" in caplog.text
