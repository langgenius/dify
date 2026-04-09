from __future__ import annotations

import pytest

from core.tools.utils import system_oauth_encryption as oauth_encryption
from core.tools.utils.system_oauth_encryption import OAuthEncryptionError, SystemOAuthEncrypter


def test_system_oauth_encrypter_roundtrip():
    encrypter = SystemOAuthEncrypter(secret_key="test-secret")
    payload = {"client_id": "cid", "client_secret": "csecret", "grant_type": "authorization_code"}

    encrypted = encrypter.encrypt_oauth_params(payload)
    decrypted = encrypter.decrypt_oauth_params(encrypted)

    assert encrypted
    assert dict(decrypted) == payload


def test_system_oauth_encrypter_decrypt_validates_input():
    encrypter = SystemOAuthEncrypter(secret_key="test-secret")

    with pytest.raises(ValueError, match="must be a string"):
        encrypter.decrypt_oauth_params(123)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="cannot be empty"):
        encrypter.decrypt_oauth_params("")


def test_system_oauth_encrypter_raises_oauth_error_for_invalid_ciphertext():
    encrypter = SystemOAuthEncrypter(secret_key="test-secret")

    with pytest.raises(OAuthEncryptionError, match="Decryption failed"):
        encrypter.decrypt_oauth_params("not-base64")


def test_system_oauth_helpers_use_global_cached_instance(monkeypatch):
    monkeypatch.setattr(oauth_encryption, "_oauth_encrypter", None)
    monkeypatch.setattr("core.tools.utils.system_oauth_encryption.dify_config.SECRET_KEY", "global-secret")

    first = oauth_encryption.get_system_oauth_encrypter()
    second = oauth_encryption.get_system_oauth_encrypter()
    assert first is second

    encrypted = oauth_encryption.encrypt_system_oauth_params({"k": "v"})
    assert oauth_encryption.decrypt_system_oauth_params(encrypted) == {"k": "v"}


def test_create_system_oauth_encrypter_factory():
    encrypter = oauth_encryption.create_system_oauth_encrypter(secret_key="factory-secret")
    assert isinstance(encrypter, SystemOAuthEncrypter)
