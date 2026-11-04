import json
from abc import ABC, abstractmethod
from json import JSONDecodeError
from typing import Any, override

from extensions.ext_redis import redis_client


class ProviderCredentialsCache(ABC):
    """Base class for provider credentials cache"""

    def __init__(self, **kwargs: Any) -> None:
        self.cache_key = self._generate_cache_key(**kwargs)

    @abstractmethod
    def _generate_cache_key(self, **kwargs: Any) -> str:
        """Generate cache key based on subclass implementation"""
        pass

    def get(self) -> dict[str, Any] | None:
        """Get cached provider credentials"""
        cached_credentials = redis_client.get(self.cache_key)
        if cached_credentials:
            try:
                cached_credentials = cached_credentials.decode("utf-8")
                return dict(json.loads(cached_credentials))
            except (JSONDecodeError, UnicodeDecodeError):
                return None
        return None

    def set(self, config: dict[str, Any]) -> None:
        """Cache provider credentials"""
        redis_client.setex(self.cache_key, 86400, json.dumps(config))

    def delete(self) -> None:
        """Delete cached provider credentials"""
        redis_client.delete(self.cache_key)


class SingletonProviderCredentialsCache(ProviderCredentialsCache):
    """Cache for tool single provider credentials"""

    def __init__(self, tenant_id: str, provider_type: str, provider_identity: str):
        super().__init__(
            tenant_id=tenant_id,
            provider_type=provider_type,
            provider_identity=provider_identity,
        )

    @override
    def _generate_cache_key(self, **kwargs: Any) -> str:
        tenant_id = kwargs["tenant_id"]
        provider_type = kwargs["provider_type"]
        identity_name = kwargs["provider_identity"]
        identity_id = f"{provider_type}.{identity_name}"
        return f"{provider_type}_credentials:tenant_id:{tenant_id}:id:{identity_id}"


class ToolProviderCredentialsCache(ProviderCredentialsCache):
    """Cache for tool provider credentials"""

    def __init__(self, tenant_id: str, provider: str, credential_id: str, *, fingerprint: str | None = None):
        """A fingerprint selects one snapshot-checked entry; None retains the legacy cache."""
        super().__init__(tenant_id=tenant_id, provider=provider, credential_id=credential_id)
        self._legacy_cache_key = self.cache_key
        self._fingerprint = fingerprint
        if fingerprint is not None:
            self.cache_key += ":snapshot"

    @override
    def get(self) -> dict[str, Any] | None:
        cached = super().get()
        if self._fingerprint is None or cached is None:
            return cached
        credentials = cached.get("credentials")
        if cached.get("fingerprint") == self._fingerprint and isinstance(credentials, dict):
            return credentials
        return None

    @override
    def set(self, config: dict[str, Any]) -> None:
        if self._fingerprint is not None:
            config = {"fingerprint": self._fingerprint, "credentials": config}
        super().set(config)

    @override
    def delete(self) -> None:
        # Separate commands also work when Redis Cluster puts the entries in different slots.
        redis_client.delete(self._legacy_cache_key)
        redis_client.delete(f"{self._legacy_cache_key}:snapshot")

    @override
    def _generate_cache_key(self, **kwargs: Any) -> str:
        tenant_id = kwargs["tenant_id"]
        provider = kwargs["provider"]
        credential_id = kwargs["credential_id"]
        return f"tool_credentials:tenant_id:{tenant_id}:provider:{provider}:credential_id:{credential_id}"


class NoOpProviderCredentialCache:
    """No-op provider credential cache"""

    def get(self) -> dict[str, Any] | None:
        """Get cached provider credentials"""
        return None

    def set(self, config: dict[str, Any]) -> None:
        """Cache provider credentials"""
        pass

    def delete(self) -> None:
        """Delete cached provider credentials"""
        pass
