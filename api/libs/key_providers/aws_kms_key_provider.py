import json
from typing import Any, override

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from Crypto.Cipher import AES

from configs import dify_config
from libs.key_providers.base import BaseKeyProvider

# Marker kept identical to libs/rsa.py so ciphertext produced by either provider is
# self-describing, even though the two providers never decode each other's payloads.
_PREFIX = b"HYBRID:"

# Bump this if the *binary layout* below ever changes. Adding new metadata fields does NOT
# require a bump (metadata is a JSON object -- old readers just ignore unknown keys via .get()).
_ENVELOPE_VERSION = 1

_DATA_KEY_SPEC = "AES_256"

# Binds each wrapped data key to the tenant it was created for. KMS refuses to decrypt unless the
# caller supplies the identical context, so a blob belonging to one tenant cannot be unwrapped
# while acting for another, even though every tenant shares one KMS key. The context is also
# recorded in CloudTrail and can be matched in IAM policies through the
# kms:EncryptionContext:dify:tenant_id condition key.
_ENCRYPTION_CONTEXT_KEY = "dify:tenant_id"


class AwsKmsKeyProvider(BaseKeyProvider):
    """
    Envelope-encryption key provider backed by AWS KMS.

    Ciphertext envelope (self-describing, forward-compatible):
        PREFIX (7 bytes)
      + envelope_version (1 byte)
      + metadata_len (2 bytes, big-endian) + metadata (UTF-8 JSON object)
      + wrapped_key_len (2 bytes, big-endian) + wrapped_key
      + nonce (16 bytes) + tag (16 bytes) + ciphertext

    The layout matches the Azure Key Vault provider so the two stay easy to compare, but the
    wrapped key here is a KMS CiphertextBlob produced by GenerateDataKey rather than an
    RSA-wrapped AES key.

    Two deliberate differences from the Azure provider:

    * One symmetric KMS key serves every tenant, and tenants are separated by the encryption
      context instead. Per-tenant KMS keys would bill per key and would need kms:CreateKey at
      runtime, a permission operators are rightly reluctant to grant to an application. The
      encryption context still binds each blob to its tenant cryptographically.
    * No key version is recorded. A KMS CiphertextBlob already names the backing key that
      produced it, and KMS retains superseded backing keys, so automatic key rotation keeps old
      credentials decryptable with no re-encryption and nothing to pin. (Automatic rotation is
      only offered for symmetric keys, which is a further reason not to mirror Azure's
      per-tenant asymmetric keys here.)
    """

    def __init__(self):
        key_id = dify_config.AWS_KMS_KEY_ID
        if not key_id:
            raise ValueError("AWS_KMS_KEY_ID must be configured when KEY_PROVIDER_TYPE=aws-kms")

        self._key_id = key_id
        self._client = boto3.client(
            "kms",
            region_name=dify_config.AWS_KMS_REGION,
            endpoint_url=dify_config.AWS_KMS_ENDPOINT_URL,
            # Credential resolution is left to the default boto3 chain (instance role, environment
            # variables, shared profile), so no long-lived secret has to be handed to Dify just to
            # reach the key that protects every other secret.
            config=Config(retries={"mode": "standard"}),
        )

    @staticmethod
    def _encryption_context(tenant_id: str) -> dict[str, str]:
        return {_ENCRYPTION_CONTEXT_KEY: tenant_id}

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        # Nothing to provision: the KMS key is created and managed by the operator, and every
        # tenant shares it. Returning the configured identifier records which key a tenant was
        # onboarded against, which is what makes a later migration to a different key detectable.
        return self._key_id

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        try:
            response = self._client.generate_data_key(
                KeyId=self._key_id,
                KeySpec=_DATA_KEY_SPEC,
                EncryptionContext=self._encryption_context(tenant_id),
            )
        except (ClientError, BotoCoreError) as exc:
            raise ValueError(f"Failed to generate a data key via AWS KMS: {exc}") from exc

        data_key = response["Plaintext"]
        wrapped_key = response["CiphertextBlob"]

        cipher_aes = AES.new(data_key, AES.MODE_EAX)
        ciphertext, tag = cipher_aes.encrypt_and_digest(text.encode())

        metadata = json.dumps({"key_id": self._key_id}).encode()

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
            raise ValueError("Unsupported ciphertext format for AWS KMS key provider")

        # Bytes slicing never raises on out-of-range indices in Python (it just returns a
        # shorter/empty slice), so a truncated envelope wouldn't otherwise surface as an error
        # until (maybe) AES decryption fails much later, or not at all. Validate lengths
        # explicitly and turn any parsing failure into ValueError, matching what callers
        # (e.g. core/provider_manager.py) already expect and suppress for malformed credentials.
        try:
            body = encrypted_text[len(_PREFIX) :]
            if len(body) < 1:
                raise ValueError("Malformed AWS KMS envelope: missing envelope version")
            envelope_version = body[0]
            if envelope_version != _ENVELOPE_VERSION:
                raise ValueError(f"Unsupported AWS KMS envelope version: {envelope_version}")
            offset = 1

            if len(body) < offset + 2:
                raise ValueError("Malformed AWS KMS envelope: truncated metadata length")
            metadata_len = int.from_bytes(body[offset : offset + 2], "big")
            offset += 2
            if len(body) < offset + metadata_len:
                raise ValueError("Malformed AWS KMS envelope: truncated metadata")
            metadata: Any = json.loads(body[offset : offset + metadata_len])
            if not isinstance(metadata, dict):
                raise ValueError("Malformed AWS KMS envelope: metadata is not a JSON object")
            offset += metadata_len

            if len(body) < offset + 2:
                raise ValueError("Malformed AWS KMS envelope: truncated wrapped key length")
            key_len = int.from_bytes(body[offset : offset + 2], "big")
            offset += 2
            if len(body) < offset + key_len + 16 + 16:
                raise ValueError("Malformed AWS KMS envelope: truncated wrapped key/nonce/tag")
            wrapped_key = body[offset : offset + key_len]
            offset += key_len
            nonce = body[offset : offset + 16]
            offset += 16
            tag = body[offset : offset + 16]
            offset += 16
            ciphertext = body[offset:]
        except (IndexError, TypeError, json.JSONDecodeError) as exc:
            raise ValueError("Malformed AWS KMS envelope") from exc

        try:
            # The key that encrypted this blob can legitimately have become unusable since --
            # disabled, scheduled for deletion, or no longer permitted by the caller's policy.
            # Every caller of decrypt_token_with_decoding (core/provider_manager.py,
            # services/model_load_balancing_service.py) only expects and suppresses ValueError for
            # "this particular credential can't be decrypted right now", so botocore errors must be
            # translated here rather than escape as a different type and bring down the whole call
            # chain (e.g. building a tenant's full provider configuration just to add an unrelated
            # new credential).
            #
            # KeyId is passed even though a symmetric CiphertextBlob already identifies its key:
            # supplying it makes KMS reject a blob wrapped under any other key instead of
            # transparently decrypting it, which is the documented defence against a substituted
            # ciphertext.
            response = self._client.decrypt(
                CiphertextBlob=wrapped_key,
                KeyId=metadata.get("key_id") or self._key_id,
                EncryptionContext=self._encryption_context(tenant_id),
            )
        except (ClientError, BotoCoreError) as exc:
            raise ValueError(f"Failed to unwrap credential via AWS KMS: {exc}") from exc

        cipher_aes = AES.new(response["Plaintext"], AES.MODE_EAX, nonce=nonce)
        return cipher_aes.decrypt_and_verify(ciphertext, tag).decode()
