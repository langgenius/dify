"""Application owner for IM Integration configuration transitions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Never

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ConfigurationTransition,
    ConfirmedIMConfiguration,
    IMControlPlaneRepository,
    IMIntegration,
    IMIntegrationAlreadyExistsError,
    IMIntegrationView,
    IMProviderConfigurationFailureKind,
    IMProviderConfigurationPort,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.shared import (
    AccountId,
    DeploymentScope,
    DirectoryScope,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    IMProviderConfigurationError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    ReplacementRequiredError,
    UnexpectedChannelProviderError,
)

_INVALID_CREDENTIALS_DESCRIPTION = "The submitted credentials are invalid."
_CONNECTION_FAILURE_DESCRIPTION = "The provider connection could not be established."


class HumanInputIMIntegrationManagementService:
    """Own IM singleton, complete CAS, rotation, replacement, and deletion."""

    def __init__(
        self,
        repository: IMControlPlaneRepository,
        provider_port: IMProviderConfigurationPort,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        id_factory: Callable[[], str] = lambda: str(uuidv7()),
    ) -> None:
        self._repository = repository
        self._provider_port = provider_port
        self._clock = clock
        self._id_factory = id_factory

    def available_providers(self) -> tuple[IMProvider, ...]:
        return self._provider_port.available_providers()

    def get_current(self, scope: DirectoryScope) -> IMIntegrationView | None:
        integration = self._load_current(scope)
        return self._view(integration) if integration is not None else None

    def get(self, scope: DirectoryScope, channel_id: IntegrationId) -> IMIntegrationView:
        return self._view(self._load_addressed(scope, channel_id))

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> None:
        self._test_candidate(scope, credentials)

    def create(
        self,
        scope: DirectoryScope,
        actor_account_id: AccountId | None,
        credentials: IMProviderCredentials,
    ) -> IMIntegrationView:
        owner_tenant_id = self._owner_tenant_id(scope)
        if self._load_current(scope) is not None:
            raise ChannelAlreadyConfiguredError("IM channel is already configured")
        confirmed = self._prepare(scope, credentials)
        integration = IMIntegration.create(
            integration_id=IntegrationId(self._id_factory()),
            tenant_id=owner_tenant_id,
            provider_tenant=ProviderTenantIdentity(confirmed.provider, confirmed.provider_tenant_id),
            encrypted_credentials=confirmed.encrypted_credentials,
            app_identifier=confirmed.app_identifier,
            configured_by_account_id=actor_account_id,
            callback_url=confirmed.callback_url,
            now=self._clock(),
        )
        try:
            created = self._repository.create_integration(integration, organization_scope=scope)
        except IMIntegrationAlreadyExistsError:
            raise ChannelAlreadyConfiguredError("IM channel is already configured") from None
        return self._view(created)

    def update(
        self,
        scope: DirectoryScope,
        channel_id: IntegrationId,
        expected_revision: IntegrationRevisionToken,
        actor_account_id: AccountId | None,
        credentials: IMProviderCredentials,
    ) -> IMIntegrationView:
        current = self._load_addressed(scope, channel_id)
        if credentials.provider is not current.provider_tenant.provider:
            if expected_revision != current.revision:
                raise ProviderConfigurationUpdatedError("IM configuration was updated")
            raise ReplacementRequiredError("IM provider replacement is required")
        confirmed = self._prepare(scope, credentials)
        if self._provider_tenant(confirmed) != current.provider_tenant:
            if expected_revision != current.revision:
                raise ProviderConfigurationUpdatedError("IM configuration was updated")
            raise ReplacementRequiredError("IM provider tenant replacement is required")
        transition = current.reconfigure(
            expected_revision=expected_revision,
            provider_tenant=self._provider_tenant(confirmed),
            encrypted_credentials=confirmed.encrypted_credentials,
            app_identifier=confirmed.app_identifier,
            configured_by_account_id=actor_account_id,
            callback_url=confirmed.callback_url,
            now=self._clock(),
        )
        if isinstance(transition, StaleRevision):
            raise ProviderConfigurationUpdatedError("IM configuration was updated")
        return self._persist_transition(scope, transition)

    def replace(
        self,
        scope: DirectoryScope,
        channel_id: IntegrationId,
        expected_revision: IntegrationRevisionToken,
        actor_account_id: AccountId | None,
        credentials: IMProviderCredentials,
    ) -> IMIntegrationView:
        current = self._load_addressed(scope, channel_id)
        confirmed = self._prepare(scope, credentials)
        transition = current.replace_configuration(
            expected_revision=expected_revision,
            replacement_integration_id=IntegrationId(self._id_factory()),
            provider_tenant=self._provider_tenant(confirmed),
            encrypted_credentials=confirmed.encrypted_credentials,
            app_identifier=confirmed.app_identifier,
            configured_by_account_id=actor_account_id,
            callback_url=confirmed.callback_url,
            now=self._clock(),
        )
        if isinstance(transition, StaleRevision):
            raise ProviderConfigurationUpdatedError("IM configuration was updated")
        return self._persist_transition(scope, transition)

    def delete(
        self,
        scope: DirectoryScope,
        channel_id: IntegrationId,
        expected_revision: IntegrationRevisionToken,
    ) -> IntegrationId:
        current = self._load_addressed(scope, channel_id)
        deletion = current.plan_deletion(expected_revision)
        if isinstance(deletion, StaleRevision):
            raise ProviderConfigurationUpdatedError("IM configuration was updated")
        persisted = self._repository.compare_and_swap_delete(deletion, organization_scope=scope)
        if isinstance(persisted, StaleRevision):
            raise ProviderConfigurationUpdatedError("IM configuration was updated")
        return current.id

    def _persist_transition(
        self,
        scope: DirectoryScope,
        transition: ConfigurationTransition,
    ) -> IMIntegrationView:
        persisted = self._repository.compare_and_swap_configuration(transition, organization_scope=scope)
        if isinstance(persisted, StaleRevision):
            raise ProviderConfigurationUpdatedError("IM configuration was updated")
        return self._view(persisted)

    def _prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        try:
            confirmed = self._provider_port.prepare(scope, credentials)
        except IMProviderConfigurationError as error:
            self._raise_provider_failure(error)
        except Exception:
            # Provider errors may contain credentials or raw payloads. Do not retain
            # the original message, exception chain, or diagnostic object.
            raise UnexpectedChannelProviderError() from None
        if confirmed.provider is not credentials.provider:
            raise UnexpectedChannelProviderError()
        return confirmed

    def _test_candidate(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> None:
        try:
            tested = self._provider_port.test(scope, credentials)
        except IMProviderConfigurationError as error:
            self._raise_provider_failure(error)
        except Exception:
            raise UnexpectedChannelProviderError() from None
        if tested.provider is not credentials.provider:
            raise UnexpectedChannelProviderError()

    @staticmethod
    def _raise_provider_failure(error: IMProviderConfigurationError) -> Never:
        if error.kind is IMProviderConfigurationFailureKind.INVALID_CREDENTIALS:
            raise ChannelProviderError(
                ProviderFailureKind.INVALID_CREDENTIALS,
                _INVALID_CREDENTIALS_DESCRIPTION,
            ) from None
        raise ChannelProviderError(
            ProviderFailureKind.CONNECTION_FAILURE,
            _CONNECTION_FAILURE_DESCRIPTION,
        ) from None

    def _load_addressed(
        self,
        scope: DirectoryScope,
        channel_id: IntegrationId,
    ) -> IMIntegration:
        current = self._load_current(scope)
        if current is None or current.id != channel_id:
            raise ChannelNotFoundError("IM channel was not found")
        return current

    def _load_current(self, scope: DirectoryScope) -> IMIntegration | None:
        return self._repository.load_current_integration(self._owner_tenant_id(scope))

    @staticmethod
    def _provider_tenant(confirmed: ConfirmedIMConfiguration) -> ProviderTenantIdentity:
        return ProviderTenantIdentity(confirmed.provider, confirmed.provider_tenant_id)

    @staticmethod
    def _owner_tenant_id(scope: DirectoryScope) -> TenantId | None:
        if isinstance(scope, WorkspaceScope):
            return scope.id
        if isinstance(scope, DeploymentScope):
            return None
        raise TypeError("unsupported Directory scope")

    @staticmethod
    def _view(integration: IMIntegration) -> IMIntegrationView:
        return IMIntegrationView(
            id=integration.id,
            provider=integration.provider_tenant.provider,
            created_at=integration.created_at,
            updated_at=integration.updated_at,
            status=integration.status,
            safe_status_reason=integration.safe_status_reason,
            app_identifier=integration.app_identifier or integration.provider_tenant.provider_tenant_id,
            provider_tenant_display=None,
            webhook_url=integration.callback_url,
            revision=integration.revision,
        )


__all__ = ["HumanInputIMIntegrationManagementService"]
