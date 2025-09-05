"""
Celery tasks for async trigger processing.

These tasks handle trigger workflow execution asynchronously
to avoid blocking the main request thread.
"""

import logging

from celery import shared_task
from sqlalchemy.orm import Session

from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.utils.http_parser import deserialize_request
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.trigger import TriggerSubscription
from services.trigger_service import TriggerService

logger = logging.getLogger(__name__)

# Use workflow queue for trigger processing
TRIGGER_QUEUE = "triggered_workflow_dispatcher"


@shared_task(queue=TRIGGER_QUEUE, bind=True, max_retries=3)
def dispatch_triggered_workflows_async(
    self,
    endpoint_id: str,
    provider_id: str,
    subscription_id: str,
    triggers: list[str],
    request_id: str,
) -> dict:
    """
    Dispatch triggers asynchronously.

    Args:
        endpoint_id: Endpoint ID
        provider_id: Provider ID
        subscription_id: Subscription ID
        triggers: List of triggers to dispatch
        request_id: Unique ID of the stored request

    Returns:
        dict: Execution result with status and dispatched trigger count
    """
    try:
        logger.info(
            "Starting async trigger dispatching for endpoint=%s, triggers=%s, request_id=%s",
            endpoint_id,
            triggers,
            request_id,
        )

        # Load request from storage
        try:
            serialized_request = storage.load_once(f"triggers/{request_id}")
            request = deserialize_request(serialized_request)
        except Exception as e:
            logger.exception("Failed to load request %s", request_id, exc_info=e)
            return {"status": "failed", "error": f"Failed to load request: {str(e)}"}

        with Session(db.engine) as session:
            # Get subscription
            subscription = session.query(TriggerSubscription).filter_by(id=subscription_id).first()
            if not subscription:
                logger.error("Subscription not found: %s", subscription_id)
                return {"status": "failed", "error": "Subscription not found"}

            # Get controller
            controller = TriggerManager.get_trigger_provider(subscription.tenant_id, TriggerProviderID(provider_id))
            if not controller:
                logger.error("Controller not found for provider: %s", provider_id)
                return {"status": "failed", "error": "Controller not found"}

            # Dispatch each trigger
            dispatched_count = 0
            for trigger in triggers:
                try:
                    trigger = controller.get_trigger(trigger)
                    if trigger is None:
                        logger.error(
                            "Trigger '%s' not found in provider '%s'",
                            trigger,
                            provider_id,
                        )
                        continue

                    TriggerService.process_triggered_workflows(
                        subscription=subscription,
                        trigger=trigger,
                        request=request,
                    )
                    dispatched_count += 1

                except Exception:
                    logger.exception(
                        "Failed to dispatch trigger '%s' for subscription %s",
                        trigger,
                        subscription_id,
                    )
                    # Continue processing other triggers even if one fails
                    continue

            logger.info(
                "Completed async trigger dispatching: processed %d/%d triggers",
                dispatched_count,
                len(triggers),
            )

            # Note: Stored request is not deleted here. It should be handled by:
            # 1. Storage system's lifecycle policy (e.g., S3 lifecycle rules for triggers/* prefix)
            # 2. Or periodic cleanup job if using local/persistent storage
            # This ensures request data is available for debugging/retry purposes

            return {
                "status": "completed",
                "dispatched_count": dispatched_count,
                "total_count": len(triggers),
            }

    except Exception as e:
        logger.exception(
            "Error in async trigger dispatching for endpoint %s",
            endpoint_id,
        )
        # Retry the task if not exceeded max retries
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60 * (self.request.retries + 1))

        # Note: Stored request is not deleted even on failure. See comment above for cleanup strategy.

        return {
            "status": "failed",
            "error": str(e),
            "retries": self.request.retries,
        }
