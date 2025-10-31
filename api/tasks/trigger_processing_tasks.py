"""
Celery tasks for async trigger processing.

These tasks handle trigger workflow execution asynchronously
to avoid blocking the main request thread.
"""

import logging
from collections.abc import Mapping, Sequence
from typing import Any

from celery import shared_task
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerInvokeEventResponse
from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.events import PluginTriggerDebugEvent, build_plugin_pool_key
from core.trigger.entities.entities import TriggerProviderEntity
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.workflow.enums import NodeType
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from extensions.ext_database import db
from models.model import EndUser
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from models.workflow import Workflow
from services.async_workflow_service import AsyncWorkflowService
from services.end_user_service import EndUserService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from services.trigger.trigger_subscription_operator_service import TriggerSubscriptionOperatorService
from services.workflow.entities import PluginTriggerData, PluginTriggerDispatchData, PluginTriggerMetadata

logger = logging.getLogger(__name__)

# Use workflow queue for trigger processing
TRIGGER_QUEUE = "triggered_workflow_dispatcher"


def dispatch_trigger_debug_event(
    events: list[str],
    user_id: str,
    timestamp: int,
    request_id: str,
    subscription: TriggerSubscription,
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


def _get_latest_workflows_by_app_ids(
    session: Session, subscribers: Sequence[WorkflowPluginTrigger]
) -> Mapping[str, Workflow]:
    """Get the latest workflows by app_ids"""
    workflow_query = (
        select(Workflow.app_id, func.max(Workflow.created_at).label("max_created_at"))
        .where(
            Workflow.app_id.in_({t.app_id for t in subscribers}),
            Workflow.version != Workflow.VERSION_DRAFT,
        )
        .group_by(Workflow.app_id)
        .subquery()
    )
    workflows = session.scalars(
        select(Workflow).join(
            workflow_query,
            (Workflow.app_id == workflow_query.c.app_id) & (Workflow.created_at == workflow_query.c.max_created_at),
        )
    ).all()
    return {w.app_id: w for w in workflows}


def dispatch_triggered_workflow(
    user_id: str,
    subscription: TriggerSubscription,
    event_name: str,
    request_id: str,
) -> int:
    """Process triggered workflows.

    Args:
        subscription: The trigger subscription
        event: The trigger entity that was activated
        request_id: The ID of the stored request in storage system
    """
    request = TriggerHttpRequestCachingService.get_request(request_id)
    payload = TriggerHttpRequestCachingService.get_payload(request_id)

    subscribers: list[WorkflowPluginTrigger] = TriggerSubscriptionOperatorService.get_subscriber_triggers(
        tenant_id=subscription.tenant_id, subscription_id=subscription.id, event_name=event_name
    )
    if not subscribers:
        logger.warning(
            "No workflows found for trigger event '%s' in subscription '%s'",
            event_name,
            subscription.id,
        )
        return 0

    dispatched_count = 0
    provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
        tenant_id=subscription.tenant_id, provider_id=TriggerProviderID(subscription.provider_id)
    )
    trigger_entity: TriggerProviderEntity = provider_controller.entity
    with Session(db.engine) as session:
        workflows: Mapping[str, Workflow] = _get_latest_workflows_by_app_ids(session, subscribers)

        end_users: Mapping[str, EndUser] = EndUserService.create_end_user_batch(
            type=InvokeFrom.TRIGGER,
            tenant_id=subscription.tenant_id,
            app_ids=[plugin_trigger.app_id for plugin_trigger in subscribers],
            user_id=user_id,
        )
        for plugin_trigger in subscribers:
            # Get workflow from mapping
            workflow: Workflow | None = workflows.get(plugin_trigger.app_id)
            if not workflow:
                logger.error(
                    "Workflow not found for app %s",
                    plugin_trigger.app_id,
                )
                continue

            # Find the trigger node in the workflow
            event_node = None
            for node_id, node_config in workflow.walk_nodes(NodeType.TRIGGER_PLUGIN):
                if node_id == plugin_trigger.node_id:
                    event_node = node_config
                    break

            if not event_node:
                logger.error("Trigger event node not found for app %s", plugin_trigger.app_id)
                continue

            # invoke triger
            node_data: TriggerEventNodeData = TriggerEventNodeData.model_validate(event_node)
            invoke_response: TriggerInvokeEventResponse = TriggerManager.invoke_trigger_event(
                tenant_id=subscription.tenant_id,
                user_id=user_id,
                provider_id=TriggerProviderID(subscription.provider_id),
                event_name=event_name,
                parameters=node_data.resolve_parameters(
                    parameter_schemas=provider_controller.get_event_parameters(event_name=event_name)
                ),
                credentials=subscription.credentials,
                credential_type=CredentialType.of(subscription.credential_type),
                subscription=subscription.to_entity(),
                request=request,
                payload=payload,
            )
            if invoke_response.cancelled:
                logger.info(
                    "Trigger ignored for app %s with trigger event %s",
                    plugin_trigger.app_id,
                    event_name,
                )
                continue

            # Create trigger data for async execution
            trigger_data = PluginTriggerData(
                app_id=plugin_trigger.app_id,
                tenant_id=subscription.tenant_id,
                workflow_id=workflow.id,
                root_node_id=plugin_trigger.node_id,
                plugin_id=subscription.provider_id,
                endpoint_id=subscription.endpoint_id,
                inputs=invoke_response.variables,
                trigger_metadata=PluginTriggerMetadata(
                    plugin_unique_identifier=provider_controller.plugin_unique_identifier or "",
                    endpoint_id=subscription.endpoint_id,
                    provider_id=subscription.provider_id,
                    event_name=event_name,
                    icon_filename=trigger_entity.identity.icon or "",
                    icon_dark_filename=trigger_entity.identity.icon_dark or "",
                ),
            )

            # Trigger async workflow
            try:
                end_user = end_users.get(plugin_trigger.app_id)
                if not end_user:
                    raise ValueError(f"End user not found for app {plugin_trigger.app_id}")

                AsyncWorkflowService.trigger_workflow_async(session=session, user=end_user, trigger_data=trigger_data)
                dispatched_count += 1
                logger.info(
                    "Triggered workflow for app %s with trigger event %s",
                    plugin_trigger.app_id,
                    event_name,
                )
            except Exception:
                logger.exception(
                    "Failed to trigger workflow for app %s",
                    plugin_trigger.app_id,
                )

        return dispatched_count


def dispatch_triggered_workflows(
    user_id: str,
    events: list[str],
    subscription: TriggerSubscription,
    request_id: str,
) -> int:
    dispatched_count = 0
    for event_name in events:
        try:
            dispatched_count += dispatch_triggered_workflow(
                user_id=user_id,
                subscription=subscription,
                event_name=event_name,
                request_id=request_id,
            )
        except Exception:
            logger.exception(
                "Failed to dispatch trigger '%s' for subscription %s and provider %s. Continuing...",
                event_name,
                subscription.id,
                subscription.provider_id,
            )
            # Continue processing other triggers even if one fails
            continue

    logger.info(
        "Completed async trigger dispatching: processed %d/%d triggers for subscription %s and provider %s",
        dispatched_count,
        len(events),
        subscription.id,
        subscription.provider_id,
    )
    return dispatched_count


@shared_task(queue=TRIGGER_QUEUE)
def dispatch_triggered_workflows_async(
    dispatch_data: Mapping[str, Any],
) -> Mapping[str, Any]:
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

        subscription: TriggerSubscription | None = TriggerProviderService.get_subscription_by_id(
            tenant_id=tenant_id,
            subscription_id=subscription_id,
        )
        if not subscription:
            logger.error("Subscription not found: %s", subscription_id)
            return {"status": "failed", "error": "Subscription not found"}

        workflow_dispatched = dispatch_triggered_workflows(
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
