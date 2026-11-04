"""Shared discovery uses the existing deployment contract and fails closed."""

import pytest

from core.tools.entities.common_entities import I18nObject
from services.consumer_adapters import PluginConsumerConnectionProviders, SharedConsumerAppDiscovery
from services.end_user_connections.errors import ConnectionCheckUnavailableError, ConnectionConfigurationError
from services.enterprise.enterprise_service import EnterpriseService
from services.errors.enterprise import EnterpriseAPIError
from services.webapp_access_query_service import WebAppAccessUnavailableError
from tests.helpers.end_user_api_key import PROVIDER, ScriptedAuth, TestProviders, plugin_provider


def test_provider_metadata_preserves_localized_declarations_and_public_icons() -> None:
    controller = plugin_provider("tenant")
    controller.entity.identity.label = I18nObject(en_US="Calendar", ja_JP="Calendar JP")
    controller.entity.identity.description = I18nObject(en_US="Manage events", ja_JP="Manage events JP")
    controller.entity.identity.icon_dark = "dark.svg"
    gateway = PluginConsumerConnectionProviders(providers=TestProviders(ScriptedAuth(), controller))
    metadata = gateway.metadata(tenant_id="tenant", provider=PROVIDER)
    assert metadata is not None
    assert metadata.label["ja_JP"] == "Calendar JP"
    assert metadata.description["ja_JP"] == "Manage events JP"
    assert metadata.icon is not None
    assert "filename=icon.svg" in metadata.icon
    assert metadata.icon_dark is not None
    assert "filename=dark.svg" in metadata.icon_dark
    assert set(metadata.model_dump()) == {"label", "description", "icon", "icon_dark"}
    assert gateway.metadata(tenant_id="foreign", provider=PROVIDER) is None


@pytest.mark.parametrize("error", [ConnectionCheckUnavailableError, ConnectionConfigurationError])
def test_provider_metadata_outages_allow_resource_discovery(
    monkeypatch: pytest.MonkeyPatch, error: type[Exception]
) -> None:
    providers = TestProviders(ScriptedAuth(), plugin_provider("tenant"))

    def unavailable(*_args: object) -> None:
        raise error()

    monkeypatch.setattr(providers, "provider", unavailable)
    gateway = PluginConsumerConnectionProviders(providers=providers)
    assert gateway.metadata(tenant_id="tenant", provider=PROVIDER) is None


def test_shared_discovery_consumes_all_pages_and_deduplicates(monkeypatch: pytest.MonkeyPatch) -> None:
    def list_apps(*, page: int, limit: int) -> dict[str, object]:
        assert limit == 100
        if page == 1:
            return {"data": [{"appId": "app-1"}], "hasMore": True}
        assert page == 2
        return {"data": [{"appId": "app-1"}, {"appId": "app-2"}], "hasMore": False}

    monkeypatch.setattr(EnterpriseService.WebAppAuth, "list_externally_accessible_apps", list_apps)
    assert SharedConsumerAppDiscovery(enabled=True)() == ("app-1", "app-2")
    assert SharedConsumerAppDiscovery(enabled=False)() == ()


@pytest.mark.parametrize("result", [{}, {"data": [], "hasMore": True}, {"data": [], "hasMore": "false"}])
def test_invalid_shared_discovery_response_is_unavailable(
    monkeypatch: pytest.MonkeyPatch, result: dict[str, object]
) -> None:
    monkeypatch.setattr(EnterpriseService.WebAppAuth, "list_externally_accessible_apps", lambda **_kwargs: result)
    with pytest.raises(WebAppAccessUnavailableError):
        SharedConsumerAppDiscovery(enabled=True)()


def test_discovery_outage_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable(**_kwargs) -> dict[str, object]:
        raise EnterpriseAPIError("Unavailable", status_code=503)

    monkeypatch.setattr(EnterpriseService.WebAppAuth, "list_externally_accessible_apps", unavailable)
    with pytest.raises(WebAppAccessUnavailableError):
        SharedConsumerAppDiscovery(enabled=True)()
