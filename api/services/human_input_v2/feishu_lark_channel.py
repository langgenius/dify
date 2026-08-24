"""Typed Human Input v2 credential projections for Feishu and Lark adapters."""

from __future__ import annotations

from collections.abc import Callable

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)
from models.human_input_v2 import (
    FeishuIMIntegrationEncryptedCredentials,
    LarkIMIntegrationEncryptedCredentials,
)


def resolve_feishu_encrypted_credentials(
    encrypted: FeishuIMIntegrationEncryptedCredentials,
    *,
    decrypt: Callable[[str], str],
) -> FeishuIMIntegrationCredentials:
    """Resolve the exact Feishu persistence schema into adapter credentials."""

    if not isinstance(encrypted, FeishuIMIntegrationEncryptedCredentials):
        raise TypeError("Feishu encrypted credentials are required")
    return FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id=encrypted.app_id,
        app_secret=decrypt_credential_secret(encrypted.encrypted_app_secret, decrypt),
        verification_token=_decrypt_optional_secret(encrypted.encrypted_verification_token, decrypt),
        encrypt_key=_decrypt_optional_secret(encrypted.encrypted_encrypt_key, decrypt),
    )


def resolve_lark_encrypted_credentials(
    encrypted: LarkIMIntegrationEncryptedCredentials,
    *,
    decrypt: Callable[[str], str],
) -> LarkIMIntegrationCredentials:
    """Resolve the exact Lark persistence schema into adapter credentials."""

    if not isinstance(encrypted, LarkIMIntegrationEncryptedCredentials):
        raise TypeError("Lark encrypted credentials are required")
    return LarkIMIntegrationCredentials(
        provider=IMProvider.LARK,
        app_id=encrypted.app_id,
        app_secret=decrypt_credential_secret(encrypted.encrypted_app_secret, decrypt),
        verification_token=_decrypt_optional_secret(encrypted.encrypted_verification_token, decrypt),
        encrypt_key=_decrypt_optional_secret(encrypted.encrypted_encrypt_key, decrypt),
    )


def _decrypt_optional_secret(encrypted: str | None, decrypt: Callable[[str], str]) -> str | None:
    if encrypted is None:
        return None
    return decrypt_credential_secret(encrypted, decrypt)


def decrypt_credential_secret(encrypted: str, decrypt: Callable[[str], str]) -> str:
    """Decrypt one persisted secret without leaking boundary-specific failures."""

    try:
        return decrypt(encrypted)
    except Exception:
        # This boundary must never propagate ciphertext or a decryptor-specific exception.
        raise ValueError("credential decryption failed") from None
