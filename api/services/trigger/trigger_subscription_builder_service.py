import json
import logging
import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from flask import Request, Response

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerDispatchResponse
from core.tools.errors import ToolProviderCredentialValidationError
from core.trigger.entities.api_entities import SubscriptionBuilderApiEntity
from core.trigger.entities.entities import (
    RequestLog,
    Subscription,
    SubscriptionBuilder,
    SubscriptionBuilderUpdater,
)
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import masked_credentials
from core.trigger.utils.endpoint import parse_endpoint_id
from extensions.ext_redis import redis_client
from models.provider_ids import TriggerProviderID
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


class TriggerSubscriptionBuilderService:
    """Service for managing trigger providers and credentials"""

    ##########################
    # Trigger provider
    ##########################
    __MAX_TRIGGER_PROVIDER_COUNT__ = 10

    ##########################
    # Builder endpoint
    ##########################
    __BUILDER_CACHE_EXPIRE_SECONDS__ = 30 * 60

    __VALIDATION_REQUEST_CACHE_COUNT__ = 10
    __VALIDATION_REQUEST_CACHE_EXPIRE_SECONDS__ = 30 * 60

    @classmethod
    def encode_cache_key(cls, subscription_id: str) -> str:
        return f"trigger:subscription:builder:{subscription_id}"

    @classmethod
    def verify_trigger_subscription_builder(
        cls,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> Mapping[str, Any]:
        """Verify a trigger subscription builder"""
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_builder = cls.get_subscription_builder(subscription_builder_id)
        if not subscription_builder:
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")

        if subscription_builder.credential_type == CredentialType.OAUTH2:
            return {"verified": bool(subscription_builder.credentials)}

        if subscription_builder.credential_type == CredentialType.API_KEY:
            credentials_to_validate = subscription_builder.credentials
            try:
                provider_controller.validate_credentials(user_id, credentials_to_validate)
            except ToolProviderCredentialValidationError as e:
                raise ValueError(f"Invalid credentials: {e}")
            return {"verified": True}

        return {"verified": True}

    @classmethod
    def build_trigger_subscription_builder(
        cls, tenant_id: str, user_id: str, provider_id: TriggerProviderID, subscription_builder_id: str
    ) -> None:
        """Build a trigger subscription builder"""
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_builder = cls.get_subscription_builder(subscription_builder_id)
        if not subscription_builder:
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")

        if not subscription_builder.name:
            raise ValueError("Subscription builder name is required")

        credential_type = CredentialType.of(subscription_builder.credential_type or CredentialType.UNAUTHORIZED.value)
        if credential_type == CredentialType.UNAUTHORIZED:
            # manually create
            TriggerProviderService.add_trigger_subscription(
                subscription_id=subscription_builder.id,
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
            subscription: Subscription = TriggerManager.subscribe_trigger(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                endpoint=parse_endpoint_id(subscription_builder.endpoint_id),
                parameters=subscription_builder.parameters,
                credentials=subscription_builder.credentials,
                credential_type=credential_type,
            )

            TriggerProviderService.add_trigger_subscription(
                subscription_id=subscription_builder.id,
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
        credential_type: CredentialType,
    ) -> SubscriptionBuilderApiEntity:
        """
        Add a new trigger subscription validation.
        """
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_constructor = provider_controller.get_subscription_constructor()
        subscription_id = str(uuid.uuid4())
        subscription_builder = SubscriptionBuilder(
            id=subscription_id,
            name=None,
            endpoint_id=subscription_id,
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=str(provider_id),
            parameters=subscription_constructor.get_default_parameters() if subscription_constructor else {},
            properties=provider_controller.get_subscription_default_properties(),
            credentials={},
            credential_type=credential_type,
            credential_expires_at=-1,
            expires_at=-1,
        )
        cache_key = cls.encode_cache_key(subscription_id)
        redis_client.setex(cache_key, cls.__BUILDER_CACHE_EXPIRE_SECONDS__, subscription_builder.model_dump_json())
        return cls.builder_to_api_entity(controller=provider_controller, entity=subscription_builder)

    @classmethod
    def update_trigger_subscription_builder(
        cls,
        tenant_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
        subscription_builder_updater: SubscriptionBuilderUpdater,
    ) -> SubscriptionBuilderApiEntity:
        """
        Update a trigger subscription validation.
        """
        subscription_id = subscription_builder_id
        provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        cache_key = cls.encode_cache_key(subscription_id)
        subscription_builder_cache = cls.get_subscription_builder(subscription_builder_id)
        if not subscription_builder_cache or subscription_builder_cache.tenant_id != tenant_id:
            raise ValueError(f"Subscription {subscription_id} expired or not found")

        subscription_builder_updater.update(subscription_builder_cache)

        redis_client.setex(
            cache_key, cls.__BUILDER_CACHE_EXPIRE_SECONDS__, subscription_builder_cache.model_dump_json()
        )
        return cls.builder_to_api_entity(controller=provider_controller, entity=subscription_builder_cache)

    @classmethod
    def builder_to_api_entity(
        cls, controller: PluginTriggerProviderController, entity: SubscriptionBuilder
    ) -> SubscriptionBuilderApiEntity:
        credential_type = CredentialType.of(entity.credential_type or CredentialType.UNAUTHORIZED.value)
        return SubscriptionBuilderApiEntity(
            id=entity.id,
            name=entity.name or "",
            provider=entity.provider_id,
            endpoint=parse_endpoint_id(entity.endpoint_id),
            parameters=entity.parameters,
            properties=entity.properties,
            credential_type=credential_type,
            credentials=masked_credentials(
                schemas=controller.get_credentials_schema(credential_type),
                credentials=entity.credentials,
            ),
        )

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
    def append_log(cls, endpoint_id: str, request: Request, response: Response) -> None:
        """Append validation request log to Redis."""
        log = RequestLog(
            id=str(uuid.uuid4()),
            endpoint=endpoint_id,
            request={
                "method": request.method,
                "url": request.url,
                "headers": dict(request.headers),
                "data": request.get_data(as_text=True),
            },
            response={
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "data": response.get_data(as_text=True),
            },
            created_at=datetime.now(),
        )

        key = f"trigger:subscription:builder:logs:{endpoint_id}"
        logs = json.loads(redis_client.get(key) or "[]")
        logs.append(log.model_dump(mode="json"))

        # Keep last N logs
        logs = logs[-cls.__VALIDATION_REQUEST_CACHE_COUNT__ :]
        redis_client.setex(key, cls.__VALIDATION_REQUEST_CACHE_EXPIRE_SECONDS__, json.dumps(logs, default=str))

    @classmethod
    def list_logs(cls, endpoint_id: str) -> list[RequestLog]:
        """List request logs for validation endpoint."""
        key = f"trigger:subscription:builder:logs:{endpoint_id}"
        logs_json = redis_client.get(key)
        if not logs_json:
            return []
        return [RequestLog.model_validate(log) for log in json.loads(logs_json)]

    @classmethod
    def process_builder_validation_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Process a temporary endpoint request.

        :param endpoint_id: The endpoint identifier
        :param request: The Flask request object
        :return: The Flask response object
        """
        # check if validation endpoint exists
        subscription_builder: SubscriptionBuilder | None = cls.get_subscription_builder(endpoint_id)
        if not subscription_builder:
            return None

        # response to validation endpoint
        controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id=subscription_builder.tenant_id, provider_id=TriggerProviderID(subscription_builder.provider_id)
        )
        try:
            response: TriggerDispatchResponse = controller.dispatch(
                user_id=subscription_builder.user_id,
                request=request,
                subscription=subscription_builder.to_subscription(),
                credentials={},
                credential_type=CredentialType.UNAUTHORIZED,
            )
        except Exception as e:
            error_response = Response(status=500, response=str(e))
            cls.append_log(endpoint_id=endpoint_id, request=request, response=error_response)
            return error_response
        # append the request log
        cls.append_log(endpoint_id=endpoint_id, request=request, response=response.response)
        return response.response

    @classmethod
    def get_subscription_builder_by_id(cls, subscription_builder_id: str) -> SubscriptionBuilderApiEntity:
        """Get a trigger subscription builder API entity."""
        subscription_builder = cls.get_subscription_builder(subscription_builder_id)
        if not subscription_builder:
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")
        return cls.builder_to_api_entity(
            controller=TriggerManager.get_trigger_provider(
                subscription_builder.tenant_id, TriggerProviderID(subscription_builder.provider_id)
            ),
            entity=subscription_builder,
        )
