"""Effective IM binding resolution tests."""

from datetime import UTC, datetime

from core.human_input_v2.contact_directory import Contact, ContactSnapshot
from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.im_integration import (
    BindingResolutionKind,
    EffectiveBindingResolver,
    IMBinding,
    IMIdentity,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    UtcTimestamp,
    WorkspaceId,
)

_NOW = UtcTimestamp(datetime(2026, 7, 25, 8, tzinfo=UTC))
_INTEGRATION_ID = IntegrationId("integration-1")
_WORKSPACE_ID = WorkspaceId("workspace-1")


def _contact() -> ContactSnapshot:
    return ContactSnapshot(
        contact=Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="Reviewer",
            email="reviewer@example.com",
            now=_NOW,
        ),
        account_available=True,
    )


def _identity(identity_id: str, provider_user_id: str, email: str = "reviewer@example.com") -> IMIdentity:
    return IMIdentity.create(
        identity_id=IMIdentityId(identity_id),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id=provider_user_id,
        display_name="Reviewer",
        email=email,
        raw_payload={"secret-provider-fact": "must-not-leak"},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )


def _binding(binding_id: str, identity: IMIdentity, scope: IMBindingScope) -> IMBinding:
    return IMBinding.create(
        binding_id=IMBindingId(binding_id),
        integration_id=_INTEGRATION_ID,
        scope=scope,
        scope_id=str(_WORKSPACE_ID if scope is IMBindingScope.WORKSPACE else _INTEGRATION_ID),
        contact_id=ContactId("contact-1"),
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )


def _resolve(*, identities: tuple[IMIdentity, ...], bindings: tuple[IMBinding, ...]):
    return EffectiveBindingResolver.resolve(
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        workspace_id=_WORKSPACE_ID,
        contact=_contact(),
        identities=identities,
        bindings=bindings,
    )


def test_workspace_binding_has_priority_over_organization_binding() -> None:
    organization_identity = _identity("identity-org", "org-user")
    workspace_identity = _identity("identity-workspace", "workspace-user")

    result = _resolve(
        identities=(organization_identity, workspace_identity),
        bindings=(
            _binding("binding-org", organization_identity, IMBindingScope.ORGANIZATION),
            _binding("binding-workspace", workspace_identity, IMBindingScope.WORKSPACE),
        ),
    )

    assert result.kind is BindingResolutionKind.WORKSPACE_OVERRIDE
    assert result.binding is not None
    assert result.binding.provider_user_id == "workspace-user"


def test_reset_to_global_is_represented_by_absent_workspace_override() -> None:
    organization_identity = _identity("identity-org", "org-user")

    result = _resolve(
        identities=(organization_identity,),
        bindings=(_binding("binding-org", organization_identity, IMBindingScope.ORGANIZATION),),
    )

    assert result.kind is BindingResolutionKind.ORGANIZATION_BINDING
    assert result.binding is not None
    assert result.binding.binding_id == IMBindingId("binding-org")


def test_normalized_email_fallback_is_used_when_no_binding_exists() -> None:
    identity = _identity("identity-1", "provider-user-1", " REVIEWER@EXAMPLE.COM ")

    result = _resolve(identities=(identity,), bindings=())

    assert result.kind is BindingResolutionKind.EMAIL_FALLBACK
    assert result.binding is not None
    assert result.binding.binding_id is None
    assert result.binding.account_id == AccountId("account-1")
    assert not hasattr(result.binding, "raw_payload")
    assert not hasattr(result.binding, "encrypted_credentials")


def test_integration_or_provider_mismatch_returns_stable_rejection_without_binding() -> None:
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-other"),
        integration_id=IntegrationId("integration-other"),
        provider=IMProvider.SLACK,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    binding = IMBinding.create(
        binding_id=IMBindingId("binding-other"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.WORKSPACE,
        scope_id=str(_WORKSPACE_ID),
        contact_id=ContactId("contact-1"),
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )

    result = _resolve(identities=(identity,), bindings=(binding,))

    assert result.kind is BindingResolutionKind.INVALID_BINDING
    assert result.binding is None
