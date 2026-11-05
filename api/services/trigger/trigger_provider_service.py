import logging
import time as _time
from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.tools.utils.system_encryption import decrypt_system_params
from core.trigger.entities.entities import Subscription as TriggerSubscriptionEntity
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import (
    create_trigger_provider_encrypter_for_properties,
    create_trigger_provider_encrypter_for_subscription,
    delete_cache_for_subscription,
)
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from extensions.ext_database import db
from models.provider_ids import TriggerProviderID
from models.trigger import (
    TriggerOAuthSystemClient,
    TriggerOAuthTenantClient,
    TriggerSubscription,
)
from services.plugin.dispatch_identity import PluginOAuthClientConfig

logger = logging.getLogger(__name__)


class TriggerProviderService:
    """Legacy subscription reads and renewal tasks.

    Console management and builder writes use the injected TriggerSubscriptionService.
    TODO: Retire these ORM-returning reads when webhook dispatch, dynamic options and
    renewal tasks migrate to detached subscription queries and explicit dependencies.
    """

    @classmethod
    def get_subscription_by_id(
        cls, tenant_id: str, subscription_id: str | None = None, *, provider_id: TriggerProviderID | None = None
    ) -> TriggerSubscription | None:
        """
        Get a trigger subscription by the ID.
        """
        with Session(db.engine, expire_on_commit=False) as session:
            query = select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id)
            if subscription_id:
                query = query.where(TriggerSubscription.id == subscription_id)
            if provider_id is not None:
                query = query.where(TriggerSubscription.provider_id == str(provider_id))
            subscription = session.scalar(query.limit(1))
            if subscription:
                provider_controller = TriggerManager.get_trigger_provider(
                    tenant_id, TriggerProviderID(subscription.provider_id)
                )
                encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                    tenant_id=tenant_id,
                    controller=provider_controller,
                    subscription=subscription,
                )
                subscription.credentials = dict(encrypter.decrypt(subscription.credentials))
                properties_encrypter, _ = create_trigger_provider_encrypter_for_properties(
                    tenant_id=subscription.tenant_id,
                    controller=provider_controller,
                    subscription=subscription,
                )
                subscription.properties = dict(properties_encrypter.decrypt(subscription.properties))
            return subscription

    @classmethod
    def refresh_oauth_token(
        cls,
        tenant_id: str,
        subscription_id: str,
    ) -> Mapping[str, Any]:
        """
        Refresh OAuth token for a trigger provider.

        :param tenant_id: Tenant ID
        :param subscription_id: Subscription instance ID
        :return: New token info
        """
        with sessionmaker(bind=db.engine).begin() as session:
            subscription = session.scalar(
                select(TriggerSubscription)
                .where(
                    TriggerSubscription.tenant_id == tenant_id,
                    TriggerSubscription.id == subscription_id,
                )
                .limit(1)
            )

            if not subscription:
                raise ValueError(f"Trigger provider subscription {subscription_id} not found")

            if subscription.credential_type != CredentialType.OAUTH2:
                raise ValueError("Only OAuth credentials can be refreshed")

            provider_id = TriggerProviderID(subscription.provider_id)
            provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                tenant_id=tenant_id, provider_id=provider_id
            )
            # Create encrypter
            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                cache=NoOpProviderCredentialCache(),
            )

            # Decrypt current credentials
            current_credentials = encrypter.decrypt(subscription.credentials)

            # Get OAuth client configuration
            redirect_uri = (
                f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{subscription.provider_id}/trigger/callback"
            )
            plugin_unique_identifier = provider_controller.plugin_unique_identifier
            system_credentials = cls.get_oauth_client(tenant_id, provider_id, provider_controller=provider_controller)

            # Refresh token
            oauth_handler = OAuthHandler()
            refreshed_credentials = oauth_handler.refresh_credentials(
                tenant_id=tenant_id,
                user_id=subscription.user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=dict(system_credentials.credentials) if system_credentials is not None else {},
                plugin_unique_identifier=(
                    system_credentials.plugin_unique_identifier
                    if system_credentials is not None
                    else plugin_unique_identifier
                ),
                credentials=current_credentials,
            )

            # Update credentials
            subscription.credentials = dict(encrypter.encrypt(dict(refreshed_credentials.credentials)))
            subscription.credential_expires_at = refreshed_credentials.expires_at

            provider_id_value = subscription.provider_id
            result = {
                "result": "success",
                "expires_at": refreshed_credentials.expires_at,
            }

        # Clear the trigger runtime credential cache after the DB commit so dispatch uses the refreshed token.
        delete_cache_for_subscription(
            tenant_id=tenant_id,
            provider_id=provider_id_value,
            subscription_id=subscription_id,
        )
        return result

    @classmethod
    def refresh_subscription(
        cls,
        tenant_id: str,
        subscription_id: str,
        now: int | None = None,
    ) -> Mapping[str, Any]:
        """
        Refresh trigger subscription if expired.

        Args:
            tenant_id: Tenant ID
            subscription_id: Subscription instance ID
            now: Current timestamp, defaults to `int(time.time())`

        Returns:
            Mapping with keys: `result` ("success"|"skipped") and `expires_at` (new or existing value)
        """
        now_ts: int = int(now if now is not None else _time.time())

        with sessionmaker(bind=db.engine).begin() as session:
            subscription = session.scalar(
                select(TriggerSubscription)
                .where(
                    TriggerSubscription.tenant_id == tenant_id,
                    TriggerSubscription.id == subscription_id,
                )
                .limit(1)
            )
            if subscription is None:
                raise ValueError(f"Trigger provider subscription {subscription_id} not found")

            if subscription.expires_at == -1 or int(subscription.expires_at) > now_ts:
                logger.debug(
                    "Subscription not due for refresh: tenant=%s id=%s expires_at=%s now=%s",
                    tenant_id,
                    subscription_id,
                    subscription.expires_at,
                    now_ts,
                )
                return {"result": "skipped", "expires_at": int(subscription.expires_at)}

            provider_id = TriggerProviderID(subscription.provider_id)
            controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                tenant_id=tenant_id, provider_id=provider_id
            )

            # Decrypt credentials and properties for runtime
            credential_encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                tenant_id=tenant_id,
                controller=controller,
                subscription=subscription,
            )
            properties_encrypter, properties_cache = create_trigger_provider_encrypter_for_properties(
                tenant_id=tenant_id,
                controller=controller,
                subscription=subscription,
            )

            decrypted_credentials = credential_encrypter.decrypt(subscription.credentials)
            decrypted_properties = properties_encrypter.decrypt(subscription.properties)

            sub_entity: TriggerSubscriptionEntity = TriggerSubscriptionEntity(
                expires_at=int(subscription.expires_at),
                endpoint=generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
                parameters=subscription.parameters,
                properties=decrypted_properties,
            )

            refreshed: TriggerSubscriptionEntity = controller.refresh_trigger(
                subscription=sub_entity,
                credentials=decrypted_credentials,
                credential_type=CredentialType.of(subscription.credential_type),
            )

            # Persist refreshed properties and expires_at
            subscription.properties = dict(properties_encrypter.encrypt(dict(refreshed.properties)))
            subscription.expires_at = int(refreshed.expires_at)
            logger.info(
                "Subscription refreshed (service): tenant=%s id=%s new_expires_at=%s",
                tenant_id,
                subscription_id,
                subscription.expires_at,
            )

            result = {"result": "success", "expires_at": int(refreshed.expires_at)}
        properties_cache.delete()
        return result

    @classmethod
    def get_oauth_client(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        *,
        provider_controller: PluginTriggerProviderController | None = None,
    ) -> PluginOAuthClientConfig | None:
        """
        Get OAuth client configuration for a provider.
        First tries tenant-level OAuth, then falls back to system OAuth.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :return: OAuth client configuration or None

        TODO: Remove this legacy resolver when subscription token refresh uses
        the injected TriggerOAuthClientService already shared by the OAuth APIs.
        """
        if provider_controller is None:
            provider_controller = TriggerManager.get_trigger_provider(tenant_id=tenant_id, provider_id=provider_id)
        plugin_unique_identifier = provider_controller.plugin_unique_identifier
        with Session(db.engine, expire_on_commit=False) as session:
            tenant_client = session.scalar(
                select(TriggerOAuthTenantClient)
                .where(
                    TriggerOAuthTenantClient.tenant_id == tenant_id,
                    TriggerOAuthTenantClient.provider == provider_id.provider_name,
                    TriggerOAuthTenantClient.plugin_id == provider_id.plugin_id,
                    TriggerOAuthTenantClient.enabled.is_(True),
                )
                .limit(1)
            )

            oauth_params: Mapping[str, Any] | None = None
            if tenant_client:
                encrypter, _ = create_provider_encrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                    cache=NoOpProviderCredentialCache(),
                )
                oauth_params = encrypter.decrypt(dict(tenant_client.oauth_params))
                return PluginOAuthClientConfig(plugin_unique_identifier, dict(oauth_params))

            is_verified = PluginService.is_plugin_verified(tenant_id, plugin_unique_identifier)
            if not is_verified:
                return None

            # Check for system-level OAuth client
            system_client = session.scalar(
                select(TriggerOAuthSystemClient)
                .where(
                    TriggerOAuthSystemClient.plugin_id == provider_id.plugin_id,
                    TriggerOAuthSystemClient.provider == provider_id.provider_name,
                )
                .limit(1)
            )

            if system_client:
                try:
                    oauth_params = decrypt_system_params(system_client.encrypted_oauth_params)
                except Exception as e:
                    raise ValueError(f"Error decrypting system oauth params: {e}") from e

            return (
                PluginOAuthClientConfig(plugin_unique_identifier, dict(oauth_params))
                if oauth_params is not None
                else None
            )

    @classmethod
    def get_subscription_by_endpoint(cls, endpoint_id: str) -> TriggerSubscription | None:
        """
        Get a trigger subscription by the endpoint ID.
        """
        with Session(db.engine, expire_on_commit=False) as session:
            subscription = session.scalar(
                select(TriggerSubscription).where(TriggerSubscription.endpoint_id == endpoint_id).limit(1)
            )
            if not subscription:
                return None
            provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                tenant_id=subscription.tenant_id, provider_id=TriggerProviderID(subscription.provider_id)
            )
            credential_encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                tenant_id=subscription.tenant_id,
                controller=provider_controller,
                subscription=subscription,
            )
            subscription.credentials = dict(credential_encrypter.decrypt(subscription.credentials))

            properties_encrypter, _ = create_trigger_provider_encrypter_for_properties(
                tenant_id=subscription.tenant_id,
                controller=provider_controller,
                subscription=subscription,
            )
            subscription.properties = dict(properties_encrypter.decrypt(subscription.properties))
            return subscription
