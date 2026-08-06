from dataclasses import fields

import pytest
from pydantic import ValidationError

from controllers.common.human_input_channel_management import (
    DingTalkChannelCandidateRequest,
    _candidate_from_request,
)
from controllers.common.human_input_v2_contracts import (
    DingTalkIMIntegrationCredentials as DingTalkCredentialUpdate,
)
from controllers.common.human_input_v2_contracts import (
    PreserveOriginalValue,
)
from core.human_input_v2.channel_management import (
    ChannelKind,
    ChannelProvider,
    ChannelRef,
    DingTalkIMCandidate,
    NewSecret,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import DingTalkIMIntegrationCredentials
from models.human_input_v2 import DingTalkIMIntegrationEncryptedCredentials


def test_dingtalk_credential_projections_are_field_aligned() -> None:
    logical_fields = {"provider", "corp_id", "client_id", "client_secret"}

    assert set(DingTalkCredentialUpdate.model_fields) == logical_fields
    assert set(DingTalkChannelCandidateRequest.model_fields) == logical_fields
    assert {field.name for field in fields(DingTalkIMCandidate)} == logical_fields
    assert set(DingTalkIMIntegrationCredentials.model_fields) == logical_fields
    assert set(DingTalkIMIntegrationEncryptedCredentials.model_fields) == {
        "provider",
        "corp_id",
        "client_id",
        "encrypted_client_secret",
    }


def test_dingtalk_credentials_are_strict_immutable_and_secret_safe() -> None:
    credentials = DingTalkIMIntegrationCredentials(
        provider=IMProvider.DING_TALK,
        corp_id="sanitized-corp-id",
        client_id="sanitized-client-id",
        client_secret="sanitized-client-secret",
    )
    candidate = DingTalkIMCandidate(
        corp_id="sanitized-corp-id",
        client_id="sanitized-client-id",
        client_secret=NewSecret("sanitized-client-secret"),
    )
    encrypted = DingTalkIMIntegrationEncryptedCredentials(
        corp_id="sanitized-corp-id",
        client_id="sanitized-client-id",
        encrypted_client_secret="sanitized-ciphertext",
    )

    assert credentials.model_config["frozen"] is True
    assert credentials.model_config["extra"] == "forbid"
    assert "sanitized-client-secret" not in repr(credentials)
    assert "sanitized-client-secret" not in repr(candidate)
    assert "sanitized-ciphertext" not in repr(encrypted)

    with pytest.raises(ValidationError):
        DingTalkIMIntegrationCredentials.model_validate(
            {
                **credentials.model_dump(),
                "unexpected": "fake-value",
            }
        )
    credential_field = "client_id"
    with pytest.raises(ValidationError):
        setattr(credentials, credential_field, "fake-replacement")


@pytest.mark.parametrize("field_name", ["corp_id", "client_id", "client_secret"])
def test_dingtalk_resolved_credentials_reject_blank_fields(field_name: str) -> None:
    values = {
        "provider": IMProvider.DING_TALK,
        "corp_id": "sanitized-corp-id",
        "client_id": "sanitized-client-id",
        "client_secret": "sanitized-client-secret",
    }
    values[field_name] = "   "

    with pytest.raises(ValidationError):
        DingTalkIMIntegrationCredentials.model_validate(values)


def test_preserve_original_value_never_enters_resolved_credentials() -> None:
    update = DingTalkCredentialUpdate(
        provider=IMProvider.DING_TALK,
        corp_id="fake-corp-001",
        client_id="fake-client-001",
        client_secret=PreserveOriginalValue(),
    )

    assert isinstance(update.client_secret, PreserveOriginalValue)
    assert "PreserveOriginalValue" not in repr(update)
    with pytest.raises(ValidationError):
        DingTalkIMIntegrationCredentials.model_validate(update.model_dump())


def test_channel_candidate_projection_trims_identifiers_and_owns_new_secret() -> None:
    request = DingTalkChannelCandidateRequest(
        provider=ChannelProvider.DING_TALK,
        corp_id="  fake-corp-001  ",
        client_id="  fake-client-001  ",
        client_secret="fake-client-secret-001",
    )

    candidate = _candidate_from_request(
        ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK),
        request,
    )

    assert candidate == DingTalkIMCandidate(
        corp_id="fake-corp-001",
        client_id="fake-client-001",
        client_secret=NewSecret("fake-client-secret-001"),
    )
    assert "fake-client-secret-001" not in repr(request)
    assert "fake-client-secret-001" not in repr(candidate)
