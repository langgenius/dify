import pytest
from pydantic import ValidationError

from controllers.console.human_input_v2.providers import (
    FeishuCredentials as FeishuCredentialRequest,
)
from controllers.console.human_input_v2.providers import LarkCredentials as LarkCredentialRequest
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)


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


def test_feishu_request_projection_requires_and_maps_complete_credentials() -> None:
    request = FeishuCredentialRequest(
        provider=IMProvider.FEISHU,
        app_id="cli_new_app",
        app_secret="new-app-secret",
        verification_token="new-verification-token",
        encrypt_key=None,
    )

    resolved = request.to_owner_credentials()

    assert resolved == FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_new_app",
        app_secret="new-app-secret",
        verification_token="new-verification-token",
        encrypt_key=None,
    )


def test_lark_request_projection_applies_new_and_cleared_secrets() -> None:
    request = LarkCredentialRequest(
        provider=IMProvider.LARK,
        app_id="cli_new_app",
        app_secret="new-app-secret",
        verification_token=None,
        encrypt_key="new-encrypt-key",
    )

    resolved = request.to_owner_credentials()

    assert resolved == LarkIMIntegrationCredentials(
        provider=IMProvider.LARK,
        app_id="cli_new_app",
        app_secret="new-app-secret",
        verification_token=None,
        encrypt_key="new-encrypt-key",
    )


def test_retention_marker_is_rejected_by_the_canonical_request() -> None:
    with pytest.raises(ValidationError):
        LarkCredentialRequest.model_validate(
            {
                "provider": IMProvider.LARK,
                "app_id": "cli_sanitized_app",
                "app_secret": {"tag": "preserve_original_value"},
                "verification_token": None,
                "encrypt_key": None,
            }
        )


def test_credential_schemas_remain_explicitly_aligned() -> None:
    logical_fields = {"provider", "app_id", "app_secret", "verification_token", "encrypt_key"}

    assert set(FeishuCredentialRequest.model_fields) == logical_fields
    assert set(LarkCredentialRequest.model_fields) == logical_fields
    assert set(FeishuIMIntegrationCredentials.model_fields) == logical_fields
    assert set(LarkIMIntegrationCredentials.model_fields) == logical_fields
