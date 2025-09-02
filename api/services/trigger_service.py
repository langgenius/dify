import logging

from flask import Request, Response

from core.plugin.entities.plugin import TriggerProviderID
from core.trigger.entities.entities import TriggerEntity
from core.trigger.trigger_manager import TriggerManager
from models.trigger import TriggerSubscription
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000

    @classmethod
    def process_triggered_workflows(cls, subscription: TriggerSubscription, trigger: TriggerEntity, request: Request) -> None:
        """Process triggered workflows."""
        

    @classmethod
    def select_triggers(cls, controller, dispatch_response, provider_id, subscription) -> list[TriggerEntity]:
        triggers = []
        for trigger_name in dispatch_response.triggers:
            trigger = controller.get_trigger(trigger_name)
            if trigger is None:
                logger.error(
                    "Trigger '%s' not found in provider '%s' for tenant '%s'",
                    trigger_name,
                    provider_id,
                    subscription.tenant_id,
                )
                raise ValueError(f"Trigger '{trigger_name}' not found")
            triggers.append(trigger)
        return triggers

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """Extract and process data from incoming endpoint request."""
        subscription = TriggerProviderService.get_subscription_by_endpoint(endpoint_id)
        if not subscription:
            return None

        provider_id = TriggerProviderID(subscription.provider_id)
        controller = TriggerManager.get_trigger_provider(subscription.tenant_id, provider_id)
        if not controller:
            return None

        dispatch_response = controller.dispatch(
            user_id=subscription.user_id, request=request, subscription=subscription.to_entity()
        )

        # TODO invoke triggers
        if dispatch_response.triggers:
            triggers = cls.select_triggers(controller, dispatch_response, provider_id, subscription)
            for trigger in triggers:
                cls.process_triggered_workflows(
                    subscription=subscription,
                    trigger=trigger,
                    request=request,
                )
        return dispatch_response.response
