"""Effective binding priority and credential-free consumer snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from core.human_input_v2.contact_directory import ContactSnapshot
from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    TenantId,
)

from .integration import IntegrationRevisionToken, ProviderTenantIdentity
from .records import IMBinding, IMIdentity


class BindingResolutionKind(StrEnum):
    """Stable priority result returned to control-plane consumers."""

    WORKSPACE_OVERRIDE = "workspace_override"
    ORGANIZATION_BINDING = "organization_binding"
    NOT_AVAILABLE = "not_available"
    INVALID_BINDING = "invalid_binding"


@dataclass(frozen=True, slots=True)
class EffectiveIMBindingSnapshot:
    """Consumer-safe effective channel facts without credentials or raw payloads."""

    integration_id: IntegrationId
    integration_config_version: int
    provider: IMProvider
    provider_tenant_id: str
    contact_id: ContactId
    account_id: AccountId | None
    identity_id: IMIdentityId
    binding_id: IMBindingId
    provider_user_id: str
    display_name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class BindingResolutionResult:
    """Effective binding or stable rejection without leaking invalid records."""

    kind: BindingResolutionKind
    binding: EffectiveIMBindingSnapshot | None


class EffectiveBindingResolver:
    """Resolve only persisted workspace overrides or Organization bindings."""

    @staticmethod
    def resolve(
        *,
        integration_revision: IntegrationRevisionToken,
        provider_tenant: ProviderTenantIdentity,
        tenant_id: TenantId,
        contact: ContactSnapshot,
        identities: tuple[IMIdentity, ...],
        bindings: tuple[IMBinding, ...],
    ) -> BindingResolutionResult:
        identities_by_id = {identity.id: identity for identity in identities}
        candidates = [binding for binding in bindings if binding.contact_id == contact.contact.id]
        workspace_binding = next(
            (
                binding
                for binding in candidates
                if binding.scope is IMBindingScope.WORKSPACE and binding.scope_id == str(tenant_id)
            ),
            None,
        )
        organization_binding = next(
            (
                binding
                for binding in candidates
                if binding.scope is IMBindingScope.ORGANIZATION
                and binding.scope_id == str(integration_revision.integration_id)
            ),
            None,
        )

        selected = workspace_binding or organization_binding
        if selected is not None:
            identity = identities_by_id.get(selected.identity_id)
            if not EffectiveBindingResolver._matches_integration(
                selected,
                identity,
                integration_revision,
                provider_tenant,
            ):
                return BindingResolutionResult(BindingResolutionKind.INVALID_BINDING, None)
            assert identity is not None
            kind = (
                BindingResolutionKind.WORKSPACE_OVERRIDE
                if selected is workspace_binding
                else BindingResolutionKind.ORGANIZATION_BINDING
            )
            return BindingResolutionResult(
                kind,
                EffectiveBindingResolver._snapshot(
                    integration_revision,
                    provider_tenant,
                    contact,
                    identity,
                    selected.id,
                ),
            )

        return BindingResolutionResult(BindingResolutionKind.NOT_AVAILABLE, None)

    @staticmethod
    def _matches_integration(
        binding: IMBinding,
        identity: IMIdentity | None,
        integration_revision: IntegrationRevisionToken,
        provider_tenant: ProviderTenantIdentity,
    ) -> bool:
        return (
            identity is not None
            and binding.integration_id == integration_revision.integration_id
            and identity.integration_id == integration_revision.integration_id
            and binding.provider is provider_tenant.provider
            and identity.provider is provider_tenant.provider
        )

    @staticmethod
    def _snapshot(
        revision: IntegrationRevisionToken,
        provider_tenant: ProviderTenantIdentity,
        contact: ContactSnapshot,
        identity: IMIdentity,
        binding_id: IMBindingId,
    ) -> EffectiveIMBindingSnapshot:
        return EffectiveIMBindingSnapshot(
            integration_id=revision.integration_id,
            integration_config_version=revision.config_version,
            provider=provider_tenant.provider,
            provider_tenant_id=provider_tenant.provider_tenant_id,
            contact_id=contact.contact.id,
            account_id=contact.contact.account_id,
            identity_id=identity.id,
            binding_id=binding_id,
            provider_user_id=identity.provider_user_id,
            display_name=identity.display_name,
            email=identity.email,
        )
