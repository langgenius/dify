"""Version-pinned Azure envelope encryption for one deployment, without Tenant access."""

from collections.abc import Callable
from datetime import UTC, datetime

from azure.core.exceptions import AzureError, ResourceNotFoundError
from azure.keyvault.keys import KeyClient, KeyRotationLifetimeAction, KeyRotationPolicy, KeyRotationPolicyAction
from azure.keyvault.keys.crypto import KeyWrapAlgorithm
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from libs.credential_cipher import (
    BoundCredentialCipher,
    CredentialKeyUnavailableError,
    InvalidCredentialCiphertextError,
)

_PREFIX = b"DIFY-DEPLOYMENT-AZURE:1:"
_NONCE_SIZE = 16
_TAG_SIZE = 16
_KEY_ERROR = "Deployment credential key is unavailable"
_CIPHERTEXT_ERROR = "Invalid deployment credential ciphertext"
_WRAP_ALGORITHM = KeyWrapAlgorithm.rsa_oaep_256


class _Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    key_name: str
    key_version: str = Field(pattern=r"^[a-zA-Z0-9-]{1,128}$")


class AzureDeploymentKeyBackend:
    """Use a caller-configured SDK client; only provisioning may modify key lifecycle."""

    def __init__(self, client: KeyClient, *, key_size: int, rotation_days: int | None) -> None:
        self._client = client
        self._key_size = key_size
        self._rotation_days = rotation_days

    def provision(self, instance_id: str, reference: str | None) -> str:
        """Require serialized provisioning; recover the logical key before considering creation."""
        name = self._name(instance_id)
        if reference is not None and reference != name:
            raise CredentialKeyUnavailableError(_KEY_ERROR)
        try:
            try:
                self._client.get_key(name)
            except ResourceNotFoundError:
                if reference is not None:
                    raise CredentialKeyUnavailableError(_KEY_ERROR) from None
                self._client.create_rsa_key(name, size=self._key_size)
            self._require_version(name)
            if self._rotation_days:
                self._client.update_key_rotation_policy(
                    name,
                    policy=KeyRotationPolicy(
                        lifetime_actions=[
                            KeyRotationLifetimeAction(
                                KeyRotationPolicyAction.rotate, time_after_create=f"P{self._rotation_days}D"
                            )
                        ],
                    ),
                )
        except AzureError:
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        return name

    def bind(self, instance_id: str, reference: str) -> BoundCredentialCipher:
        """Require compatible persisted reference and available key; never create or rotate."""
        name = self._name(instance_id)
        if reference != name:
            raise CredentialKeyUnavailableError(_KEY_ERROR)
        self._require_version(name)
        return _AzureDeploymentCipher(self._client, name, self._require_version)

    @staticmethod
    def _name(instance_id: str) -> str:
        return f"dify-deployment-{instance_id}"

    def _require_version(self, name: str) -> str:
        try:
            key = self._client.get_key(name)
        except AzureError:
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        properties = key.properties
        now = datetime.now(UTC)
        if (
            not properties.version
            or properties.enabled is False
            or (properties.expires_on is not None and properties.expires_on <= now)
            or (properties.not_before is not None and properties.not_before > now)
        ):
            raise CredentialKeyUnavailableError(_KEY_ERROR)
        return properties.version


class _AzureDeploymentCipher:
    def __init__(self, client: KeyClient, name: str, current_version: Callable[[str], str]) -> None:
        self._client = client
        self._name = name
        self._current_version = current_version

    def encrypt(self, plaintext: str) -> bytes:
        """Require text; wrap a fresh data key with the latest enabled version for every call."""
        version = self._current_version(self._name)
        metadata = _Metadata(key_name=self._name, key_version=version).model_dump_json().encode("utf-8")
        header = _PREFIX + len(metadata).to_bytes(2, "big") + metadata
        data_key = get_random_bytes(32)
        aes = AES.new(data_key, AES.MODE_EAX, nonce=get_random_bytes(_NONCE_SIZE))
        aes.update(header)
        encrypted, tag = aes.encrypt_and_digest(plaintext.encode("utf-8"))
        try:
            client = self._client.get_cryptography_client(self._name, key_version=version)
            wrapped = client.wrap_key(_WRAP_ALGORITHM, data_key).encrypted_key
        except AzureError:
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        return header + len(wrapped).to_bytes(2, "big") + wrapped + aes.nonce + tag + encrypted

    def decrypt(self, ciphertext: bytes) -> str:
        """Require our authenticated envelope; unwrap only the recorded version of this deployment key."""
        offset = len(_PREFIX)
        if not ciphertext.startswith(_PREFIX) or len(ciphertext) < offset + 2:
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR)
        metadata_size = int.from_bytes(ciphertext[offset : offset + 2], "big")
        metadata_end = offset + 2 + metadata_size
        if len(ciphertext) < metadata_end + 2:
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR)
        try:
            metadata = _Metadata.model_validate_json(ciphertext[offset + 2 : metadata_end])
        except ValidationError:
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR) from None
        if metadata.key_name != self._name:
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR)
        wrapped_size = int.from_bytes(ciphertext[metadata_end : metadata_end + 2], "big")
        wrapped_end = metadata_end + 2 + wrapped_size
        nonce_end = wrapped_end + _NONCE_SIZE
        tag_end = nonce_end + _TAG_SIZE
        if wrapped_size == 0 or len(ciphertext) < tag_end:
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR)
        try:
            client = self._client.get_cryptography_client(self._name, key_version=metadata.key_version)
            data_key = client.unwrap_key(_WRAP_ALGORITHM, ciphertext[metadata_end + 2 : wrapped_end]).key
        except (ValueError, TypeError):
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR) from None
        except AzureError:
            raise CredentialKeyUnavailableError(_KEY_ERROR) from None
        try:
            aes = AES.new(data_key, AES.MODE_EAX, nonce=ciphertext[wrapped_end:nonce_end])
            aes.update(ciphertext[:metadata_end])
            return aes.decrypt_and_verify(ciphertext[tag_end:], ciphertext[nonce_end:tag_end]).decode("utf-8")
        except (ValueError, TypeError):
            raise InvalidCredentialCiphertextError(_CIPHERTEXT_ERROR) from None
