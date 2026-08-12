import json
from datetime import UTC, datetime
from typing import Any, override

from azure.core.exceptions import AzureError
from azure.identity import DefaultAzureCredential
from azure.keyvault.keys import (
    KeyClient,
    KeyRotationLifetimeAction,
    KeyRotationPolicy,
    KeyRotationPolicyAction,
)
from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes

from configs import dify_config
from libs.key_providers.base import BaseKeyProvider

# Marker kept identical to libs/rsa.py so ciphertext produced by either provider is
# self-describing, even though the two providers never decode each other's payloads.
_PREFIX = b"HYBRID:"

# Bump this if the *binary layout* below ever changes. Adding new metadata fields does NOT
# require a bump (metadata is a JSON object -- old readers just ignore unknown keys via .get()).
_ENVELOPE_VERSION = 1

_DEFAULT_WRAP_ALGORITHM = KeyWrapAlgorithm.rsa_oaep_256


class AzureKeyVaultKeyProvider(BaseKeyProvider):
    """
    Envelope-encryption key provider backed by Azure Key Vault.

    Ciphertext envelope (self-describing, forward-compatible):
        PREFIX (7 bytes)
      + envelope_version (1 byte)
      + metadata_len (2 bytes, big-endian) + metadata (UTF-8 JSON object)
      + wrapped_key_len (2 bytes, big-endian) + wrapped_key
      + nonce (16 bytes) + tag (16 bytes) + ciphertext

    `metadata` currently carries {"key_version": ..., "wrap_alg": ...}. It's a JSON object
    rather than fixed-width fields so new attributes can be added later without touching the
    binary layout or breaking old ciphertext; `envelope_version` exists separately to guard
    the binary layout itself, in case that ever needs to change.

    Recording the key_version that wrapped each token (rather than always resolving "the
    current version" at decrypt time) is what makes Key Vault's native automatic key rotation
    safe to use here: old tokens keep decrypting against the version that encrypted them,
    while new tokens pick up whatever version is current. This only holds as long as old
    versions are never allowed to *expire* -- see generate_key_pair().
    """

    def __init__(self):
        vault_url = dify_config.AZURE_KEYVAULT_VAULT_URL
        if not vault_url:
            raise ValueError("AZURE_KEYVAULT_VAULT_URL must be configured when KEY_PROVIDER_TYPE=azure-keyvault")

        self._vault_url = vault_url
        self._credential = DefaultAzureCredential()
        self._key_client = KeyClient(vault_url=vault_url, credential=self._credential)

    @staticmethod
    def _key_name(tenant_id: str) -> str:
        return f"dify-tenant-{tenant_id}"

    def _get_crypto_client(self, tenant_id: str, version: str | None = None) -> tuple[CryptographyClient, str]:
        """
        Return a CryptographyClient bound to `version`, along with the resolved version string
        that was actually used.
        """
        key_name = self._key_name(tenant_id)
        if version is not None:
            resolved_version = version
        else:
            versions = list(self._key_client.list_properties_of_key_versions(key_name))
            if not versions:
                raise ValueError(f"No key versions found for key {key_name}")
            current = max(
                versions,
                key=lambda properties: properties.created_on or datetime.min.replace(tzinfo=UTC),
            )
            resolved_version = current.version or ""
        return self._key_client.get_cryptography_client(key_name, key_version=resolved_version), resolved_version

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        key_name = self._key_name(tenant_id)
        self._key_client.create_rsa_key(key_name, size=dify_config.AZURE_KEYVAULT_KEY_SIZE)

        rotation_interval_days = dify_config.AZURE_KEYVAULT_ROTATION_INTERVAL_DAYS
        if rotation_interval_days:
            self._key_client.update_key_rotation_policy(
                key_name,
                policy=KeyRotationPolicy(
                    lifetime_actions=[
                        KeyRotationLifetimeAction(
                            KeyRotationPolicyAction.rotate,
                            time_after_create=f"P{rotation_interval_days}D",
                        )
                    ],
                    # Deliberately no `expires_in` here: this provider pins each ciphertext to
                    # the key_version that encrypted it and relies on old versions staying
                    # usable forever. If versions were also given an expiry (time_before_expiry
                    # trigger / expires_in), old ciphertext would become permanently
                    # undecryptable once its version expired, unless a separate re-wrap/
                    # migration job proactively moves it to the new version first.
                ),
            )
        return key_name

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        aes_key = get_random_bytes(16)
        cipher_aes = AES.new(aes_key, AES.MODE_EAX)
        ciphertext, tag = cipher_aes.encrypt_and_digest(text.encode())

        crypto_client, key_version = self._get_crypto_client(tenant_id)
        wrapped_key = crypto_client.wrap_key(_DEFAULT_WRAP_ALGORITHM, aes_key).encrypted_key

        metadata = json.dumps({"key_version": key_version, "wrap_alg": _DEFAULT_WRAP_ALGORITHM.value}).encode()

        return (
            _PREFIX
            + _ENVELOPE_VERSION.to_bytes(1, "big")
            + len(metadata).to_bytes(2, "big")
            + metadata
            + len(wrapped_key).to_bytes(2, "big")
            + wrapped_key
            + cipher_aes.nonce
            + tag
            + ciphertext
        )

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> str:
        return tenant_id

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: str) -> str:
        tenant_id = decoding
        if not encrypted_text.startswith(_PREFIX):
            raise ValueError("Unsupported ciphertext format for Azure Key Vault key provider")

        # Bytes slicing never raises on out-of-range indices in Python (it just returns a
        # shorter/empty slice), so a truncated envelope wouldn't otherwise surface as an error
        # until (maybe) AES decryption fails much later, or not at all. Validate lengths
        # explicitly and turn any parsing failure into ValueError, matching what callers
        # (e.g. core/provider_manager.py) already expect and suppress for malformed credentials.
        try:
            body = encrypted_text[len(_PREFIX) :]
            if len(body) < 1:
                raise ValueError("Malformed Azure Key Vault envelope: missing envelope version")
            envelope_version = body[0]
            if envelope_version != _ENVELOPE_VERSION:
                raise ValueError(f"Unsupported Azure Key Vault envelope version: {envelope_version}")
            offset = 1

            if len(body) < offset + 2:
                raise ValueError("Malformed Azure Key Vault envelope: truncated metadata length")
            metadata_len = int.from_bytes(body[offset : offset + 2], "big")
            offset += 2
            if len(body) < offset + metadata_len:
                raise ValueError("Malformed Azure Key Vault envelope: truncated metadata")
            metadata: Any = json.loads(body[offset : offset + metadata_len])
            if not isinstance(metadata, dict):
                raise ValueError("Malformed Azure Key Vault envelope: metadata is not a JSON object")
            offset += metadata_len

            if len(body) < offset + 2:
                raise ValueError("Malformed Azure Key Vault envelope: truncated wrapped key length")
            key_len = int.from_bytes(body[offset : offset + 2], "big")
            offset += 2
            if len(body) < offset + key_len + 16 + 16:
                raise ValueError("Malformed Azure Key Vault envelope: truncated wrapped key/nonce/tag")
            wrapped_key = body[offset : offset + key_len]
            offset += key_len
            nonce = body[offset : offset + 16]
            offset += 16
            tag = body[offset : offset + 16]
            offset += 16
            ciphertext = body[offset:]
        except (IndexError, TypeError) as exc:
            raise ValueError("Malformed Azure Key Vault envelope") from exc

        wrap_alg = KeyWrapAlgorithm(metadata["wrap_alg"]) if metadata.get("wrap_alg") else _DEFAULT_WRAP_ALGORITHM
        try:
            # A specific key_version can legitimately become unusable after this ciphertext was
            # created -- disabled, deleted, or (if a rotation policy with an expiry was
            # misconfigured despite generate_key_pair()'s warning against it) expired. Every
            # caller of decrypt_token_with_decoding (core/provider_manager.py,
            # services/model_load_balancing_service.py) already only expects/suppresses
            # ValueError for "this particular credential can't be decrypted right now", so Azure
            # SDK errors must be translated here rather than left to escape as a different type
            # and crash the whole call chain (e.g. building a tenant's full provider
            # configuration just to create an unrelated new credential).
            crypto_client, _ = self._get_crypto_client(tenant_id, version=metadata.get("key_version"))
            aes_key = crypto_client.unwrap_key(wrap_alg, wrapped_key).key
        except AzureError as exc:
            raise ValueError(f"Failed to unwrap credential via Azure Key Vault: {exc}") from exc

        cipher_aes = AES.new(aes_key, AES.MODE_EAX, nonce=nonce)
        return cipher_aes.decrypt_and_verify(ciphertext, tag).decode()
