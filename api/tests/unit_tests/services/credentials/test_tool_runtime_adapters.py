"""OAuth runtime decryption always uses the persisted token snapshot."""

from dataclasses import replace

import pytest

from core.helper.provider_cache import ToolProviderCredentialsCache
from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin
from core.tools.plugin_tool.provider import PluginToolProviderController
from services.credentials.tool_runtime import ToolRuntimeCredential
from services.credentials.tool_runtime_adapters import ProviderToolCredentialRuntime


def test_oauth_decryption_does_not_read_or_repopulate_the_credential_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    def stale_cache(_self: ToolProviderCredentialsCache) -> dict[str, str]:
        return {"token": "cached-expired-token"}

    def reject_cache_write(_self: ToolProviderCredentialsCache, _config: dict[str, object]) -> None:
        raise AssertionError("OAuth snapshots must not repopulate the cache")

    monkeypatch.setattr(ToolProviderCredentialsCache, "get", stale_cache)
    monkeypatch.setattr(ToolProviderCredentialsCache, "set", reject_cache_write)
    controller = PluginToolProviderController(
        entity=ToolProviderEntityWithPlugin.model_validate(
            {
                "identity": {
                    "author": "org",
                    "name": "provider",
                    "description": {"en_US": "Provider"},
                    "icon": "icon.svg",
                    "label": {"en_US": "Provider"},
                },
                "credentials_schema": [],
                "oauth_schema": {"credentials_schema": [], "client_schema": []},
            }
        ),
        plugin_id="org/plugin",
        plugin_unique_identifier="org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tenant_id="workspace",
    )
    runtime = ProviderToolCredentialRuntime(
        controller=controller, provider_id="org/plugin/provider", console_api_url=""
    )
    old = ToolRuntimeCredential(
        "credential", "workspace", "owner", "org/plugin/provider", "oauth2", '{"token":"old"}', 1
    )
    latest = replace(old, encrypted_credentials='{"token":"new"}', expires_at=3600)
    assert runtime.decrypt(old) == {"token": "old"}
    assert runtime.decrypt(latest) == {"token": "new"}
    assert runtime.decrypt(replace(latest, credential_type="api-key")) == {"token": "cached-expired-token"}
