"""Authenticated credential bytes and recoverable local deployment key lifecycle."""

from typing import override

import pytest

from libs.credential_cipher import CredentialKeyUnavailableError, InvalidCredentialCiphertextError
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend


class MemoryStorage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def load_once(self, filename: str) -> bytes:
        if filename not in self.files:
            raise FileNotFoundError(filename)
        return self.files[filename]

    def save_if_absent(self, filename: str, data: bytes) -> bool:
        if filename in self.files:
            return False
        self.files[filename] = data
        return True


def test_provision_recovers_the_same_key_after_partial_success() -> None:
    storage = MemoryStorage()
    backend = LocalDeploymentKeyBackend(storage)
    reference = backend.provision("deployment-a", None)
    snapshot = dict(storage.files)
    assert set(snapshot) == {"privkeys/deployments/deployment-a/private.pem"}
    assert backend.provision("deployment-a", None) == reference
    assert backend.provision("deployment-a", reference) == reference
    assert storage.files == snapshot


@pytest.mark.parametrize("plaintext", ["", "secret", "凭据 🔐"])
def test_authenticated_randomized_roundtrip(plaintext: str) -> None:
    backend = LocalDeploymentKeyBackend(MemoryStorage())
    cipher = backend.bind("deployment-a", backend.provision("deployment-a", None))
    first, second = cipher.encrypt(plaintext), cipher.encrypt(plaintext)
    assert first != second
    assert cipher.decrypt(first) == plaintext
    assert cipher.decrypt(second) == plaintext
    for corrupted in (b"", first[:10], first[:-1], first + b"x", bytes([first[0] ^ 1]) + first[1:]):
        with pytest.raises(InvalidCredentialCiphertextError):
            cipher.decrypt(corrupted)


def test_wrong_key_and_missing_material_fail_without_replacement() -> None:
    storage = MemoryStorage()
    backend = LocalDeploymentKeyBackend(storage)
    reference = backend.provision("deployment-a", None)
    first = backend.bind("deployment-a", reference)
    other_reference = backend.provision("deployment-b", None)
    other = backend.bind("deployment-b", other_reference)
    with pytest.raises(InvalidCredentialCiphertextError):
        other.decrypt(first.encrypt("secret"))
    with pytest.raises(CredentialKeyUnavailableError):
        backend.bind("deployment-b", reference)
    del storage.files["privkeys/deployments/deployment-a/private.pem"]
    with pytest.raises(CredentialKeyUnavailableError):
        backend.provision("deployment-a", reference)
    with pytest.raises(CredentialKeyUnavailableError):
        backend.bind("deployment-a", reference)
    assert "privkeys/deployments/deployment-a/private.pem" not in storage.files


def test_corrupt_key_is_not_overwritten() -> None:
    storage = MemoryStorage()
    storage.files["privkeys/deployments/deployment-a/private.pem"] = b"broken key"
    with pytest.raises(CredentialKeyUnavailableError):
        LocalDeploymentKeyBackend(storage).provision("deployment-a", None)
    assert next(iter(storage.files.values())) == b"broken key"


def test_atomic_creation_unavailable_never_falls_back_to_overwriting_save() -> None:
    class UnsupportedStorage(MemoryStorage):
        @override
        def save_if_absent(self, filename: str, data: bytes) -> bool:
            raise NotImplementedError("Atomic creation unavailable")

    storage = UnsupportedStorage()
    with pytest.raises(CredentialKeyUnavailableError):
        LocalDeploymentKeyBackend(storage).provision("deployment-a", None)
    assert not storage.files
    existing = MemoryStorage()
    reference = LocalDeploymentKeyBackend(existing).provision("deployment-a", None)
    storage.files.update(existing.files)
    backend = LocalDeploymentKeyBackend(storage)
    assert backend.provision("deployment-a", None) == reference
    assert backend.provision("deployment-a", reference) == reference
    cipher = backend.bind("deployment-a", reference)
    assert cipher.decrypt(cipher.encrypt("existing credential")) == "existing credential"
