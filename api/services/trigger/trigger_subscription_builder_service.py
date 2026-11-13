import logging
import uuid
from collections.abc import Mapping
from contextlib import AbstractContextManager
from datetime import datetime
from typing import Any, Protocol

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
    SubscriptionConstructor,
)
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.utils.encryption import masked_credentials
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from models.provider_ids import TriggerProviderID

logger = logging.getLogger(__name__)


class TriggerSubscriptionBuilderStore(Protocol):
    """Persist temporary builders and validation logs without owning their policies."""

    def get(self, *, subscription_id: str) -> SubscriptionBuilder | None: ...

    def save(self, *, builder: SubscriptionBuilder) -> None: ...

    def delete(self, *, subscription_id: str) -> None: ...

    def lock(self, *, subscription_id: str) -> AbstractContextManager[None]: ...

    def list_logs(self, *, endpoint_id: str) -> list[RequestLog]: ...

    def append_log(self, *, log: RequestLog) -> None: ...


class TriggerSubscriptionBuilderQuery(Protocol):
    def get_subscription_builder(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> SubscriptionBuilder | None:
        """Return the owned builder, or None if its temporary capability expired."""
        ...


class TriggerSubscriptionProviderLookup(Protocol):
    def __call__(self, *, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderController: ...


class TriggerSubscriber(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        endpoint: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> Subscription: ...


class TriggerSubscriptionWriter(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        provider_id: TriggerProviderID,
        endpoint_id: str,
        credential_type: CredentialType,
        parameters: Mapping[str, Any],
        properties: Mapping[str, Any],
        credentials: Mapping[str, str],
        subscription_id: str,
        credential_expires_at: int,
        expires_at: int,
    ) -> Mapping[str, Any]: ...


class TriggerSubscriptionBuilderService:
    """Manage temporary subscription ownership, updates and provider verification."""

    def __init__(
        self,
        *,
        builders: TriggerSubscriptionBuilderStore,
        get_provider: TriggerSubscriptionProviderLookup,
        subscribe: TriggerSubscriber,
        create_subscription: TriggerSubscriptionWriter,
    ) -> None:
        self._builders = builders
        self._get_provider = get_provider
        self._subscribe = subscribe
        self._create_subscription = create_subscription

    def create_trigger_subscription_builder(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        credential_type: CredentialType,
    ) -> SubscriptionBuilderApiEntity:
        """
        Add a new trigger subscription validation.
        """
        provider_controller = self._get_provider(tenant_id=tenant_id, provider_id=provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        subscription_constructor: SubscriptionConstructor | None = provider_controller.get_subscription_constructor()
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
        self._builders.save(builder=subscription_builder)
        return self.builder_to_api_entity(controller=provider_controller, entity=subscription_builder)

    def update_trigger_subscription_builder(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
        subscription_builder_updater: SubscriptionBuilderUpdater,
    ) -> SubscriptionBuilderApiEntity:
        """
        Update a trigger subscription validation.
        """
        subscription_id = subscription_builder_id
        provider_controller = self._get_provider(tenant_id=tenant_id, provider_id=provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        # Acquire lock to prevent concurrent updates
        with self._builders.lock(subscription_id=subscription_id):
            subscription_builder_cache = self._require_owned_subscription_builder(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                subscription_builder_id=subscription_builder_id,
            )

            subscription_builder_updater.update(subscription_builder_cache)

            self._builders.save(builder=subscription_builder_cache)
            return self.builder_to_api_entity(controller=provider_controller, entity=subscription_builder_cache)

    def update_and_verify_builder(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
        subscription_builder_updater: SubscriptionBuilderUpdater,
    ) -> Mapping[str, bool]:
        """
        Atomically update and verify a subscription builder.
        This ensures the verification is done on the exact data that was just updated.
        """
        subscription_id = subscription_builder_id
        provider_controller = self._get_provider(tenant_id=tenant_id, provider_id=provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        # Acquire lock for the entire update + verify operation
        with self._builders.lock(subscription_id=subscription_id):
            subscription_builder_cache = self._require_owned_subscription_builder(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                subscription_builder_id=subscription_builder_id,
            )

            # Update
            subscription_builder_updater.update(subscription_builder_cache)
            self._builders.save(builder=subscription_builder_cache)

            # Verify (using the just-updated data)
            if subscription_builder_cache.credential_type == CredentialType.OAUTH2:
                return {"verified": bool(subscription_builder_cache.credentials)}

            if subscription_builder_cache.credential_type == CredentialType.API_KEY:
                credentials_to_validate = subscription_builder_cache.credentials
                try:
                    provider_controller.validate_credentials(user_id, credentials_to_validate)
                except ToolProviderCredentialValidationError as e:
                    raise ValueError(f"Invalid credentials: {e}") from e
                return {"verified": True}

            return {"verified": True}

    def update_and_build_builder(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
        subscription_builder_updater: SubscriptionBuilderUpdater,
    ) -> None:
        """
        Atomically update and build a subscription builder.
        This ensures the build uses the exact data that was just updated.
        """
        subscription_id = subscription_builder_id
        provider_controller = self._get_provider(tenant_id=tenant_id, provider_id=provider_id)
        if not provider_controller:
            raise ValueError(f"Provider {provider_id} not found")

        # Acquire lock for the entire update + build operation
        with self._builders.lock(subscription_id=subscription_id):
            subscription_builder = self._require_owned_subscription_builder(
                tenant_id=tenant_id,
                user_id=user_id,
                provider_id=provider_id,
                subscription_builder_id=subscription_builder_id,
            )

            # Update
            subscription_builder_updater.update(subscription_builder)
            self._builders.save(builder=subscription_builder)

            if not subscription_builder.name:
                raise ValueError("Subscription builder name is required")

            # Build
            credential_type = CredentialType.of(subscription_builder.credential_type or CredentialType.UNAUTHORIZED)
            if credential_type == CredentialType.UNAUTHORIZED:
                # manually create
                self._create_subscription(
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
                subscription: Subscription = self._subscribe(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    provider_id=provider_id,
                    endpoint=generate_plugin_trigger_endpoint_url(subscription_builder.endpoint_id),
                    parameters=subscription_builder.parameters,
                    credentials=subscription_builder.credentials,
                    credential_type=credential_type,
                )

                self._create_subscription(
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
                    expires_at=(
                        subscription.expires_at
                        if subscription.expires_at is not None
                        else (subscription_builder.expires_at or -1)
                    ),
                )

            # Delete the builder after successful subscription creation
            self._builders.delete(subscription_id=subscription_id)

    @staticmethod
    def builder_to_api_entity(
        controller: PluginTriggerProviderController, entity: SubscriptionBuilder
    ) -> SubscriptionBuilderApiEntity:
        credential_type = CredentialType.of(entity.credential_type or CredentialType.UNAUTHORIZED.value)
        return SubscriptionBuilderApiEntity(
            id=entity.id,
            name=entity.name or "",
            provider=entity.provider_id,
            endpoint=generate_plugin_trigger_endpoint_url(entity.endpoint_id),
            parameters=entity.parameters,
            properties=entity.properties,
            credential_type=credential_type,
            credentials=masked_credentials(
                schemas=controller.get_credentials_schema(credential_type),
                credentials=entity.credentials,
            )
            if controller.get_subscription_constructor()
            else {},
        )

    def _get_subscription_builder_by_endpoint_id(self, endpoint_id: str) -> SubscriptionBuilder | None:
        """Resolve the public validation capability without authenticated owner context."""
        subscription_builder = self._builders.get(subscription_id=endpoint_id)
        if subscription_builder is not None and subscription_builder.endpoint_id == endpoint_id:
            return subscription_builder

        return None

    def get_subscription_builder(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> SubscriptionBuilder | None:
        """Return an owned temporary builder, or None when no temporary builder exists."""
        subscription_builder = self._get_subscription_builder_by_endpoint_id(subscription_builder_id)
        if subscription_builder is None:
            return None
        if (
            subscription_builder.id != subscription_builder_id
            or subscription_builder.tenant_id != tenant_id
            or subscription_builder.user_id != user_id
            or subscription_builder.provider_id != str(provider_id)
        ):
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")
        return subscription_builder

    def _require_owned_subscription_builder(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> SubscriptionBuilder:
        """Return an owned temporary builder or reject an absent capability."""
        subscription_builder = self.get_subscription_builder(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            subscription_builder_id=subscription_builder_id,
        )
        if subscription_builder is None:
            raise ValueError(f"Subscription builder {subscription_builder_id} not found")
        return subscription_builder

    def append_log(self, endpoint_id: str, request: Request, response: Response) -> None:
        """Record the validation request and its response."""
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

        self._builders.append_log(log=log)

    def list_logs(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> list[RequestLog]:
        """List request logs for validation endpoint."""
        subscription_builder = self._require_owned_subscription_builder(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            subscription_builder_id=subscription_builder_id,
        )

        return self._builders.list_logs(endpoint_id=subscription_builder.endpoint_id)

    def process_builder_validation_endpoint(self, endpoint_id: str, request: Request) -> Response | None:
        """
        Process a temporary endpoint request.

        :param endpoint_id: The endpoint identifier
        :param request: The Flask request object
        :return: The Flask response object
        """
        # check if validation endpoint exists
        subscription_builder: SubscriptionBuilder | None = self._get_subscription_builder_by_endpoint_id(endpoint_id)
        if not subscription_builder:
            return None

        try:
            # response to validation endpoint
            controller: PluginTriggerProviderController = self._get_provider(
                tenant_id=subscription_builder.tenant_id,
                provider_id=TriggerProviderID(subscription_builder.provider_id),
            )
            dispatch_response: TriggerDispatchResponse = controller.dispatch(
                request=request,
                subscription=subscription_builder.to_subscription(),
                credentials={},
                credential_type=CredentialType.UNAUTHORIZED,
            )
            response: Response = dispatch_response.response
            # append the request log
            self.append_log(
                endpoint_id=endpoint_id,
                request=request,
                response=response,
            )
            return response
        except Exception:
            logger.exception("Error during validation endpoint dispatch for endpoint_id=%s", endpoint_id)
            error_response = Response(status=500, response="An internal error has occurred.")
            self.append_log(endpoint_id=endpoint_id, request=request, response=error_response)
            return error_response

    def get_subscription_builder_by_id(
        self,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_builder_id: str,
    ) -> SubscriptionBuilderApiEntity:
        """Get a trigger subscription builder API entity."""
        subscription_builder = self._require_owned_subscription_builder(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            subscription_builder_id=subscription_builder_id,
        )
        return self.builder_to_api_entity(
            controller=self._get_provider(tenant_id=tenant_id, provider_id=provider_id),
            entity=subscription_builder,
        )
