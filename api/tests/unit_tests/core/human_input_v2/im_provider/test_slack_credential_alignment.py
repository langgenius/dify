from __future__ import annotations

from controllers.common.human_input_channel_management import SlackChannelCandidateRequest
from controllers.common.human_input_v2_contracts import SlackIMIntegrationCredentials as SlackCredentialUpdate
from core.human_input_v2.channel_management import NewSecret, SlackIMCandidate
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import SlackIMIntegrationCredentials
from models.human_input_v2 import SlackIMIntegrationEncryptedCredentials


def test_slack_credential_projections_are_field_complete() -> None:
    logical_fields = set(SlackIMIntegrationCredentials.model_fields)

    assert set(SlackCredentialUpdate.model_fields) == logical_fields
    assert set(SlackChannelCandidateRequest.model_fields) == logical_fields
    assert {field.name for field in SlackIMCandidate.__dataclass_fields__.values()} == logical_fields
    assert set(SlackIMIntegrationEncryptedCredentials.model_fields) == {
        "provider",
        "client_id",
        "encrypted_client_secret",
        "encrypted_signing_secret",
        "encrypted_bot_token",
        "encrypted_app_token",
    }


def test_slack_candidate_repr_hides_every_secret() -> None:
    candidate = SlackIMCandidate(
        client_id="client-id",
        client_secret=NewSecret("client-secret"),
        signing_secret=NewSecret("signing-secret"),
        bot_token=NewSecret("bot-token"),
        app_token=NewSecret("app-token"),
    )

    assert candidate.provider is not None
    assert str(candidate.provider) == IMProvider.SLACK.value
    assert "client-secret" not in repr(candidate)
    assert "signing-secret" not in repr(candidate)
    assert "bot-token" not in repr(candidate)
    assert "app-token" not in repr(candidate)
