"""Renew persisted subscriptions without holding SQL transactions across provider calls."""

import logging
from collections.abc import Mapping
from typing import Any, Protocol

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription
from models.provider_ids import TriggerProviderID
from models.utils.trigger_endpoint import generate_plugin_trigger_endpoint_url
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.trigger.oauth_client_service import TriggerOAuthClientService
from services.trigger.oauth_service import TriggerOAuthCredentials
from services.trigger.subscription_query_service import TriggerSubscriptionSchemas
from services.trigger.subscription_service import (
    TriggerSubscriptionCacheInvalidator,
    TriggerSubscriptionCodec,
    TriggerSubscriptionLease,
    TriggerSubscriptionLeaseLostError,
    TriggerSubscriptionLocks,
    TriggerSubscriptionNotFoundError,
    TriggerSubscriptionSnapshot,
)

logger = logging.getLogger(__name__)


class TriggerSubscriptionRenewalStore(Protocol):
    def get(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionSnapshot | None: ...

    def update_renewed_credentials(
        self,
        *,
        expected: TriggerSubscriptionSnapshot,
        credentials: Mapping[str, object],
        credential_expires_at: int,
    ) -> None:
        """Persist rotated credentials if their inputs are unchanged, preserving unrelated edits."""
        ...

    def update_renewed_subscription(
        self,
        *,
        expected: TriggerSubscriptionSnapshot,
        properties: Mapping[str, Any],
        expires_at: int,
    ) -> None:
        """Persist renewal output if the subscription sent to the provider is unchanged."""
        ...


class TriggerSubscriptionRenewalGateway(Protocol):
    def get_schemas(
        self, *, tenant_id: str, provider_id: TriggerProviderID, credential_type: CredentialType
    ) -> TriggerSubscriptionSchemas: ...

    def refresh(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        subscription: Subscription,
        credentials: Mapping[str, object],
        credential_type: CredentialType,
    ) -> Subscription: ...


class TriggerOAuthRenewalGateway(Protocol):
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
        """None uses the provider's default client, retaining package-bound dispatch."""
        ...


class TriggerSubscriptionRenewalService:
    """Run independent OAuth and subscription renewal stages against detached snapshots.

    TODO: The shared RSA key provider still owns a scoped DB session; remove that
    dependency when tenant key reads return detached values.
    """

    def __init__(
        self,
        *,
        subscriptions: TriggerSubscriptionRenewalStore,
        providers: TriggerSubscriptionRenewalGateway,
        oauth: TriggerOAuthRenewalGateway,
        clients: TriggerOAuthClientService,
        locks: TriggerSubscriptionLocks,
        codec: TriggerSubscriptionCodec,
        credential_threshold: int,
        subscription_threshold: int,
        console_api_url: str,
        invalidate_cache: TriggerSubscriptionCacheInvalidator,
        invalidate_properties: TriggerSubscriptionCacheInvalidator,
    ) -> None:
        self._subscriptions = subscriptions
        self._providers = providers
        self._oauth = oauth
        self._clients = clients
        self._locks = locks
        self._codec = codec
        self._credential_threshold = credential_threshold
        self._subscription_threshold = subscription_threshold
        self._console_api_url = console_api_url
        self._invalidate_cache = invalidate_cache
        self._invalidate_properties = invalidate_properties

    def refresh_if_due(self, *, tenant_id: str, subscription_id: str, now: int) -> None:
        """Serialize provider renewal and writes for this subscription.

        Re-read after acquiring the lease so a concurrent renewal or edit is observed.
        Once lease loss is detected, no further provider calls or writes are made.
        A completed provider operation cannot be undone.
        """
        with self._locks.for_subscription(tenant_id=tenant_id, subscription_id=subscription_id) as lease:
            self._refresh_if_due(tenant_id=tenant_id, subscription_id=subscription_id, now=now, lease=lease)

    def _refresh_if_due(
        self, *, tenant_id: str, subscription_id: str, now: int, lease: TriggerSubscriptionLease
    ) -> None:
        """Under the held lease, reload the scoped subscription and renew stages due at ``now``."""
        subscription = self._subscriptions.get(tenant_id=tenant_id, subscription_id=subscription_id)
        if subscription is None:
            logger.warning("Subscription not found: tenant=%s id=%s", tenant_id, subscription_id)
            return

        if (
            subscription.credential_type == CredentialType.OAUTH2
            and subscription.credential_expires_at != -1
            and subscription.credential_expires_at <= now + self._credential_threshold
        ):
            try:
                self._refresh_oauth(subscription, lease)
            except TriggerSubscriptionLeaseLostError:
                raise
            except Exception:
                logger.exception("OAuth refresh failed: tenant=%s subscription_id=%s", tenant_id, subscription_id)

        if subscription.expires_at == -1 or subscription.expires_at > now + self._subscription_threshold:
            return
        try:
            # Reload after OAuth renewal so the provider receives the newly committed token.
            current = self._subscriptions.get(tenant_id=tenant_id, subscription_id=subscription_id)
            if current is None:
                raise TriggerSubscriptionNotFoundError(f"Trigger subscription {subscription_id} not found.")
            # The scheduler selects ahead of expiry; subscription renewal historically waits until expiry.
            if current.expires_at != -1 and current.expires_at <= now:
                self._refresh_subscription(current, lease)
        except TriggerSubscriptionLeaseLostError:
            raise
        except Exception:
            logger.exception("Subscription refresh failed: tenant=%s id=%s", tenant_id, subscription_id)

    def _refresh_oauth(self, subscription: TriggerSubscriptionSnapshot, lease: TriggerSubscriptionLease) -> None:
        """Check the subscription lease before the OAuth call and credential write."""
        provider_id = TriggerProviderID(subscription.provider_id)
        schemas = self._providers.get_schemas(
            tenant_id=subscription.tenant_id, provider_id=provider_id, credential_type=CredentialType.OAUTH2
        )
        # Tokens use the subscription credential schema, not the OAuth client ID/secret schema.
        encrypter = self._codec.for_schema(
            tenant_id=subscription.tenant_id,
            schema=schemas.credentials[CredentialType.OAUTH2],
        )
        credentials = encrypter.decrypt(subscription.credentials)
        client_config = self._clients.resolve(tenant_id=subscription.tenant_id, provider_id=provider_id)
        lease.ensure_owned()
        refreshed = self._oauth.refresh_credentials(
            tenant_id=subscription.tenant_id,
            user_id=subscription.user_id,
            provider_id=provider_id,
            redirect_uri=(
                f"{self._console_api_url}/console/api/oauth/plugin/{subscription.provider_id}/trigger/callback"
            ),
            client_config=client_config,
            credentials=credentials,
        )
        lease.ensure_owned()
        encrypted_credentials = encrypter.encrypt(dict(refreshed.credentials))
        lease.ensure_owned()
        self._subscriptions.update_renewed_credentials(
            expected=subscription,
            credentials=encrypted_credentials,
            credential_expires_at=refreshed.expires_at,
        )
        self._invalidate(subscription, self._invalidate_cache)
        logger.info(
            "OAuth token refreshed: tenant=%s subscription_id=%s expires_at=%s",
            subscription.tenant_id,
            subscription.id,
            refreshed.expires_at,
        )

    def _refresh_subscription(self, subscription: TriggerSubscriptionSnapshot, lease: TriggerSubscriptionLease) -> None:
        """Check the subscription lease before the provider call and property write."""
        provider_id = TriggerProviderID(subscription.provider_id)
        schemas = self._providers.get_schemas(
            tenant_id=subscription.tenant_id, provider_id=provider_id, credential_type=subscription.credential_type
        )
        credential_encrypter = self._codec.for_schema(
            tenant_id=subscription.tenant_id,
            schema=schemas.credentials[subscription.credential_type],
        )
        properties_encrypter = self._codec.for_schema(tenant_id=subscription.tenant_id, schema=schemas.properties)
        credentials = credential_encrypter.decrypt(subscription.credentials)
        properties = properties_encrypter.decrypt(subscription.properties)
        lease.ensure_owned()
        refreshed = self._providers.refresh(
            tenant_id=subscription.tenant_id,
            provider_id=provider_id,
            subscription=Subscription(
                expires_at=subscription.expires_at,
                endpoint=generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
                parameters=subscription.parameters,
                properties=properties,
            ),
            credentials=credentials,
            credential_type=subscription.credential_type,
        )
        lease.ensure_owned()
        encrypted_properties = properties_encrypter.encrypt(dict(refreshed.properties))
        lease.ensure_owned()
        self._subscriptions.update_renewed_subscription(
            expected=subscription,
            properties=encrypted_properties,
            expires_at=int(refreshed.expires_at),
        )
        self._invalidate(subscription, self._invalidate_properties)
        logger.info(
            "Subscription refreshed: tenant=%s subscription_id=%s expires_at=%s",
            subscription.tenant_id,
            subscription.id,
            refreshed.expires_at,
        )

    @staticmethod
    def _invalidate(subscription: TriggerSubscriptionSnapshot, invalidate: TriggerSubscriptionCacheInvalidator) -> None:
        try:
            invalidate(
                tenant_id=subscription.tenant_id, provider_id=subscription.provider_id, subscription_id=subscription.id
            )
        except Exception:
            logger.exception(
                "Failed to invalidate cache after renewing trigger subscription %s in workspace %s",
                subscription.id,
                subscription.tenant_id,
            )
