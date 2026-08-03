"""
Unit tests for AzureKeyVaultKeyProvider, with the Azure SDK mocked out (no network calls).

The main thing under test is that ciphertext is pinned to the key *version* that wrapped it,
so that Key Vault's native key rotation (a new "current" version appearing) does not break
decryption of tokens encrypted before the rotation.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from azure.keyvault.keys import KeyRotationPolicy

from configs import dify_config
from libs.key_providers.azure_keyvault_key_provider import AzureKeyVaultKeyProvider


class FakeCryptographyClient:
    """
    Stands in for azure.keyvault.keys.crypto.CryptographyClient. wrap_key/unwrap_key here just
    tag the payload with the bound key version, so unwrapping with the "wrong" version's client
    can be detected -- mirroring how a real RSA key from a different version can't unwrap data
    wrapped under another version's key.
    """

    def __init__(self, key: SimpleNamespace, credential: object = None) -> None:
        self.version = key.properties.version
        self.credential = credential

    def wrap_key(self, algorithm: object, key_bytes: bytes) -> SimpleNamespace:
        self.last_wrap_algorithm = algorithm
        return SimpleNamespace(encrypted_key=f"{self.version}:".encode() + key_bytes)

    def unwrap_key(self, algorithm: object, wrapped: bytes) -> SimpleNamespace:
        self.last_unwrap_algorithm = algorithm
        prefix = f"{self.version}:".encode()
        if not wrapped.startswith(prefix):
            raise ValueError(f"key version {self.version} cannot unwrap data wrapped by another version")
        return SimpleNamespace(key=wrapped[len(prefix) :])


class FakeKeyClient:
    """Stands in for azure.keyvault.keys.KeyClient."""

    def __init__(self, vault_url: str | None = None, credential: object = None) -> None:
        self.vault_url = vault_url
        self.credential = credential
        self.current_version = "v1"
        self.rotation_policies: dict[str, KeyRotationPolicy] = {}
        self.created_keys: dict[str, int] = {}

    def create_rsa_key(self, name: str, size: int = 2048) -> SimpleNamespace:
        self.created_keys[name] = size
        return SimpleNamespace(properties=SimpleNamespace(version=self.current_version))

    def get_key(self, name: str, version: str | None = None) -> SimpleNamespace:
        assert name in self.created_keys, f"key {name} was never created"
        return SimpleNamespace(properties=SimpleNamespace(version=version or self.current_version))

    def update_key_rotation_policy(self, name: str, policy: KeyRotationPolicy) -> KeyRotationPolicy:
        self.rotation_policies[name] = policy
        return policy


@pytest.fixture
def fake_key_client(monkeypatch: pytest.MonkeyPatch) -> FakeKeyClient:
    client = FakeKeyClient()
    monkeypatch.setattr(
        "libs.key_providers.azure_keyvault_key_provider.KeyClient",
        MagicMock(return_value=client),
    )
    monkeypatch.setattr(
        "libs.key_providers.azure_keyvault_key_provider.CryptographyClient",
        FakeCryptographyClient,
    )
    monkeypatch.setattr(
        "libs.key_providers.azure_keyvault_key_provider.DefaultAzureCredential",
        MagicMock(),
    )
    return client


@pytest.fixture(autouse=True)
def azure_keyvault_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "AZURE_KEYVAULT_VAULT_URL", "https://fake-vault.vault.azure.net")
    monkeypatch.setattr(dify_config, "AZURE_KEYVAULT_KEY_SIZE", 2048)
    monkeypatch.setattr(dify_config, "AZURE_KEYVAULT_ROTATION_INTERVAL_DAYS", None)


@pytest.mark.usefixtures("fake_key_client")
def test_missing_vault_url_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "AZURE_KEYVAULT_VAULT_URL", None)
    with pytest.raises(ValueError, match="AZURE_KEYVAULT_VAULT_URL"):
        AzureKeyVaultKeyProvider()


@pytest.mark.usefixtures("fake_key_client")
def test_encrypt_decrypt_roundtrip() -> None:
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted = provider.encrypt("tenant-1", "super-secret")
    decoding = provider.get_decrypt_decoding("tenant-1")
    assert provider.decrypt_with_decoding(encrypted, decoding) == "super-secret"


def test_rotation_does_not_break_decryption_of_old_ciphertext(fake_key_client: FakeKeyClient) -> None:
    """
    The core guarantee: a token encrypted before rotation must still decrypt correctly after
    Key Vault promotes a new "current" version, and new tokens use the new version.
    """
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted_v1 = provider.encrypt("tenant-1", "secret-before-rotation")

    # Simulate Key Vault's rotation policy promoting a new version in the background.
    fake_key_client.current_version = "v2"

    encrypted_v2 = provider.encrypt("tenant-1", "secret-after-rotation")

    # Sanity check the fakes actually recorded different versions.
    assert encrypted_v1 != encrypted_v2

    decoding = provider.get_decrypt_decoding("tenant-1")
    assert provider.decrypt_with_decoding(encrypted_v1, decoding) == "secret-before-rotation"
    assert provider.decrypt_with_decoding(encrypted_v2, decoding) == "secret-after-rotation"


def test_generate_key_pair_without_rotation_interval_does_not_set_policy(fake_key_client: FakeKeyClient) -> None:
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")
    assert fake_key_client.rotation_policies == {}


def test_generate_key_pair_with_rotation_interval_sets_time_after_create_only(
    monkeypatch: pytest.MonkeyPatch, fake_key_client: FakeKeyClient
) -> None:
    monkeypatch.setattr(dify_config, "AZURE_KEYVAULT_ROTATION_INTERVAL_DAYS", 30)

    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    policy = fake_key_client.rotation_policies["dify-tenant-tenant-1"]
    assert policy.expires_in is None
    (action,) = policy.lifetime_actions
    assert action.time_after_create == "P30D"
    assert action.time_before_expiry is None


@pytest.mark.usefixtures("fake_key_client")
def test_decrypt_rejects_unknown_envelope_version() -> None:
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted = bytearray(provider.encrypt("tenant-1", "secret"))
    # Byte right after the "HYBRID:" prefix is the envelope version.
    encrypted[len(b"HYBRID:")] = 99

    with pytest.raises(ValueError, match="envelope version"):
        provider.decrypt_with_decoding(bytes(encrypted), "tenant-1")


@pytest.mark.usefixtures("fake_key_client")
def test_decrypt_rejects_unrecognized_prefix() -> None:
    provider = AzureKeyVaultKeyProvider()
    with pytest.raises(ValueError, match="Unsupported ciphertext format"):
        provider.decrypt_with_decoding(b"not-a-valid-envelope", "tenant-1")
