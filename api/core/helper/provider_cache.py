import json
from abc import ABC, abstractmethod
from json import JSONDecodeError
from typing import Any

from extensions.ext_redis import redis_client


class ProviderCredentialsCache(ABC):
    """Base class for provider credentials cache"""

    def __init__(self, **kwargs):
        self.cache_key = self._generate_cache_key(**kwargs)

    @abstractmethod
    def _generate_cache_key(self, **kwargs) -> str:
        """Generate cache key based on subclass implementation"""
        pass

    def get(self) -> dict | None:
        """Get cached provider credentials"""
        cached_credentials = redis_client.get(self.cache_key)
        if cached_credentials:
            try:
                cached_credentials = cached_credentials.decode("utf-8")
                return dict(json.loads(cached_credentials))
            except JSONDecodeError:
                return None
        return None

    def set(self, config: dict[str, Any]):
        """Cache provider credentials"""
        redis_client.setex(self.cache_key, 86400, json.dumps(config))

    def delete(self):
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

    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        provider_type = kwargs["provider_type"]
        identity_name = kwargs["provider_identity"]
        identity_id = f"{provider_type}.{identity_name}"
        return f"{provider_type}_credentials:tenant_id:{tenant_id}:id:{identity_id}"


class ToolProviderCredentialsCache(ProviderCredentialsCache):
    """Cache for tool provider credentials"""

    def __init__(self, tenant_id: str, provider: str, credential_id: str):
        super().__init__(tenant_id=tenant_id, provider=provider, credential_id=credential_id)

    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        provider = kwargs["provider"]
        credential_id = kwargs["credential_id"]
        return f"tool_credentials:tenant_id:{tenant_id}:provider:{provider}:credential_id:{credential_id}"


class NoOpProviderCredentialCache:
    """No-op provider credential cache"""

    def get(self) -> dict | None:
        """Get cached provider credentials"""
        return None

    def set(self, config: dict[str, Any]):
        """Cache provider credentials"""
        pass

    def delete(self):
        """Delete cached provider credentials"""
        pass
