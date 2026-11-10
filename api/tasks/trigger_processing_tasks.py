"""
Celery tasks for async trigger processing.

These tasks handle trigger workflow execution asynchronously
to avoid blocking the main request thread.
"""

import logging
from collections.abc import Mapping
from typing import Any

from celery import shared_task

from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.events import PluginTriggerDebugEvent, build_plugin_pool_key
from extensions.ext_application_services import application_services
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime
from services.workflow.entities import PluginTriggerDispatchData

logger = logging.getLogger(__name__)

# Use workflow queue for trigger processing
TRIGGER_QUEUE = "triggered_workflow_dispatcher"


def dispatch_trigger_debug_event(
    events: list[str],
    user_id: str,
    timestamp: int,
    request_id: str,
    subscription: TriggerSubscriptionRuntime,
) -> int:
    debug_dispatched = 0
    try:
        for event_name in events:
            pool_key: str = build_plugin_pool_key(
                name=event_name,
                tenant_id=subscription.tenant_id,
                subscription_id=subscription.id,
                provider_id=subscription.provider_id,
            )
            trigger_debug_event: PluginTriggerDebugEvent = PluginTriggerDebugEvent(
                timestamp=timestamp,
                user_id=user_id,
                name=event_name,
                request_id=request_id,
                subscription_id=subscription.id,
                provider_id=subscription.provider_id,
            )
            debug_dispatched += TriggerDebugEventBus.dispatch(
                tenant_id=subscription.tenant_id,
                event=trigger_debug_event,
                pool_key=pool_key,
            )
            logger.debug(
                "Trigger debug dispatched %d sessions to pool %s for event %s for subscription %s provider %s",
                debug_dispatched,
                pool_key,
                event_name,
                subscription.id,
                subscription.provider_id,
            )
        return debug_dispatched
    except Exception:
        logger.exception("Failed to dispatch to debug sessions")
        return 0


@shared_task(queue=TRIGGER_QUEUE)
def dispatch_triggered_workflows_async(
    dispatch_data: Mapping[str, Any],
) -> Mapping[str, Any]:
    """
    Dispatch triggers asynchronously.

    Args:
        dispatch_data: Dispatch payload validated into PluginTriggerDispatchData,
            carrying user_id, tenant_id, endpoint_id, provider_id,
            subscription_id, timestamp, events, and request_id

    Returns:
        dict: Execution result with status and dispatched trigger count
    """
    dispatch_params: PluginTriggerDispatchData = PluginTriggerDispatchData.model_validate(dispatch_data)
    user_id = dispatch_params.user_id
    tenant_id = dispatch_params.tenant_id
    endpoint_id = dispatch_params.endpoint_id
    provider_id = dispatch_params.provider_id
    subscription_id = dispatch_params.subscription_id
    timestamp = dispatch_params.timestamp
    events = dispatch_params.events
    request_id = dispatch_params.request_id

    try:
        logger.info(
            "Starting trigger dispatching uid=%s, endpoint=%s, events=%s, req_id=%s, sub_id=%s, provider_id=%s",
            user_id,
            endpoint_id,
            events,
            request_id,
            subscription_id,
            provider_id,
        )

        subscription = application_services().workspaces.trigger_subscriptions.get_for_execution(
            tenant_id=tenant_id,
            subscription_id=subscription_id,
        )
        if not subscription:
            logger.error("Subscription not found: %s", subscription_id)
            return {"status": "failed", "error": "Subscription not found"}

        workflow_dispatched = application_services().workspaces.trigger_workflow_dispatch.dispatch(
            user_id=user_id,
            events=events,
            subscription=subscription,
            request_id=request_id,
        )

        debug_dispatched = dispatch_trigger_debug_event(
            events=events,
            user_id=user_id,
            timestamp=timestamp,
            request_id=request_id,
            subscription=subscription,
        )

        return {
            "status": "completed",
            "total_count": len(events),
            "workflows": workflow_dispatched,
            "debug_events": debug_dispatched,
        }

    except Exception as e:
        logger.exception(
            "Error in async trigger dispatching for endpoint %s data %s for subscription %s and provider %s",
            endpoint_id,
            dispatch_data,
            subscription_id,
            provider_id,
        )
        return {
            "status": "failed",
            "error": str(e),
        }
