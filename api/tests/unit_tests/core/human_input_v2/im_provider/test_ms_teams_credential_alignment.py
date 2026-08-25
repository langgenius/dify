from __future__ import annotations

from controllers.console.human_input_v2.providers import MSTeamsCredentials as MSTeamsCredentialUpdate
from core.human_input_v2.im_provider import contracts


def test_ms_teams_resolved_credential_projection_is_registered() -> None:
    assert hasattr(contracts, "MSTeamsIMIntegrationCredentials")


def test_ms_teams_credential_projections_are_field_complete_and_secret_safe() -> None:
    resolved_type = contracts.MSTeamsIMIntegrationCredentials
    assert set(resolved_type.model_fields) == {"provider", "tenant_id", "client_id", "client_secret"}
    assert set(MSTeamsCredentialUpdate.model_fields) == {"provider", "tenant_id", "client_id", "client_secret"}

    credentials = resolved_type(
        provider="ms_teams",
        tenant_id="11111111-1111-1111-1111-111111111111",
        client_id="22222222-2222-2222-2222-222222222222",
        client_secret="test-only-client-secret",
    )

    assert credentials.model_config["frozen"] is True
    assert credentials.model_config["extra"] == "forbid"
    assert "test-only-client-secret" not in repr(credentials)
