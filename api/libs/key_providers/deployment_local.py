"""Local deployment keys, isolated from Tenant credential storage."""

from typing import Protocol

from Crypto.Cipher import AES, PKCS1_OAEP
from Crypto.PublicKey import RSA
from Crypto.Random import get_random_bytes

from libs.credential_cipher import (
    BoundCredentialCipher,
    CredentialKeyUnavailableError,
    InvalidCredentialCiphertextError,
)

_PREFIX = b"DIFY-DEPLOYMENT-LOCAL:1:"
_NONCE_SIZE = 16
_TAG_SIZE = 16
_DATA_KEY_SIZE = 32
_KEY_ERROR = "Deployment credential key is unavailable"


class DeploymentKeyStorage(Protocol):
    def load_once(self, filename: str) -> bytes: ...
    def save(self, filename: str, data: bytes) -> None: ...


class LocalDeploymentKeyBackend:
    def __init__(self, storage: DeploymentKeyStorage) -> None:
        self._storage = storage

    def provision(self, instance_id: str, reference: str | None) -> str:
        """Require serialized provisioning; create/recover without replacing existing material."""
        path = self._path(instance_id)
        try:
            encoded = self._storage.load_once(path)
        except FileNotFoundError:
            if reference is not None:
                raise CredentialKeyUnavailableError(_KEY_ERROR) from None
            private_key = RSA.generate(2048)
            try:
                self._storage.save(path, private_key.export_key())
            except OSError:
                raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        except OSError:
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        else:
            private_key = self._private_key(encoded)
        public_reference = private_key.publickey().export_key().decode("ascii")
        if reference is not None and reference != public_reference:
            raise CredentialKeyUnavailableError(_KEY_ERROR)
        return public_reference

    def bind(self, instance_id: str, reference: str) -> BoundCredentialCipher:
        """Require persisted reference; load and match material without writes."""
        try:
            private_key = self._private_key(self._storage.load_once(self._path(instance_id)))
            public_key = RSA.import_key(reference)
        except (OSError, ValueError, IndexError, TypeError):
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        if public_key.has_private() or public_key != private_key.publickey():
            raise CredentialKeyUnavailableError(_KEY_ERROR)
        return _LocalDeploymentCipher(private_key)

    @staticmethod
    def _path(instance_id: str) -> str:
        return f"privkeys/deployments/{instance_id}/private.pem"

    @staticmethod
    def _private_key(encoded: bytes) -> RSA.RsaKey:
        try:
            key = RSA.import_key(encoded)
        except (ValueError, IndexError, TypeError):
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        if not key.has_private():
            raise CredentialKeyUnavailableError(_KEY_ERROR)
        return key


class _LocalDeploymentCipher:
    """Keep the parsed deployment key on this bound instance; never provision during use."""

    def __init__(self, private_key: RSA.RsaKey) -> None:
        self._private_key = private_key

    def encrypt(self, plaintext: str) -> bytes:
        """Require text; return randomized RSA-wrapped AES-EAX ciphertext."""
        data_key = get_random_bytes(_DATA_KEY_SIZE)
        aes = AES.new(data_key, AES.MODE_EAX, nonce=get_random_bytes(_NONCE_SIZE))
        aes.update(_PREFIX)
        encrypted, tag = aes.encrypt_and_digest(plaintext.encode("utf-8"))
        wrapped = PKCS1_OAEP.new(self._private_key.publickey()).encrypt(data_key)
        return _PREFIX + wrapped + aes.nonce + tag + encrypted

    def decrypt(self, ciphertext: bytes) -> str:
        """Require our complete envelope; authenticate before decoding or returning plaintext."""
        offset = len(_PREFIX)
        key_end = offset + self._private_key.size_in_bytes()
        nonce_end = key_end + _NONCE_SIZE
        tag_end = nonce_end + _TAG_SIZE
        if not ciphertext.startswith(_PREFIX) or len(ciphertext) < tag_end:
            raise InvalidCredentialCiphertextError("Invalid deployment credential ciphertext")
        try:
            data_key = PKCS1_OAEP.new(self._private_key).decrypt(ciphertext[offset:key_end])
            aes = AES.new(data_key, AES.MODE_EAX, nonce=ciphertext[key_end:nonce_end])
            aes.update(_PREFIX)
            return aes.decrypt_and_verify(ciphertext[tag_end:], ciphertext[nonce_end:tag_end]).decode("utf-8")
        except (ValueError, TypeError):
            raise InvalidCredentialCiphertextError("Invalid deployment credential ciphertext") from None
