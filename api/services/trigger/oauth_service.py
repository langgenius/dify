"""Orchestrate trigger authorization without carrying HTTP or ORM objects."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from core.trigger.entities.api_entities import SubscriptionBuilderApiEntity
from models.provider_ids import TriggerProviderID
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.trigger.oauth_client_service import TriggerOAuthClientService


class TriggerOAuthClientNotConfiguredError(Exception):
    """Neither an enabled tenant client nor a trusted system client is available."""


class TriggerOAuthContextError(Exception):
    """The callback capability is missing, expired or no longer matches the provider package."""


class TriggerOAuthProviderError(Exception):
    """The provider could not authorize or exchange credentials."""


@dataclass(frozen=True, slots=True)
class TriggerOAuthContext:
    tenant_id: str
    user_id: str
    plugin_id: str
    provider: str
    subscription_builder_id: str
    # None keeps callbacks created before package binding compatible.
    plugin_unique_identifier: str | None = None


@dataclass(frozen=True, slots=True)
class TriggerOAuthCallbackRequest:
    method: str
    full_path: str
    headers: tuple[tuple[str, str], ...]
    body: bytes


@dataclass(frozen=True, slots=True)
class TriggerOAuthCredentials:
    credentials: Mapping[str, object]
    expires_at: int


@dataclass(frozen=True, slots=True)
class TriggerOAuthAuthorization:
    authorization_url: str
    subscription_builder: SubscriptionBuilderApiEntity
    context_id: str
    context_max_age: int


class TriggerOAuthProviderGateway(Protocol):
    def authorization_url(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig,
    ) -> str: ...

    def exchange_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig,
        callback: TriggerOAuthCallbackRequest,
    ) -> TriggerOAuthCredentials: ...


class TriggerOAuthContexts(Protocol):
    @property
    def max_age(self) -> int: ...

    def create(self, context: TriggerOAuthContext) -> str: ...

    def consume(self, context_id: str) -> TriggerOAuthContext: ...


class TriggerOAuthBuilders(Protocol):
    def create(
        self, *, tenant_id: str, user_id: str, provider_id: TriggerProviderID
    ) -> SubscriptionBuilderApiEntity: ...

    def set_credentials(
        self,
        *,
        context: TriggerOAuthContext,
        provider_id: TriggerProviderID,
        credentials: Mapping[str, object],
        expires_at: int,
    ) -> None: ...


class TriggerOAuthService:
    def __init__(
        self,
        *,
        clients: TriggerOAuthClientService,
        providers: TriggerOAuthProviderGateway,
        contexts: TriggerOAuthContexts,
        builders: TriggerOAuthBuilders,
    ) -> None:
        self._clients = clients
        self._providers = providers
        self._contexts = contexts
        self._builders = builders

    def authorize(
        self, *, tenant_id: str, user_id: str, provider_id: TriggerProviderID, redirect_uri: str
    ) -> TriggerOAuthAuthorization:
        client_config = self._clients.resolve(tenant_id=tenant_id, provider_id=provider_id)
        if client_config is None:
            raise TriggerOAuthClientNotConfiguredError("No OAuth client configuration found for this trigger provider")
        builder = self._builders.create(tenant_id=tenant_id, user_id=user_id, provider_id=provider_id)
        context_id = self._contexts.create(
            TriggerOAuthContext(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                subscription_builder_id=builder.id,
                plugin_unique_identifier=client_config.plugin_unique_identifier,
            )
        )
        authorization_url = self._providers.authorization_url(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            redirect_uri=redirect_uri,
            client_config=client_config,
        )
        return TriggerOAuthAuthorization(authorization_url, builder, context_id, self._contexts.max_age)

    def callback(
        self,
        *,
        provider_id: TriggerProviderID,
        context_id: str | None,
        redirect_uri: str,
        callback: TriggerOAuthCallbackRequest,
    ) -> None:
        """Consume the cookie capability; None means the browser omitted the cookie."""
        if not context_id:
            raise TriggerOAuthContextError("context_id not found")
        context = self._contexts.consume(context_id)
        if context.plugin_id != provider_id.plugin_id or context.provider != provider_id.provider_name:
            raise TriggerOAuthContextError("OAuth context does not belong to this trigger provider")
        client_config = self._clients.resolve(tenant_id=context.tenant_id, provider_id=provider_id)
        if client_config is None:
            raise TriggerOAuthClientNotConfiguredError("No OAuth client configuration found for this trigger provider")
        if (
            context.plugin_unique_identifier is not None
            and context.plugin_unique_identifier != client_config.plugin_unique_identifier
        ):
            raise TriggerOAuthContextError("Plugin changed during OAuth authorization; restart authorization")
        result = self._providers.exchange_credentials(
            tenant_id=context.tenant_id,
            user_id=context.user_id,
            provider_id=provider_id,
            redirect_uri=redirect_uri,
            client_config=client_config,
            callback=callback,
        )
        if not result.credentials:
            raise TriggerOAuthProviderError("Failed to get OAuth credentials from the provider.")
        self._builders.set_credentials(
            context=context,
            provider_id=provider_id,
            credentials=result.credentials,
            expires_at=result.expires_at,
        )
