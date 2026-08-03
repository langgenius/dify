import json
import threading
import time
from typing import Any, override

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

_CRYPTO_CLIENT_CACHE_TTL_SECONDS = 300


class AzureKeyVaultKeyProvider(BaseKeyProvider):
    """
    Envelope-encryption key provider backed by Azure Key Vault.

    Each tenant gets its own RSA key inside the vault (created on tenant creation).
    The RSA private key never leaves Key Vault: a random AES key is generated locally
    for every token, used to encrypt the token, and then wrapped/unwrapped through Key
    Vault's wrap_key/unwrap_key operations.

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

        self._credential = DefaultAzureCredential()
        self._key_client = KeyClient(vault_url=vault_url, credential=self._credential)
        # Cached per (tenant_id, version). `version=None` means "whatever is current", which is
        # only ever used by encrypt() -- decrypt always pins the exact version from the envelope.
        self._crypto_clients: dict[tuple[str, str | None], tuple[CryptographyClient, str, float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key_name(tenant_id: str) -> str:
        return f"dify-tenant-{tenant_id}"

    def _get_crypto_client(self, tenant_id: str, version: str | None = None) -> tuple[CryptographyClient, str]:
        """
        Return a CryptographyClient bound to `version` (or the current version if None),
        along with the resolved version string that was actually used.
        """
        key_name = self._key_name(tenant_id)
        cache_key = (key_name, version)

        with self._lock:
            cached = self._crypto_clients.get(cache_key)
            if cached and cached[2] > time.monotonic():
                return cached[0], cached[1]

        key = self._key_client.get_key(key_name, version=version)
        resolved_version = key.properties.version or ""
        client = CryptographyClient(key, credential=self._credential)

        expires_at = time.monotonic() + _CRYPTO_CLIENT_CACHE_TTL_SECONDS
        with self._lock:
            self._crypto_clients[cache_key] = (client, resolved_version, expires_at)
        return client, resolved_version

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
        # No pre-fetch here: different ciphertexts for the same tenant may reference different
        # key versions across rotations, so the actual CryptographyClient is resolved
        # per-ciphertext in decrypt_with_decoding (cached internally by (tenant, version)).
        # This "decoding" is just the tenant_id, kept opaque per the BaseKeyProvider contract.
        return tenant_id

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: str) -> str:
        tenant_id = decoding
        if not encrypted_text.startswith(_PREFIX):
            raise ValueError("Unsupported ciphertext format for Azure Key Vault key provider")

        body = encrypted_text[len(_PREFIX) :]
        envelope_version = body[0]
        if envelope_version != _ENVELOPE_VERSION:
            raise ValueError(f"Unsupported Azure Key Vault envelope version: {envelope_version}")
        offset = 1

        metadata_len = int.from_bytes(body[offset : offset + 2], "big")
        offset += 2
        metadata: dict[str, Any] = json.loads(body[offset : offset + metadata_len])
        offset += metadata_len

        key_len = int.from_bytes(body[offset : offset + 2], "big")
        offset += 2
        wrapped_key = body[offset : offset + key_len]
        offset += key_len
        nonce = body[offset : offset + 16]
        offset += 16
        tag = body[offset : offset + 16]
        offset += 16
        ciphertext = body[offset:]

        wrap_alg = KeyWrapAlgorithm(metadata["wrap_alg"]) if metadata.get("wrap_alg") else _DEFAULT_WRAP_ALGORITHM
        crypto_client, _ = self._get_crypto_client(tenant_id, version=metadata.get("key_version"))
        aes_key = crypto_client.unwrap_key(wrap_alg, wrapped_key).key

        cipher_aes = AES.new(aes_key, AES.MODE_EAX, nonce=nonce)
        return cipher_aes.decrypt_and_verify(ciphertext, tag).decode()
