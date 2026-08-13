"""
Unit tests for AzureKeyVaultKeyProvider, with the Azure SDK mocked out (no network calls).

The main thing under test is that ciphertext is pinned to the key *version* that wrapped it,
so that Key Vault's native key rotation (a new "current" version appearing) does not break
decryption of tokens encrypted before the rotation.
"""

import datetime
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from azure.core.exceptions import HttpResponseError
from azure.keyvault.keys import KeyRotationPolicy

from configs import dify_config
from libs.key_providers.azure_keyvault_key_provider import AzureKeyVaultKeyProvider


class FakeCryptographyClient:
    """
    Stands in for azure.keyvault.keys.crypto.CryptographyClient. wrap_key/unwrap_key here just
    tag the payload with the bound key version, so unwrapping with the "wrong" version's client
    can be detected -- mirroring how a real RSA key from a different version can't unwrap data
    wrapped under another version's key.

    Constructed from a key *id string* (e.g. ".../keys/<name>/<version>"), mirroring how the
    real provider now avoids ever handing CryptographyClient an already-materialized key --
    see AzureKeyVaultKeyProvider._get_crypto_client().
    """

    # Class-level so a test can mark a version "disabled" (mirroring Key Vault's real behavior
    # for a disabled/deleted key version) without threading state through every fixture.
    disabled_versions: set[str] = set()

    def __init__(self, key: str, credential: object = None) -> None:
        self.version = key.rsplit("/", 1)[-1]
        self.credential = credential
        self.closed = False

    def close(self) -> None:
        self.closed = True

    def wrap_key(self, algorithm: object, key_bytes: bytes) -> SimpleNamespace:
        self.last_wrap_algorithm = algorithm
        return SimpleNamespace(encrypted_key=f"{self.version}:".encode() + key_bytes)

    def unwrap_key(self, algorithm: object, wrapped: bytes) -> SimpleNamespace:
        self.last_unwrap_algorithm = algorithm
        if self.version in self.disabled_versions:
            raise HttpResponseError(message="Operation unwrapKey is not allowed on a disabled key.")
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
        # version -> created_on, in creation order; mirrors what list_properties_of_key_versions
        # reports in real Key Vault, which the provider now relies on (instead of GetKey) to
        # resolve "the current version" without ever fetching key material.
        self._version_created_on: dict[str, datetime.datetime] = {}

    def _register_current_version(self) -> None:
        if self.current_version not in self._version_created_on:
            self._version_created_on[self.current_version] = datetime.datetime(2024, 1, 1) + datetime.timedelta(
                seconds=len(self._version_created_on)
            )

    def create_rsa_key(self, name: str, size: int = 2048) -> SimpleNamespace:
        self.created_keys[name] = size
        self._register_current_version()
        return SimpleNamespace(properties=SimpleNamespace(version=self.current_version))

    def list_properties_of_key_versions(self, name: str) -> list[SimpleNamespace]:
        assert name in self.created_keys, f"key {name} was never created"
        self._register_current_version()
        return [
            SimpleNamespace(version=version, created_on=created_on, id=f"{self.vault_url}/keys/{name}/{version}")
            for version, created_on in self._version_created_on.items()
        ]

    def update_key_rotation_policy(self, name: str, policy: KeyRotationPolicy) -> KeyRotationPolicy:
        self.rotation_policies[name] = policy
        return policy

    def get_cryptography_client(self, name: str, *, key_version: str | None = None) -> "FakeCryptographyClient":
        assert name in self.created_keys, f"key {name} was never created"
        key_id = f"{self.vault_url}/keys/{name}/{key_version}"
        return FakeCryptographyClient(key_id, credential=self.credential)


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
    FakeCryptographyClient.disabled_versions = set()
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


def _embedded_key_version(envelope: bytes) -> str:
    """Peel out the {"key_version": ...} metadata Dify embeds in each ciphertext, for assertions."""
    body = envelope[len(b"HYBRID:") :]
    metadata_len = int.from_bytes(body[1:3], "big")
    metadata = json.loads(body[3 : 3 + metadata_len])
    return metadata["key_version"]


def test_rotation_does_not_break_decryption_of_old_ciphertext(fake_key_client: FakeKeyClient) -> None:
    """
    The core guarantee: a token encrypted before rotation must still decrypt correctly after
    Key Vault promotes a new "current" version, and new tokens must promptly pick up the new
    version rather than keep using a stale cached "current" client.
    """
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted_v1 = provider.encrypt("tenant-1", "secret-before-rotation")
    assert _embedded_key_version(encrypted_v1) == "v1"

    # Simulate Key Vault's rotation policy promoting a new version in the background.
    fake_key_client.current_version = "v2"

    encrypted_v2 = provider.encrypt("tenant-1", "secret-after-rotation")
    # The new version must be picked up immediately, not after some cache TTL elapses.
    assert _embedded_key_version(encrypted_v2) == "v2"

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


@pytest.mark.usefixtures("fake_key_client")
def test_decrypt_rejects_truncated_envelope_missing_version_byte() -> None:
    provider = AzureKeyVaultKeyProvider()
    with pytest.raises(ValueError, match="Malformed Azure Key Vault envelope"):
        provider.decrypt_with_decoding(b"HYBRID:", "tenant-1")


@pytest.mark.usefixtures("fake_key_client")
@pytest.mark.parametrize(
    "truncate_at",
    [
        len(b"HYBRID:") + 2,  # cut inside the metadata-length prefix
        len(b"HYBRID:") + 3,  # cut inside the metadata JSON blob
    ],
)
def test_decrypt_rejects_truncated_envelope_raises_value_error(truncate_at: int) -> None:
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted = provider.encrypt("tenant-1", "secret")
    truncated = encrypted[:truncate_at]

    with pytest.raises(ValueError):
        provider.decrypt_with_decoding(truncated, "tenant-1")


@pytest.mark.usefixtures("fake_key_client")
def test_decrypt_translates_disabled_key_version_into_value_error() -> None:
    """
    A specific key_version can become unusable after a credential was encrypted (disabled,
    deleted, or expired in Key Vault). Callers of decrypt_token_with_decoding
    (core/provider_manager.py, services/model_load_balancing_service.py) only catch ValueError
    for "this credential can't be decrypted right now" -- if the underlying Azure SDK error
    leaked through untranslated, it would crash the whole call chain (e.g. building a tenant's
    full provider configuration just to create an unrelated new credential).
    """
    provider = AzureKeyVaultKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted = provider.encrypt("tenant-1", "secret")
    assert _embedded_key_version(encrypted) == "v1"

    # Simulate the vault operator disabling/deleting the version that encrypted this credential.
    FakeCryptographyClient.disabled_versions.add("v1")

    with pytest.raises(ValueError, match="Failed to unwrap credential"):
        provider.decrypt_with_decoding(encrypted, "tenant-1")
