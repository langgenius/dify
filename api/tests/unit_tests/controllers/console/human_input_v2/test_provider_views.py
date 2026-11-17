"""Persisted credential extensions must never escape through Console responses."""

from controllers.console.human_input_v2.provider_views import im_credentials_response
from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials


def test_response_explicitly_projects_known_redacted_fields() -> None:
    credentials = SlackCredentials.model_validate_json(
        '{"provider":"slack","client_id":"client","client_secret":"private",'
        '"signing_secret":"private","bot_token":"xoxb-private",'
        '"future_secret":{"nested":"new-private-secret"},"future_optional":null}'
    )

    assert im_credentials_response(credentials).model_dump(mode="json") == {
        "provider": "slack",
        "client_id": "client",
        "client_secret": {"type": "redacted"},
        "signing_secret": {"type": "redacted"},
        "bot_token": {"type": "redacted"},
        "app_token": None,
    }
