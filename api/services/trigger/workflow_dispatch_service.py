"""Dispatch subscribed plugin events into workflow executions outside SQL transactions."""

import json
import logging
from collections.abc import Callable, Mapping
from typing import Protocol

from core.plugin.entities.request import TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginInvokeError
from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from enums import QuotaType
from models.enums import CreatorUserRole, EndUserType
from services.async_workflow_service import (
    TriggerExecutionLogs,
    TriggerWorkflowDispatcher,
    TriggerWorkflowQuery,
    WorkflowQueuePublisher,
)
from services.errors.app import QuotaExceededError
from services.quota_service import QuotaCharge, unlimited
from services.trigger.event_service import TriggerEventService
from services.trigger.subscription_binding_service import TriggerSubscriber, TriggerSubscriptionBindingQuery
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime
from services.workflow.entities import PluginTriggerData, PluginTriggerMetadata, TriggerActor, TriggerWorkflowSnapshot

logger = logging.getLogger(__name__)


class TriggerEndUserProvisioner(Protocol):
    def create_end_user_batch(
        self,
        type: EndUserType,
        tenant_id: str,
        app_ids: list[str],
        user_id: str,
    ) -> Mapping[str, TriggerActor]: ...


class PluginTriggerWorkflowDispatchService:
    def __init__(
        self,
        *,
        workflows: TriggerWorkflowQuery,
        logs: TriggerExecutionLogs,
        queues: WorkflowQueuePublisher,
        dispatch: TriggerWorkflowDispatcher,
        events: TriggerEventService,
        bindings: TriggerSubscriptionBindingQuery,
        end_users: TriggerEndUserProvisioner,
        reserve_quota: Callable[[QuotaType, str], QuotaCharge],
        mark_rate_limited: Callable[[str], None],
    ) -> None:
        self._workflows = workflows
        self._logs = logs
        self._queues = queues
        self._dispatch = dispatch
        self._events = events
        self._bindings = bindings
        self._end_users = end_users
        self._reserve_quota = reserve_quota
        self._mark_rate_limited = mark_rate_limited

    def dispatch_event(
        self,
        *,
        user_id: str,
        subscription: TriggerSubscriptionRuntime,
        event_name: str,
        request_id: str,
    ) -> int:
        """Process triggered workflows.

        Args:
            user_id: The ID of the user who activated the trigger
            subscription: The trigger subscription
            event_name: The name of the trigger event that was activated
            request_id: The ID of the stored request in storage system

        Returns:
            The number of workflows dispatched for the event
        """
        subscribers = self._bindings.get_subscriber_triggers(
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
        prepared_event = self._events.prepare(subscription=subscription, event_name=event_name, request_id=request_id)
        definition = prepared_event.definition

        workflows = self._workflows.get_published_trigger_workflows(
            tenant_id=subscription.tenant_id, app_ids=[subscriber.app_id for subscriber in subscribers]
        )

        end_users_by_app = self._end_users.create_end_user_batch(
            type=EndUserType.TRIGGER,
            tenant_id=subscription.tenant_id,
            app_ids=[plugin_trigger.app_id for plugin_trigger in subscribers],
            user_id=user_id,
        )

        for plugin_trigger in subscribers:
            workflow = workflows.get(plugin_trigger.app_id)
            if not workflow:
                logger.error(
                    "Workflow not found for app %s",
                    plugin_trigger.app_id,
                )
                continue

            event_node = None
            for node in json.loads(workflow.graph)["nodes"]:
                if node["id"] == plugin_trigger.node_id and node["data"]["type"] == TRIGGER_PLUGIN_NODE_TYPE:
                    event_node = node["data"]
                    break

            if not event_node:
                logger.error("Trigger event node not found for app %s", plugin_trigger.app_id)
                continue

            trigger_metadata = PluginTriggerMetadata(
                plugin_unique_identifier=definition.plugin_unique_identifier or "",
                endpoint_id=subscription.endpoint_id,
                provider_id=subscription.provider_id,
                event_name=event_name,
                icon_filename=definition.icon,
                icon_dark_filename=definition.icon_dark,
            )

            quota_charge = unlimited()
            try:
                quota_charge = self._reserve_quota(QuotaType.TRIGGER, subscription.tenant_id)
            except QuotaExceededError:
                self._mark_rate_limited(subscription.tenant_id)
                logger.info(
                    "Tenant %s rate limited, skipping plugin trigger %s", subscription.tenant_id, plugin_trigger.id
                )
                return dispatched_count

            node_data: TriggerEventNodeData = TriggerEventNodeData.model_validate(event_node)
            invoke_response: TriggerInvokeEventResponse | None = None

            try:
                invoke_response = self._events.invoke(event=prepared_event, user_id=user_id, node_data=node_data)
            except PluginInvokeError as e:
                quota_charge.refund()

                error_message = e.to_user_friendly_error(plugin_name=definition.provider_name)
                try:
                    end_user = end_users_by_app.get(plugin_trigger.app_id)
                    self._record_failure(
                        workflow=workflow,
                        plugin_trigger=plugin_trigger,
                        subscription=subscription,
                        trigger_metadata=trigger_metadata,
                        end_user=end_user,
                        error_message=error_message,
                        event_name=event_name,
                        request_id=request_id,
                    )
                except Exception:
                    logger.exception(
                        "Failed to record trigger failure log for app %s",
                        plugin_trigger.app_id,
                    )
                continue
            except Exception:
                quota_charge.refund()

                logger.exception(
                    "Failed to invoke trigger event for app %s",
                    plugin_trigger.app_id,
                )
                continue

            if invoke_response is not None and invoke_response.cancelled:
                quota_charge.refund()

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
                trigger_metadata=trigger_metadata,
            )

            # Trigger async workflow
            try:
                end_user = end_users_by_app.get(plugin_trigger.app_id)
                if not end_user:
                    raise ValueError(f"End user not found for app {plugin_trigger.app_id}")

                self._dispatch.trigger_workflow_async(
                    actor=TriggerActor(id=end_user.id, role=CreatorUserRole.END_USER), trigger_data=trigger_data
                )
                quota_charge.commit()
                dispatched_count += 1
                logger.info(
                    "Triggered workflow for app %s with trigger event %s",
                    plugin_trigger.app_id,
                    event_name,
                )
            except Exception:
                quota_charge.refund()

                logger.exception(
                    "Failed to trigger workflow for app %s",
                    plugin_trigger.app_id,
                )

        return dispatched_count

    def dispatch(
        self,
        *,
        user_id: str,
        events: list[str],
        subscription: TriggerSubscriptionRuntime,
        request_id: str,
    ) -> int:
        dispatched_count = 0
        for event_name in events:
            try:
                dispatched_count += self.dispatch_event(
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

    def _record_failure(
        self,
        *,
        workflow: TriggerWorkflowSnapshot,
        plugin_trigger: TriggerSubscriber,
        subscription: TriggerSubscriptionRuntime,
        trigger_metadata: PluginTriggerMetadata,
        end_user: TriggerActor | None,
        error_message: str,
        event_name: str,
        request_id: str,
    ) -> None:
        actor = TriggerActor(
            id=end_user.id if end_user else subscription.user_id,
            role=CreatorUserRole.END_USER if end_user else CreatorUserRole.ACCOUNT,
        )
        trigger_data = PluginTriggerData(
            app_id=plugin_trigger.app_id,
            tenant_id=subscription.tenant_id,
            workflow_id=workflow.id,
            root_node_id=plugin_trigger.node_id,
            inputs={},
            trigger_metadata=trigger_metadata,
            plugin_id=subscription.provider_id,
            endpoint_id=subscription.endpoint_id,
        )
        # Plan selection can call Billing; resolve it before the atomic three-log write.
        queue = self._queues.get_queue(subscription.tenant_id)
        self._logs.record_invocation_failure(
            workflow=workflow,
            actor=actor,
            trigger_data=trigger_data,
            error=error_message,
            queue=queue,
            failure_inputs={
                "event_name": event_name,
                "subscription_id": subscription.id,
                "request_id": request_id,
                "plugin_trigger_id": plugin_trigger.id,
            },
        )
