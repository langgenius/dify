import logging
import secrets
import time

from flask import Request, Response

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerDispatchResponse, TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginNotFoundError
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import create_trigger_provider_encrypter_for_subscription
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from graphon.entities.graph_config import NodeConfigDict
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from services.workflow.entities import PluginTriggerDispatchData
from tasks.trigger_processing_tasks import dispatch_triggered_workflows_async

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000

    @classmethod
    def invoke_trigger_event(
        cls, tenant_id: str, user_id: str, node_config: NodeConfigDict, event: PluginTriggerDebugEvent
    ) -> TriggerInvokeEventResponse:
        """Invoke a trigger event."""
        subscription: TriggerSubscription | None = TriggerProviderService.get_subscription_by_id(
            tenant_id=tenant_id,
            subscription_id=event.subscription_id,
        )
        if not subscription:
            raise ValueError("Subscription not found")
        node_data = TriggerEventNodeData.model_validate(node_config["data"], from_attributes=True)
        request = TriggerHttpRequestCachingService.get_request(event.request_id)
        payload = TriggerHttpRequestCachingService.get_payload(event.request_id)
        # invoke triger
        provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id, TriggerProviderID(subscription.provider_id)
        )
        return TriggerManager.invoke_trigger_event(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=TriggerProviderID(event.provider_id),
            event_name=event.name,
            parameters=node_data.resolve_parameters(
                parameter_schemas=provider_controller.get_event_parameters(event_name=event.name)
            ),
            credentials=subscription.credentials,
            credential_type=CredentialType.of(subscription.credential_type),
            subscription=subscription.to_entity(),
            request=request,
            payload=payload,
        )

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Extract and process data from incoming endpoint request.

        Args:
            endpoint_id: Endpoint ID
            request: Request
        """
        timestamp = int(time.time())
        subscription: TriggerSubscription | None = None
        try:
            subscription = TriggerProviderService.get_subscription_by_endpoint(endpoint_id)
        except PluginNotFoundError:
            return Response(status=404, response="Trigger provider not found")
        except Exception:
            return Response(status=500, response="Failed to get subscription by endpoint")

        if not subscription:
            return None

        provider_id = TriggerProviderID(subscription.provider_id)
        controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id=subscription.tenant_id, provider_id=provider_id
        )
        encrypter, _ = create_trigger_provider_encrypter_for_subscription(
            tenant_id=subscription.tenant_id,
            controller=controller,
            subscription=subscription,
        )
        dispatch_response: TriggerDispatchResponse = controller.dispatch(
            request=request,
            subscription=subscription.to_entity(),
            credentials=encrypter.decrypt(subscription.credentials),
            credential_type=CredentialType.of(subscription.credential_type),
        )

        if dispatch_response.events:
            request_id = f"trigger_request_{timestamp}_{secrets.token_hex(6)}"

            # save the request and payload to storage as persistent data
            TriggerHttpRequestCachingService.persist_request(request_id, request)
            TriggerHttpRequestCachingService.persist_payload(request_id, dispatch_response.payload)

            # Validate event names
            for event_name in dispatch_response.events:
                if controller.get_event(event_name) is None:
                    logger.error(
                        "Event name %s not found in provider %s for endpoint %s",
                        event_name,
                        subscription.provider_id,
                        endpoint_id,
                    )
                    raise ValueError(f"Event name {event_name} not found in provider {subscription.provider_id}")

            plugin_trigger_dispatch_data = PluginTriggerDispatchData(
                user_id=dispatch_response.user_id,
                tenant_id=subscription.tenant_id,
                endpoint_id=endpoint_id,
                provider_id=subscription.provider_id,
                subscription_id=subscription.id,
                timestamp=timestamp,
                events=list(dispatch_response.events),
                request_id=request_id,
            )
            dispatch_data = plugin_trigger_dispatch_data.model_dump(mode="json")
            dispatch_triggered_workflows_async.delay(dispatch_data)

            logger.info(
                "Queued async dispatching for %d triggers on endpoint %s with request_id %s",
                len(dispatch_response.events),
                endpoint_id,
                request_id,
            )
        return dispatch_response.response
