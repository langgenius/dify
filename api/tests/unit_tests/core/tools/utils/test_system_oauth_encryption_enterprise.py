import pytest

from core.tools.utils.system_oauth_encryption import (
    OAuthEncryptionError,
    create_system_oauth_encrypter,
    decrypt_system_oauth_params,
    encrypt_system_oauth_params,
)


def test_system_oauth_encrypter_round_trips_params():
    encrypter = create_system_oauth_encrypter(secret_key="test-secret")
    encrypted = encrypter.encrypt_oauth_params({"client_id": "cid", "client_secret": "secret"})

    assert encrypter.decrypt_oauth_params(encrypted) == {
        "client_id": "cid",
        "client_secret": "secret",
    }


def test_global_system_oauth_helpers_round_trip():
    encrypted = encrypt_system_oauth_params({"client_id": "cid"})

    assert decrypt_system_oauth_params(encrypted) == {"client_id": "cid"}


def test_system_oauth_encrypter_rejects_invalid_ciphertext():
    encrypter = create_system_oauth_encrypter(secret_key="test-secret")

    with pytest.raises(OAuthEncryptionError):
        encrypter.decrypt_oauth_params("not-valid")
