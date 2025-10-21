import json
from enum import StrEnum
from json import JSONDecodeError

from extensions.ext_redis import redis_client


class ProviderCredentialsCacheType(StrEnum):
    PROVIDER = "provider"
    MODEL = "provider_model"
    LOAD_BALANCING_MODEL = "load_balancing_provider_model"


class ProviderCredentialsCache:
    def __init__(self, tenant_id: str, identity_id: str, cache_type: ProviderCredentialsCacheType):
        self.cache_key = f"{cache_type}_credentials:tenant_id:{tenant_id}:id:{identity_id}"

    def get(self) -> dict | None:
        """
        Get cached model provider credentials.

        :return:
        """
        cached_provider_credentials = redis_client.get(self.cache_key)
        if cached_provider_credentials:
            try:
                cached_provider_credentials = cached_provider_credentials.decode("utf-8")
                cached_provider_credentials = json.loads(cached_provider_credentials)
            except JSONDecodeError:
                return None

            return dict(cached_provider_credentials)
        else:
            return None

    def set(self, credentials: dict):
        """
        Cache model provider credentials.

        :param credentials: provider credentials
        :return:
        """
        redis_client.setex(self.cache_key, 86400, json.dumps(credentials))

    def delete(self):
        """
        Delete cached model provider credentials.

        :return:
        """
        redis_client.delete(self.cache_key)
