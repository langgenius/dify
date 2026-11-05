"""OAuth cache entries are bounded and checked against the persisted snapshot."""

import json
from dataclasses import replace

import pytest

from core.helper.provider_cache import ToolProviderCredentialsCache
from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin
from core.tools.plugin_tool.provider import PluginToolProviderController
from services.credentials.tool_runtime import ToolRuntimeCredential
from services.credentials.tool_runtime_adapters import ProviderToolCredentialRuntime


class CredentialCacheRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.ttls: dict[str, int] = {}

    def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.values[key] = value.encode()
        self.ttls[key] = ttl

    def delete(self, key: str) -> None:
        self.values.pop(key, None)
        self.ttls.pop(key, None)


def _controller() -> PluginToolProviderController:
    schemas = [
        {"name": name, "type": "secret-input", "label": {"en_US": name}} for name in ("access_token", "refresh_token")
    ]
    return PluginToolProviderController(
        entity=ToolProviderEntityWithPlugin.model_validate(
            {
                "identity": {
                    "author": "org",
                    "name": "provider",
                    "description": {"en_US": "Provider"},
                    "icon": "icon.svg",
                    "label": {"en_US": "Provider"},
                },
                "credentials_schema": schemas,
                "oauth_schema": {"credentials_schema": schemas, "client_schema": []},
            }
        ),
        plugin_id="org/plugin",
        plugin_unique_identifier="org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tenant_id="workspace",
    )


@pytest.mark.parametrize("invalidate_from", ["runtime", "management"])
def test_oauth_cache_reuses_only_matching_snapshots_and_invalidates_both_entries(
    monkeypatch: pytest.MonkeyPatch, invalidate_from: str
) -> None:
    redis = CredentialCacheRedis()
    monkeypatch.setattr("core.helper.provider_cache.redis_client", redis)
    decryptions: list[str] = []

    def decrypt(workspace_id: str, value: str) -> str:
        assert workspace_id == "workspace"
        decryptions.append(value)
        return f"plain:{value}"

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", decrypt)
    runtime = ProviderToolCredentialRuntime(
        controller=_controller(), provider_id="org/plugin/provider", console_api_url=""
    )
    old_credentials = {"access_token": "access-old", "refresh_token": "refresh-old"}
    old = ToolRuntimeCredential(
        "credential", "workspace", "owner", "org/plugin/provider", "oauth2", json.dumps(old_credentials), -1
    )
    legacy = ToolProviderCredentialsCache(tenant_id=old.workspace_id, provider=old.provider, credential_id=old.id)
    legacy.set({"token": "stale-legacy-token"})
    old_plaintext = {name: f"plain:{value}" for name, value in old_credentials.items()}
    for _ in range(10):
        assert runtime.decrypt(old) == old_plaintext
    assert len(decryptions) == 2

    new_credentials = {"access_token": "access-new", "refresh_token": "refresh-new"}
    latest = replace(old, encrypted_credentials=json.dumps(new_credentials))
    new_plaintext = {name: f"plain:{value}" for name, value in new_credentials.items()}
    assert runtime.decrypt(latest) == new_plaintext
    assert len(decryptions) == 4

    # A reader of the old snapshot may finish its cache write after a refresh.
    runtime._cache(old).set(old_plaintext)
    assert runtime.decrypt(latest) == new_plaintext
    assert len(decryptions) == 6
    assert runtime.decrypt(latest) == new_plaintext
    assert len(decryptions) == 6
    assert len(redis.values) == 2
    assert set(redis.ttls.values()) == {86400}
    assert runtime.decrypt(replace(latest, credential_type="api-key")) == {"token": "stale-legacy-token"}

    if invalidate_from == "runtime":
        runtime.invalidate(latest)
    else:
        legacy.delete()
    assert redis.values == {}
    assert redis.ttls == {}


def test_oauth_cache_ignores_a_malformed_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = CredentialCacheRedis()
    monkeypatch.setattr("core.helper.provider_cache.redis_client", redis)
    cache = ToolProviderCredentialsCache(
        tenant_id="workspace", provider="provider", credential_id="credential", fingerprint="current"
    )
    redis.setex(cache.cache_key, 86400, '{"fingerprint":"current","credentials":[]}')
    assert cache.get() is None
