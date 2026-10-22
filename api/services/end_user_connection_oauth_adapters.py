"""Existing plugin OAuth, Client encryption and short-lived context adapters."""

import json
import time
from collections.abc import Callable, Mapping
from contextlib import closing
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any, Protocol
from uuid import uuid4

import httpx
from pydantic import TypeAdapter, ValidationError
from redis.exceptions import RedisError
from werkzeug import Request
from werkzeug.test import EnvironBuilder

from clients.plugin.auth import PluginCredentialAuthClient
from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from clients.plugin.errors import PluginNotImplementedError
from configs import dify_config
from constants.end_user_connections import END_USER_OAUTH_CONTEXT_PREFIX, OAuthClientSource
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.plugin.entities.plugin_daemon import CredentialType, PluginOAuthCredentialsResponse
from core.plugin.impl.base import use_plugin_daemon_request_timeout
from core.plugin.impl.exc import PluginDaemonError
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.tools.utils.encryption import create_provider_encrypter
from core.tools.utils.system_encryption import decrypt_system_params
from extensions.ext_redis import RedisClientWrapper, redis_client
from models.provider_ids import ToolProviderID
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.end_user_connection_labels import mask_account_label
from services.end_user_connections.entities import ConnectionMutationGuard, ConnectionOAuthClient, WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionError,
    ConnectionIdentityError,
    ConnectionNotFoundError,
    ConnectionOAuthError,
    ConnectionReauthorizationRequiredError,
    ConnectionSecretUnavailableError,
)
from services.end_user_connections.oauth import (
    ConnectionOAuthAttempt,
    ConnectionOAuthGrant,
    OAuthClientSnapshot,
    ResolvedOAuthClient,
    StoredOAuthClientConfiguration,
)
from services.end_user_connections.oauth_lifecycle import OAuthRefreshLease, OAuthRefreshResult
from services.plugin.oauth_service import OAuthProxyService


class OAuthClientConfigurationQuery(Protocol):
    def oauth_client_configuration(self, tenant_id: str, provider: str) -> StoredOAuthClientConfiguration: ...

    def oauth_grant_client_configuration(
        self, tenant_id: str, provider: str, reference: ConnectionOAuthClient
    ) -> StoredOAuthClientConfiguration: ...


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
        self,
        *,
        clients: OAuthClientConfigurationQuery,
        providers: PluginApiKeyCredentialGateway,
        handler: OAuthHandler,
        auth: PluginCredentialAuthClient,
    ) -> None:
        self._clients = clients
        self._providers = providers
        self._handler = handler
        self._auth = auth

    def resolve_client(self, tenant_id: str, provider: str) -> ResolvedOAuthClient:
        stored = self._clients.oauth_client_configuration(tenant_id, provider)
        return self._resolve_client(tenant_id, provider, stored)

    def resolve_grant_client(
        self, tenant_id: str, provider: str, reference: ConnectionOAuthClient
    ) -> ResolvedOAuthClient:
        stored = self._clients.oauth_grant_client_configuration(tenant_id, provider, reference)
        client = self._resolve_client(tenant_id, provider, stored)
        if client.snapshot.reference != reference:
            raise ConnectionReauthorizationRequiredError()
        return client

    def _resolve_client(
        self, tenant_id: str, provider: str, stored: StoredOAuthClientConfiguration
    ) -> ResolvedOAuthClient:
        controller = self._providers.provider(tenant_id, provider)
        if CredentialType.OAUTH2 not in controller.get_supported_credential_types():
            raise ConnectionConfigurationError()
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
            return self._grant(result)
        except Exception:
            raise ConnectionOAuthError() from None

    @staticmethod
    def _grant(result: PluginOAuthCredentialsResponse) -> ConnectionOAuthGrant:
        expires_at = (
            datetime.fromtimestamp(result.expires_at, UTC).replace(tzinfo=None) if result.expires_at >= 0 else None
        )
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

    def refresh(
        self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient, credentials: Mapping[str, Any]
    ) -> ConnectionOAuthGrant | CredentialCheckResult:
        identity = ToolProviderID(provider)
        try:
            with use_plugin_daemon_request_timeout(10):
                result = self._handler.refresh_credentials(
                    tenant_id=context.tenant_id,
                    user_id=context.end_user_id,
                    plugin_id=identity.plugin_id,
                    provider=identity.provider_name,
                    redirect_uri=self.redirect_uri(provider),
                    system_credentials=client.parameters,
                    credentials=credentials,
                )
            if not result.credentials:
                raise ValueError("Empty refresh result")
            # Providers may omit unchanged fields, notably a non-rotating refresh token.
            merged = result.model_copy(update={"credentials": {**credentials, **result.credentials}})
            return self._grant(merged)
        except Exception as error:
            # The existing OAuthHandler wraps failures in ValueError. Preserve its
            # typed unsupported cause without interpreting provider error strings.
            cause: BaseException | None = error
            while cause is not None:
                if isinstance(cause, PluginNotImplementedError):
                    return CredentialCheckResult(
                        status="invalid",
                        reason_code="credential_expired",
                        retryable=False,
                        checked_at=int(time.time()),
                    )
                cause = cause.__cause__ or cause.__context__
            return CredentialCheckResult(
                status="temporarily_unavailable",
                reason_code="provider_unavailable",
                retryable=True,
                checked_at=int(time.time()),
            )

    def check(
        self, context: WebConnectionContext, provider: str, credentials: Mapping[str, Any]
    ) -> CredentialCheckResult:
        try:
            return self._auth.check_provider_credentials(
                tenant_id=context.tenant_id,
                user_id=context.end_user_id,
                provider=provider,
                credentials=credentials,
                credential_type=CredentialType.OAUTH2,
            )
        except PluginNotImplementedError:
            return CredentialCheckResult(
                status="unsupported", reason_code=None, retryable=False, checked_at=int(time.time())
            )
        except (PluginDaemonError, httpx.HTTPError):
            return CredentialCheckResult(
                status="temporarily_unavailable",
                reason_code="provider_unavailable",
                retryable=True,
                checked_at=int(time.time()),
            )

    def revoke(
        self, context: WebConnectionContext, provider: str, client: ResolvedOAuthClient, credentials: Mapping[str, Any]
    ) -> OAuthRevokeResult:
        try:
            return self._auth.revoke_credentials(
                tenant_id=context.tenant_id,
                user_id=context.end_user_id,
                provider=provider,
                system_credentials=client.parameters,
                credentials=credentials,
            )
        except PluginNotImplementedError:
            return OAuthRevokeResult(status="unsupported", reason_code=None, retryable=False)
        except (PluginDaemonError, httpx.HTTPError):
            return OAuthRevokeResult(
                status="temporarily_unavailable", reason_code="provider_unavailable", retryable=True
            )


class RedisOAuthRefreshLease:
    def __init__(self, redis: RedisClientWrapper, key: str, token: str) -> None:
        self._redis = redis
        self._key = key
        self._token = token

    def ensure_owned(self) -> None:
        try:
            value = self._redis.get(self._key)
            if value == self._token or value == self._token.encode():
                return
        except RedisError:
            pass
        raise ConnectionCheckUnavailableError()


class RedisOAuthRefreshSingleFlight:
    # Atomically join the active flight or become its leader. Capturing the token
    # in the same operation avoids losing a completion between lock contention
    # and subscribing to its result. Finished flights are not reused by new calls.
    _JOIN = """
local token = redis.call('GET', KEYS[1])
if token then return {0, token} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return {1, ARGV[1]}
"""
    _PUBLISH = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('DEL', KEYS[1])
return 1
"""
    _TIMEOUT = 30
    _TTL = 60
    _adapter = TypeAdapter(OAuthRefreshResult)
    _errors: dict[str, type[ConnectionError]] = {
        error.__name__: error
        for error in (
            ConnectionCheckUnavailableError,
            ConnectionConflictError,
            ConnectionIdentityError,
            ConnectionNotFoundError,
            ConnectionConfigurationError,
            ConnectionReauthorizationRequiredError,
            ConnectionSecretUnavailableError,
        )
    }

    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def run(
        self, guard: ConnectionMutationGuard, operation: Callable[[OAuthRefreshLease], OAuthRefreshResult]
    ) -> OAuthRefreshResult:
        owner = f"{guard.owner.account_id or ''}:{guard.owner.end_user_id or ''}"
        scope = f"{guard.tenant_id}:{owner}:{guard.connection_id}:{guard.revision}"
        key = f"end_user_connection_refresh:{{{scope}}}"
        try:
            leader, raw_token = self._redis.eval(self._JOIN, 1, key, uuid4().hex, self._TTL)
            token = raw_token.decode() if isinstance(raw_token, bytes) else raw_token
            result_key = f"{key}:result:{token}"
            if not leader:
                return self._wait(key, result_key, token)
            lease = RedisOAuthRefreshLease(self._redis, key, token)
            try:
                result = operation(lease)
            except Exception as error:
                name = type(error).__name__
                if name not in self._errors:
                    name = ConnectionCheckUnavailableError.__name__
                self._publish(key, result_key, token, json.dumps({"error": name}))
                raise
            self._publish(
                key, result_key, token, json.dumps({"result": self._adapter.dump_python(result, mode="json")})
            )
            return result
        except RedisError:
            raise ConnectionCheckUnavailableError() from None

    def _publish(self, key: str, result_key: str, token: str, payload: str) -> None:
        if not self._redis.eval(self._PUBLISH, 2, key, result_key, token, payload, self._TTL):
            raise ConnectionCheckUnavailableError()

    def _wait(self, key: str, result_key: str, token: str) -> OAuthRefreshResult:
        deadline = time.monotonic() + self._TIMEOUT
        while time.monotonic() < deadline:
            payload = self._redis.get(result_key)
            if payload is None:
                active = self._redis.get(key)
                if active not in (token, token.encode()):
                    # Publication and removal are atomic; re-read after observing
                    # removal to cover completion just after the first result read.
                    payload = self._redis.get(result_key)
                    if payload is None:
                        raise ConnectionCheckUnavailableError()
            if payload is not None:
                data = json.loads(payload)
                if "error" in data:
                    raise self._errors.get(data["error"], ConnectionCheckUnavailableError)()
                return self._adapter.validate_python(data["result"])
            time.sleep(0.05)
        raise ConnectionCheckUnavailableError()
