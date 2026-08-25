"""Domain tests for IM Integration configuration revision semantics."""

from dataclasses import replace
from datetime import datetime

import pytest

from core.human_input_v2.entities import IMBindingScope, IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    ConfigurationTransition,
    ConfigurationTransitionKind,
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMBinding,
    IMIdentity,
    IMIntegration,
    IntegrationRevisionToken,
    OpaqueProviderPayload,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    TenantId,
)

_NOW = datetime(2026, 7, 25, 8)
_LATER = datetime(2026, 7, 25, 9)


def _credentials(secret: str) -> EncryptedCredentials:
    return EncryptedCredentials(ciphertext=secret)


def _integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=_credentials("ciphertext-1"),
        app_identifier="app-1",
        configured_by_account_id=AccountId("account-1"),
        callback_url="https://example.com/callback",
        now=_NOW,
    )


def test_first_creation_owns_complete_revision_token() -> None:
    integration = _integration()

    assert integration.revision == IntegrationRevisionToken(IntegrationId("integration-1"), 1)
    assert integration.status is IMIntegrationStatus.CONFIGURED
    assert integration.encrypted_credentials == EncryptedCredentials(version=1, ciphertext="ciphertext-1")
    assert integration.app_identifier == "app-1"


@pytest.mark.parametrize("config_version", [0, -1])
def test_revision_token_requires_positive_version(config_version: int) -> None:
    with pytest.raises(ValueError, match="positive"):
        IntegrationRevisionToken(IntegrationId("integration-1"), config_version)


def test_opaque_values_reject_empty_envelopes_or_non_object_provider_payloads() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        EncryptedCredentials(ciphertext="")
    with pytest.raises(ValueError, match="JSON object"):
        OpaqueProviderPayload("[]").to_mapping()


def test_provider_tenant_and_integration_require_valid_persisted_values() -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        ProviderTenantIdentity(IMProvider.FEISHU, " ")
    with pytest.raises(ValueError, match="positive"):
        replace(_integration(), config_version=0)
    with pytest.raises(ValueError, match="must not be blank"):
        replace(_integration(), app_identifier=" ")


@pytest.mark.parametrize("app_identifier", ["", "   ", "  supplied-app  "])
def test_confirmed_configuration_preserves_supplied_app_identifier_exactly(app_identifier: str) -> None:
    confirmed = ConfirmedIMConfiguration(
        provider=IMProvider.FEISHU,
        provider_tenant_id="  provider-tenant-1  ",
        encrypted_credentials=_credentials("opaque-ciphertext"),
        app_identifier=app_identifier,
        callback_url=None,
        provider_tenant_display=None,
    )

    assert confirmed.app_identifier == app_identifier
    assert confirmed.provider_tenant_id == "provider-tenant-1"


def test_confirmed_configuration_rejects_blank_provider_tenant_id() -> None:
    with pytest.raises(ValueError, match="provider tenant id must not be blank"):
        ConfirmedIMConfiguration(
            provider=IMProvider.FEISHU,
            provider_tenant_id="   ",
            encrypted_credentials=_credentials("opaque-ciphertext"),
            app_identifier="",
            callback_url=None,
            provider_tenant_display=None,
        )


def test_identity_and_binding_reject_invalid_current_state() -> None:
    with pytest.raises(ValueError, match="provider user id"):
        IMIdentity.create(
            identity_id=IMIdentityId("identity-1"),
            integration_id=IntegrationId("integration-1"),
            provider=IMProvider.FEISHU,
            provider_user_id=" ",
            display_name=None,
            email=None,
            raw_payload={},
            last_seen_sync_run_id=None,
            last_seen_at=None,
            now=_NOW,
        )
    with pytest.raises(ValueError, match="scope id"):
        IMBinding.create(
            binding_id=IMBindingId("binding-1"),
            integration_id=IntegrationId("integration-1"),
            scope=IMBindingScope.WORKSPACE,
            scope_id=" ",
            contact_id=ContactId("contact-1"),
            identity_id=IMIdentityId("identity-1"),
            provider=IMProvider.FEISHU,
            bound_by_account_id=None,
            now=_NOW,
        )
    with pytest.raises(ValueError, match="organization binding scope"):
        IMBinding.create(
            binding_id=IMBindingId("binding-1"),
            integration_id=IntegrationId("integration-1"),
            scope=IMBindingScope.ORGANIZATION,
            scope_id="integration-other",
            contact_id=ContactId("contact-1"),
            identity_id=IMIdentityId("identity-1"),
            provider=IMProvider.FEISHU,
            bound_by_account_id=None,
            now=_NOW,
        )


def test_confirmed_credential_rotation_advances_once_and_preserves_current_state() -> None:
    integration = _integration()

    decision = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=_credentials("ciphertext-2"),
        app_identifier="app-2",
        configured_by_account_id=AccountId("account-2"),
        callback_url="https://example.com/new-callback",
        now=_LATER,
    )

    assert isinstance(decision, ConfigurationTransition)
    assert decision.kind is ConfigurationTransitionKind.CREDENTIAL_ROTATION
    assert decision.integration.id == integration.id
    assert decision.integration.revision.config_version == 2
    assert decision.integration.app_identifier == "app-2"
    assert decision.invalidation.invalidate_identities is False
    assert decision.invalidation.invalidate_bindings is False


def test_credential_rotation_rejects_replacement_identity() -> None:
    integration = _integration()

    with pytest.raises(ValueError, match="must preserve integration identity"):
        integration.reconfigure(
            expected_revision=integration.revision,
            provider_tenant=integration.provider_tenant,
            encrypted_credentials=_credentials("ciphertext-2"),
            app_identifier="app-2",
            configured_by_account_id=None,
            callback_url=None,
            now=_LATER,
            replacement_integration_id=IntegrationId("integration-2"),
        )


def test_provider_tenant_replacement_gets_new_identity_and_invalidates_current_state() -> None:
    integration = _integration()

    decision = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-tenant-2"),
        encrypted_credentials=EncryptedCredentials(ciphertext="ciphertext-2"),
        app_identifier="client-1",
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
        replacement_integration_id=IntegrationId("integration-2"),
    )

    assert isinstance(decision, ConfigurationTransition)
    assert decision.kind is ConfigurationTransitionKind.PROVIDER_REPLACEMENT
    assert decision.integration.id == IntegrationId("integration-2")
    assert decision.integration.revision.config_version == 1
    assert decision.integration.app_identifier == "client-1"
    assert decision.invalidation.invalidate_identities is True
    assert decision.invalidation.invalidate_bindings is True

    stale = decision.integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=decision.integration.provider_tenant,
        encrypted_credentials=decision.integration.encrypted_credentials,
        app_identifier=decision.integration.app_identifier,
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
    )
    assert stale == StaleRevision(expected=integration.revision, actual=decision.integration.revision)


def test_provider_replacement_requires_new_integration_identity() -> None:
    integration = _integration()

    with pytest.raises(ValueError, match="requires a new integration identity"):
        integration.reconfigure(
            expected_revision=integration.revision,
            provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-tenant-2"),
            encrypted_credentials=EncryptedCredentials(ciphertext="ciphertext-2"),
            app_identifier="client-1",
            configured_by_account_id=None,
            callback_url=None,
            now=_LATER,
        )


def test_stale_update_and_delete_return_stable_results() -> None:
    integration = _integration()
    stale_token = IntegrationRevisionToken(integration.id, 9)

    update = integration.reconfigure(
        expected_revision=stale_token,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=_credentials("ciphertext-2"),
        app_identifier="app-2",
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
