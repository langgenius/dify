import json
import logging
import time as _time
import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import ProviderConfigEncrypter, create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.tools.utils.system_oauth_encryption import decrypt_system_oauth_params
from core.trigger.entities.api_entities import (
    TriggerProviderApiEntity,
    TriggerProviderSubscriptionApiEntity,
)
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
from extensions.ext_redis import redis_client
from models.provider_ids import TriggerProviderID
from models.trigger import (
    TriggerOAuthSystemClient,
    TriggerOAuthTenantClient,
    TriggerSubscription,
    WorkflowPluginTrigger,
)
from services.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


class TriggerProviderService:
    """Service for managing trigger providers and credentials"""

    ##########################
    # Trigger provider
    ##########################
    __MAX_TRIGGER_PROVIDER_COUNT__ = 10

    @classmethod
    def get_trigger_provider(cls, tenant_id: str, provider: TriggerProviderID) -> TriggerProviderApiEntity:
        """Get info for a trigger provider"""
        return TriggerManager.get_trigger_provider(tenant_id, provider).to_api_entity()

    @classmethod
    def list_trigger_providers(cls, tenant_id: str) -> list[TriggerProviderApiEntity]:
        """List all trigger providers for the current tenant"""
        return [provider.to_api_entity() for provider in TriggerManager.list_all_trigger_providers(tenant_id)]

    @classmethod
    def list_trigger_provider_subscriptions(
        cls, tenant_id: str, provider_id: TriggerProviderID
    ) -> list[TriggerProviderSubscriptionApiEntity]:
        """List all trigger subscriptions for the current tenant"""
        subscriptions: list[TriggerProviderSubscriptionApiEntity] = []
        workflows_in_use_map: dict[str, int] = {}
        with Session(db.engine, expire_on_commit=False) as session:
            # Get all subscriptions
            subscriptions_db = (
                session.query(TriggerSubscription)
                .filter_by(tenant_id=tenant_id, provider_id=str(provider_id))
                .order_by(desc(TriggerSubscription.created_at))
                .all()
            )
            subscriptions = [subscription.to_api_entity() for subscription in subscriptions_db]
            if not subscriptions:
                return []
            usage_counts = (
                session.query(
                    WorkflowPluginTrigger.subscription_id,
                    func.count(func.distinct(WorkflowPluginTrigger.app_id)).label("app_count"),
                )
                .filter(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id.in_([s.id for s in subscriptions]),
                )
                .group_by(WorkflowPluginTrigger.subscription_id)
                .all()
            )
            workflows_in_use_map = {str(row.subscription_id): int(row.app_count) for row in usage_counts}

        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        for subscription in subscriptions:
            encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                tenant_id=tenant_id,
                controller=provider_controller,
                subscription=subscription,
            )
            subscription.credentials = dict(
                encrypter.mask_credentials(dict(encrypter.decrypt(subscription.credentials)))
            )
            subscription.properties = dict(encrypter.mask_credentials(dict(encrypter.decrypt(subscription.properties))))
            subscription.parameters = dict(encrypter.mask_credentials(dict(encrypter.decrypt(subscription.parameters))))
            count = workflows_in_use_map.get(subscription.id)
            subscription.workflows_in_use = count if count is not None else 0

        return subscriptions

    @classmethod
    def add_trigger_subscription(
        cls,
        tenant_id: str,
        user_id: str,
        name: str,
        provider_id: TriggerProviderID,
        endpoint_id: str,
        credential_type: CredentialType,
        parameters: Mapping[str, Any],
        properties: Mapping[str, Any],
        credentials: Mapping[str, str],
        subscription_id: str | None = None,
        credential_expires_at: int = -1,
        expires_at: int = -1,
    ) -> Mapping[str, Any]:
        """
        Add a new trigger provider with credentials.
        Supports multiple credential instances per provider.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier (e.g., "plugin_id/provider_name")
        :param credential_type: Type of credential (oauth or api_key)
        :param credentials: Credential data to encrypt and store
        :param name: Optional name for this credential instance
        :param expires_at: OAuth token expiration timestamp
        :return: Success response
        """
        try:
            provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
            with Session(db.engine, expire_on_commit=False) as session:
                # Use distributed lock to prevent race conditions
                lock_key = f"trigger_provider_create_lock:{tenant_id}_{provider_id}"
                with redis_client.lock(lock_key, timeout=20):
                    # Check provider count limit
                    provider_count = (
                        session.query(TriggerSubscription)
                        .filter_by(tenant_id=tenant_id, provider_id=str(provider_id))
                        .count()
                    )

                    if provider_count >= cls.__MAX_TRIGGER_PROVIDER_COUNT__:
                        raise ValueError(
                            f"Maximum number of providers ({cls.__MAX_TRIGGER_PROVIDER_COUNT__}) "
                            f"reached for {provider_id}"
                        )

                    # Check if name already exists
                    existing = (
                        session.query(TriggerSubscription)
                        .filter_by(tenant_id=tenant_id, provider_id=str(provider_id), name=name)
                        .first()
                    )
                    if existing:
                        raise ValueError(f"Credential name '{name}' already exists for this provider")

                    credential_encrypter: ProviderConfigEncrypter | None = None
                    if credential_type != CredentialType.UNAUTHORIZED:
                        credential_encrypter, _ = create_provider_encrypter(
                            tenant_id=tenant_id,
                            config=provider_controller.get_credential_schema_config(credential_type),
                            cache=NoOpProviderCredentialCache(),
                        )

                    properties_encrypter, _ = create_provider_encrypter(
                        tenant_id=tenant_id,
                        config=provider_controller.get_properties_schema(),
                        cache=NoOpProviderCredentialCache(),
                    )

                    # Create provider record
                    subscription = TriggerSubscription(
                        id=subscription_id or str(uuid.uuid4()),
                        tenant_id=tenant_id,
                        user_id=user_id,
                        name=name,
                        endpoint_id=endpoint_id,
                        provider_id=str(provider_id),
                        parameters=parameters,
                        properties=properties_encrypter.encrypt(dict(properties)),
                        credentials=credential_encrypter.encrypt(dict(credentials)) if credential_encrypter else {},
                        credential_type=credential_type.value,
                        credential_expires_at=credential_expires_at,
                        expires_at=expires_at,
                    )

                    session.add(subscription)
                    session.commit()

                    return {
                        "result": "success",
                        "id": str(subscription.id),
                    }

        except Exception as e:
            logger.exception("Failed to add trigger provider")
            raise ValueError(str(e))

    @classmethod
    def get_subscription_by_id(cls, tenant_id: str, subscription_id: str | None = None) -> TriggerSubscription | None:
        """
        Get a trigger subscription by the ID.
        """
        with Session(db.engine, expire_on_commit=False) as session:
            subscription: TriggerSubscription | None = None
            if subscription_id:
                subscription = (
                    session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()
                )
            else:
                subscription = session.query(TriggerSubscription).filter_by(tenant_id=tenant_id).first()
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
    def delete_trigger_provider(cls, session: Session, tenant_id: str, subscription_id: str):
        """
        Delete a trigger provider subscription within an existing session.

        :param session: Database session
        :param tenant_id: Tenant ID
        :param subscription_id: Subscription instance ID
        :return: Success response
        """
        subscription: TriggerSubscription | None = (
            session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()
        )
        if not subscription:
            raise ValueError(f"Trigger provider subscription {subscription_id} not found")

        credential_type: CredentialType = CredentialType.of(subscription.credential_type)
        is_auto_created: bool = credential_type in [CredentialType.OAUTH2, CredentialType.API_KEY]
        if is_auto_created:
            provider_id = TriggerProviderID(subscription.provider_id)
            provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                tenant_id=tenant_id, provider_id=provider_id
            )
            encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                tenant_id=tenant_id,
                controller=provider_controller,
                subscription=subscription,
            )
            try:
                TriggerManager.unsubscribe_trigger(
                    tenant_id=tenant_id,
                    user_id=subscription.user_id,
                    provider_id=provider_id,
                    subscription=subscription.to_entity(),
                    credentials=encrypter.decrypt(subscription.credentials),
                    credential_type=credential_type,
                )
            except Exception as e:
                logger.exception("Error unsubscribing trigger", exc_info=e)

        # Clear cache
        session.delete(subscription)
        delete_cache_for_subscription(
            tenant_id=tenant_id,
            provider_id=subscription.provider_id,
            subscription_id=subscription.id,
        )

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
        with Session(db.engine) as session:
            subscription = session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()

            if not subscription:
                raise ValueError(f"Trigger provider subscription {subscription_id} not found")

            if subscription.credential_type != CredentialType.OAUTH2.value:
                raise ValueError("Only OAuth credentials can be refreshed")

            provider_id = TriggerProviderID(subscription.provider_id)
            provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                tenant_id=tenant_id, provider_id=provider_id
            )
            # Create encrypter
            encrypter, cache = create_provider_encrypter(
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
            system_credentials = cls.get_oauth_client(tenant_id, provider_id)

            # Refresh token
            oauth_handler = OAuthHandler()
            refreshed_credentials = oauth_handler.refresh_credentials(
                tenant_id=tenant_id,
                user_id=subscription.user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=system_credentials or {},
                credentials=current_credentials,
            )

            # Update credentials
            subscription.credentials = dict(encrypter.encrypt(dict(refreshed_credentials.credentials)))
            subscription.credential_expires_at = refreshed_credentials.expires_at
            session.commit()

            # Clear cache
            cache.delete()

            return {
                "result": "success",
                "expires_at": refreshed_credentials.expires_at,
            }

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

        with Session(db.engine) as session:
            subscription: TriggerSubscription | None = (
                session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()
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
            session.commit()
            properties_cache.delete()

            logger.info(
                "Subscription refreshed (service): tenant=%s id=%s new_expires_at=%s",
                tenant_id,
                subscription_id,
                subscription.expires_at,
            )

            return {"result": "success", "expires_at": int(refreshed.expires_at)}

    @classmethod
    def get_oauth_client(cls, tenant_id: str, provider_id: TriggerProviderID) -> Mapping[str, Any] | None:
        """
        Get OAuth client configuration for a provider.
        First tries tenant-level OAuth, then falls back to system OAuth.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :return: OAuth client configuration or None
        """
        provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )
        with Session(db.engine, expire_on_commit=False) as session:
            tenant_client: TriggerOAuthTenantClient | None = (
                session.query(TriggerOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=provider_id.provider_name,
                    plugin_id=provider_id.plugin_id,
                    enabled=True,
                )
                .first()
            )

            oauth_params: Mapping[str, Any] | None = None
            if tenant_client:
                encrypter, _ = create_provider_encrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                    cache=NoOpProviderCredentialCache(),
                )
                oauth_params = encrypter.decrypt(dict(tenant_client.oauth_params))
                return oauth_params

            is_verified = PluginService.is_plugin_verified(tenant_id, provider_id.plugin_id)
            if not is_verified:
                return None

            # Check for system-level OAuth client
            system_client: TriggerOAuthSystemClient | None = (
                session.query(TriggerOAuthSystemClient)
                .filter_by(plugin_id=provider_id.plugin_id, provider=provider_id.provider_name)
                .first()
            )

            if system_client:
                try:
                    oauth_params = decrypt_system_oauth_params(system_client.encrypted_oauth_params)
                except Exception as e:
                    raise ValueError(f"Error decrypting system oauth params: {e}")

            return oauth_params

    @classmethod
    def is_oauth_system_client_exists(cls, tenant_id: str, provider_id: TriggerProviderID) -> bool:
        """
        Check if system OAuth client exists for a trigger provider.
        """
        is_verified = PluginService.is_plugin_verified(tenant_id, provider_id.plugin_id)
        if not is_verified:
            return False
        with Session(db.engine, expire_on_commit=False) as session:
            system_client: TriggerOAuthSystemClient | None = (
                session.query(TriggerOAuthSystemClient)
                .filter_by(plugin_id=provider_id.plugin_id, provider=provider_id.provider_name)
                .first()
            )
            return system_client is not None

    @classmethod
    def save_custom_oauth_client_params(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        client_params: Mapping[str, Any] | None = None,
        enabled: bool | None = None,
    ) -> Mapping[str, Any]:
        """
        Save or update custom OAuth client parameters for a trigger provider.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :param client_params: OAuth client parameters (client_id, client_secret, etc.)
        :param enabled: Enable/disable the custom OAuth client
        :return: Success response
        """
        if client_params is None and enabled is None:
            return {"result": "success"}

        # Get provider controller to access schema
        provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )

        with Session(db.engine) as session:
            # Find existing custom client params
            custom_client = (
                session.query(TriggerOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    plugin_id=provider_id.plugin_id,
                    provider=provider_id.provider_name,
                )
                .first()
            )

            # Create new record if doesn't exist
            if custom_client is None:
                custom_client = TriggerOAuthTenantClient(
                    tenant_id=tenant_id,
                    plugin_id=provider_id.plugin_id,
                    provider=provider_id.provider_name,
                )
                session.add(custom_client)

            # Update client params if provided
            if client_params is None:
                custom_client.encrypted_oauth_params = json.dumps({})
            else:
                encrypter, cache = create_provider_encrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                    cache=NoOpProviderCredentialCache(),
                )

                # Handle hidden values
                original_params = encrypter.decrypt(dict(custom_client.oauth_params))
                new_params: dict[str, Any] = {
                    key: value if value != HIDDEN_VALUE else original_params.get(key, UNKNOWN_VALUE)
                    for key, value in client_params.items()
                }
                custom_client.encrypted_oauth_params = json.dumps(encrypter.encrypt(new_params))
                cache.delete()

            # Update enabled status if provided
            if enabled is not None:
                custom_client.enabled = enabled

            session.commit()

        return {"result": "success"}

    @classmethod
    def get_custom_oauth_client_params(cls, tenant_id: str, provider_id: TriggerProviderID) -> Mapping[str, Any]:
        """
        Get custom OAuth client parameters for a trigger provider.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :return: Masked OAuth client parameters
        """
        with Session(db.engine) as session:
            custom_client = (
                session.query(TriggerOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    plugin_id=provider_id.plugin_id,
                    provider=provider_id.provider_name,
                )
                .first()
            )

            if custom_client is None:
                return {}

            # Get provider controller to access schema
            provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                tenant_id=tenant_id, provider_id=provider_id
            )

            # Create encrypter to decrypt and mask values
            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                cache=NoOpProviderCredentialCache(),
            )

            return encrypter.mask_plugin_credentials(encrypter.decrypt(dict(custom_client.oauth_params)))

    @classmethod
    def delete_custom_oauth_client_params(cls, tenant_id: str, provider_id: TriggerProviderID) -> Mapping[str, Any]:
        """
        Delete custom OAuth client parameters for a trigger provider.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :return: Success response
        """
        with Session(db.engine) as session:
            session.query(TriggerOAuthTenantClient).filter_by(
                tenant_id=tenant_id,
                provider=provider_id.provider_name,
                plugin_id=provider_id.plugin_id,
            ).delete()
            session.commit()

        return {"result": "success"}

    @classmethod
    def is_oauth_custom_client_enabled(cls, tenant_id: str, provider_id: TriggerProviderID) -> bool:
        """
        Check if custom OAuth client is enabled for a trigger provider.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :return: True if enabled, False otherwise
        """
        with Session(db.engine, expire_on_commit=False) as session:
            custom_client = (
                session.query(TriggerOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    plugin_id=provider_id.plugin_id,
                    provider=provider_id.provider_name,
                    enabled=True,
                )
                .first()
            )
            return custom_client is not None

    @classmethod
    def get_subscription_by_endpoint(cls, endpoint_id: str) -> TriggerSubscription | None:
        """
        Get a trigger subscription by the endpoint ID.
        """
        with Session(db.engine, expire_on_commit=False) as session:
            subscription = session.query(TriggerSubscription).filter_by(endpoint_id=endpoint_id).first()
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
