"""Tenant-bound IM credential cipher contracts."""

from typing import override

from libs.key_providers.base import BaseKeyProvider
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher


class _RecordingKeyProvider(BaseKeyProvider):
    def __init__(self) -> None:
        self.encrypt_calls: list[tuple[str, str]] = []
        self.decrypt_calls: list[tuple[str, bytes]] = []

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        raise AssertionError(f"key provisioning is outside this contract: {tenant_id}")

    @override
    def encrypt(self, tenant_id: str, plaintext: str) -> bytes:
        self.encrypt_calls.append((tenant_id, plaintext))
        return b"opaque-ciphertext"

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> object:
        raise AssertionError(f"the wrapper must call the provider decrypt boundary directly: {tenant_id}")

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: object) -> str:
        raise AssertionError(f"the wrapper must not assemble a decoding path: {encrypted_text!r}, {decoding!r}")

    @override
    def decrypt(self, tenant_id: str, ciphertext: bytes) -> str:
        self.decrypt_calls.append((tenant_id, ciphertext))
        return "recovered-plaintext"


def test_cipher_captures_one_tenant_and_forwards_exact_encrypt_decrypt_types() -> None:
    key_provider = _RecordingKeyProvider()
    cipher = TenantBoundCredentialCipher(key_provider, "workspace-1")
    ciphertext = b"stored-ciphertext"

    encrypted = cipher.encrypt("serialized-credentials")
    decrypted = cipher.decrypt(ciphertext)

    assert encrypted == b"opaque-ciphertext"
    assert isinstance(encrypted, bytes)
    assert decrypted == "recovered-plaintext"
    assert isinstance(decrypted, str)
    assert key_provider.encrypt_calls == [("workspace-1", "serialized-credentials")]
    assert key_provider.decrypt_calls == [("workspace-1", ciphertext)]


def test_cipher_keeps_the_captured_tenant_stable_across_multiple_calls() -> None:
    key_provider = _RecordingKeyProvider()
    cipher = TenantBoundCredentialCipher(key_provider, "workspace-captured")

    cipher.encrypt("first")
    cipher.encrypt("second")
    cipher.decrypt(b"first-ciphertext")
    cipher.decrypt(b"second-ciphertext")

    assert key_provider.encrypt_calls == [
        ("workspace-captured", "first"),
        ("workspace-captured", "second"),
    ]
    assert key_provider.decrypt_calls == [
        ("workspace-captured", b"first-ciphertext"),
        ("workspace-captured", b"second-ciphertext"),
    ]
