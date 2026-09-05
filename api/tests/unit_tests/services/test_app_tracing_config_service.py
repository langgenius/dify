from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.app_tracing_config_service import (
    AppTracingConfigAlreadyExistsError,
    AppTracingConfigNotFoundError,
    AppTracingConfigRecord,
    AppTracingConfigService,
)


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _record(*, tracing_config: dict[str, object] | None = None) -> AppTracingConfigRecord:
    timestamp = datetime(2026, 1, 1, tzinfo=UTC)
    return AppTracingConfigRecord(
        id="config-1",
        app_id="app-1",
        tracing_provider="arize",
        tracing_config=tracing_config,
        is_active=True,
        created_at=timestamp,
        updated_at=timestamp,
    )


def test_get_scopes_lookup_to_workspace_and_presents_config() -> None:
    stored = _record(tracing_config={"api_key": "encrypted"})
    configs = MagicMock()
    configs.get.return_value = stored
    provider = MagicMock()
    provider.present_config.return_value = {"api_key": "******", "project_url": "https://example.com"}
    service = AppTracingConfigService(configs=configs, provider=provider)

    result = service.get(_context(), "app-1", "arize")

    assert result == _record(tracing_config={"api_key": "******", "project_url": "https://example.com"})
    assert stored.tracing_config == {"api_key": "encrypted"}
    provider.validate_provider.assert_called_once_with("arize")
    configs.get.assert_called_once_with(
        workspace_id="workspace-1",
        app_id="app-1",
        tracing_provider="arize",
    )
    provider.present_config.assert_called_once_with(
        workspace_id="workspace-1",
        tracing_provider="arize",
        tracing_config={"api_key": "encrypted"},
    )


def test_get_returns_none_without_calling_provider_for_missing_config() -> None:
    configs = MagicMock()
    configs.get.return_value = None
    provider = MagicMock()
    service = AppTracingConfigService(configs=configs, provider=provider)

    assert service.get(_context(), "app-1", "arize") is None

    provider.validate_provider.assert_called_once_with("arize")
    provider.present_config.assert_not_called()


def test_get_validates_provider_before_store_lookup() -> None:
    events: list[str] = []
    configs = MagicMock()
    configs.get.side_effect = lambda **_: events.append("store.get")
    provider = MagicMock()
    provider.validate_provider.side_effect = lambda *_: events.append("provider.validate")
    service = AppTracingConfigService(configs=configs, provider=provider)

    assert service.get(_context(), "app-1", "arize") is None

    assert events == ["provider.validate", "store.get"]


def test_create_calls_provider_between_separate_store_operations() -> None:
    events: list[str] = []
    configs = MagicMock()

    def get_config(**_: object) -> None:
        events.append("store.get:closed")

    def create_config(**_: object) -> bool:
        events.append("store.create:closed")
        return True

    configs.get.side_effect = get_config
    configs.create.side_effect = create_config
    provider = MagicMock()

    def prepare_config(**_: object) -> dict[str, str]:
        events.append("provider.prepare")
        return {"api_key": "encrypted"}

    provider.prepare_new_config.side_effect = prepare_config
    service = AppTracingConfigService(configs=configs, provider=provider)

    service.create(_context(), "app-1", "arize", {"api_key": "plain"})

    assert events == ["store.get:closed", "provider.prepare", "store.create:closed"]
    provider.prepare_new_config.assert_called_once_with(
        workspace_id="workspace-1",
        tracing_provider="arize",
        tracing_config={"api_key": "plain"},
    )
    configs.create.assert_called_once_with(
        workspace_id="workspace-1",
        app_id="app-1",
        tracing_provider="arize",
        tracing_config={"api_key": "encrypted"},
    )


def test_create_reports_duplicate_before_provider_preparation() -> None:
    configs = MagicMock()
    configs.get.return_value = _record(tracing_config={"api_key": "encrypted"})
    provider = MagicMock()
    provider.prepare_new_config.return_value = {"api_key": "new-encrypted"}
    service = AppTracingConfigService(configs=configs, provider=provider)

    with pytest.raises(AppTracingConfigAlreadyExistsError, match="Trace config is exist"):
        service.create(_context(), "app-1", "arize", {"api_key": "plain"})

    provider.prepare_new_config.assert_not_called()
    configs.create.assert_not_called()


def test_create_reports_duplicate_detected_during_write() -> None:
    configs = MagicMock()
    configs.get.return_value = None
    configs.create.return_value = False
    provider = MagicMock()
    provider.prepare_new_config.return_value = {"api_key": "encrypted"}
    service = AppTracingConfigService(configs=configs, provider=provider)

    with pytest.raises(AppTracingConfigAlreadyExistsError):
        service.create(_context(), "app-1", "arize", {"api_key": "plain"})


def test_update_validates_reads_prepares_and_writes_in_order() -> None:
    events: list[str] = []
    current = _record(tracing_config={"api_key": "old-encrypted"})
    configs = MagicMock()
    configs.get.side_effect = lambda **_: events.append("store.get:closed") or current
    configs.update.side_effect = lambda **_: events.append("store.update:closed") or True
    provider = MagicMock()
    provider.validate_provider.side_effect = lambda *_: events.append("provider.validate")
    provider.prepare_updated_config.side_effect = lambda **_: (
        events.append("provider.prepare") or {"api_key": "new-encrypted"}
    )
    service = AppTracingConfigService(configs=configs, provider=provider)

    service.update(_context(), "app-1", "arize", {"api_key": "******"})

    assert events == ["store.get:closed", "provider.validate", "provider.prepare", "store.update:closed"]
    provider.prepare_updated_config.assert_called_once_with(
        workspace_id="workspace-1",
        tracing_provider="arize",
        tracing_config={"api_key": "******"},
        current_tracing_config={"api_key": "old-encrypted"},
    )
    configs.update.assert_called_once_with(
        workspace_id="workspace-1",
        app_id="app-1",
        tracing_provider="arize",
        tracing_config={"api_key": "new-encrypted"},
    )


def test_update_reports_config_missing_before_provider_preparation() -> None:
    configs = MagicMock()
    configs.get.return_value = None
    provider = MagicMock()
    service = AppTracingConfigService(configs=configs, provider=provider)

    with pytest.raises(AppTracingConfigNotFoundError, match="Trace config not exist"):
        service.update(_context(), "app-1", "arize", {})

    provider.validate_provider.assert_called_once_with("arize")
    provider.prepare_updated_config.assert_not_called()
    configs.update.assert_not_called()


def test_update_reports_config_removed_before_write() -> None:
    configs = MagicMock()
    configs.get.return_value = _record(tracing_config={"api_key": "old-encrypted"})
    configs.update.return_value = False
    provider = MagicMock()
    provider.prepare_updated_config.return_value = {"api_key": "new-encrypted"}
    service = AppTracingConfigService(configs=configs, provider=provider)

    with pytest.raises(AppTracingConfigNotFoundError):
        service.update(_context(), "app-1", "arize", {"api_key": "******"})


def test_delete_scopes_to_workspace_and_reports_missing_config() -> None:
    configs = MagicMock()
    configs.delete.return_value = False
    provider = MagicMock()
    service = AppTracingConfigService(configs=configs, provider=provider)

    with pytest.raises(AppTracingConfigNotFoundError):
        service.delete(_context(), "app-1", "arize")

    configs.delete.assert_called_once_with(
        workspace_id="workspace-1",
        app_id="app-1",
        tracing_provider="arize",
    )
    provider.validate_provider.assert_called_once_with("arize")


def test_delete_validates_provider_before_store_delete() -> None:
    events: list[str] = []
    configs = MagicMock()
    configs.delete.side_effect = lambda **_: events.append("store.delete") or True
    provider = MagicMock()
    provider.validate_provider.side_effect = lambda *_: events.append("provider.validate")
    service = AppTracingConfigService(configs=configs, provider=provider)

    service.delete(_context(), "app-1", "arize")

    assert events == ["provider.validate", "store.delete"]
