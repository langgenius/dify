from __future__ import annotations

import pytest

from core.tools.utils import system_encryption as encryption
from core.tools.utils.system_encryption import EncryptionError, SystemEncrypter


def test_system_encrypter_roundtrip():
    encrypter = SystemEncrypter(secret_key="test-secret")
    payload = {"client_id": "cid", "client_secret": "csecret", "grant_type": "authorization_code"}

    encrypted = encrypter.encrypt_params(payload)
    decrypted = encrypter.decrypt_params(encrypted)

    assert encrypted
    assert dict(decrypted) == payload


def test_system_encrypter_decrypt_validates_input():
    encrypter = SystemEncrypter(secret_key="test-secret")

    with pytest.raises(ValueError, match="must be a string"):
        encrypter.decrypt_params(123)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="cannot be empty"):
        encrypter.decrypt_params("")


def test_system_encrypter_raises_error_for_invalid_ciphertext():
    encrypter = SystemEncrypter(secret_key="test-secret")

    with pytest.raises(EncryptionError, match="Decryption failed"):
        encrypter.decrypt_params("not-base64")


def test_system_helpers_use_global_cached_instance(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(encryption, "_encrypter", None)
    monkeypatch.setattr("core.tools.utils.system_encryption.dify_config.SECRET_KEY", "global-secret")

    first = encryption.get_system_encrypter()
    second = encryption.get_system_encrypter()
    assert first is second

    encrypted = encryption.encrypt_system_params({"k": "v"})
    assert encryption.decrypt_system_params(encrypted) == {"k": "v"}


def test_create_system_encrypter_factory():
    encrypter = encryption.create_system_encrypter(secret_key="factory-secret")
    assert isinstance(encrypter, SystemEncrypter)
