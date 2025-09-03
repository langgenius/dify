import json
import logging
import uuid
from collections.abc import Mapping

from flask import Request, Response

from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import (
    RequestLog,
    SubscriptionBuilder,
)
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_redis import redis_client
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


class TriggerSubscriptionBuilderService:
    """Service for managing trigger providers and credentials"""

    ##########################
    # Trigger provider
    ##########################
    __MAX_TRIGGER_PROVIDER_COUNT__ = 10

    ##########################
    # Validation endpoint
    ##########################
    __VALIDATION_REQUEST_CACHE_COUNT__ = 10
    __VALIDATION_REQUEST_CACHE_EXPIRE_MS__ = 30 * 60 * 1000

    @classmethod
    def encode_cache_key(cls, subscription_id: str) -> str:
        return f"trigger:subscription:validation:{subscription_id}"

    @classmethod
    def verify_trigger_subscription_builder(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> None:
        """Verify a trigger subscription builder"""
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_builder = cls.get_subscription_builder(subscription_builder_id)
        if not subscription_builder:
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")

        provider_controller.validate_credentials(user_id, subscription_builder.credentials)

    @classmethod
    def build_trigger_subscription_builder(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> None:
        """Build a trigger subscription builder"""
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_builder = cls.get_subscription_builder(subscription_builder_id)
        if not subscription_builder:
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")

        if subscription_builder.name is None:
            raise ValueError("Subscription builder name is required")

        credential_type = CredentialType.of(subscription_builder.credential_type or CredentialType.UNAUTHORIZED.value)
        if credential_type == CredentialType.UNAUTHORIZED:
            # manually create
            TriggerProviderService.add_trigger_provider(
                tenant_id=tenant_id,
                user_id=user_id,
                name=subscription_builder.name,
                provider_id=provider_id,
                endpoint_id=subscription_builder.endpoint_id,
                parameters=subscription_builder.parameters,
                properties=subscription_builder.properties,
                credential_expires_at=subscription_builder.credential_expires_at or -1,
                expires_at=subscription_builder.expires_at,
                credentials=subscription_builder.credentials,
                credential_type=credential_type,
            )
        else:
            # automatically create
            subscription = TriggerManager.subscribe_trigger(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                endpoint=subscription_builder.endpoint_id,
                parameters=subscription_builder.parameters,
                credentials=subscription_builder.credentials,
            )

            TriggerProviderService.add_trigger_provider(
                tenant_id=tenant_id,
                user_id=user_id,
                name=subscription_builder.name,
                provider_id=provider_id,
                endpoint_id=subscription_builder.endpoint_id,
                parameters=subscription_builder.parameters,
                properties=subscription.properties,
                credentials=subscription_builder.credentials,
                credential_type=credential_type,
                credential_expires_at=subscription_builder.credential_expires_at or -1,
                expires_at=subscription_builder.expires_at,
            )

        cls.delete_trigger_subscription_builder(subscription_builder_id)

    @classmethod
    def create_trigger_subscription_builder(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
        credential_expires_at: int,
        expires_at: int,
    ) -> SubscriptionBuilder:
        """
        Add a new trigger subscription validation.
        """
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_schema = provider_controller.get_subscription_schema()
        subscription_id = str(uuid.uuid4())
        subscription_builder = SubscriptionBuilder(
            id=subscription_id,
            name="",
            endpoint_id=subscription_id,
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=str(provider_id),
            parameters=subscription_schema.get_default_parameters(),
            properties=subscription_schema.get_default_properties(),
            credentials=credentials,
            credential_type=credential_type,
            credential_expires_at=credential_expires_at,
            expires_at=expires_at,
        )
        cache_key = cls.encode_cache_key(subscription_id)
        redis_client.setex(
            cache_key, cls.__VALIDATION_REQUEST_CACHE_EXPIRE_MS__, subscription_builder.model_dump_json()
        )
        return subscription_builder

    @classmethod
    def update_trigger_subscription_builder(
        cls,
        tenant_id: str,
        subscription_builder: SubscriptionBuilder,
    ) -> SubscriptionBuilder:
        """
        Update a trigger subscription validation.
        """
        subscription_id = subscription_builder.id
        cache_key = cls.encode_cache_key(subscription_id)
        subscription_builder_cache = cls.get_subscription_builder(subscription_id)
        if not subscription_builder_cache or subscription_builder_cache.tenant_id != tenant_id:
            raise ValueError(f"Subscription {subscription_id} not found")

        redis_client.setex(
            cache_key, cls.__VALIDATION_REQUEST_CACHE_EXPIRE_MS__, subscription_builder.model_dump_json()
        )
        return subscription_builder

    @classmethod
    def delete_trigger_subscription_builder(cls, subscription_id: str) -> None:
        """
        Delete a trigger subscription validation.
        """
        cache_key = cls.encode_cache_key(subscription_id)
        redis_client.delete(cache_key)

    @classmethod
    def get_subscription_builder(cls, endpoint_id: str) -> SubscriptionBuilder | None:
        """
        Get a trigger subscription by the endpoint ID.
        """
        cache_key = cls.encode_cache_key(endpoint_id)
        subscription_cache = redis_client.get(cache_key)
        if subscription_cache:
            return SubscriptionBuilder.model_validate(json.loads(subscription_cache))

        return None

    @classmethod
    def append_request_log(cls, endpoint_id: str, request: Request, response: Response) -> None:
        """
        Append the validation request log to Redis.
        """
        pass

    @classmethod
    def list_request_logs(cls, endpoint_id: str) -> list[RequestLog]:
        """
        List the request logs for a validation endpoint.
        """
        return []

    @classmethod
    def process_builder_validation_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Process a temporary endpoint request.

        :param endpoint_id: The endpoint identifier
        :param request: The Flask request object
        :return: The Flask response object
        """
        # check if validation endpoint exists
        subscription_builder = cls.get_subscription_builder(endpoint_id)
        if not subscription_builder:
            return None

        # response to validation endpoint
        controller = TriggerManager.get_trigger_provider(
            subscription_builder.tenant_id, TriggerProviderID(subscription_builder.provider_id)
        )
        response = controller.dispatch(
            user_id=subscription_builder.user_id,
            request=request,
            subscription=subscription_builder.to_subscription(),
        )
        # append the request log
        cls.append_request_log(endpoint_id, request, response.response)
        return response.response
