import copy
from unittest.mock import patch

import pytest

from core.entities.provider_entities import BasicProviderConfig
from core.tools.utils.encryption import ProviderConfigEncrypter


# ---------------------------
# A no-op cache
# ---------------------------
class NoopCache:
    """Simple cache stub: always returns None, does nothing for set/delete."""

    def get(self):
        return None

    def set(self, config):
        pass

    def delete(self):
        pass


@pytest.fixture
def secret_field() -> BasicProviderConfig:
    """A SECRET_INPUT field named 'password'."""
    return BasicProviderConfig(
        name="password",
        type=BasicProviderConfig.Type.SECRET_INPUT,
    )


@pytest.fixture
def normal_field() -> BasicProviderConfig:
    """A TEXT_INPUT field named 'username'."""
    return BasicProviderConfig(
        name="username",
        type=BasicProviderConfig.Type.TEXT_INPUT,
    )


@pytest.fixture
def encrypter_obj(secret_field, normal_field):
    """
    Build ProviderConfigEncrypter with:
    - tenant_id = tenant123
    - one secret field (password) and one normal field (username)
    - NoopCache as cache
    """
    return ProviderConfigEncrypter(
        tenant_id="tenant123",
        config=[secret_field, normal_field],
        provider_config_cache=NoopCache(),
    )


# ============================================================
# ProviderConfigEncrypter.encrypt()
# ============================================================


def test_encrypt_only_secret_is_encrypted_and_non_secret_unchanged(encrypter_obj):
    """
    Secret field should be encrypted, non-secret field unchanged.
    Verify encrypt_token called only for secret field.
    Also check deep copy (input not modified).
    """
    data_in = {"username": "alice", "password": "plain_pwd"}
    data_copy = copy.deepcopy(data_in)

    with patch("core.tools.utils.encryption.encrypter.encrypt_token", return_value="CIPHERTEXT") as mock_encrypt:
        out = encrypter_obj.encrypt(data_in)

    assert out["username"] == "alice"
    assert out["password"] == "CIPHERTEXT"
    mock_encrypt.assert_called_once_with("tenant123", "plain_pwd")
    assert data_in == data_copy  # deep copy semantics


def test_encrypt_missing_secret_key_is_ok(encrypter_obj):
    """If secret field missing in input, no error and no encryption called."""
    with patch("core.tools.utils.encryption.encrypter.encrypt_token") as mock_encrypt:
        out = encrypter_obj.encrypt({"username": "alice"})
    assert out["username"] == "alice"
    mock_encrypt.assert_not_called()


# ============================================================
# ProviderConfigEncrypter.mask_tool_credentials()
# ============================================================


@pytest.mark.parametrize(
    ("raw", "prefix", "suffix"),
    [
        ("longsecret", "lo", "et"),
        ("abcdefg", "ab", "fg"),
        ("1234567", "12", "67"),
    ],
)
def test_mask_tool_credentials_long_secret(encrypter_obj, raw, prefix, suffix):
    """
    For length > 6: keep first 2 and last 2, mask middle with '*'.
    """
    data_in = {"username": "alice", "password": raw}
    data_copy = copy.deepcopy(data_in)

    out = encrypter_obj.mask_tool_credentials(data_in)
    masked = out["password"]

    assert masked.startswith(prefix)
    assert masked.endswith(suffix)
    assert "*" in masked
    assert len(masked) == len(raw)
    assert data_in == data_copy  # deep copy semantics


@pytest.mark.parametrize("raw", ["", "1", "12", "123", "123456"])
def test_mask_tool_credentials_short_secret(encrypter_obj, raw):
    """
    For length <= 6: fully mask with '*' of same length.
    """
    out = encrypter_obj.mask_tool_credentials({"password": raw})
    assert out["password"] == ("*" * len(raw))


def test_mask_tool_credentials_missing_key_noop(encrypter_obj):
    """If secret key missing, leave other fields unchanged."""
    data_in = {"username": "alice"}
    data_copy = copy.deepcopy(data_in)

    out = encrypter_obj.mask_tool_credentials(data_in)
    assert out["username"] == "alice"
    assert data_in == data_copy


# ============================================================
# ProviderConfigEncrypter.decrypt()
# ============================================================


def test_decrypt_normal_flow(encrypter_obj):
    """
    Normal decrypt flow:
    - decrypt_token called for secret field
    - secret replaced with decrypted value
    - non-secret unchanged
    """
    data_in = {"username": "alice", "password": "ENC"}
    data_copy = copy.deepcopy(data_in)

    with patch("core.tools.utils.encryption.encrypter.decrypt_token", return_value="PLAIN") as mock_decrypt:
        out = encrypter_obj.decrypt(data_in)

    assert out["username"] == "alice"
    assert out["password"] == "PLAIN"
    mock_decrypt.assert_called_once_with("tenant123", "ENC")
    assert data_in == data_copy  # deep copy semantics


@pytest.mark.parametrize("empty_val", ["", None])
def test_decrypt_skip_empty_values(encrypter_obj, empty_val):
    """Skip decrypt if value is empty or None, keep original."""
    with patch("core.tools.utils.encryption.encrypter.decrypt_token") as mock_decrypt:
        out = encrypter_obj.decrypt({"password": empty_val})

    mock_decrypt.assert_not_called()
    assert out["password"] == empty_val


def test_decrypt_swallow_exception_and_keep_original(encrypter_obj):
    """
    If decrypt_token raises, exception should be swallowed,
    and original value preserved.
    """
    with patch("core.tools.utils.encryption.encrypter.decrypt_token", side_effect=Exception("boom")):
        out = encrypter_obj.decrypt({"password": "ENC_ERR"})

    assert out["password"] == "ENC_ERR"
