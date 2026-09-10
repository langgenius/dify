import json

from pytest_mock import MockerFixture

from core.helper.provider_cache import ToolProviderCredentialsCache


def test_provider_credentials_cache_get_returns_decoded_dict(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.provider_cache.redis_client")
    cache = ToolProviderCredentialsCache(tenant_id="tenant", provider="provider", credential_id="credential")
    payload = {"api_key": "secret"}

    redis_client_mock.get.return_value = json.dumps(payload).encode("utf-8")

    assert cache.get() == payload


def test_provider_credentials_cache_get_returns_none_for_invalid_utf8(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.provider_cache.redis_client")
    cache = ToolProviderCredentialsCache(tenant_id="tenant", provider="provider", credential_id="credential")

    redis_client_mock.get.return_value = b"\xff"

    assert cache.get() is None
