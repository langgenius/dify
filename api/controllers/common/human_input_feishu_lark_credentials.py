"""Controller-local request projections for Feishu and Lark credentials."""

from collections.abc import Callable

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
from services.human_input_feishu_lark_channel import decrypt_credential_secret

type _SecretDirective = str | PreserveOriginalValue | None


def resolve_feishu_request_credentials(
    request: FeishuCredentialRequest,
    current: FeishuIMIntegrationEncryptedCredentials | None,
    *,
    decrypt: Callable[[str], str],
) -> FeishuIMIntegrationCredentials:
    """Project every Feishu request field without generic secret passthrough."""

    return FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id=request.app_id,
        app_secret=_resolve_required_secret(
            request.app_secret,
            current.encrypted_app_secret if current is not None else None,
            decrypt,
        ),
        verification_token=_resolve_secret(
            request.verification_token,
            current.encrypted_verification_token if current is not None else None,
            decrypt,
        ),
        encrypt_key=_resolve_secret(
            request.encrypt_key,
            current.encrypted_encrypt_key if current is not None else None,
            decrypt,
        ),
    )


def resolve_lark_request_credentials(
    request: LarkCredentialRequest,
    current: LarkIMIntegrationEncryptedCredentials | None,
    *,
    decrypt: Callable[[str], str],
) -> LarkIMIntegrationCredentials:
    """Project every Lark request field without generic secret passthrough."""

    return LarkIMIntegrationCredentials(
        provider=IMProvider.LARK,
        app_id=request.app_id,
        app_secret=_resolve_required_secret(
            request.app_secret,
            current.encrypted_app_secret if current is not None else None,
            decrypt,
        ),
        verification_token=_resolve_secret(
            request.verification_token,
            current.encrypted_verification_token if current is not None else None,
            decrypt,
        ),
        encrypt_key=_resolve_secret(
            request.encrypt_key,
            current.encrypted_encrypt_key if current is not None else None,
            decrypt,
        ),
    )


def _resolve_required_secret(
    directive: str | PreserveOriginalValue,
    encrypted_current: str | None,
    decrypt: Callable[[str], str],
) -> str:
    resolved = _resolve_secret(directive, encrypted_current, decrypt)
    if resolved is None:
        raise ValueError("required credential is unavailable")
    return resolved


def _resolve_secret(
    directive: _SecretDirective,
    encrypted_current: str | None,
    decrypt: Callable[[str], str],
) -> str | None:
    if directive is None or isinstance(directive, str):
        return directive
    if encrypted_current is None:
        raise ValueError("preserved credential is unavailable")
    return decrypt_credential_secret(encrypted_current, decrypt)
