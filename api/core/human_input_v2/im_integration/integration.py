"""IM Integration aggregate and complete compare-and-swap revision values."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import StrEnum

from pydantic import JsonValue, NaiveDatetime

from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.shared import AccountId, IntegrationId, TenantId


@dataclass(frozen=True, slots=True)
class EncryptedCredentials:
    """Immutable opaque encrypted configuration passed through the domain boundary."""

    _serialized: str = field(repr=False)

    @classmethod
    def from_mapping(cls, values: Mapping[str, JsonValue]) -> EncryptedCredentials:
        if not values:
            raise ValueError("encrypted credentials must not be empty")
        return cls(json.dumps(dict(values), sort_keys=True, separators=(",", ":")))

    def to_mapping(self) -> dict[str, JsonValue]:
        value = json.loads(self._serialized)
        if not isinstance(value, dict):
            raise ValueError("encrypted credentials must be a JSON object")
        return value


@dataclass(frozen=True, slots=True)
class ProviderTenantIdentity:
    """Provider plus its confirmed organization or workspace identity."""

    provider: IMProvider
    provider_tenant_id: str

    def __post_init__(self) -> None:
        if not self.provider_tenant_id.strip():
            raise ValueError("provider tenant id must not be blank")
        object.__setattr__(self, "provider_tenant_id", self.provider_tenant_id.strip())


@dataclass(frozen=True, slots=True)
class IntegrationRevisionToken:
    """Complete CAS token that prevents identity-replacement ABA."""

    integration_id: IntegrationId
    config_version: int

    def __post_init__(self) -> None:
        if self.config_version < 1:
            raise ValueError("config version must be positive")


@dataclass(frozen=True, slots=True)
class StaleRevision:
    """Stable rejection for a token that no longer names current configuration."""

    expected: IntegrationRevisionToken
    actual: IntegrationRevisionToken | None


class ConfigurationTransitionKind(StrEnum):
    """Current-state effect selected by one confirmed configuration write."""

    CREDENTIAL_ROTATION = "credential_rotation"
    PROVIDER_REPLACEMENT = "provider_replacement"


@dataclass(frozen=True, slots=True)
class CurrentStateInvalidation:
    """Current identity and binding cleanup owned by the configuration transaction."""

    invalidate_identities: bool
    invalidate_bindings: bool


@dataclass(frozen=True, slots=True)
class ConfigurationTransition:
    """Atomic configuration write plus its current-state cleanup decision."""

    expected_revision: IntegrationRevisionToken
    kind: ConfigurationTransitionKind
    integration: IMIntegration
    invalidation: CurrentStateInvalidation


@dataclass(frozen=True, slots=True)
class IntegrationDeletion:
    """CAS-authorized deletion and current-state invalidation decision."""

    expected_revision: IntegrationRevisionToken
    invalidation: CurrentStateInvalidation = CurrentStateInvalidation(True, True)


@dataclass(frozen=True, slots=True)
class IMIntegration:
    """Organization IM configuration aggregate.

    Provider reads and credential encryption happen before construction.
    Configuration transitions return decisions; persistence adapters alone make
    them atomic and decide whether the expected revision is still current.
    Connectivity diagnostics are non-configuration state and retain the token.
    """

    id: IntegrationId
    tenant_id: TenantId | None
    provider_tenant: ProviderTenantIdentity
    encrypted_credentials: EncryptedCredentials
    configured_by_account_id: AccountId | None
    callback_url: str | None
    config_version: int
    status: IMIntegrationStatus
    safe_status_reason: str | None
    last_checked_at: NaiveDatetime | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    def __post_init__(self) -> None:
        if self.config_version < 1:
            raise ValueError("config version must be positive")

    @classmethod
    def create(
        cls,
        *,
        integration_id: IntegrationId,
        tenant_id: TenantId | None,
        provider_tenant: ProviderTenantIdentity,
        encrypted_credentials: EncryptedCredentials,
        configured_by_account_id: AccountId | None,
        callback_url: str | None,
        now: NaiveDatetime,
    ) -> IMIntegration:
        return cls(
            id=integration_id,
            tenant_id=tenant_id,
            provider_tenant=provider_tenant,
            encrypted_credentials=encrypted_credentials,
            configured_by_account_id=configured_by_account_id,
            callback_url=callback_url,
            config_version=1,
            status=IMIntegrationStatus.CONFIGURED,
            safe_status_reason=None,
            last_checked_at=None,
            created_at=now,
            updated_at=now,
        )

    @property
    def revision(self) -> IntegrationRevisionToken:
        return IntegrationRevisionToken(self.id, self.config_version)

    def reconfigure(
        self,
        *,
        expected_revision: IntegrationRevisionToken,
        provider_tenant: ProviderTenantIdentity,
        encrypted_credentials: EncryptedCredentials,
        configured_by_account_id: AccountId | None,
        callback_url: str | None,
        now: NaiveDatetime,
        replacement_integration_id: IntegrationId | None = None,
    ) -> ConfigurationTransition | StaleRevision:
        """Plan a confirmed rotation or replacement without performing I/O."""

        if expected_revision != self.revision:
            return StaleRevision(expected_revision, self.revision)

        if provider_tenant == self.provider_tenant:
            if replacement_integration_id not in (None, self.id):
                raise ValueError("credential rotation must preserve integration identity")
            updated = replace(
                self,
                encrypted_credentials=encrypted_credentials,
                configured_by_account_id=configured_by_account_id,
                callback_url=callback_url,
                config_version=self.config_version + 1,
                status=IMIntegrationStatus.CONFIGURED,
                safe_status_reason=None,
                last_checked_at=None,
                updated_at=now,
            )
            return ConfigurationTransition(
                expected_revision=expected_revision,
                kind=ConfigurationTransitionKind.CREDENTIAL_ROTATION,
                integration=updated,
                invalidation=CurrentStateInvalidation(False, False),
            )

        if replacement_integration_id is None or replacement_integration_id == self.id:
            raise ValueError("provider replacement requires a new integration identity")
        replacement = IMIntegration.create(
            integration_id=replacement_integration_id,
            tenant_id=self.tenant_id,
            provider_tenant=provider_tenant,
            encrypted_credentials=encrypted_credentials,
            configured_by_account_id=configured_by_account_id,
            callback_url=callback_url,
            now=now,
        )
        return ConfigurationTransition(
            expected_revision=expected_revision,
            kind=ConfigurationTransitionKind.PROVIDER_REPLACEMENT,
            integration=replacement,
            invalidation=CurrentStateInvalidation(True, True),
        )

    def plan_deletion(self, expected_revision: IntegrationRevisionToken) -> IntegrationDeletion | StaleRevision:
        """Return deletion cleanup only when the complete token is current."""

        if expected_revision != self.revision:
            return StaleRevision(expected_revision, self.revision)
        return IntegrationDeletion(expected_revision)

    def record_diagnostics(
        self,
        *,
        status: IMIntegrationStatus,
        safe_status_reason: str | None,
        checked_at: NaiveDatetime,
    ) -> IMIntegration:
        """Update connection diagnostics without advancing configuration."""

        return replace(
            self,
            status=status,
            safe_status_reason=safe_status_reason,
            last_checked_at=checked_at,
            updated_at=checked_at,
        )
