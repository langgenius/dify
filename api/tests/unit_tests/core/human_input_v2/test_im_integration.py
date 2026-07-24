"""Domain tests for IM Integration configuration revision semantics."""

from datetime import UTC, datetime

import pytest

from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    ConfigurationTransitionKind,
    EncryptedCredentials,
    IMIntegration,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.shared import AccountId, IntegrationId, UtcTimestamp, WorkspaceId

_NOW = UtcTimestamp(datetime(2026, 7, 25, 8, tzinfo=UTC))
_LATER = UtcTimestamp(datetime(2026, 7, 25, 9, tzinfo=UTC))


def _credentials(secret: str) -> EncryptedCredentials:
    return EncryptedCredentials.from_mapping({"app_id": "app-1", "encrypted_app_secret": secret})


def _integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        workspace_id=WorkspaceId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=_credentials("ciphertext-1"),
        configured_by_account_id=AccountId("account-1"),
        callback_url="https://example.com/callback",
        now=_NOW,
    )


def test_first_creation_owns_complete_revision_token() -> None:
    integration = _integration()

    assert integration.revision == IntegrationRevisionToken(IntegrationId("integration-1"), 1)
    assert integration.status is IMIntegrationStatus.CONFIGURED
    assert integration.encrypted_credentials.to_mapping()["encrypted_app_secret"] == "ciphertext-1"


@pytest.mark.parametrize("config_version", [0, -1])
def test_revision_token_requires_positive_version(config_version: int) -> None:
    with pytest.raises(ValueError, match="positive"):
        IntegrationRevisionToken(IntegrationId("integration-1"), config_version)


def test_confirmed_credential_rotation_advances_once_and_preserves_current_state() -> None:
    integration = _integration()

    decision = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=_credentials("ciphertext-2"),
        configured_by_account_id=AccountId("account-2"),
        callback_url="https://example.com/new-callback",
        now=_LATER,
    )

    assert decision.kind is ConfigurationTransitionKind.CREDENTIAL_ROTATION
    assert decision.integration.id == integration.id
    assert decision.integration.revision.config_version == 2
    assert decision.invalidation.invalidate_identities is False
    assert decision.invalidation.invalidate_bindings is False


def test_provider_tenant_replacement_gets_new_identity_and_invalidates_current_state() -> None:
    integration = _integration()

    decision = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-tenant-2"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "client-1",
                "encrypted_client_secret": "ciphertext-2",
                "encrypted_signing_secret": "ciphertext-3",
                "encrypted_bot_token": "ciphertext-4",
            }
        ),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
        replacement_integration_id=IntegrationId("integration-2"),
    )

    assert decision.kind is ConfigurationTransitionKind.PROVIDER_REPLACEMENT
    assert decision.integration.id == IntegrationId("integration-2")
    assert decision.integration.revision.config_version == 1
    assert decision.invalidation.invalidate_identities is True
    assert decision.invalidation.invalidate_bindings is True

    stale = decision.integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=decision.integration.provider_tenant,
        encrypted_credentials=decision.integration.encrypted_credentials,
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
    )
    assert stale == StaleRevision(expected=integration.revision, actual=decision.integration.revision)


def test_stale_update_and_delete_return_stable_results() -> None:
    integration = _integration()
    stale_token = IntegrationRevisionToken(integration.id, 9)

    update = integration.reconfigure(
        expected_revision=stale_token,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=_credentials("ciphertext-2"),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
    )
    deletion = integration.plan_deletion(stale_token)

    expected = StaleRevision(expected=stale_token, actual=integration.revision)
    assert update == expected
    assert deletion == expected


def test_connectivity_diagnostics_do_not_advance_configuration_revision() -> None:
    integration = _integration()

    updated = integration.record_diagnostics(
        status=IMIntegrationStatus.CONNECTED,
        safe_status_reason="Connection verified",
        checked_at=_LATER,
    )

    assert updated.revision == integration.revision
    assert updated.status is IMIntegrationStatus.CONNECTED
    assert updated.last_checked_at == _LATER
