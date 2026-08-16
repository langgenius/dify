"""Effective IM binding resolution tests."""

from datetime import datetime

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
    TenantId,
)

_NOW = datetime(2026, 7, 25, 8)
_INTEGRATION_ID = IntegrationId("integration-1")
_TENANT_ID = TenantId("workspace-1")


def _contact(email: str | None = "reviewer@example.com") -> ContactSnapshot:
    return ContactSnapshot(
        contact=Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="Reviewer",
            email=email,
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
        scope_id=str(_TENANT_ID if scope is IMBindingScope.WORKSPACE else _INTEGRATION_ID),
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
        tenant_id=_TENANT_ID,
        contact=_contact(),
        identities=identities,
        bindings=bindings,
    )


def test_workspace_binding_has_priority_over_organization_binding() -> None:
    organization_identity = _identity("identity-org", "org-user")
    tenant_identity = _identity("identity-workspace", "workspace-user")

    result = _resolve(
        identities=(organization_identity, tenant_identity),
        bindings=(
            _binding("binding-org", organization_identity, IMBindingScope.ORGANIZATION),
            _binding("binding-workspace", tenant_identity, IMBindingScope.WORKSPACE),
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


def test_matching_email_without_persisted_binding_is_not_available() -> None:
    identity = _identity("identity-1", "provider-user-1", " REVIEWER@EXAMPLE.COM ")

    result = _resolve(identities=(identity,), bindings=())

    assert result.kind is BindingResolutionKind.NOT_AVAILABLE
    assert result.binding is None


def test_resolution_kind_does_not_expose_implicit_email_fallback() -> None:
    assert "email_fallback" not in {kind.value for kind in BindingResolutionKind}


def test_missing_email_or_matching_identity_returns_not_available() -> None:
    without_email = EffectiveBindingResolver.resolve(
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        tenant_id=_TENANT_ID,
        contact=_contact(None),
        identities=(),
        bindings=(),
    )
    without_identity = _resolve(identities=(), bindings=())

    assert without_email.kind is BindingResolutionKind.NOT_AVAILABLE
    assert without_identity.kind is BindingResolutionKind.NOT_AVAILABLE


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
        scope_id=str(_TENANT_ID),
        contact_id=ContactId("contact-1"),
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )

    result = _resolve(identities=(identity,), bindings=(binding,))

    assert result.kind is BindingResolutionKind.INVALID_BINDING
    assert result.binding is None
