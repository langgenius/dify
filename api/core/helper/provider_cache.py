import json
from abc import ABC, abstractmethod
from json import JSONDecodeError
from typing import Any, Optional

from extensions.ext_redis import redis_client


class ProviderCredentialsCache(ABC):
    """Base class for provider credentials cache"""

    def __init__(self, **kwargs):
        self.cache_key = self._generate_cache_key(**kwargs)

    @abstractmethod
    def _generate_cache_key(self, **kwargs) -> str:
        """Generate cache key based on subclass implementation"""
        pass

    def get(self) -> Optional[dict]:
        """Get cached provider credentials"""
        cached_credentials = redis_client.get(self.cache_key)
        if cached_credentials:
            try:
                cached_credentials = cached_credentials.decode("utf-8")
                return dict(json.loads(cached_credentials))
            except JSONDecodeError:
                return None
        return None

    def set(self, config: dict[str, Any]) -> None:
        """Cache provider credentials"""
        redis_client.setex(self.cache_key, 86400, json.dumps(config))

    def delete(self) -> None:
        """Delete cached provider credentials"""
        redis_client.delete(self.cache_key)


class GenericProviderCredentialsCache(ProviderCredentialsCache):
    """Cache for generic provider credentials"""

    def __init__(self, tenant_id: str, identity_id: str):
        super().__init__(tenant_id=tenant_id, identity_id=identity_id)

    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        identity_id = kwargs["identity_id"]
        return f"generic_provider_credentials:tenant_id:{tenant_id}:id:{identity_id}"

class ToolProviderCredentialsCache(ProviderCredentialsCache):
    """Cache for tool provider credentials"""

    def __init__(self, tenant_id: str, provider: str, credential_id: str):
        super().__init__(tenant_id=tenant_id, provider=provider, credential_id=credential_id)

    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        provider = kwargs["provider"]
        credential_id = kwargs["credential_id"]
        return f"provider_credentials:tenant_id:{tenant_id}:provider:{provider}:credential_id:{credential_id}"


class NoOpProviderCredentialCache:
    """No-op provider credential cache"""

    def get(self) -> Optional[dict]:
        """Get cached provider credentials"""
        return None

    def set(self, config: dict[str, Any]) -> None:
        """Cache provider credentials"""
        pass

    def delete(self) -> None:
        """Delete cached provider credentials"""
        pass
