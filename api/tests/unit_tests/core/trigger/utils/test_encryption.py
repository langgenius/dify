"""Tests for core.trigger.utils.encryption — masking logic and cache key generation."""

from __future__ import annotations

from core.entities.provider_entities import ProviderConfig
from core.tools.entities.common_entities import I18nObject
from core.trigger.utils.encryption import (
    TriggerProviderCredentialsCache,
    TriggerProviderOAuthClientParamsCache,
    TriggerProviderPropertiesCache,
    masked_credentials,
)


def _make_schema(name: str, field_type: str = "secret-input") -> ProviderConfig:
    return ProviderConfig(
        name=name,
        label=I18nObject(en_US=name, zh_Hans=name),
        type=field_type,
    )


class TestMaskedCredentials:
    def test_short_secret_fully_masked(self):
        schema = [_make_schema("key", "secret-input")]
        result = masked_credentials(schema, {"key": "ab"})
        assert result["key"] == "**"

    def test_long_secret_partially_masked(self):
        schema = [_make_schema("key", "secret-input")]
        result = masked_credentials(schema, {"key": "abcdef"})
        assert result["key"].startswith("ab")
        assert result["key"].endswith("ef")
        assert "**" in result["key"]

    def test_non_secret_field_unchanged(self):
        schema = [_make_schema("host", "text-input")]
        result = masked_credentials(schema, {"host": "example.com"})
        assert result["host"] == "example.com"

    def test_unknown_key_passes_through(self):
        result = masked_credentials([], {"unknown": "value"})
        assert result["unknown"] == "value"


class TestCacheKeyGeneration:
    def test_credentials_cache_key_contains_ids(self):
        cache = TriggerProviderCredentialsCache(tenant_id="t1", provider_id="p1", credential_id="c1")
        assert "t1" in cache.cache_key
        assert "p1" in cache.cache_key
        assert "c1" in cache.cache_key

    def test_oauth_client_cache_key_contains_ids(self):
        cache = TriggerProviderOAuthClientParamsCache(tenant_id="t1", provider_id="p1")
        assert "t1" in cache.cache_key
        assert "p1" in cache.cache_key

    def test_properties_cache_key_contains_ids(self):
        cache = TriggerProviderPropertiesCache(tenant_id="t1", provider_id="p1", subscription_id="s1")
        assert "t1" in cache.cache_key
        assert "p1" in cache.cache_key
        assert "s1" in cache.cache_key
