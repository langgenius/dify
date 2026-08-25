from __future__ import annotations

import logging
from typing import Annotated, get_args, get_origin

import pytest
from pydantic import SecretStr, TypeAdapter, ValidationError

from controllers.console.human_input_v2._common import StrictModel
from controllers.console.human_input_v2.providers import (
    DingTalkCredentialsInput,
    EmailProviderCredentials,
    FeishuCredentialsInput,
    LarkCredentialsInput,
    MSTeamsCredentialsInput,
    ResendCredentials,
    SlackCredentialsInput,
    WeComCredentialsInput,
)
from controllers.console.human_input_v2.providers import (
    IMProviderCredentialsInput as ConsoleIMProviderCredentials,
)
from core.human_input_v2.email_channel import ResendCandidate
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    DingTalkCredentials,
    FeishuCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from core.human_input_v2.im_integration.adapters.credentials import (
    IMProviderCredentials as ProviderIMProviderCredentials,
)

_IM_CASES = (
    (
        FeishuCredentialsInput,
        FeishuCredentials,
        {
            "provider": "feishu",
            "app_id": "app-id",
            "app_secret": "app-secret",
            "verification_token": "verification-token",
            "encrypt_key": "encrypt-key",
        },
    ),
    (
        LarkCredentialsInput,
        LarkCredentials,
        {
            "provider": "lark",
            "app_id": "app-id",
            "app_secret": "app-secret",
            "verification_token": "verification-token",
            "encrypt_key": "encrypt-key",
        },
    ),
    (
        SlackCredentialsInput,
        SlackCredentials,
        {
            "provider": "slack",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "signing_secret": "signing-secret",
            "bot_token": "xoxb-bot-token",
            "app_token": "xapp-app-token",
        },
    ),
    (
        DingTalkCredentialsInput,
        DingTalkCredentials,
        {
            "provider": "ding_talk",
            "corp_id": "corp-id",
            "client_id": "client-id",
            "client_secret": "client-secret",
        },
    ),
    (
        MSTeamsCredentialsInput,
        MSTeamsCredentials,
        {
            "provider": "ms_teams",
            "tenant_id": "11111111-1111-4111-8111-111111111111",
            "client_id": "22222222-2222-4222-8222-222222222222",
            "client_secret": "client-secret",
        },
    ),
    (
        WeComCredentialsInput,
        WeComCredentials,
        {
            "provider": "we_com",
            "corp_id": "corp-id",
            "agent_id": "12345",
            "secret": "wecom-secret",
        },
    ),
)
_RESEND_PAYLOAD = {
    "provider": "resend",
    "sender_email": "sender@example.com",
    "sender_name": "Dify",
    "api_key": "resend-api-key",
}
_SECRET_FIELD_NAMES = {
    "app_secret",
    "verification_token",
    "encrypt_key",
    "client_secret",
    "signing_secret",
    "bot_token",
    "app_token",
    "secret",
}
type _IMCredentialsDTO = (
    FeishuCredentialsInput
    | LarkCredentialsInput
    | SlackCredentialsInput
    | DingTalkCredentialsInput
    | MSTeamsCredentialsInput
    | WeComCredentialsInput
)


def test_console_union_is_a_distinct_six_dto_transport_boundary() -> None:
    console_value = ConsoleIMProviderCredentials.__value__

    assert ConsoleIMProviderCredentials is not ProviderIMProviderCredentials
    assert get_origin(console_value) is Annotated
    console_union, field = get_args(console_value)
    assert get_args(console_union) == tuple(case[0] for case in _IM_CASES)
    assert field.discriminator == "provider"
    assert all(dto_type is not owner_type for dto_type, owner_type, _payload in _IM_CASES)


@pytest.mark.parametrize(("dto_type", "owner_type", "payload"), _IM_CASES)
def test_im_provider_dto_constructs_complete_owner_credentials(
    dto_type: type[_IMCredentialsDTO],
    owner_type: type[object],
    payload: dict[str, str],
) -> None:
    credentials = TypeAdapter(ConsoleIMProviderCredentials).validate_python(payload)
    owner_credentials = credentials.to_owner_credentials()

    assert type(credentials) is dto_type
    assert type(owner_credentials) is owner_type
    assert type(owner_credentials) in get_args(get_args(ProviderIMProviderCredentials.__value__)[0])


def test_slack_app_token_is_optional_and_documented_for_socket_mode() -> None:
    payload = dict(_IM_CASES[2][2])
    del payload["app_token"]

    credentials = TypeAdapter(ConsoleIMProviderCredentials).validate_python(payload)

    assert isinstance(credentials, SlackCredentialsInput)
    assert credentials.app_token is None
    assert credentials.to_owner_credentials().app_token is None
    schema = SlackCredentialsInput.model_json_schema()
    assert "app_token" not in schema["required"]
    assert schema["properties"]["app_token"]["description"] == (
        "Optional Slack app-level token required only for Socket Mode."
    )


def test_resend_dto_constructs_complete_owner_candidate() -> None:
    credentials = TypeAdapter(EmailProviderCredentials).validate_python(_RESEND_PAYLOAD)

    candidate = credentials.to_owner_candidate()

    assert isinstance(credentials, ResendCredentials)
    assert isinstance(candidate, ResendCandidate)
    assert candidate.api_key == _RESEND_PAYLOAD["api_key"]
    assert candidate.api_key not in repr(candidate)


@pytest.mark.parametrize(("_dto_type", "_owner_type", "payload"), _IM_CASES)
def test_every_secret_uses_secret_str_and_is_absent_from_repr_and_logs(
    _dto_type: type[_IMCredentialsDTO],
    _owner_type: type[object],
    payload: dict[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    credentials = TypeAdapter(ConsoleIMProviderCredentials).validate_python(payload)
    secret_values = {value for name, value in payload.items() if name in _SECRET_FIELD_NAMES}

    for name in credentials.__class__.model_fields:
        if name in _SECRET_FIELD_NAMES:
            assert isinstance(getattr(credentials, name), (SecretStr, type(None)))

    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info("credentials=%r", credentials)
    rendered = repr(credentials) + caplog.text
    assert "credentials=" in caplog.text
    assert all(secret not in rendered for secret in secret_values)


def test_resend_api_key_uses_secret_str_and_is_absent_from_repr_and_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    credentials = TypeAdapter(EmailProviderCredentials).validate_python(_RESEND_PAYLOAD)

    assert isinstance(credentials, ResendCredentials)
    assert isinstance(credentials.api_key, SecretStr)

    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info("credentials=%r", credentials)

    rendered = repr(credentials) + caplog.text
    assert "credentials=" in caplog.text
    assert _RESEND_PAYLOAD["api_key"] not in rendered


@pytest.mark.parametrize("forbidden_field", ["event_transport_mode", "unexpected"])
def test_provider_dto_rejects_extra_fields(forbidden_field: str) -> None:
    payload = dict(_IM_CASES[2][2])
    payload[forbidden_field] = "socket"

    with pytest.raises(ValidationError):
        TypeAdapter(ConsoleIMProviderCredentials).validate_python(payload)


def test_validation_diagnostics_hide_submitted_secrets() -> None:
    class IMCredentialsEnvelope(StrictModel):
        credentials: ConsoleIMProviderCredentials

    payload = dict(_IM_CASES[2][2])
    payload["unexpected"] = "raw-provider-payload"

    with pytest.raises(ValidationError) as captured:
        IMCredentialsEnvelope.model_validate({"credentials": payload})

    rendered = str(captured.value)
    assert "client-secret" not in rendered
    assert "signing-secret" not in rendered
    assert "xoxb-bot-token" not in rendered
    assert "xapp-app-token" not in rendered
    assert "raw-provider-payload" not in rendered


def test_resend_validation_diagnostics_hide_api_key_and_raw_provider_payload() -> None:
    class EmailCredentialsEnvelope(StrictModel):
        credentials: EmailProviderCredentials

    payload = dict(_RESEND_PAYLOAD)
    payload["unexpected"] = "raw-provider-payload"

    with pytest.raises(ValidationError) as captured:
        EmailCredentialsEnvelope.model_validate({"credentials": payload})

    rendered = str(captured.value)
    assert _RESEND_PAYLOAD["api_key"] not in rendered
    assert "raw-provider-payload" not in rendered


@pytest.mark.parametrize("provider", list(IMProvider))
def test_missing_required_secret_is_rejected(provider: IMProvider) -> None:
    _, _, source = next(case for case in _IM_CASES if case[2]["provider"] == provider.value)
    payload = dict(source)
    secret_name = next(name for name in ("app_secret", "client_secret", "secret") if name in payload)
    del payload[secret_name]

    with pytest.raises(ValidationError):
        TypeAdapter(ConsoleIMProviderCredentials).validate_python(payload)
