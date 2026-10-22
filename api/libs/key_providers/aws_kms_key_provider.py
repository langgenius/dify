import json
import logging
from typing import Any, override

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from Crypto.Cipher import AES

from configs import dify_config
from libs.key_providers.base import BaseKeyProvider

logger = logging.getLogger(__name__)

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
#
# This name is part of the on-disk format: changing it makes every existing credential
# undecryptable, because the context supplied at decrypt time would no longer match the one the
# data key was wrapped under. The "dify:" prefix keeps it clear of the "aws:" prefix AWS reserves.
_ENCRYPTION_CONTEXT_KEY = "dify:tenant_id"

# botocore defaults both timeouts to 60s. One Decrypt is issued per encrypted field, and
# assembling a tenant's provider configuration on a console request issues them in a loop, so the
# defaults would let a single unreachable KMS endpoint hold a worker for 60s x attempts x fields.
# KMS is a low-latency service; short timeouts cost nothing when it is healthy and bound the
# damage when it is not.
_CONNECT_TIMEOUT_SECONDS = 3
_READ_TIMEOUT_SECONDS = 5
_MAX_ATTEMPTS = 3


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

    Why one shared KMS key rather than one key per tenant, as the Azure provider does?

    Against the threat that dominates -- code execution inside Dify itself -- the two are
    equivalent, and it is worth being blunt about that: a process that can decrypt for any
    tenant on demand can decrypt for every tenant, and per-tenant keys change nothing, because
    Dify has to be granted use of all of them anyway. Neither design contains an attacker who
    is already running as the application. What differs is everything around that:

    * Least privilege. Keys created at runtime have unguessable ARNs, so a per-tenant design
      cannot name them in a policy: it needs kms:Decrypt on arn:aws:kms:...:key/* -- every key
      in the account -- plus kms:CreateKey, which AWS only accepts on Resource "*". A single
      shared key is grantable on one ARN, and the tenant boundary itself becomes expressible in
      policy through the kms:EncryptionContext:dify:tenant_id condition key, which a per-tenant
      design has no equivalent of. The wildcard is not academic: it is what would make the
      substituted-ciphertext attack that decrypt() guards against below actually succeed.
    * Cost and quota. Per-tenant keys bill monthly per key, count against a per-region key
      quota, and cannot be reclaimed for 7-30 days after a tenant leaves.
    * Rotation. AWS offers automatic rotation only for symmetric keys, and it needs no
      re-encryption, so no key version has to be pinned per ciphertext the way the Azure
      provider must pin one. A CiphertextBlob already names the backing key that produced it,
      and KMS retains superseded backing keys, so old credentials keep decrypting.

    What per-tenant keys would buy, and this design deliberately gives up: crypto-shredding,
    i.e. making one tenant's credentials unrecoverable by destroying one key. The closest
    equivalent here is a Deny statement conditioned on that tenant's encryption context, which
    is an access control rather than a cryptographic one.

    See README.md in this package for the threat model in full, a least-privilege key policy,
    and the rotation/migration runbook.
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
            config=Config(
                retries={"mode": "standard", "max_attempts": _MAX_ATTEMPTS},
                connect_timeout=_CONNECT_TIMEOUT_SECONDS,
                read_timeout=_READ_TIMEOUT_SECONDS,
            ),
        )

    @staticmethod
    def _encryption_context(tenant_id: str) -> dict[str, str]:
        # This value is the entire tenant boundary: under a shared KMS key it is the only thing
        # keeping one tenant's credentials away from another's. A caller that passed "" or None
        # would quietly dissolve that boundary -- and None specifically would surface as
        # botocore's ParamValidationError, which subclasses BotoCoreError and so would be
        # translated below into exactly the ValueError that callers suppress, turning a
        # programming error into credentials that silently stop being readable.
        #
        # TypeError rather than ValueError is deliberate: ValueError is this provider's signal
        # for "that particular credential cannot be decrypted right now", which callers are
        # entitled to swallow. A missing tenant identity is a broken caller and must not be
        # swallowed.
        if not isinstance(tenant_id, str) or not tenant_id:
            raise TypeError(f"tenant_id must be a non-empty string, got {tenant_id!r}")
        return {_ENCRYPTION_CONTEXT_KEY: tenant_id}

    @staticmethod
    def _warn_unreadable(tenant_id: str, exc: Exception) -> None:
        """
        Record why a credential could not be read.

        Every caller of decrypt_token_with_decoding suppresses ValueError (see
        core/provider_manager.py), which is the right behaviour for one bad row but means a
        *systemic* failure -- a revoked policy, a disabled or deleted key, an alias repointed at
        a different key, KEY_PROVIDER_TYPE switched underneath existing ciphertext -- reaches
        operators only as credentials that silently went blank, with nothing in the logs to
        explain it. Worse, the obvious reaction is to re-enter and save the credential, which
        overwrites ciphertext that was still recoverable.

        Only the tenant id and the underlying error are logged, never ciphertext or plaintext.
        """
        logger.warning("Cannot read a credential for tenant %s with the AWS KMS key provider: %s", tenant_id, exc)

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

        # Record the ARN KMS actually resolved, not the configured identifier, so an operator can
        # tell which key a stored credential belongs to even when AWS_KMS_KEY_ID is an alias.
        # This is diagnostic only: decrypt deliberately does not trust it (see below).
        metadata = json.dumps({"key_id": response.get("KeyId", self._key_id)}).encode()

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
        # RecursionError is included because json.loads raises it, not JSONDecodeError, on deeply
        # nested input, and a metadata_len is only 16 bits -- comfortably enough nesting to trip
        # CPython's limit. Letting it escape would turn one poisoned row into a 500 for every
        # caller listing that tenant's providers.
        except (IndexError, TypeError, RecursionError, json.JSONDecodeError) as exc:
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
            #
            # It must come from configuration, never from metadata["key_id"]. The metadata is
            # authenticated by neither the EAX tag nor the KMS encryption context, so an attacker
            # able to write this row could swap in a whole envelope wrapped under a key they own
            # and name that key here -- and if the deployment's IAM policy grants kms:Decrypt
            # broadly, KMS would honour it and hand back an attacker-chosen plaintext to be used
            # as a tenant credential.
            response = self._client.decrypt(
                CiphertextBlob=wrapped_key,
                KeyId=self._key_id,
                EncryptionContext=self._encryption_context(tenant_id),
            )
        except (ClientError, BotoCoreError) as exc:
            self._warn_unreadable(tenant_id, exc)
            raise ValueError(f"Failed to unwrap credential via AWS KMS: {exc}") from exc

        cipher_aes = AES.new(response["Plaintext"], AES.MODE_EAX, nonce=nonce)
        return cipher_aes.decrypt_and_verify(ciphertext, tag).decode()
