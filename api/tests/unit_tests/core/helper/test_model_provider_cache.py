import json

from pytest_mock import MockerFixture

from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType


def test_model_provider_credentials_cache_get_returns_decoded_dict(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.model_provider_cache.redis_client")
    cache = ProviderCredentialsCache(
        tenant_id="tenant",
        identity_id="identity",
        cache_type=ProviderCredentialsCacheType.PROVIDER,
    )
    payload = {"api_key": "secret"}

    redis_client_mock.get.return_value = json.dumps(payload).encode("utf-8")

    assert cache.get() == payload


def test_model_provider_credentials_cache_get_returns_none_for_invalid_utf8(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.model_provider_cache.redis_client")
    cache = ProviderCredentialsCache(
        tenant_id="tenant",
        identity_id="identity",
        cache_type=ProviderCredentialsCacheType.PROVIDER,
    )

    redis_client_mock.get.return_value = b"\xff"

    assert cache.get() is None
