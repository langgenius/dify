"""Existing plugin OAuth, Client encryption and short-lived context adapters."""

import json
from contextlib import closing
from datetime import UTC, datetime
from hashlib import sha256
from typing import Protocol

from pydantic import TypeAdapter, ValidationError
from werkzeug import Request
from werkzeug.test import EnvironBuilder

from configs import dify_config
from constants.end_user_connections import END_USER_OAUTH_CONTEXT_PREFIX, OAuthClientSource
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.tools.utils.encryption import create_provider_encrypter
from core.tools.utils.system_encryption import decrypt_system_params
from extensions.ext_redis import redis_client
from models.provider_ids import ToolProviderID
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.end_user_connection_labels import mask_account_label
from services.end_user_connections.entities import ConnectionOAuthClient, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionOAuthError,
    ConnectionSecretUnavailableError,
)
from services.end_user_connections.oauth import (
    ConnectionOAuthAttempt,
    ConnectionOAuthGrant,
    OAuthClientSnapshot,
    ResolvedOAuthClient,
    StoredOAuthClientConfiguration,
)
from services.plugin.oauth_service import OAuthProxyService


class OAuthClientConfigurationQuery(Protocol):
    def oauth_client_configuration(self, tenant_id: str, provider: str) -> StoredOAuthClientConfiguration: ...


class RedisConnectionOAuthAttempts:
    # The shared callback uses one cookie, so a Console and a Web attempt cannot
    # accidentally consume each other's context. Provider state binds the attempt.
    COOKIE_PREFIX = END_USER_OAUTH_CONTEXT_PREFIX
    _adapter = TypeAdapter(ConnectionOAuthAttempt)
    _ROUTE_PREFIX = "end_user_connection_oauth_route:"

    def save(self, attempt: ConnectionOAuthAttempt) -> str:
        provider = ToolProviderID(attempt.provider)
        context_id = OAuthProxyService.create_proxy_context(
            user_id=attempt.context.end_user_id,
            tenant_id=attempt.context.tenant_id,
            plugin_id=provider.plugin_id,
            provider=provider.provider_name,
            extra_data={"purpose": "end_user_connection", "attempt": self._adapter.dump_python(attempt, mode="json")},
        )
        redis_client.setex(
            self._ROUTE_PREFIX + attempt.state_digest,
            OAuthProxyService.__MAX_AGE__,
            json.dumps({"provider": attempt.provider, "callback_url": attempt.callback_url}),
        )
        return self.COOKIE_PREFIX + context_id

    def callback_url(self, state: str, provider: str) -> str | None:
        route = redis_client.get(self._ROUTE_PREFIX + sha256(state.encode()).hexdigest())
        if route is None:
            return None
        data = json.loads(route)
        if data["provider"] != provider:
            raise ConnectionOAuthError()
        return data["callback_url"]

    def consume(self, context_id: str) -> ConnectionOAuthAttempt:
        if not context_id.startswith(self.COOKIE_PREFIX):
            raise ConnectionOAuthError()
        try:
            stored = OAuthProxyService.use_proxy_context(context_id.removeprefix(self.COOKIE_PREFIX))
            if stored.get("purpose") != "end_user_connection":
                raise ConnectionOAuthError()
            attempt = self._adapter.validate_python(stored["attempt"])
            provider = ToolProviderID(attempt.provider)
            if (
                stored["user_id"] != attempt.context.end_user_id
                or stored["tenant_id"] != attempt.context.tenant_id
                or stored["plugin_id"] != provider.plugin_id
                or stored["provider"] != provider.provider_name
            ):
                raise ConnectionOAuthError()
            return attempt
        except (ValueError, KeyError, TypeError, ValidationError):
            raise ConnectionOAuthError() from None


class PluginConnectionOAuthGateway:
    def __init__(
        self, *, clients: OAuthClientConfigurationQuery, providers: PluginApiKeyCredentialGateway, handler: OAuthHandler
    ) -> None:
        self._clients = clients
        self._providers = providers
        self._handler = handler

    def resolve_client(self, tenant_id: str, provider: str) -> ResolvedOAuthClient:
        controller = self._providers.provider(tenant_id, provider)
        if CredentialType.OAUTH2 not in controller.get_supported_credential_types():
            raise ConnectionConfigurationError()
        stored = self._clients.oauth_client_configuration(tenant_id, provider)
        if stored.source == OAuthClientSource.PLATFORM and not PluginService.is_plugin_verified(
            tenant_id, controller.plugin_unique_identifier
        ):
            raise ConnectionConfigurationError()
        try:
            if stored.source == OAuthClientSource.WORKSPACE:
                encrypter, _ = create_provider_encrypter(
                    tenant_id=tenant_id,
                    config=[item.to_basic_provider_config() for item in controller.get_oauth_client_schema()],
                    cache=NoOpProviderCredentialCache(),
                )
                parameters = encrypter.decrypt(json.loads(stored.encrypted_parameters))
            else:
                parameters = decrypt_system_params(stored.encrypted_parameters)
        except Exception:
            raise ConnectionSecretUnavailableError() from None
        if not parameters:
            raise ConnectionConfigurationError()
        client_id = parameters.get("client_id")
        return ResolvedOAuthClient(
            snapshot=OAuthClientSnapshot(
                reference=ConnectionOAuthClient(
                    source=stored.source,
                    configuration_id=stored.configuration_id,
                    client_id=client_id if isinstance(client_id, str) else None,
                ),
                fingerprint=stored.fingerprint,
            ),
            parameters=parameters,
        )

    @staticmethod
    def redirect_uri(provider: str) -> str:
        # Keep the callback registered by existing workspace/platform OAuth Clients.
        return f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/tool/callback"

    def authorization_url(self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient) -> str:
        identity = ToolProviderID(provider)
        try:
            return self._handler.get_authorization_url(
                tenant_id=context.tenant_id,
                user_id=context.end_user_id,
                plugin_id=identity.plugin_id,
                provider=identity.provider_name,
                redirect_uri=self.redirect_uri(provider),
                system_credentials=client.parameters,
            ).authorization_url
        except Exception:
            raise ConnectionOAuthError() from None

    def exchange(
        self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient, query_string: bytes
    ) -> ConnectionOAuthGrant:
        identity = ToolProviderID(provider)
        try:
            # Only the provider's callback parameters cross the plugin boundary,
            # never browser cookies, Dify passports or authorization headers.
            with closing(
                EnvironBuilder(path=self.redirect_uri(provider), query_string=query_string.decode("utf-8"))
            ) as builder:
                callback = Request(builder.get_environ())
                result = self._handler.get_credentials(
                    tenant_id=context.tenant_id,
                    user_id=context.end_user_id,
                    plugin_id=identity.plugin_id,
                    provider=identity.provider_name,
                    redirect_uri=self.redirect_uri(provider),
                    system_credentials=client.parameters,
                    request=callback,
                )
            expires_at = (
                datetime.fromtimestamp(result.expires_at, UTC).replace(tzinfo=None) if result.expires_at >= 0 else None
            )
        except Exception:
            raise ConnectionOAuthError() from None
        # Provider metadata is open-ended. Only these explicit identity fields are
        # eligible for display; credentials and arbitrary metadata never become labels.
        label = next(
            (
                result.metadata[key]
                for key in ("email", "name")
                if isinstance(result.metadata.get(key), str) and result.metadata[key]
            ),
            None,
        )
        return ConnectionOAuthGrant(
            credentials=result.credentials,
            expires_at=expires_at,
            account_label=mask_account_label(label),
        )
