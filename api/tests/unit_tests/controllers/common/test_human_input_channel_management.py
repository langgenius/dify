from __future__ import annotations

from datetime import datetime

import pytest
from pydantic import ValidationError

from controllers.common.human_input_channel_management import (
    ChannelRequestMappingError,
    DeleteChannelQuery,
    SaveChannelRequest,
    channel_ref_from_path,
    channel_test_response,
    channel_view_response,
    delete_channel_command,
    get_channel_command,
    require_test_result,
    require_view,
    save_channel_command,
)
from controllers.common.human_input_channel_management import (
    TestChannelRequest as ChannelTestRequest,
)
from controllers.common.human_input_channel_management import (
    test_channel_command as build_test_channel_command,
)
from controllers.common.human_input_v2_contracts import PreserveOriginalValue
from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelFailureCategory,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    ChannelScope,
    ChannelScopeKind,
    ChannelStatus,
    ChannelTestResult,
    ChannelView,
    IMChannelSummary,
    ResendChannelTestSummary,
    SaveEmailChannelCommand,
    SaveIMChannelCommand,
)
from core.human_input_v2.email_channel import RetainExistingAPIKey
from core.human_input_v2.shared import IntegrationId, NormalizedEmail


def test_only_supported_complete_refs_are_accepted() -> None:
    assert channel_ref_from_path("email", "resend") == ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    assert channel_ref_from_path("im", "slack") == ChannelRef(ChannelKind.IM, ChannelProvider.SLACK)

    with pytest.raises(ChannelRequestMappingError) as mismatch:
        channel_ref_from_path("email", "slack")

    assert mismatch.value.failure.category is ChannelFailureCategory.UNSUPPORTED_CHANNEL


def test_strict_request_rejects_extra_and_partial_cas_fields() -> None:
    with pytest.raises(ValidationError):
        SaveChannelRequest.model_validate(
            {
                "candidate": {
                    "provider": "slack",
                    "client_id": "client",
                    "client_secret": "secret",
                    "signing_secret": "signing",
                    "bot_token": "token",
                    "app_token": "app-token",
                    "tenant_id": "attacker-selected",
                }
            }
        )

    with pytest.raises(ValidationError):
        SaveChannelRequest.model_validate(
            {
                "candidate": {
                    "provider": "slack",
                    "client_id": "client",
                    "client_secret": "secret",
                    "signing_secret": "signing",
                    "bot_token": "token",
                    "app_token": "app-token",
                },
                "expected_integration_id": "integration-1",
            }
        )


@pytest.mark.parametrize(
    "secret",
    [
        "******",
        "••••••",
        "masked",
        "preserve-existing",
        "preserve_original_value",
    ],
)
def test_secret_placeholders_are_rejected(secret: str) -> None:
    with pytest.raises(ValidationError):
        SaveChannelRequest.model_validate(
            {
                "candidate": {
                    "provider": "slack",
                    "client_id": "client",
                    "client_secret": secret,
                    "signing_secret": "signing",
                    "bot_token": "token",
                    "app_token": "app-token",
                }
            }
        )


@pytest.mark.parametrize(
    "preserved_field",
    ["client_secret", "signing_secret", "bot_token", "app_token"],
)
def test_slack_save_accepts_structured_secret_preservation(preserved_field: str) -> None:
    candidate: dict[str, object] = {
        "provider": "slack",
        "client_id": "client",
        "client_secret": "client-secret",
        "signing_secret": "signing-secret",
        "bot_token": "bot-token",
        "app_token": "app-token",
    }
    candidate[preserved_field] = {"tag": "preserve_original_value"}

    request = SaveChannelRequest.model_validate(
        {
            "candidate": candidate,
            "expected_integration_id": "integration-1",
            "expected_config_version": 1,
        }
    )

    assert isinstance(getattr(request.candidate, preserved_field), PreserveOriginalValue)


def test_blank_secrets_and_email_revision_tokens_are_rejected() -> None:
    with pytest.raises(ValidationError):
        SaveChannelRequest.model_validate(
            {
                "candidate": {
                    "provider": "ding_talk",
                    "corp_id": "corp",
                    "client_id": "client",
                    "client_secret": " ",
                }
            }
        )

    with pytest.raises(ValidationError):
        SaveChannelRequest.model_validate(
            {
                "candidate": {
                    "provider": "resend",
                    "sender_email": "sender@example.com",
                },
                "expected_integration_id": "integration-1",
                "expected_config_version": 1,
            }
        )

    with pytest.raises(ValidationError):
        DeleteChannelQuery.model_validate({"expected_config_version": 1})


def test_blank_email_key_maps_to_explicit_retention() -> None:
    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    request = SaveChannelRequest.model_validate(
        {
            "candidate": {
                "provider": "resend",
                "sender_email": "Sender@Example.com",
                "sender_name": " Sender ",
                "api_key": " ",
            }
        }
    )

    command = save_channel_command(ref, request)

    assert isinstance(command, SaveEmailChannelCommand)
    assert isinstance(command.candidate.api_key, RetainExistingAPIKey)
    assert str(command.candidate.sender_email) == "sender@example.com"
    assert command.candidate.sender_name == "Sender"


def test_email_test_get_and_invalid_delete_commands_preserve_transport_semantics() -> None:
    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    request = ChannelTestRequest.model_validate(
        {
            "candidate": {
                "provider": "resend",
                "sender_email": "sender@example.com",
                "api_key": "resend-key",
            }
        }
    )

    assert get_channel_command(ref).ref == ref
    assert build_test_channel_command(ref, request).ref == ref

    with pytest.raises(ChannelRequestMappingError, match="email_revision_token_not_allowed"):
        delete_channel_command(
            ref,
            DeleteChannelQuery(
                expected_integration_id="integration-1",
                expected_config_version=1,
            ),
        )


def test_route_candidate_mismatch_is_rejected_before_dispatch() -> None:
    request = ChannelTestRequest.model_validate(
        {
            "candidate": {
                "provider": "feishu",
                "app_id": "app",
                "app_secret": "secret",
            }
        }
    )

    with pytest.raises(ChannelRequestMappingError) as mismatch:
        build_test_channel_command(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), request)

    assert mismatch.value.failure.category is ChannelFailureCategory.VALIDATION_FAILURE
    assert mismatch.value.failure.code == "channel_candidate_mismatch"


def test_im_save_and_delete_preserve_complete_revision_token() -> None:
    ref = ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK)
    request = SaveChannelRequest.model_validate(
        {
            "candidate": {
                "provider": "ding_talk",
                "corp_id": "corp",
                "client_id": "client",
                "client_secret": "secret",
            },
            "expected_integration_id": "integration-1",
            "expected_config_version": 3,
        }
    )

    save = save_channel_command(ref, request)
    delete = delete_channel_command(
        ref,
        DeleteChannelQuery(expected_integration_id="integration-1", expected_config_version=3),
    )

    assert isinstance(save, SaveIMChannelCommand)
    assert save.expected_integration_id == "integration-1"
    assert save.expected_config_version == 3
    assert delete.expected_integration_id == "integration-1"
    assert delete.expected_config_version == 3


def test_feishu_candidate_maps_every_optional_secret() -> None:
    ref = ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU)
    request = SaveChannelRequest.model_validate(
        {
            "candidate": {
                "provider": "feishu",
                "app_id": " app ",
                "app_secret": "secret",
                "verification_token": "verification",
                "encrypt_key": "encrypt-key",
            }
        }
    )

    command = save_channel_command(ref, request)

    assert isinstance(command, SaveIMChannelCommand)
    assert command.candidate.app_id == "app"
    assert command.candidate.verification_token is not None
    assert command.candidate.encrypt_key is not None


def test_persisted_and_test_responses_are_distinct_and_credential_free() -> None:
    ref = ChannelRef(ChannelKind.IM, ChannelProvider.SLACK)
    view = ChannelView(
        ref=ref,
        scope=ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1"),
        configured=True,
        status=ChannelStatus.CONNECTED,
        capabilities=frozenset((ChannelCapability.CONFIGURE, ChannelCapability.TEST)),
        summary=IMChannelSummary("team-1", IntegrationId("integration-1"), 2),
    )
    test_result = ChannelTestResult(
        ref=ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND),
        scope=ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1"),
        status=ChannelStatus.CONNECTED,
        summary=ResendChannelTestSummary(
            recipient_email=NormalizedEmail("operator@example.com"),
            sender_email=NormalizedEmail("sender@example.com"),
            sender_name="Sender",
        ),
        checked_at=datetime(2026, 7, 30),
    )

    view_payload = channel_view_response(view).model_dump(mode="json")
    test_payload = channel_test_response(test_result).model_dump(mode="json")

    assert view_payload["summary"]["integration_id"] == "integration-1"
    assert "checked_at" not in view_payload
    assert test_payload["summary"]["recipient_email"] == "operator@example.com"
    assert "configured" not in test_payload
    assert "integration_id" not in repr(test_payload)
    assert "secret" not in repr(view_payload).casefold()


def test_failed_operation_results_map_to_safe_transport_errors() -> None:
    result = ChannelOperationResult.failed(
        ChannelFailureCategory.PROVIDER_FAILURE,
        "provider_unavailable",
    )

    with pytest.raises(ChannelRequestMappingError, match="provider_unavailable"):
        require_view(result)
    with pytest.raises(ChannelRequestMappingError, match="provider_unavailable"):
        require_test_result(result)
