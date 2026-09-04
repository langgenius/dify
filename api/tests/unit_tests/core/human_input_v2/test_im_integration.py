"""Domain tests for IM provider preparation, identities, and bindings."""

from datetime import datetime

import pytest

from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.im_integration import (
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMBinding,
    IMIdentity,
    OpaqueProviderPayload,
)
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
)

_NOW = datetime(2026, 7, 25, 8)


def _credentials(secret: str) -> EncryptedCredentials:
    return EncryptedCredentials(ciphertext=secret)


def test_opaque_provider_payload_rejects_non_object_json() -> None:
    with pytest.raises(ValueError, match="JSON object"):
        OpaqueProviderPayload("[]").to_mapping()


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
