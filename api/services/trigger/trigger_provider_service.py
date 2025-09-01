import json
import logging
import re
from collections.abc import Mapping
from typing import Any, Optional

from flask import Request, Response
from sqlalchemy import desc
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import create_provider_encrypter
from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.tools.utils.system_oauth_encryption import decrypt_system_oauth_params
from core.trigger.entities.api_entities import (
    SubscriptionValidation,
    TriggerProviderApiEntity,
    TriggerProviderSubscriptionApiEntity,
)
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import (
    create_trigger_provider_encrypter_for_subscription,
    create_trigger_provider_oauth_encrypter,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.trigger import TriggerOAuthSystemClient, TriggerOAuthTenantClient, TriggerSubscription
from services.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


class TriggerProviderService:
    """Service for managing trigger providers and credentials"""

    __MAX_TRIGGER_PROVIDER_COUNT__ = 10

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
        with Session(db.engine, autoflush=False) as session:
            subscriptions_db = (
                session.query(TriggerSubscription)
                .filter_by(tenant_id=tenant_id, provider_id=str(provider_id))
                .order_by(desc(TriggerSubscription.created_at))
                .all()
            )
            subscriptions = [subscription.to_api_entity() for subscription in subscriptions_db]

        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        for subscription in subscriptions:
            encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                tenant_id=tenant_id,
                controller=provider_controller,
                subscription=subscription,
            )
            subscription.credentials = encrypter.decrypt(subscription.credentials)
        return subscriptions

    @classmethod
    def add_trigger_provider(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        credential_type: CredentialType,
        credentials: dict,
        name: Optional[str] = None,
        expires_at: int = -1,
    ) -> dict:
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
            with Session(db.engine) as session:
                # Use distributed lock to prevent race conditions
                lock_key = f"trigger_provider_create_lock:{tenant_id}_{provider_id}"
                with redis_client.lock(lock_key, timeout=20):
                    # Check provider count limit
                    provider_count = (
                        session.query(TriggerSubscription)
                        .filter_by(tenant_id=tenant_id, provider_id=provider_id)
                        .count()
                    )

                    if provider_count >= cls.__MAX_TRIGGER_PROVIDER_COUNT__:
                        raise ValueError(
                            f"Maximum number of providers ({cls.__MAX_TRIGGER_PROVIDER_COUNT__}) "
                            f"reached for {provider_id}"
                        )

                    # Generate name if not provided
                    if not name:
                        name = cls._generate_provider_name(
                            session=session,
                            tenant_id=tenant_id,
                            provider_id=provider_id,
                            credential_type=credential_type,
                        )
                    else:
                        # Check if name already exists
                        existing = (
                            session.query(TriggerSubscription)
                            .filter_by(tenant_id=tenant_id, provider_id=provider_id, name=name)
                            .first()
                        )
                        if existing:
                            raise ValueError(f"Credential name '{name}' already exists for this provider")

                    encrypter, _ = create_provider_encrypter(
                        tenant_id=tenant_id,
                        config=provider_controller.get_credential_schema_config(credential_type),
                        cache=NoOpProviderCredentialCache(),
                    )

                    # Create provider record
                    db_provider = TriggerSubscription(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        provider_id=provider_id,
                        credential_type=credential_type.value,
                        credentials=encrypter.encrypt(credentials),
                        name=name,
                        expires_at=expires_at,
                    )

                    session.add(db_provider)
                    session.commit()

                    return {"result": "success", "id": str(db_provider.id)}

        except Exception as e:
            logger.exception("Failed to add trigger provider")
            raise ValueError(str(e))

    @classmethod
    def update_trigger_provider(
        cls,
        tenant_id: str,
        subscription_id: str,
        credentials: Optional[dict] = None,
        name: Optional[str] = None,
    ) -> dict:
        """
        Update an existing trigger provider's credentials or name.

        :param tenant_id: Tenant ID
        :param subscription_id: Subscription instance ID
        :param credentials: New credentials (optional)
        :param name: New name (optional)
        :return: Success response
        """
        with Session(db.engine) as session:
            db_provider = session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()
            if not db_provider:
                raise ValueError(f"Trigger provider subscription {subscription_id} not found")

            try:
                provider_controller = TriggerManager.get_trigger_provider(
                    tenant_id, TriggerProviderID(db_provider.provider_id)
                )

                if credentials:
                    encrypter, cache = create_trigger_provider_encrypter_for_subscription(
                        tenant_id=tenant_id,
                        controller=provider_controller,
                        subscription=db_provider,
                    )
                    # Handle hidden values
                    original_credentials = encrypter.decrypt(db_provider.credentials)
                    new_credentials = {
                        key: value if value != HIDDEN_VALUE else original_credentials.get(key, UNKNOWN_VALUE)
                        for key, value in credentials.items()
                    }

                    db_provider.credentials = encrypter.encrypt(new_credentials)
                    cache.delete()

                # Update name if provided
                if name and name != db_provider.name:
                    # Check if name already exists
                    existing = (
                        session.query(TriggerSubscription)
                        .filter_by(tenant_id=tenant_id, provider_id=db_provider.provider_id, name=name)
                        .filter(TriggerSubscription.id != subscription_id)
                        .first()
                    )
                    if existing:
                        raise ValueError(f"Credential name '{name}' already exists")

                    db_provider.name = name

                session.commit()
                return {"result": "success"}

            except Exception as e:
                session.rollback()
                raise ValueError(str(e))

    @classmethod
    def delete_trigger_provider(cls, tenant_id: str, subscription_id: str) -> dict:
        """
        Delete a trigger provider subscription.

        :param tenant_id: Tenant ID
        :param subscription_id: Subscription instance ID
        :return: Success response
        """
        with Session(db.engine) as session:
            db_provider = session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()
            if not db_provider:
                raise ValueError(f"Trigger provider subscription {subscription_id} not found")

            provider_controller = TriggerManager.get_trigger_provider(
                tenant_id, TriggerProviderID(db_provider.provider_id)
            )
            # Clear cache
            _, cache = create_trigger_provider_encrypter_for_subscription(
                tenant_id=tenant_id,
                controller=provider_controller,
                subscription=db_provider,
            )

            session.delete(db_provider)
            session.commit()

            cache.delete()
            return {"result": "success"}

    @classmethod
    def refresh_oauth_token(
        cls,
        tenant_id: str,
        subscription_id: str,
    ) -> dict:
        """
        Refresh OAuth token for a trigger provider.

        :param tenant_id: Tenant ID
        :param subscription_id: Subscription instance ID
        :return: New token info
        """
        with Session(db.engine) as session:
            db_provider = session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()

            if not db_provider:
                raise ValueError(f"Trigger provider subscription {subscription_id} not found")

            if db_provider.credential_type != CredentialType.OAUTH2.value:
                raise ValueError("Only OAuth credentials can be refreshed")

            provider_id = TriggerProviderID(db_provider.provider_id)
            provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
            # Create encrypter
            encrypter, cache = create_trigger_provider_encrypter_for_subscription(
                tenant_id=tenant_id,
                controller=provider_controller,
                subscription=db_provider,
            )

            # Decrypt current credentials
            current_credentials = encrypter.decrypt(db_provider.credentials)

            # Get OAuth client configuration
            redirect_uri = (
                f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{db_provider.provider_id}/trigger/callback"
            )
            system_credentials = cls.get_oauth_client(tenant_id, provider_id)

            # Refresh token
            oauth_handler = OAuthHandler()
            refreshed_credentials = oauth_handler.refresh_credentials(
                tenant_id=tenant_id,
                user_id=db_provider.user_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=system_credentials or {},
                credentials=current_credentials,
            )

            # Update credentials
            db_provider.credentials = encrypter.encrypt(dict(refreshed_credentials.credentials))
            db_provider.expires_at = refreshed_credentials.expires_at
            session.commit()

            # Clear cache
            cache.delete()

            return {
                "result": "success",
                "expires_at": refreshed_credentials.expires_at,
            }

    @classmethod
    def get_oauth_client(cls, tenant_id: str, provider_id: TriggerProviderID) -> Optional[Mapping[str, Any]]:
        """
        Get OAuth client configuration for a provider.
        First tries tenant-level OAuth, then falls back to system OAuth.

        :param tenant_id: Tenant ID
        :param provider_id: Provider identifier
        :return: OAuth client configuration or None
        """
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        with Session(db.engine, autoflush=False) as session:
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
                encrypter, _ = create_trigger_provider_oauth_encrypter(tenant_id, provider_controller)
                oauth_params = encrypter.decrypt(tenant_client.oauth_params)
                return oauth_params

            is_verified = PluginService.is_plugin_verified(tenant_id, provider_id.plugin_id)
            if not is_verified:
                return oauth_params

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
    def save_custom_oauth_client_params(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        client_params: Optional[dict] = None,
        enabled: Optional[bool] = None,
    ) -> dict:
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
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)

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
            if client_params is not None:
                encrypter, _ = create_provider_encrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                    cache=NoOpProviderCredentialCache(),
                )

                # Handle hidden values
                original_params = encrypter.decrypt(custom_client.oauth_params)
                new_params: dict = {
                    key: value if value != HIDDEN_VALUE else original_params.get(key, UNKNOWN_VALUE)
                    for key, value in client_params.items()
                }
                custom_client.encrypted_oauth_params = json.dumps(encrypter.encrypt(new_params))

            # Update enabled status if provided
            if enabled is not None:
                custom_client.enabled = enabled

            session.commit()

        return {"result": "success"}

    @classmethod
    def get_custom_oauth_client_params(cls, tenant_id: str, provider_id: TriggerProviderID) -> dict:
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
            provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)

            # Create encrypter to decrypt and mask values
            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                cache=NoOpProviderCredentialCache(),
            )

            return encrypter.mask_tool_credentials(encrypter.decrypt(custom_client.oauth_params))

    @classmethod
    def delete_custom_oauth_client_params(cls, tenant_id: str, provider_id: TriggerProviderID) -> dict:
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
        with Session(db.engine, autoflush=False) as session:
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
    def _generate_provider_name(
        cls,
        session: Session,
        tenant_id: str,
        provider_id: TriggerProviderID,
        credential_type: CredentialType,
    ) -> str:
        """
        Generate a unique name for a provider credential instance.

        :param session: Database session
        :param tenant_id: Tenant ID
        :param provider: Provider identifier
        :param credential_type: Credential type
        :return: Generated name
        """
        try:
            db_providers = (
                session.query(TriggerSubscription)
                .filter_by(
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    credential_type=credential_type.value,
                )
                .order_by(desc(TriggerSubscription.created_at))
                .all()
            )

            # Get base name
            base_name = credential_type.get_name()

            # Find existing numbered names
            pattern = rf"^{re.escape(base_name)}\s+(\d+)$"
            numbers = []

            for db_provider in db_providers:
                if db_provider.name:
                    match = re.match(pattern, db_provider.name.strip())
                    if match:
                        numbers.append(int(match.group(1)))

            # Generate next number
            if not numbers:
                return f"{base_name} 1"

            max_number = max(numbers)
            return f"{base_name} {max_number + 1}"

        except Exception as e:
            logger.warning("Error generating provider name")
            return f"{credential_type.get_name()} 1"

    @classmethod
    def get_subscription_by_endpoint(cls, endpoint_id: str) -> TriggerSubscription | None:
        """
        Get a trigger subscription by the endpoint ID.
        """
        with Session(db.engine, autoflush=False) as session:
            subscription = session.query(TriggerSubscription).filter_by(endpoint=endpoint_id).first()
            return subscription

    @classmethod
    def get_subscription_validation(cls, endpoint_id: str) -> SubscriptionValidation | None:
        """
        Get a trigger subscription by the endpoint ID.
        """
        cache_key = f"trigger:subscription:validation:endpoint:{endpoint_id}"
        subscription_cache = redis_client.get(cache_key)
        if subscription_cache:
            return SubscriptionValidation.model_validate(json.loads(subscription_cache))

        return None