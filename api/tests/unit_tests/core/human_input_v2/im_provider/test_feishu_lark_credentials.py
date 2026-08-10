from collections.abc import Callable
from typing import cast

import pytest
from pydantic import ValidationError

from controllers.common.human_input_feishu_lark_credentials import (
    _resolve_required_secret,
    resolve_feishu_request_credentials,
    resolve_lark_request_credentials,
)
from controllers.common.human_input_v2_contracts import (
    FeishuIMIntegrationCredentials as FeishuCredentialRequest,
)
from controllers.common.human_input_v2_contracts import (
    LarkIMIntegrationCredentials as LarkCredentialRequest,
)
from controllers.common.human_input_v2_contracts import PreserveOriginalValue
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)
from models.human_input_v2 import (
    FeishuIMIntegrationEncryptedCredentials,
    LarkIMIntegrationEncryptedCredentials,
)
from services.human_input_feishu_lark_channel import (
    resolve_feishu_encrypted_credentials,
    resolve_lark_encrypted_credentials,
)


def _decryptor(values: dict[str, str]) -> Callable[[str], str]:
    return values.__getitem__


@pytest.mark.parametrize(
    ("resolved_type", "provider"),
    [
        (FeishuIMIntegrationCredentials, IMProvider.FEISHU),
        (LarkIMIntegrationCredentials, IMProvider.LARK),
    ],
)
def test_resolved_credentials_are_strict_frozen_and_secret_safe(
    resolved_type: type[FeishuIMIntegrationCredentials] | type[LarkIMIntegrationCredentials],
    provider: IMProvider,
) -> None:
    credentials = resolved_type(
        provider=provider,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key="sanitized-encrypt-key",
    )

    rendered = repr(credentials)
    assert "sanitized-app-secret" not in rendered
    assert "sanitized-verification-token" not in rendered
    assert "sanitized-encrypt-key" not in rendered
    with pytest.raises(ValidationError) as validation_error:
        resolved_type(
            provider=provider,
            app_id="cli_sanitized_app",
            app_secret="",
            verification_token="sanitized-verification-token",
            encrypt_key="sanitized-encrypt-key",
        )
    assert "sanitized-verification-token" not in str(validation_error.value)
    assert "sanitized-encrypt-key" not in str(validation_error.value)
    with pytest.raises(ValidationError):
        resolved_type.model_validate({**credentials.model_dump(), "unexpected": "value"})
    with pytest.raises(ValidationError):
        credentials.app_id = "changed"


def test_feishu_request_projection_resolves_each_secret_directive() -> None:
    current = FeishuIMIntegrationEncryptedCredentials(
        app_id="cli_old_app",
        encrypted_app_secret="cipher-app-secret",
        encrypted_verification_token="cipher-verification-token",
        encrypted_encrypt_key="cipher-encrypt-key",
    )
    request = FeishuCredentialRequest(
        provider=IMProvider.FEISHU,
        app_id="cli_new_app",
        app_secret=PreserveOriginalValue(),
        verification_token="new-verification-token",
        encrypt_key=None,
    )

    resolved = resolve_feishu_request_credentials(
        request,
        current,
        decrypt=_decryptor(
            {
                "cipher-app-secret": "old-app-secret",
                "cipher-verification-token": "old-verification-token",
                "cipher-encrypt-key": "old-encrypt-key",
            }
        ),
    )

    assert resolved == FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_new_app",
        app_secret="old-app-secret",
        verification_token="new-verification-token",
        encrypt_key=None,
    )


def test_lark_encrypted_projection_decrypts_every_secret() -> None:
    encrypted = LarkIMIntegrationEncryptedCredentials(
        app_id="cli_sanitized_app",
        encrypted_app_secret="cipher-app-secret",
        encrypted_verification_token="cipher-verification-token",
        encrypted_encrypt_key="cipher-encrypt-key",
    )

    resolved = resolve_lark_encrypted_credentials(
        encrypted,
        decrypt=_decryptor(
            {
                "cipher-app-secret": "resolved-app-secret",
                "cipher-verification-token": "resolved-verification-token",
                "cipher-encrypt-key": "resolved-encrypt-key",
            }
        ),
    )

    assert resolved == LarkIMIntegrationCredentials(
        provider=IMProvider.LARK,
        app_id="cli_sanitized_app",
        app_secret="resolved-app-secret",
        verification_token="resolved-verification-token",
        encrypt_key="resolved-encrypt-key",
    )


def test_lark_request_projection_applies_new_and_cleared_secrets() -> None:
    request = LarkCredentialRequest(
        provider=IMProvider.LARK,
        app_id="cli_new_app",
        app_secret="new-app-secret",
        verification_token=None,
        encrypt_key="new-encrypt-key",
    )

    resolved = resolve_lark_request_credentials(
        request,
        None,
        decrypt=lambda encrypted: encrypted,
    )

    assert resolved == LarkIMIntegrationCredentials(
        provider=IMProvider.LARK,
        app_id="cli_new_app",
        app_secret="new-app-secret",
        verification_token=None,
        encrypt_key="new-encrypt-key",
    )


def test_feishu_encrypted_projection_preserves_optional_clear_values() -> None:
    encrypted = FeishuIMIntegrationEncryptedCredentials(
        app_id="cli_sanitized_app",
        encrypted_app_secret="cipher-app-secret",
        encrypted_verification_token=None,
        encrypted_encrypt_key=None,
    )

    resolved = resolve_feishu_encrypted_credentials(
        encrypted,
        decrypt=_decryptor({"cipher-app-secret": "resolved-app-secret"}),
    )

    assert resolved == FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="resolved-app-secret",
        verification_token=None,
        encrypt_key=None,
    )


def test_preserve_without_current_secret_fails_safely() -> None:
    request = LarkCredentialRequest(
        provider=IMProvider.LARK,
        app_id="cli_sanitized_app",
        app_secret=PreserveOriginalValue(),
        verification_token=None,
        encrypt_key=None,
    )

    with pytest.raises(ValueError, match="preserved credential is unavailable"):
        resolve_lark_request_credentials(request, None, decrypt=lambda value: value)


def test_decryption_failure_does_not_expose_ciphertext_or_decryptor_error() -> None:
    encrypted = FeishuIMIntegrationEncryptedCredentials(
        app_id="cli_sanitized_app",
        encrypted_app_secret="cipher-sensitive-marker",
        encrypted_verification_token=None,
        encrypted_encrypt_key=None,
    )

    def fail_decryption(_encrypted: str) -> str:
        raise RuntimeError("decryptor-sensitive-marker")

    with pytest.raises(ValueError) as decryption_error:
        resolve_feishu_encrypted_credentials(
            encrypted,
            decrypt=fail_decryption,
        )

    rendered = str(decryption_error.value)
    assert "cipher-sensitive-marker" not in rendered
    assert "decryptor-sensitive-marker" not in rendered


def test_credential_schemas_remain_explicitly_aligned() -> None:
    logical_fields = {"provider", "app_id", "app_secret", "verification_token", "encrypt_key"}
    encrypted_fields = {
        "provider",
        "app_id",
        "encrypted_app_secret",
        "encrypted_verification_token",
        "encrypted_encrypt_key",
    }

    assert set(FeishuCredentialRequest.model_fields) == logical_fields
    assert set(LarkCredentialRequest.model_fields) == logical_fields
    assert set(FeishuIMIntegrationCredentials.model_fields) == logical_fields
    assert set(LarkIMIntegrationCredentials.model_fields) == logical_fields
    assert set(FeishuIMIntegrationEncryptedCredentials.model_fields) == encrypted_fields
    assert set(LarkIMIntegrationEncryptedCredentials.model_fields) == encrypted_fields


def test_projection_rejects_wrong_persistence_types_and_missing_required_secret() -> None:
    feishu = FeishuIMIntegrationEncryptedCredentials(
        app_id="cli_sanitized_app",
        encrypted_app_secret="cipher-app-secret",
        encrypted_verification_token=None,
        encrypted_encrypt_key=None,
    )
    lark = LarkIMIntegrationEncryptedCredentials(
        app_id="cli_sanitized_app",
        encrypted_app_secret="cipher-app-secret",
        encrypted_verification_token=None,
        encrypted_encrypt_key=None,
    )

    with pytest.raises(TypeError, match="Feishu encrypted"):
        resolve_feishu_encrypted_credentials(
            cast(FeishuIMIntegrationEncryptedCredentials, lark),
            decrypt=lambda value: value,
        )
    with pytest.raises(TypeError, match="Lark encrypted"):
        resolve_lark_encrypted_credentials(
            cast(LarkIMIntegrationEncryptedCredentials, feishu),
            decrypt=lambda value: value,
        )
    with pytest.raises(ValueError, match="required credential"):
        _resolve_required_secret(cast(str, None), None, lambda value: value)
