"""Plugin transport and compatibility boundaries for trigger OAuth."""

from collections.abc import Mapping

from pydantic import TypeAdapter

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.trigger.entities.api_entities import SubscriptionBuilderApiEntity
from core.trigger.entities.entities import SubscriptionBuilderUpdater
from core.trigger.trigger_manager import TriggerManager
from models.provider_ids import TriggerProviderID
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.plugin.oauth_service import OAuthProxyService
from services.trigger.oauth_client_service import TriggerOAuthProviderMetadata
from services.trigger.oauth_service import (
    TriggerOAuthCallbackRequest,
    TriggerOAuthContext,
    TriggerOAuthContextError,
    TriggerOAuthCredentials,
    TriggerOAuthProviderError,
)
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService

_context_adapter = TypeAdapter(TriggerOAuthContext)


class PluginTriggerOAuthGateway:
    def __init__(self, *, oauth: OAuthHandler) -> None:
        self._oauth = oauth

    def get_metadata(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthProviderMetadata:
        provider = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        return TriggerOAuthProviderMetadata(
            schema=provider.get_oauth_client_schema(),
            plugin_unique_identifier=provider.plugin_unique_identifier,
        )

    def is_verified(self, *, tenant_id: str, plugin_unique_identifier: str) -> bool:
        return PluginService.is_plugin_verified(tenant_id, plugin_unique_identifier)

    def authorization_url(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig,
    ) -> str:
        try:
            result = self._oauth.get_authorization_url(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=dict(client_config.credentials),
                plugin_unique_identifier=client_config.plugin_unique_identifier,
            )
        except ValueError as error:
            raise TriggerOAuthProviderError("Failed to get the trigger provider's OAuth authorization URL.") from error
        return result.authorization_url

    def exchange_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig,
        callback: TriggerOAuthCallbackRequest,
    ) -> TriggerOAuthCredentials:
        # Preserve the legacy raw request, including trailing '?' and header order.
        protocol = next(
            (value for name, value in callback.headers if name.lower().replace("-", "_") == "http_version"), "HTTP/1.1"
        )
        raw_request = f"{callback.method} {callback.full_path} {protocol}\r\n".encode()
        raw_request += b"".join(f"{name}: {value}\r\n".encode() for name, value in callback.headers)
        raw_request += b"\r\n" + callback.body
        try:
            result = self._oauth.get_credentials_from_raw_request(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=dict(client_config.credentials),
                plugin_unique_identifier=client_config.plugin_unique_identifier,
                raw_request=raw_request,
            )
        except ValueError as error:
            raise TriggerOAuthProviderError("Failed to get OAuth credentials from the trigger provider.") from error
        return TriggerOAuthCredentials(credentials=result.credentials, expires_at=result.expires_at)

    def refresh_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig | None,
        credentials: Mapping[str, object],
    ) -> TriggerOAuthCredentials:
        """None retains renewal with the provider's default OAuth client."""
        plugin_unique_identifier = (
            client_config.plugin_unique_identifier
            if client_config is not None
            else self.get_metadata(tenant_id=tenant_id, provider_id=provider_id).plugin_unique_identifier
        )
        try:
            result = self._oauth.refresh_credentials(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=dict(client_config.credentials) if client_config is not None else {},
                plugin_unique_identifier=plugin_unique_identifier,
                credentials=dict(credentials),
            )
        except ValueError as error:
            raise TriggerOAuthProviderError("Failed to refresh OAuth credentials for the trigger provider.") from error
        return TriggerOAuthCredentials(credentials=result.credentials, expires_at=result.expires_at)


class OAuthProxyContextGateway:
    """Retain the shared proxy format so in-flight callbacks survive deployment.

    TODO: Migrate the shared proxy owner to atomic consumption for all plugin
    OAuth callers; its existing GET/DELETE pair does not exclude concurrent replay.
    """

    max_age: int = OAuthProxyService.__MAX_AGE__

    def create(self, context: TriggerOAuthContext) -> str:
        return OAuthProxyService.create_proxy_context(
            user_id=context.user_id,
            tenant_id=context.tenant_id,
            plugin_id=context.plugin_id,
            provider=context.provider,
            extra_data={
                "subscription_builder_id": context.subscription_builder_id,
                "plugin_unique_identifier": context.plugin_unique_identifier,
            },
        )

    def consume(self, context_id: str) -> TriggerOAuthContext:
        try:
            context = OAuthProxyService.use_proxy_context(context_id)
            return _context_adapter.validate_python(context)
        except ValueError as error:
            raise TriggerOAuthContextError("Invalid or expired context_id") from error


class TriggerOAuthBuilderGateway:
    """Adapt OAuth credentials to the shared subscription builder lifecycle."""

    def __init__(self, *, builders: TriggerSubscriptionBuilderService) -> None:
        self._builders = builders

    def create(self, *, tenant_id: str, user_id: str, provider_id: TriggerProviderID) -> SubscriptionBuilderApiEntity:
        return self._builders.create_trigger_subscription_builder(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            credential_type=CredentialType.OAUTH2,
        )

    def set_credentials(
        self,
        *,
        context: TriggerOAuthContext,
        provider_id: TriggerProviderID,
        credentials: Mapping[str, object],
        expires_at: int,
    ) -> None:
        self._builders.update_trigger_subscription_builder(
            tenant_id=context.tenant_id,
            user_id=context.user_id,
            provider_id=provider_id,
            subscription_builder_id=context.subscription_builder_id,
            subscription_builder_updater=SubscriptionBuilderUpdater(
                credentials=credentials,
                credential_expires_at=expires_at,
            ),
        )
