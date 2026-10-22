"""Adapt persisted endpoint snapshots to the plugin runtime and existing task queue."""

from flask import Request

from core.helper.provider_encryption import create_provider_encrypter
from core.plugin.impl.exc import PluginNotFoundError
from core.trigger.entities.entities import Subscription
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from models.provider_ids import TriggerProviderID
from services.trigger.endpoint_service import (
    TriggerEndpointDispatch,
    TriggerEndpointLoadError,
    TriggerEndpointProviderNotFoundError,
)
from services.trigger.subscription_service import TriggerSubscriptionSnapshot
from services.workflow.entities import PluginTriggerDispatchData


class PluginTriggerEndpointGateway:
    """Use existing credential caches after the subscription query has closed.

    TODO: The shared RSA key provider still owns a scoped DB session; remove that
    dependency when tenant key reads return detached values.
    """

    def dispatch(self, *, subscription: TriggerSubscriptionSnapshot, request: Request) -> TriggerEndpointDispatch:
        try:
            provider = TriggerManager.get_trigger_provider(
                tenant_id=subscription.tenant_id, provider_id=TriggerProviderID(subscription.provider_id)
            )
            credentials_encrypter, _ = create_provider_encrypter(
                tenant_id=subscription.tenant_id,
                config=provider.get_credential_schema_config(subscription.credential_type),
                cache=TriggerProviderCredentialsCache(
                    tenant_id=subscription.tenant_id,
                    provider_id=str(provider.get_provider_id()),
                    credential_id=subscription.id,
                ),
            )
            credentials = credentials_encrypter.decrypt(subscription.credentials)
            properties_encrypter, _ = create_provider_encrypter(
                tenant_id=subscription.tenant_id,
                config=provider.get_properties_schema(),
                cache=TriggerProviderPropertiesCache(
                    tenant_id=subscription.tenant_id,
                    provider_id=str(provider.get_provider_id()),
                    subscription_id=subscription.id,
                ),
            )
            properties = properties_encrypter.decrypt(subscription.properties)
        except PluginNotFoundError as error:
            raise TriggerEndpointProviderNotFoundError(
                f"Trigger provider {subscription.provider_id} not found."
            ) from error
        except Exception as error:
            raise TriggerEndpointLoadError(f"Failed to prepare trigger subscription {subscription.id}.") from error

        result = provider.dispatch(
            request=request,
            subscription=Subscription(
                expires_at=subscription.expires_at,
                endpoint=generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
                parameters=subscription.parameters,
                properties=properties,
            ),
            credentials=credentials,
            credential_type=subscription.credential_type,
        )
        return TriggerEndpointDispatch(
            result=result, event_names=frozenset(event.identity.name for event in provider.get_events())
        )


def enqueue_triggered_workflows(data: PluginTriggerDispatchData) -> None:
    from tasks.trigger_processing_tasks import dispatch_triggered_workflows_async

    dispatch_triggered_workflows_async.delay(data.model_dump(mode="json"))
