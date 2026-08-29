"""
Unit tests for AwsKmsKeyProvider, with the AWS SDK mocked out (no network calls).

The properties worth pinning here are the two that let a single KMS key serve every tenant
safely: the encryption context binds each wrapped data key to one tenant, and passing KeyId on
decrypt makes KMS reject a blob wrapped under a different key instead of quietly accepting it.
"""

import json
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from libs.key_providers.aws_kms_key_provider import AwsKmsKeyProvider

KEY_ID = "arn:aws:kms:us-east-1:111122223333:key/fake-key"
OTHER_KEY_ID = "arn:aws:kms:us-east-1:111122223333:key/other-key"


class FakeKmsClient:
    """
    Stands in for a boto3 KMS client.

    GenerateDataKey returns a blob that encodes the key id and the encryption context it was
    created under, so Decrypt can enforce both the way real KMS does: a mismatched context or a
    mismatched KeyId is refused rather than silently honoured.
    """

    disabled_keys: set[str] = set()

    def __init__(self) -> None:
        self.generate_calls: list[dict] = []
        self.decrypt_calls: list[dict] = []

    # boto3 spells its keyword arguments in PascalCase, and this fake has to accept the same
    # names the provider passes, so N803 is suppressed rather than the signature changed.
    def generate_data_key(self, *, KeyId: str, KeySpec: str, EncryptionContext: dict[str, str]) -> dict:  # noqa: N803
        self.generate_calls.append({"KeyId": KeyId, "KeySpec": KeySpec, "EncryptionContext": EncryptionContext})
        if KeyId in self.disabled_keys:
            raise ClientError({"Error": {"Code": "DisabledException", "Message": "key is disabled"}}, "GenerateDataKey")
        size = {"AES_256": 32, "AES_128": 16}[KeySpec]
        plaintext = bytes(range(size))
        blob = json.dumps({"key_id": KeyId, "ctx": EncryptionContext, "key": plaintext.hex()}).encode()
        return {"Plaintext": plaintext, "CiphertextBlob": blob}

    def decrypt(self, *, CiphertextBlob: bytes, KeyId: str, EncryptionContext: dict[str, str]) -> dict:  # noqa: N803
        self.decrypt_calls.append(
            {"CiphertextBlob": CiphertextBlob, "KeyId": KeyId, "EncryptionContext": EncryptionContext}
        )
        if KeyId in self.disabled_keys:
            raise ClientError({"Error": {"Code": "DisabledException", "Message": "key is disabled"}}, "Decrypt")
        payload = json.loads(CiphertextBlob)
        if payload["key_id"] != KeyId:
            raise ClientError(
                {"Error": {"Code": "IncorrectKeyException", "Message": "wrong key"}},
                "Decrypt",
            )
        if payload["ctx"] != EncryptionContext:
            raise ClientError(
                {"Error": {"Code": "InvalidCiphertextException", "Message": "context mismatch"}},
                "Decrypt",
            )
        return {"Plaintext": bytes.fromhex(payload["key"])}


@pytest.fixture
def fake_kms_client(monkeypatch: pytest.MonkeyPatch) -> FakeKmsClient:
    client = FakeKmsClient()
    monkeypatch.setattr(
        "libs.key_providers.aws_kms_key_provider.boto3.client",
        MagicMock(return_value=client),
    )
    FakeKmsClient.disabled_keys = set()
    return client


@pytest.fixture(autouse=True)
def aws_kms_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        AWS_KMS_KEY_ID=KEY_ID,
        AWS_KMS_REGION="us-east-1",
        AWS_KMS_ENDPOINT_URL=None,
    )


@pytest.mark.usefixtures("fake_kms_client")
def test_missing_key_id_raises(config_overrides: Callable[..., None]) -> None:
    config_overrides(AWS_KMS_KEY_ID=None)
    with pytest.raises(ValueError, match="AWS_KMS_KEY_ID"):
        AwsKmsKeyProvider()


@pytest.mark.usefixtures("fake_kms_client")
def test_encrypt_decrypt_roundtrip() -> None:
    provider = AwsKmsKeyProvider()
    provider.generate_key_pair("tenant-1")

    encrypted = provider.encrypt("tenant-1", "super-secret")
    decoding = provider.get_decrypt_decoding("tenant-1")
    assert provider.decrypt_with_decoding(encrypted, decoding) == "super-secret"


def test_generate_key_pair_returns_configured_key_without_calling_kms(fake_kms_client: FakeKmsClient) -> None:
    """The operator owns the key, so onboarding a tenant must not need kms:CreateKey."""
    provider = AwsKmsKeyProvider()

    assert provider.generate_key_pair("tenant-1") == KEY_ID
    assert fake_kms_client.generate_calls == []
    assert fake_kms_client.decrypt_calls == []


def test_encryption_context_binds_the_tenant(fake_kms_client: FakeKmsClient) -> None:
    """A credential wrapped for one tenant must not be unwrappable while acting for another."""
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")

    assert fake_kms_client.generate_calls[0]["EncryptionContext"] == {"dify:tenant_id": "tenant-1"}

    with pytest.raises(ValueError, match="Failed to unwrap credential via AWS KMS"):
        provider.decrypt_with_decoding(encrypted, "tenant-2")


def test_decrypt_passes_key_id_so_a_substituted_blob_is_rejected(fake_kms_client: FakeKmsClient) -> None:
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")

    # Rewrite the embedded metadata to name a different key, as a swapped ciphertext would.
    tampered = _with_metadata(encrypted, {"key_id": OTHER_KEY_ID})

    with pytest.raises(ValueError, match="Failed to unwrap credential via AWS KMS"):
        provider.decrypt_with_decoding(tampered, "tenant-1")
    assert fake_kms_client.decrypt_calls[-1]["KeyId"] == OTHER_KEY_ID


def test_data_key_spec_is_aes_256(fake_kms_client: FakeKmsClient) -> None:
    AwsKmsKeyProvider().encrypt("tenant-1", "super-secret")
    assert fake_kms_client.generate_calls[0]["KeySpec"] == "AES_256"


@pytest.mark.usefixtures("fake_kms_client")
def test_disabled_key_surfaces_as_value_error() -> None:
    """
    Callers only expect ValueError for "this credential can't be decrypted right now"; a botocore
    error escaping instead would take down unrelated work, such as listing a tenant's providers.
    """
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")

    FakeKmsClient.disabled_keys = {KEY_ID}
    with pytest.raises(ValueError, match="Failed to unwrap credential via AWS KMS"):
        provider.decrypt_with_decoding(encrypted, "tenant-1")
    with pytest.raises(ValueError, match="Failed to generate a data key via AWS KMS"):
        provider.encrypt("tenant-1", "super-secret")


def test_transport_failure_surfaces_as_value_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """BotoCoreError (connection-level) must be translated too, not just ClientError."""
    client = FakeKmsClient()

    def _boom(**_: object) -> dict:
        raise EndpointConnectionError(endpoint_url="https://kms.us-east-1.amazonaws.com")

    monkeypatch.setattr(
        "libs.key_providers.aws_kms_key_provider.boto3.client",
        MagicMock(return_value=client),
    )
    monkeypatch.setattr(client, "generate_data_key", _boom)

    with pytest.raises(ValueError, match="Failed to generate a data key via AWS KMS"):
        AwsKmsKeyProvider().encrypt("tenant-1", "super-secret")


@pytest.mark.usefixtures("fake_kms_client")
def test_foreign_ciphertext_is_rejected() -> None:
    provider = AwsKmsKeyProvider()
    with pytest.raises(ValueError, match="Unsupported ciphertext format"):
        provider.decrypt_with_decoding(b"not-a-dify-envelope", "tenant-1")


@pytest.mark.usefixtures("fake_kms_client")
def test_unsupported_envelope_version_is_rejected() -> None:
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")
    bumped = encrypted[:7] + (99).to_bytes(1, "big") + encrypted[8:]

    with pytest.raises(ValueError, match="Unsupported AWS KMS envelope version"):
        provider.decrypt_with_decoding(bumped, "tenant-1")


@pytest.mark.usefixtures("fake_kms_client")
@pytest.mark.parametrize("keep", [7, 8, 9, 12, 40])
def test_truncated_envelope_raises_value_error(keep: int) -> None:
    """
    Python slicing silently returns short slices, so every length has to be checked explicitly;
    a truncated envelope must fail loudly rather than reach AES with garbage.
    """
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")

    with pytest.raises(ValueError, match="AWS KMS envelope"):
        provider.decrypt_with_decoding(encrypted[:keep], "tenant-1")


@pytest.mark.usefixtures("fake_kms_client")
def test_non_object_metadata_is_rejected() -> None:
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")
    broken = _with_raw_metadata(encrypted, b'"a string, not an object"')

    with pytest.raises(ValueError, match="metadata is not a JSON object"):
        provider.decrypt_with_decoding(broken, "tenant-1")


@pytest.mark.usefixtures("fake_kms_client")
def test_unparsable_metadata_is_rejected() -> None:
    provider = AwsKmsKeyProvider()
    encrypted = provider.encrypt("tenant-1", "super-secret")
    broken = _with_raw_metadata(encrypted, b"{not json")

    with pytest.raises(ValueError, match="Malformed AWS KMS envelope"):
        provider.decrypt_with_decoding(broken, "tenant-1")


def _split(envelope: bytes) -> tuple[bytes, bytes, bytes]:
    """Return (header_up_to_metadata_len, metadata, remainder)."""
    body = envelope[len(b"HYBRID:") :]
    metadata_len = int.from_bytes(body[1:3], "big")
    return envelope[: len(b"HYBRID:") + 1], body[3 : 3 + metadata_len], body[3 + metadata_len :]


def _with_raw_metadata(envelope: bytes, metadata: bytes) -> bytes:
    head, _, rest = _split(envelope)
    return head + len(metadata).to_bytes(2, "big") + metadata + rest


def _with_metadata(envelope: bytes, metadata: dict) -> bytes:
    return _with_raw_metadata(envelope, json.dumps(metadata).encode())
