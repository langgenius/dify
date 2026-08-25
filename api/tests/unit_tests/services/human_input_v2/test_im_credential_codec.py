"""Whole-configuration IM credential envelope contracts."""

from __future__ import annotations

import json
from base64 import b64encode
from dataclasses import dataclass
from inspect import getsource, signature
from typing import Annotated, Protocol, get_args, get_origin, get_type_hints, override

import pytest
from pydantic import BaseModel, ValidationError
from pydantic.fields import FieldInfo

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import EncryptedCredentials
from core.human_input_v2.im_integration.adapters import (
    DingTalkCredentials,
    FeishuCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from core.human_input_v2.im_integration.adapters.credentials import (
    IMProviderCredentials,
    IMProviderCredentialsAdapter,
)
from models.human_input_v2 import HumanInputIMIntegration, IMEncryptedCredentials
from models.types import FrozenPydanticModelColumn
from services.human_input_v2 import im_credential_codec as codec_module
from services.human_input_v2.im_credential_codec import (
    BoundCredentialCipher,
    IMCredentialCodec,
    IMCredentialError,
)

_SAFE_ERROR = "IM credential configuration is unavailable"
_CREDENTIAL_TYPES = (
    FeishuCredentials,
    LarkCredentials,
    SlackCredentials,
    DingTalkCredentials,
    MSTeamsCredentials,
    WeComCredentials,
)


@dataclass(frozen=True, slots=True)
class _CredentialCase:
    credentials: IMProviderCredentials


_CASES = (
    _CredentialCase(
        FeishuCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key="feishu-encrypt-key",
        )
    ),
    _CredentialCase(
        LarkCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key=None,
        )
    ),
    _CredentialCase(
        SlackCredentials(
            provider=IMProvider.SLACK,
            client_id="slack-client",
            client_secret="slack-client-secret",
            signing_secret="slack-signing-secret",
            bot_token="xoxb-slack-bot-token",
            app_token="xapp-slack-app-token",
        )
    ),
    _CredentialCase(
        DingTalkCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="ding-secret",
        )
    ),
    _CredentialCase(
        MSTeamsCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000001",
            client_id="00000000-0000-0000-0000-000000000002",
            client_secret="teams-secret",
        )
    ),
    _CredentialCase(
        WeComCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1001",
            secret="wecom-secret",
        )
    ),
)


class _RecordingCipher:
    def __init__(self, ciphertext: bytes = b"\x00\xffopaque-ciphertext") -> None:
        self.ciphertext = ciphertext
        self.encrypt_calls: list[str] = []
        self.decrypt_calls: list[bytes] = []

    def encrypt(self, plaintext: str) -> bytes:
        self.encrypt_calls.append(plaintext)
        return self.ciphertext

    def decrypt(self, ciphertext: bytes) -> str:
        self.decrypt_calls.append(ciphertext)
        return self.encrypt_calls[-1]


def test_bound_cipher_protocol_is_exactly_owner_free() -> None:
    assert issubclass(BoundCredentialCipher, Protocol)
    assert BoundCredentialCipher.__doc__ == "A credential cipher bounded to a tenant or the whole deployment."
    assert tuple(signature(BoundCredentialCipher.encrypt).parameters) == ("self", "plaintext")
    assert get_type_hints(BoundCredentialCipher.encrypt) == {"plaintext": str, "return": bytes}
    assert tuple(signature(BoundCredentialCipher.decrypt).parameters) == ("self", "ciphertext")
    assert get_type_hints(BoundCredentialCipher.decrypt) == {"ciphertext": bytes, "return": str}


def test_canonical_provider_union_is_discriminated_and_bound_to_the_named_adapter() -> None:
    canonical_value = IMProviderCredentials.__value__

    assert get_origin(canonical_value) is Annotated
    union, field = get_args(canonical_value)
    assert get_args(union) == _CREDENTIAL_TYPES
    assert isinstance(field, FieldInfo)
    assert field.discriminator == "provider"
    assert codec_module.IMProviderCredentialsAdapter is IMProviderCredentialsAdapter
    assert IMProviderCredentialsAdapter._type is IMProviderCredentials
    assert get_type_hints(IMCredentialCodec.load)["return"] is IMProviderCredentials

    for case in _CASES:
        recovered = IMProviderCredentialsAdapter.validate_json(case.credentials.model_dump_json())
        assert recovered == case.credentials
        assert type(recovered) is type(case.credentials)


@pytest.mark.parametrize(
    "payload",
    [
        {"provider": "discord", "token": "unsupported"},
        {"provider": "slack", "app_id": "wrong-variant", "app_secret": "wrong-variant-secret"},
        {"client_id": "missing-discriminator"},
    ],
    ids=("unknown-discriminator", "invalid-variant", "missing-discriminator"),
)
def test_canonical_provider_union_rejects_invalid_discriminators_and_variants(payload: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        IMProviderCredentialsAdapter.validate_python(payload)


def test_runtime_codec_has_none_of_the_superseded_mapping_or_wrapper_design() -> None:
    forbidden_symbols = {
        "_CREDENTIAL_MODEL_BY_PROVIDER",
        "_require_supported",
        "_parse_credentials",
        "SealedIMCredentialConfiguration",
        "IMCredentialLoadingError",
        "IMCredentialProtectionError",
    }

    assert forbidden_symbols.isdisjoint(vars(codec_module))
    source = getsource(codec_module)
    assert "MappingProxyType" not in source
    assert "isinstance(" not in source


def test_persisted_envelope_schema_is_exact_strict_frozen_and_concrete() -> None:
    assert IMEncryptedCredentials.__bases__ == (BaseModel,)
    assert set(IMEncryptedCredentials.model_fields) == {"version", "ciphertext"}
    assert IMEncryptedCredentials.model_config == {
        "extra": "forbid",
        "frozen": True,
        "strict": True,
        "validate_default": True,
    }

    column_type = HumanInputIMIntegration.__table__.c.encrypted_credentials.type
    assert isinstance(column_type, FrozenPydanticModelColumn)
    assert column_type._model_type is IMEncryptedCredentials
    assert column_type._adapter is None

    envelope = IMEncryptedCredentials(ciphertext="opaque-ciphertext")
    assert envelope.version == 1
    assert "opaque-ciphertext" not in repr(envelope)
    with pytest.raises(ValidationError):
        IMEncryptedCredentials.model_validate({"version": 1, "ciphertext": ""}, strict=True)
    with pytest.raises(ValidationError):
        IMEncryptedCredentials.model_validate({"version": "1", "ciphertext": "opaque"}, strict=True)
    with pytest.raises(ValidationError):
        IMEncryptedCredentials.model_validate(
            {"version": 1, "ciphertext": "opaque", "provider": IMProvider.SLACK},
            strict=True,
        )


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.credentials.provider.value)
def test_codec_seals_and_recovers_complete_typed_credentials_once(case: _CredentialCase) -> None:
    cipher = _RecordingCipher()
    codec = IMCredentialCodec(cipher)

    sealed = codec.seal(case.credentials)

    assert sealed == EncryptedCredentials(version=1, ciphertext=b64encode(cipher.ciphertext).decode())
    assert len(cipher.encrypt_calls) == 1
    assert json.loads(cipher.encrypt_calls[0]) == case.credentials.model_dump(mode="json")

    recovered = codec.load(case.credentials.provider, sealed)

    assert recovered == case.credentials
    assert type(recovered) is type(case.credentials)
    assert cipher.decrypt_calls == [cipher.ciphertext]


def test_codec_rejects_unknown_version_before_base64_decode_or_decryption() -> None:
    invalid_envelope = object.__new__(EncryptedCredentials)
    object.__setattr__(invalid_envelope, "version", 2)
    object.__setattr__(invalid_envelope, "ciphertext", "sensitive-ciphertext")
    cipher = _RecordingCipher()

    with pytest.raises(IMCredentialError, match=_SAFE_ERROR) as captured:
        IMCredentialCodec(cipher).load(IMProvider.SLACK, invalid_envelope)

    assert cipher.decrypt_calls == []
    assert str(captured.value) == _SAFE_ERROR
    assert "sensitive-ciphertext" not in repr(captured.value)


def test_codec_rejects_invalid_base64_payload_before_decryption() -> None:
    class _NoDecryptCipher(_RecordingCipher):
        @override
        def decrypt(self, ciphertext: bytes) -> str:
            del ciphertext
            raise AssertionError("invalid base64 must fail before decryption")

    cipher = _NoDecryptCipher()

    with pytest.raises(IMCredentialError, match=_SAFE_ERROR) as captured:
        IMCredentialCodec(cipher).load(
            IMProvider.SLACK,
            EncryptedCredentials(ciphertext="not-valid-base64"),
        )

    assert str(captured.value) == _SAFE_ERROR
    assert "not-valid-base64" not in repr(captured.value)
    assert captured.value.__cause__ is not None


@pytest.mark.parametrize("recovered_payload", ["[]", "{}", "not-json"], ids=("non-object", "empty", "malformed"))
def test_codec_rejects_invalid_recovered_payload_with_safe_outer_error_and_diagnostic_cause(
    recovered_payload: str,
) -> None:
    class _InvalidPayloadCipher(_RecordingCipher):
        @override
        def decrypt(self, ciphertext: bytes) -> str:
            self.decrypt_calls.append(ciphertext)
            return recovered_payload

    cipher = _InvalidPayloadCipher()

    with pytest.raises(IMCredentialError, match=_SAFE_ERROR) as captured:
        IMCredentialCodec(cipher).load(
            IMProvider.SLACK,
            EncryptedCredentials(ciphertext=b64encode(cipher.ciphertext).decode()),
        )

    assert str(captured.value) == _SAFE_ERROR
    assert recovered_payload not in repr(captured.value)
    assert isinstance(captured.value.__cause__, ValidationError)


def test_codec_rejects_recovered_provider_mismatch_before_provider_io() -> None:
    mismatched_credentials = FeishuCredentials(
        provider=IMProvider.FEISHU,
        app_id="feishu-app",
        app_secret="plaintext-secret",
        verification_token=None,
        encrypt_key=None,
    )

    class _MismatchedCipher(_RecordingCipher):
        @override
        def decrypt(self, ciphertext: bytes) -> str:
            self.decrypt_calls.append(ciphertext)
            return mismatched_credentials.model_dump_json()

    cipher = _MismatchedCipher()

    with pytest.raises(IMCredentialError, match=_SAFE_ERROR) as captured:
        IMCredentialCodec(cipher).load(
            IMProvider.SLACK,
            EncryptedCredentials(ciphertext=b64encode(cipher.ciphertext).decode()),
        )

    assert str(captured.value) == _SAFE_ERROR
    assert "plaintext-secret" not in repr(captured.value)
    assert captured.value.__cause__ is None


def test_codec_preserves_cipher_failures_as_causes_without_exposing_them() -> None:
    class _FailingCipher:
        def encrypt(self, plaintext: str) -> bytes:
            del plaintext
            raise RuntimeError("raw-encryptor-secret")

        def decrypt(self, ciphertext: bytes) -> str:
            del ciphertext
            raise RuntimeError("raw-decryptor-secret")

    codec = IMCredentialCodec(_FailingCipher())

    with pytest.raises(IMCredentialError) as loading_error:
        codec.load(
            IMProvider.SLACK,
            EncryptedCredentials(ciphertext=b64encode(b"sensitive-ciphertext").decode()),
        )
    with pytest.raises(IMCredentialError) as protection_error:
        codec.seal(_CASES[2].credentials)

    assert str(loading_error.value) == _SAFE_ERROR
    assert "raw-decryptor-secret" not in repr(loading_error.value)
    assert "sensitive-ciphertext" not in repr(loading_error.value)
    assert isinstance(loading_error.value.__cause__, RuntimeError)
    assert str(protection_error.value) == _SAFE_ERROR
    assert "raw-encryptor-secret" not in repr(protection_error.value)
    assert "slack-client-secret" not in repr(protection_error.value)
    assert isinstance(protection_error.value.__cause__, RuntimeError)
