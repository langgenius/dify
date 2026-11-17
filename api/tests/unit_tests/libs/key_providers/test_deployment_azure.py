"""Azure deployment version pinning and retry behavior with real local RSA wrapping."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from azure.core.exceptions import ResourceNotFoundError, ServiceRequestError
from azure.keyvault.keys import KeyClient
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA

from libs.credential_cipher import CredentialKeyUnavailableError, InvalidCredentialCiphertextError
from libs.key_providers.deployment_azure import AzureDeploymentKeyBackend


@pytest.fixture
def azure_backend():
    client = MagicMock(spec=KeyClient)
    versions: dict[tuple[str, str], RSA.RsaKey] = {}
    current: dict[str, str] = {}

    def get_key(name: str):
        if name not in current:
            raise ResourceNotFoundError
        return SimpleNamespace(
            properties=SimpleNamespace(
                version=current[name],
                enabled=True,
                expires_on=None,
                not_before=None,
            )
        )

    def create(name: str, *, size: int):
        version = str(len(versions) + 1)
        current[name] = version
        versions[name, version] = RSA.generate(size)
        return get_key(name)

    def crypto(name: str, *, key_version: str):
        key = versions[name, key_version]
        crypto_client = MagicMock()
        crypto_client.wrap_key.side_effect = lambda _algorithm, plaintext: SimpleNamespace(
            encrypted_key=PKCS1_OAEP.new(key.publickey(), hashAlgo=SHA256).encrypt(plaintext)
        )
        crypto_client.unwrap_key.side_effect = lambda _algorithm, ciphertext: SimpleNamespace(
            key=PKCS1_OAEP.new(key, hashAlgo=SHA256).decrypt(ciphertext)
        )
        return crypto_client

    client.get_key.side_effect = get_key
    client.create_rsa_key.side_effect = create
    client.get_cryptography_client.side_effect = crypto
    return AzureDeploymentKeyBackend(client, key_size=2048, rotation_days=90), client


def test_recovery_does_not_create_another_version(azure_backend) -> None:
    backend, client = azure_backend
    reference = backend.provision("a", None)
    assert reference == "dify-deployment-a"
    assert backend.provision("a", None) == reference
    assert backend.provision("a", reference) == reference
    assert client.create_rsa_key.call_count == 1
    policy = client.update_key_rotation_policy.call_args.kwargs["policy"]
    assert policy.expires_in is None


def test_rotation_preserves_old_ciphertexts_and_randomizes_new_ones(azure_backend) -> None:
    backend, client = azure_backend
    reference = backend.provision("a", None)
    cipher = backend.bind("a", reference)
    first = cipher.encrypt("凭据")
    client.create_rsa_key(reference, size=2048)
    second = cipher.encrypt("凭据")
    assert first != second
    assert cipher.decrypt(first) == cipher.decrypt(second) == "凭据"
    middle = len(first) // 2
    for broken in (
        b"",
        first[:20],
        first[:-1],
        first + b"x",
        first[:middle] + bytes([first[middle] ^ 1]) + first[middle + 1 :],
    ):
        with pytest.raises(InvalidCredentialCiphertextError):
            cipher.decrypt(broken)
    other = backend.bind("b", backend.provision("b", None))
    with pytest.raises(InvalidCredentialCiphertextError):
        other.decrypt(first)


def test_missing_reference_or_key_never_provisions_on_read(azure_backend) -> None:
    backend, client = azure_backend
    with pytest.raises(CredentialKeyUnavailableError):
        backend.bind("a", "dify-tenant-a")
    with pytest.raises(CredentialKeyUnavailableError):
        backend.provision("a", "dify-deployment-a")
    client.create_rsa_key.assert_not_called()


def test_azure_errors_are_sanitized(azure_backend) -> None:
    backend, client = azure_backend
    client.get_key.side_effect = ServiceRequestError("raw-credential-from-provider")
    with pytest.raises(CredentialKeyUnavailableError) as failure:
        backend.provision("a", None)
    assert "raw-credential" not in str(failure.value)
