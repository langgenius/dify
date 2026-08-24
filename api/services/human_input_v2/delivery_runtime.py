"""Production composition adapters for Human Input v2 Email delivery."""

from __future__ import annotations

from core.helper import encrypter
from core.human_input_v2.delivery_runtime import (
    ConfigurationSnapshotIdentity,
    DeliveryPreparationError,
    ProviderCredential,
    ResolvedEmailChannelSnapshot,
)
from core.human_input_v2.email_channel import EmailChannelRepository
from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import TenantId


class TenantEmailConfigurationSnapshotResolver:
    """Resolve only the preselected workspace channel immediately before send."""

    def __init__(self, repository: EmailChannelRepository) -> None:
        self._repository = repository

    def resolve(
        self,
        tenant_id: TenantId,
        provider: EmailProviderType,
        *,
        expected: ConfigurationSnapshotIdentity | None = None,
    ) -> ResolvedEmailChannelSnapshot:
        configuration = self._repository.load(tenant_id)
        if configuration is None:
            raise DeliveryPreparationError("provider_not_configured")
        if configuration.tenant_id != tenant_id:
            raise DeliveryPreparationError("provider_configuration_scope_mismatch")
        if configuration.provider is not provider:
            raise DeliveryPreparationError("provider_configuration_mismatch")
        identity = ConfigurationSnapshotIdentity(configuration.id, configuration.updated_at)
        if expected is not None and identity != expected:
            raise DeliveryPreparationError("provider_configuration_changed")
        try:
            api_key = encrypter.decrypt_token(str(tenant_id), configuration.protected_api_key)
        except Exception as error:
            raise DeliveryPreparationError("provider_credential_unavailable") from error
        return ResolvedEmailChannelSnapshot(
            identity=identity,
            provider=provider,
            sender_email=configuration.sender_email,
            sender_name=configuration.sender_name,
            credential=ProviderCredential(api_key),
        )


__all__ = ["TenantEmailConfigurationSnapshotResolver"]
