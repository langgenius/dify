"""
Celery tasks for async trigger processing.

These tasks handle trigger workflow execution asynchronously
to avoid blocking the main request thread.
"""

import logging

from celery import shared_task
from sqlalchemy.orm import Session

from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import (
    create_trigger_provider_encrypter_for_properties,
    create_trigger_provider_encrypter_for_subscription,
)
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from services.trigger.trigger_debug_service import PluginTriggerDebugEvent, TriggerDebugService
from services.trigger.trigger_service import TriggerService
from services.workflow.entities import PluginTriggerDispatchData

logger = logging.getLogger(__name__)

# Use workflow queue for trigger processing
TRIGGER_QUEUE = "triggered_workflow_dispatcher"


@shared_task(queue=TRIGGER_QUEUE)
def dispatch_triggered_workflows_async(
    dispatch_data: dict,
) -> dict:
    """
    Dispatch triggers asynchronously.

    Args:
        endpoint_id: Endpoint ID
        provider_id: Provider ID
        subscription_id: Subscription ID
        timestamp: Timestamp of the event
        triggers: List of triggers to dispatch
        request_id: Unique ID of the stored request

    Returns:
        dict: Execution result with status and dispatched trigger count
    """
    dispatch_params: PluginTriggerDispatchData = PluginTriggerDispatchData.model_validate(dispatch_data)
    endpoint_id = dispatch_params.endpoint_id
    provider_id = dispatch_params.provider_id
    subscription_id = dispatch_params.subscription_id
    timestamp = dispatch_params.timestamp
    events = dispatch_params.events
    request_id = dispatch_params.request_id

    try:
        logger.info(
            "Starting async trigger dispatching for endpoint=%s, events=%s, request_id=%s, timestamp=%s",
            endpoint_id,
            events,
            request_id,
            timestamp,
        )

        # Verify request exists in storage
        try:
            serialized_request = storage.load_once(f"triggers/{request_id}")
            # Just verify it exists, we don't need to deserialize it here
            if not serialized_request:
                raise ValueError("Request not found in storage")
        except Exception as e:
            logger.exception("Failed to load request %s", request_id, exc_info=e)
            return {"status": "failed", "error": f"Failed to load request: {str(e)}"}

        with Session(db.engine) as session:
            # Get subscription
            subscription: TriggerSubscription | None = (
                session.query(TriggerSubscription).filter_by(id=subscription_id).first()
            )
            if not subscription:
                logger.error("Subscription not found: %s", subscription_id)
                return {"status": "failed", "error": "Subscription not found"}

            # Get controller
            controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                subscription.tenant_id, TriggerProviderID(provider_id)
            )
            if not controller:
                logger.error("Controller not found for provider: %s", provider_id)
                return {"status": "failed", "error": "Controller not found"}

            credential_encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                tenant_id=subscription.tenant_id,
                controller=controller,
                subscription=subscription,
            )
            subscription.credentials = credential_encrypter.decrypt(subscription.credentials)

            properties_encrypter, _ = create_trigger_provider_encrypter_for_properties(
                tenant_id=subscription.tenant_id,
                controller=controller,
                subscription=subscription,
            )
            subscription.properties = properties_encrypter.decrypt(subscription.properties)

            # Dispatch each trigger
            dispatched_count = 0
            for event_name in events:
                try:
                    event = controller.get_event(event_name)
                    if event is None:
                        logger.error(
                            "Trigger '%s' not found in provider '%s'",
                            event_name,
                            provider_id,
                        )
                        continue

                    dispatched_count += TriggerService.dispatch_triggered_workflows(
                        subscription=subscription,
                        event=event,
                        request_id=request_id,
                    )

                except Exception:
                    logger.exception(
                        "Failed to dispatch trigger '%s' for subscription %s",
                        event_name,
                        subscription_id,
                    )
                    # Continue processing other triggers even if one fails
                    continue

            # Dispatch to debug sessions after processing all triggers
            debug_dispatched = 0
            try:
                for event_name in events:
                    pool_key: str = PluginTriggerDebugEvent.build_pool_key(
                        tenant_id=subscription.tenant_id,
                        subscription_id=subscription_id,
                        event_name=event_name,
                        provider_id=provider_id,
                    )
                    event = PluginTriggerDebugEvent(
                        subscription_id=subscription_id,
                        request_id=request_id,
                        timestamp=timestamp,
                        event_name=event_name,
                    )
                    debug_dispatched += TriggerDebugService.dispatch(
                        tenant_id=subscription.tenant_id,
                        event=event,
                        pool_key=pool_key,
                    )
            except Exception:
                # Silent failure for debug dispatch
                logger.exception("Failed to dispatch to debug sessions")

            logger.info(
                "Completed async trigger dispatching: processed %d/%d triggers",
                dispatched_count,
                len(events),
            )

            return {
                "status": "completed",
                "total_count": len(events),
                "dispatched_count": dispatched_count,
                "debug_dispatched_count": debug_dispatched,
            }

    except Exception as e:
        logger.exception(
            "Error in async trigger dispatching for endpoint %s data %s",
            endpoint_id,
            dispatch_data,
        )
        return {
            "status": "failed",
            "error": str(e),
        }
