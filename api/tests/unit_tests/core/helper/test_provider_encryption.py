"""Unit tests for core.helper.provider_encryption.

Covers ``ProviderConfigEncrypter``: it encrypts, masks and decrypts only the
provider config fields declared as ``SECRET_INPUT``, always works on a deep copy
of the caller's mapping, and serves ``decrypt`` from the provider config cache
when the cache already holds credentials. The tenant encrypter and cache are
mocked so no real keys or Redis are involved.
"""

from unittest.mock import MagicMock, patch

import pytest

from core.entities.provider_entities import BasicProviderConfig, ProviderConfigType
from core.helper.provider_encryption import ProviderConfigEncrypter, create_provider_encrypter


def _config(*fields: tuple[str, ProviderConfigType]) -> list[BasicProviderConfig]:
    return [BasicProviderConfig(name=name, type=field_type) for name, field_type in fields]


def _encrypter(*fields: tuple[str, ProviderConfigType], cache: MagicMock | None = None) -> ProviderConfigEncrypter:
    if cache is None:
        cache = MagicMock()
        cache.get.return_value = None
    return ProviderConfigEncrypter(
        tenant_id="tenant",
        config=_config(*fields) if fields else [],
        provider_config_cache=cache,
    )


# =========================================================
# encrypt
# =========================================================


def test_encrypt_only_touches_secret_fields() -> None:
    encrypter = _encrypter(
        ("api_key", ProviderConfigType.SECRET_INPUT),
        ("region", ProviderConfigType.TEXT_INPUT),
    )

    with patch("core.helper.provider_encryption.encrypter") as module:
        module.encrypt_token.return_value = "encrypted"
        result = encrypter.encrypt({"api_key": "secret", "region": "us-east-1"})

    module.encrypt_token.assert_called_once_with("tenant", "secret")
    assert result == {"api_key": "encrypted", "region": "us-east-1"}


def test_encrypt_skips_secret_fields_missing_from_data() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    with patch("core.helper.provider_encryption.encrypter") as module:
        result = encrypter.encrypt({"other": "value"})

    module.encrypt_token.assert_not_called()
    assert result == {"other": "value"}


def test_encrypt_treats_empty_secret_as_empty_string() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    with patch("core.helper.provider_encryption.encrypter") as module:
        module.encrypt_token.return_value = "encrypted"
        result = encrypter.encrypt({"api_key": None})

    module.encrypt_token.assert_called_once_with("tenant", "")
    assert result == {"api_key": "encrypted"}


def test_encrypt_returns_a_deep_copy() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))
    nested = {"api_key": "secret", "options": {"items": [1, 2]}}

    with patch("core.helper.provider_encryption.encrypter") as module:
        module.encrypt_token.return_value = "encrypted"
        result = encrypter.encrypt(nested)

    assert result is not nested
    assert nested == {"api_key": "secret", "options": {"items": [1, 2]}}


def test_encrypt_without_secret_config_returns_data_unchanged() -> None:
    encrypter = _encrypter(("region", ProviderConfigType.TEXT_INPUT))

    assert encrypter.encrypt({"region": "us-east-1"}) == {"region": "us-east-1"}


# =========================================================
# mask_credentials
# =========================================================


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1234567890", "12******90"),
        ("1234567", "12***67"),
        ("123456", "******"),
        ("abc", "***"),
        ("", ""),
    ],
)
def test_mask_credentials_masks_secret_values(value: str, expected: str) -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    assert encrypter.mask_credentials({"api_key": value}) == {"api_key": expected}


def test_mask_credentials_leaves_non_secret_fields_untouched() -> None:
    encrypter = _encrypter(
        ("api_key", ProviderConfigType.SECRET_INPUT),
        ("region", ProviderConfigType.TEXT_INPUT),
    )

    assert encrypter.mask_credentials({"api_key": "secret", "region": "us-east-1"}) == {
        "api_key": "******",
        "region": "us-east-1",
    }


def test_mask_credentials_skips_fields_missing_from_data() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    assert encrypter.mask_credentials({"other": "value"}) == {"other": "value"}


def test_mask_credentials_returns_a_deep_copy() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))
    source = {"api_key": "secret", "options": {"items": [1, 2]}}

    result = encrypter.mask_credentials(source)

    assert result is not source
    assert source["api_key"] == "secret"


def test_mask_plugin_credentials_delegates_to_mask_credentials() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    assert encrypter.mask_plugin_credentials({"api_key": "secret"}) == {"api_key": "******"}


# =========================================================
# decrypt
# =========================================================


def test_decrypt_returns_cached_credentials_without_decrypting() -> None:
    cache = MagicMock()
    cache.get.return_value = {"api_key": "cached"}
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT), cache=cache)

    with patch("core.helper.provider_encryption.encrypter") as module:
        result = encrypter.decrypt({"api_key": "encrypted"})

    module.decrypt_token.assert_not_called()
    cache.set.assert_not_called()
    assert result == {"api_key": "cached"}


def test_decrypt_decrypts_secret_fields_and_caches_result() -> None:
    cache = MagicMock()
    cache.get.return_value = None
    encrypter = _encrypter(
        ("api_key", ProviderConfigType.SECRET_INPUT),
        ("region", ProviderConfigType.TEXT_INPUT),
        cache=cache,
    )

    with patch("core.helper.provider_encryption.encrypter") as module:
        module.decrypt_token.return_value = "secret"
        result = encrypter.decrypt({"api_key": "encrypted", "region": "us-east-1"})

    module.decrypt_token.assert_called_once_with("tenant", "encrypted")
    cache.set.assert_called_once_with({"api_key": "secret", "region": "us-east-1"})
    assert result == {"api_key": "secret", "region": "us-east-1"}


@pytest.mark.parametrize("value", [None, ""])
def test_decrypt_skips_empty_secret_values(value: str | None) -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    with patch("core.helper.provider_encryption.encrypter") as module:
        result = encrypter.decrypt({"api_key": value})

    module.decrypt_token.assert_not_called()
    assert result == {"api_key": value}


def test_decrypt_keeps_encrypted_value_when_decryption_fails() -> None:
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT))

    with patch("core.helper.provider_encryption.encrypter") as module:
        module.decrypt_token.side_effect = ValueError("bad token")
        result = encrypter.decrypt({"api_key": "encrypted"})

    assert result == {"api_key": "encrypted"}


def test_decrypt_returns_a_deep_copy_and_caches_it() -> None:
    cache = MagicMock()
    cache.get.return_value = None
    encrypter = _encrypter(("api_key", ProviderConfigType.SECRET_INPUT), cache=cache)
    source = {"api_key": "encrypted", "options": {"items": [1, 2]}}

    with patch("core.helper.provider_encryption.encrypter") as module:
        module.decrypt_token.return_value = "secret"
        result = encrypter.decrypt(source)

    assert result is not source
    assert source == {"api_key": "encrypted", "options": {"items": [1, 2]}}
    assert cache.set.call_args.args[0] == {"api_key": "secret", "options": {"items": [1, 2]}}


# =========================================================
# create_provider_encrypter
# =========================================================


def test_create_provider_encrypter_returns_encrypter_and_same_cache() -> None:
    cache = MagicMock()
    config = _config(("api_key", ProviderConfigType.SECRET_INPUT))

    encrypter, returned_cache = create_provider_encrypter(tenant_id="tenant", config=config, cache=cache)

    assert isinstance(encrypter, ProviderConfigEncrypter)
    assert encrypter.tenant_id == "tenant"
    assert encrypter.config == config
    assert encrypter.provider_config_cache is cache
    assert returned_cache is cache
